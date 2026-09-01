import { describe, expect, it } from 'vitest';
import { createVerletRope } from './rope';
import type { Rope } from './rope';
import { createRopeSimStep } from './ropeStep';
import { createFixedTimestepDriver } from './fixedTimestep';
import type { SimState, Vec3 } from './types';

/**
 * SIM-1 acceptance (plan.md): a pinned rope settles with max stretch <5%,
 * and no NaN across 10k randomized initial states — plus bitwise determinism
 * and driver equivalence. Everything here is seeded: the suite is itself
 * deterministic, run after run.
 */

const DT = 1 / 120;
const DEFAULT_CORD = {
  segmentCount: 16,
  segmentLength: 0.1,
  gravity: 9.81,
  iterations: 4,
  damping: 0.985,
} as const;

/** Tiny deterministic PRNG (mulberry32) — seeded randomness, no surprises. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const range = (rand: () => number, lo: number, hi: number): number => lo + rand() * (hi - lo);

/** Bitwise array equality — the determinism bar is exact, not approx. */
function expectBitwiseEqual(a: ArrayLike<number>, b: ArrayLike<number>, label: string): void {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      throw new Error(`${label}: element ${i} differs — ${a[i]} vs ${b[i]}`);
    }
  }
}

function positions(rope: Rope): number[] {
  const out: Vec3 = { x: 0, y: 0, z: 0 };
  const flat: number[] = [];
  for (let i = 0; i < rope.pointCount; i += 1) {
    rope.readPoint(i, out);
    flat.push(out.x, out.y, out.z);
  }
  return flat;
}

/** Seeds a fully randomized initial state (the fuzz condition, reused). */
function seedRandomState(rope: Rope, rand: () => number, velocityScale: number): void {
  for (let i = 0; i < rope.pointCount; i += 1) {
    rope.setPoint(i, range(rand, -2, 2), range(rand, -2, 2), range(rand, -2, 2));
  }
  for (let i = 0; i < rope.pointCount; i += 1) {
    const vx = range(rand, -velocityScale, velocityScale);
    const vy = range(rand, -velocityScale, velocityScale);
    const vz = range(rand, -velocityScale, velocityScale);
    rope.setVelocity(i, vx, vy, vz, DT);
  }
}

describe('rope — settle under gravity (SIM-1 acceptance a)', () => {
  it('a pinned rope dropped horizontally settles: constraints <5% and kinetic energy decays', () => {
    const rope = createVerletRope({
      ...DEFAULT_CORD,
      pin: { x: 0, y: 2, z: 0 },
    });
    // Hardest benign start: stretched out horizontally from the pin.
    rope.placeAlong({ x: 0, y: 2, z: 0 }, { x: 1.6, y: 2, z: 0 });

    const STEPS = 600; // 5 sim seconds
    const ke = new Float64Array(STEPS);
    for (let s = 0; s < STEPS; s += 1) {
      rope.step(DT);
      expect(rope.isFiniteState()).toBe(true);
      ke[s] = rope.kineticEnergy(DT);
    }

    // Every distance constraint holds within 5% of rest length.
    const worst = rope.maxConstraintViolation();
    expect(worst).toBeLessThanOrEqual(0.05);

    // Kinetic energy decays: windowed averages fall monotonically and the
    // tail is a small fraction of the swing.
    const windowAvg = (lo: number, hi: number): number => {
      let sum = 0;
      for (let i = lo; i < hi; i += 1) sum += ke[i];
      return sum / (hi - lo);
    };
    const early = windowAvg(60, 180); // mid-swing
    const mid = windowAvg(300, 420);
    const tail = windowAvg(540, 600);
    expect(mid).toBeLessThan(early);
    expect(tail).toBeLessThan(mid);
    expect(tail).toBeLessThan(0.02 * early);

    // The pin never moved.
    const pin: Vec3 = { x: 0, y: 0, z: 0 };
    rope.readPoint(rope.pinnedIndex, pin);
    expect(pin.x).toBe(0);
    expect(pin.y).toBe(2);
    expect(pin.z).toBe(0);
  });

  it('a kicked hanging rope damps to rest: constraints <5%, energy ~zero, state finite', () => {
    const rope = createVerletRope({
      ...DEFAULT_CORD,
      pin: { x: 0, y: 1.6, z: 0 },
    });
    rope.placeAlong({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: 0 });
    for (let i = 1; i < rope.pointCount; i += 1) {
      rope.setVelocity(i, 1.5, 0, 0.75, DT);
    }
    const keStart = rope.kineticEnergy(DT);

    for (let s = 0; s < 300; s += 1) {
      rope.step(DT);
      expect(rope.isFiniteState()).toBe(true);
    }

    expect(rope.maxConstraintViolation()).toBeLessThanOrEqual(0.05);
    expect(rope.kineticEnergy(DT)).toBeLessThan(0.01 * keStart);
  });
});

describe('rope — robustness across 10,000 randomized initial states (SIM-1 acceptance b)', () => {
  it('10k random/collapsed/duplicated states: zero NaN/Inf, constraints within tolerance or strictly improving, pin immovable', () => {
    const rand = mulberry32(0xc0fd5); // "cords"
    const CONFIGS = 10_000;
    const STEPS = 240; // 2 sim seconds each
    let nanInfCount = 0;
    let failures = 0;
    let worstFinalViolation = 0;
    let worstFinalCase = -1;
    let toleranceMet = 0;

    for (let f = 0; f < CONFIGS; f += 1) {
      const segmentCount = 4 + Math.floor(rand() * 21); // 4..24
      const pinX0 = range(rand, -1, 1);
      const pinY0 = range(rand, 0.5, 2.5);
      const pinZ0 = range(rand, -1, 1);
      const rope = createVerletRope({
        segmentCount,
        segmentLength: 0.1,
        gravity: 9.81,
        iterations: 4,
        damping: 0.985,
        pinIndex: rand() < 0.5 ? 0 : segmentCount, // both ends get pinned duty
        pin: { x: pinX0, y: pinY0, z: pinZ0 },
      });

      const variant = f % 10;
      if (variant === 0) {
        // Fully collapsed: every point stacked at one spot (degenerate-guard
        // path — the 0/0 constraint direction).
        const cx = range(rand, -2, 2);
        const cy = range(rand, -2, 2);
        const cz = range(rand, -2, 2);
        for (let i = 0; i < rope.pointCount; i += 1) rope.setPoint(i, cx, cy, cz);
      } else if (variant === 1) {
        // Random, but every odd point duplicates its neighbor.
        for (let i = 0; i < rope.pointCount; i += 1) {
          if (i % 2 === 1 && i > 0) {
            const src: Vec3 = { x: 0, y: 0, z: 0 };
            rope.readPoint(i - 1, src);
            rope.setPoint(i, src.x, src.y, src.z);
          } else {
            rope.setPoint(i, range(rand, -2, 2), range(rand, -2, 2), range(rand, -2, 2));
          }
        }
      } else {
        // Fully random points in the bounded volume.
        for (let i = 0; i < rope.pointCount; i += 1) {
          rope.setPoint(i, range(rand, -2, 2), range(rand, -2, 2), range(rand, -2, 2));
        }
      }
      // Random velocities, up to a violent 10 units/s per axis.
      for (let i = 0; i < rope.pointCount; i += 1) {
        const vx = range(rand, -10, 10);
        const vy = range(rand, -10, 10);
        const vz = range(rand, -10, 10);
        rope.setVelocity(i, vx, vy, vz, DT);
      }

      const violationBefore = rope.maxConstraintViolation();

      for (let s = 0; s < STEPS; s += 1) {
        rope.step(DT);
        if (!rope.isFiniteState()) nanInfCount += 1;
      }

      const violationAfter = rope.maxConstraintViolation();
      if (violationAfter <= 0.05) toleranceMet += 1;
      if (!(violationAfter <= 0.05 || violationAfter < violationBefore)) failures += 1;
      if (violationAfter > worstFinalViolation) {
        worstFinalViolation = violationAfter;
        worstFinalCase = f;
      }

      // The pin is hard: the pinned point ends bitwise at the configured pin.
      const pinAfter: Vec3 = { x: 0, y: 0, z: 0 };
      rope.readPoint(rope.pinnedIndex, pinAfter);
      expect(pinAfter.x).toBe(pinX0);
      expect(pinAfter.y).toBe(pinY0);
      expect(pinAfter.z).toBe(pinZ0);
    }

    expect(nanInfCount).toBe(0);
    expect(failures).toBe(0);
    // Health bars with teeth (seeded corpus, so these are exact): after 2s
    // the overwhelming majority sits inside the 5% tolerance outright and
    // even the worst tangle (a fully collapsed config) is near it and still
    // converging. Baseline run: 9,851/10,000 within 5%, worst 8.44%.
    expect(toleranceMet).toBeGreaterThanOrEqual(9800);
    expect(worstFinalViolation).toBeLessThanOrEqual(0.10);
    expect(worstFinalCase).toBeGreaterThanOrEqual(0);
  }, 120_000);
});

describe('rope — determinism (SIM-1 acceptance c)', () => {
  const initRope = (seed: number): Rope => {
    const rope = createVerletRope({ ...DEFAULT_CORD, pin: { x: 0, y: 2, z: 0 } });
    rope.placeAlong({ x: 0, y: 2, z: 0 }, { x: 1.6, y: 2, z: 0 });
    seedRandomState(rope, mulberry32(seed), 5);
    return rope;
  };

  it('two identical ropes stepped identically produce bitwise-identical positions', () => {
    const a = initRope(1234);
    const b = initRope(1234);
    for (let s = 0; s < 300; s += 1) {
      a.step(DT);
      b.step(DT);
    }
    expectBitwiseEqual(positions(a), positions(b), 'rope A vs B after 300 steps');
    expect(a.kineticEnergy(DT)).toBe(b.kineticEnergy(DT));
  });

  it('the fixed-timestep driver path is bitwise-identical to direct stepping, and repeatable', () => {
    // Two identical rope-steps driven through the production driver with the
    // same frame-delta sequence (120 frames of 1/60s → 2 substeps each).
    const makeDriven = (): number[] => {
      const step = createRopeSimStep({ cord: { ...DEFAULT_CORD, pin: { x: 0, y: 2, z: 0 } } });
      const driver = createFixedTimestepDriver(step, { timestep: DT, maxSubsteps: 5 });
      let state: SimState = { time: 0, cords: [] };
      for (let frame = 0; frame < 120; frame += 1) {
        const result = driver.advance(state, 1 / 60, { pointerRay: null });
        expect(result.substeps).toBe(2); // pins the 240-slice equivalence below
        state = result.state;
      }
      return state.cords[0].points.flatMap((p) => [p.x, p.y, p.z]);
    };
    const driven1 = makeDriven();
    const driven2 = makeDriven();
    expectBitwiseEqual(driven1, driven2, 'driver run 1 vs run 2');

    // The driven path must match direct stepping of the same 240 slices —
    // the driver adds nothing between rope.step(dt) calls. The spawn endpoint
    // is computed with the adapter's exact expression so the initial arrays
    // agree bitwise (a literal 0.4 would differ from 2 - 16*0.1 by one ulp).
    const direct = createVerletRope({ ...DEFAULT_CORD, pin: { x: 0, y: 2, z: 0 } });
    const spawn = {
      x: 0,
      y: 2 - DEFAULT_CORD.segmentCount * DEFAULT_CORD.segmentLength,
      z: 0,
    };
    direct.placeAlong({ x: 0, y: 2, z: 0 }, spawn);
    for (let s = 0; s < 240; s += 1) direct.step(DT);
    expectBitwiseEqual(positions(direct), driven1, 'direct stepping vs driver-fed rope');
  });
});

describe('ropeStep — SimStep adapter smoke', () => {
  it('advances the clock by exactly dt, exposes one cord of pointCount points, all finite, pin exact', () => {
    const step = createRopeSimStep({
      cord: { ...DEFAULT_CORD, pin: { x: 0, y: 1.6, z: 0 } },
    });
    let state: SimState = { time: 0, cords: [] };
    state = step(state, DT, { pointerRay: null });
    expect(state.time).toBeCloseTo(DT, 12);
    expect(state.cords.length).toBe(1);
    expect(state.cords[0].points.length).toBe(DEFAULT_CORD.segmentCount + 1);
    for (const p of state.cords[0].points) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
      expect(Number.isFinite(p.z)).toBe(true);
    }
    const head = state.cords[0].points[0];
    expect(head.x).toBe(0);
    expect(head.y).toBe(1.6); // spawn hangs from the configured pin
    expect(head.z).toBe(0);

    // The shell identity is stable across steps (zero steady-state allocation).
    const sameShell = step(state, DT, { pointerRay: null });
    expect(sameShell).toBe(state);
    expect(state.time).toBeCloseTo(2 * DT, 12);
  });
});

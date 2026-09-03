import { describe, expect, it } from 'vitest';
import { createVerletRope } from './rope';
import type { Rope } from './rope';
import { createRopeSimStep } from './ropeStep';
import { createFixedTimestepDriver } from './fixedTimestep';
import type { SimState, Vec2 } from './types';

/**
 * SIM-2 acceptance (plan.md: "Carried-pin constraint & stretch leash") — the
 * carried cord end is a kinematic pin that converges to its target with
 * bounded velocity (no teleporting) under the stretch leash (the endpoint
 * separation can never exceed the rope's total rest length: the cord
 * stretches and dangles, it never extends). Every test is seeded/analytic —
 * the suite is itself deterministic, run after run.
 *
 * The scenarios: (a) violent drag — a 50 m target teleport in one step; the
 * leash and finiteness hold per substep; (b) leash circle — dragged hard in
 * circles beyond the max radius, the carried pin rides the leash sphere
 * EXACTLY one total length from the seated pin; (c) determinism — identical
 * drag sequences finish bitwise-identical, on the rope and through the
 * production SimStep + fixed-timestep driver; (d) release stub — when the
 * target stops updating, the held cord damps to rest with the carried pin
 * frozen (the real release FSM is later lanes').
 */

const DT = 1 / 120;
const SEGMENTS = 16;
const SEG_LEN = 0.1;
// The solver's leash length is this exact float expression — recompute it the
// same way so the test's bar and the rope's clamp are the same number.
const TOTAL = SEGMENTS * SEG_LEN;
const PIN_Y = 1.6;
const END = SEGMENTS; // carried point index (the seated pin is 0)

const DEFAULT_CORD = {
  segmentCount: SEGMENTS,
  segmentLength: SEG_LEN,
  gravity: 9.81,
  iterations: 4,
  damping: 0.985,
} as const;

/** A rope hanging straight down from (0, PIN_Y, 0), free end carried. */
function makeCarriedRope(): Rope {
  const rope = createVerletRope({ ...DEFAULT_CORD, pin: { x: 0, y: PIN_Y} });
  rope.placeAlong({ x: 0, y: PIN_Y}, { x: 0, y: PIN_Y - TOTAL});
  rope.carryEnd(END);
  return rope;
}

function readPoint(rope: Rope, index: number): Vec2 {
  const out: Vec2 = { x: 0, y: 0};
  rope.readPoint(index, out);
  return out;
}

/** Distance between the two endpoints — the quantity the leash bounds. */
function endpointDistance(rope: Rope): number {
  const a = readPoint(rope, 0);
  const b = readPoint(rope, rope.pointCount - 1);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

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
  const flat: number[] = [];
  for (let i = 0; i < rope.pointCount; i += 1) {
    const p = readPoint(rope, i);
    flat.push(p.x, p.y);
  }
  return flat;
}

describe('carry — violent drag (SIM-2 acceptance a)', () => {
  it('a 50 m target teleport: no NaN/Inf, leash never violated, stretch under 2x rest at every instant, settles taut', () => {
    const rope = makeCarriedRope();
    // The grabbed end hangs at (0, 0, 0); this target is exactly 50 m away:
    // sqrt(30² + 40²) = 50. One call = the whole teleport lands in one step.
    rope.setPinTarget(END, { x: 30, y: 40});

    let nanCount = 0;
    let worstLeashOvershoot = 0; // max over steps of (endpointDistance - TOTAL)
    let worstStretch = 0; // max constraint violation at any step end
    for (let s = 0; s < 600; s += 1) {
      rope.step(DT);
      if (!rope.isFiniteState()) nanCount += 1;
      const overshoot = endpointDistance(rope) - TOTAL;
      if (overshoot > worstLeashOvershoot) worstLeashOvershoot = overshoot;
      const violation = rope.maxConstraintViolation();
      if (violation > worstStretch) worstStretch = violation;
    }

    expect(nanCount).toBe(0);
    // Leash invariant: absolute, with room only for float noise (~1e-16).
    expect(worstLeashOvershoot).toBeLessThanOrEqual(1e-9);
    // Transient stretch stays sane: every segment ≤ 2x rest at every step end.
    expect(worstStretch).toBeLessThanOrEqual(1.0);

    // Held at the unreachable target for 5 more seconds: the pin rides the
    // leash sphere in the target's direction and the cord settles taut.
    for (let s = 0; s < 600; s += 1) rope.step(DT);
    expect(rope.isFiniteState()).toBe(true);
    expect(rope.maxConstraintViolation()).toBeLessThanOrEqual(0.05);
    expect(endpointDistance(rope)).toBeLessThanOrEqual(TOTAL + 1e-9);
  });

  it('the bounded pin converges step by step — it never teleports, even toward a violent target', () => {
    const rope = makeCarriedRope();
    const cap = 12 * DT; // maxPinSpeed * dt: the per-step travel ceiling
    rope.setPinTarget(END, { x: 30, y: 40});
    rope.step(DT);
    const afterOne = readPoint(rope, END);
    // After the teleport frame the pin has moved exactly one cap-length from
    // its start (0, 0, 0), along the target direction (0.6, 0.8, 0) — a drag,
    // not a jump.
    expect(Math.sqrt(afterOne.x * afterOne.x + afterOne.y * afterOne.y))
      .toBeCloseTo(cap, 12);
    expect(afterOne.x / cap).toBeCloseTo(0.6, 9);
    expect(afterOne.y / cap).toBeCloseTo(0.8, 9);

    // The leash point is reached by many steps of bounded travel, never one jump.
    let steps = 1;
    while (steps < 1000 && endpointDistance(rope) < TOTAL - 1e-9) {
      rope.step(DT);
      steps += 1;
    }
    expect(steps).toBeGreaterThan(10);
    expect(rope.isFiniteState()).toBe(true);
    expect(rope.maxConstraintViolation()).toBeLessThanOrEqual(1.0);
  });
});

describe('carry — leash circle (SIM-2 acceptance b)', () => {
  it('dragged in circles hard beyond max radius, the endpoints stay exactly one total length apart', () => {
    const rope = makeCarriedRope();
    // Pull direction: a unit vector tilted 45° below horizontal, rotated
    // around Y each step. Targets sit at 2x the max radius (dragged hard
    // outward), so the leash projection fires on every single step and the
    // carried pin rides the sphere while orbiting the seated pin.
    let ux = Math.SQRT1_2;
    let uy = -Math.SQRT1_2;
    let uz = 0;
    const ANG = 0.02; // rad/step — slower than the pin's max orbit rate, so it tracks
    const PULL = 2 * TOTAL;
    const cosA = Math.cos(ANG);
    const sinA = Math.sin(ANG);

    let worstLeashOvershoot = 0;
    let worstStretch = 0;
    let tautest = Infinity; // min endpoint distance once riding the sphere
    let nanCount = 0;

    for (let s = 0; s < 1500; s += 1) {
      const nx = ux * cosA + uz * sinA;
      const nz = -ux * sinA + uz * cosA;
      ux = nx;
      uz = nz;
      rope.setPinTarget(END, {
        x: ux * PULL,
        y: PIN_Y + uy * PULL
      });
      rope.step(DT);
      if (!rope.isFiniteState()) nanCount += 1;
      const dist = endpointDistance(rope);
      const overshoot = dist - TOTAL;
      if (overshoot > worstLeashOvershoot) worstLeashOvershoot = overshoot;
      const violation = rope.maxConstraintViolation();
      if (violation > worstStretch) worstStretch = violation;
      if (s >= 60 && dist < tautest) tautest = dist;
    }

    expect(nanCount).toBe(0);
    // The leash: absolute, at every one of the 1500 clamped steps.
    expect(worstLeashOvershoot).toBeLessThanOrEqual(1e-9);
    // Riding the sphere: after the first steps the separation is exactly one
    // total length — never measurably inside, never over (float noise band).
    expect(tautest).toBeGreaterThanOrEqual(TOTAL - 1e-9);
    // The swung cord stays sane through the whole orbit.
    expect(worstStretch).toBeLessThanOrEqual(1.0);
  });
});

describe('carry — determinism (SIM-2 acceptance c)', () => {
  it('two ropes driven by the same drag sequence finish bitwise-identical', () => {
    const drag = (rope: Rope): void => {
      for (let f = 0; f < 240; f += 1) {
        const t = f * 0.05;
        rope.setPinTarget(END, {
          x: Math.cos(t) * 2.4,
          y: PIN_Y + 1.1 + Math.sin(t * 1.7) * 1.3
        });
        rope.step(DT);
      }
    };
    const a = makeCarriedRope();
    const b = makeCarriedRope();
    drag(a);
    drag(b);
    expectBitwiseEqual(positions(a), positions(b), 'carried rope A vs B after 240 drag steps');
    expect(a.kineticEnergy(DT)).toBe(b.kineticEnergy(DT));
  });

  it('SimInput.pinTarget through the production SimStep + fixed driver is bitwise-identical across runs', () => {
    const run = (): number[] => {
      const step = createRopeSimStep({ cord: { ...DEFAULT_CORD, pin: { x: 0, y: PIN_Y} } });
      const driver = createFixedTimestepDriver(step, { timestep: DT, maxSubsteps: 5 });
      let state: SimState = { time: 0, cords: [] };
      for (let f = 0; f < 120; f += 1) {
        const t = f * 0.13;
        const result = driver.advance(state, 1 / 60, {
          pointerPoint: null,
          pinTarget: {
            index: END,
            position: {
              x: Math.cos(t) * 2,
              y: 1.0 + Math.sin(t) * 0.8
            },
          },
        });
        expect(result.substeps).toBe(2);
        state = result.state;
      }
      return state.cords[0].points.flatMap((p) => [p.x, p.y]);
    };
    expectBitwiseEqual(run(), run(), 'driver carry run 1 vs run 2');
  });

  it('the carried pin and the seated pin hold bitwise through a whole violent drag', () => {
    const rope = makeCarriedRope();
    for (let f = 0; f < 300; f += 1) {
      const t = f * 0.09;
      rope.setPinTarget(END, {
        x: Math.cos(t) * 2.2,
        y: PIN_Y + Math.sin(t * 1.4) * 1.5
      });
      rope.step(DT);
      const seat = readPoint(rope, 0);
      if (seat.x !== 0 || seat.y !== PIN_Y) {
        throw new Error(`seated pin moved at frame ${f}: ${JSON.stringify(seat)}`);
      }
    }
    expect(rope.isFiniteState()).toBe(true);
  });
});

describe('carry — release stub (SIM-2 acceptance d)', () => {
  it('when the target stops updating, the held cord damps to rest with the carried pin frozen', () => {
    const rope = makeCarriedRope();

    // Violent phase: whip the cord around for a second.
    for (let f = 0; f < 120; f += 1) {
      const t = f * 0.21;
      rope.setPinTarget(END, {
        x: Math.cos(t) * 2.5,
        y: 0.4 + Math.sin(t * 1.3)
      });
      rope.step(DT);
    }
    const keMidSwing = rope.kineticEnergy(DT);
    expect(keMidSwing).toBeGreaterThan(0);

    // The "hand" stops: the last target stands (reachable — inside the leash
    // sphere), nothing new is sent, and the cord settles around the held pin.
    const LAST_TARGET = { x: 0.5, y: 0.9}; // 0.88 from the seat — inside
    rope.setPinTarget(END, LAST_TARGET);
    for (let s = 0; s < 900; s += 1) {
      rope.step(DT);
      expect(rope.isFiniteState()).toBe(true);
    }

    // The carried pin converged exactly onto the last target and is frozen.
    const held = readPoint(rope, END);
    expect(held.x).toBe(LAST_TARGET.x);
    expect(held.y).toBe(LAST_TARGET.y);
    const frozen = positions(rope);
    for (let s = 0; s < 120; s += 1) rope.step(DT);
    // The pin holds bitwise; the free points' residual Verlet oscillation
    // (gravity re-injects every step, damping bleeds it out) stays
    // microscopically small — visually frozen, well under a millimetre.
    const after = positions(rope);
    let maxDrift = 0;
    for (let i = 0; i < after.length; i += 1) {
      const d = Math.abs(after[i] - frozen[i]);
      if (d > maxDrift) maxDrift = d;
    }
    expect(maxDrift).toBeLessThan(5e-3);

    // Settled: constraints within 5%, energy decayed to ~nothing.
    expect(rope.maxConstraintViolation()).toBeLessThanOrEqual(0.05);
    expect(rope.kineticEnergy(DT)).toBeLessThan(0.01 * keMidSwing);

    // The seated pin never moved.
    const seat = readPoint(rope, 0);
    expect(seat.x).toBe(0);
    expect(seat.y).toBe(PIN_Y);
  });
});

describe('carry — API guards and violent-input survival', () => {
  it('carryEnd rejects non-endpoint and seated indices; setPinTarget requires the carried end', () => {
    const rope = makeCarriedRope();
    expect(() => rope.carryEnd(-1)).toThrow();
    expect(() => rope.carryEnd(5)).toThrow();
    expect(() => rope.carryEnd(1.5)).toThrow();
    expect(() => rope.carryEnd(0)).toThrow(); // the seated pin
    expect(() => rope.setPinTarget(END, { x: 1, y: 1})).not.toThrow();

    const bare = createVerletRope({ ...DEFAULT_CORD, pin: { x: 0, y: PIN_Y} });
    expect(bare.carriedIndex).toBe(null);
    expect(() => bare.setPinTarget(0, { x: 1, y: 1})).toThrow(); // nothing carried
  });

  it('NaN/Inf targets are ignored: the pin holds, state stays finite, a later valid target still drags', () => {
    const rope = makeCarriedRope();
    rope.setPinTarget(END, { x: Number.NaN, y: 0});
    rope.step(DT);
    expect(rope.isFiniteState()).toBe(true);
    let p = readPoint(rope, END);
    expect(p.x).toBe(0);
    expect(p.y).toBe(0);

    rope.setPinTarget(END, { x: Number.POSITIVE_INFINITY, y: 0});
    rope.step(DT);
    expect(rope.isFiniteState()).toBe(true);
    p = readPoint(rope, END);
    expect(p.x).toBe(0);

    // A valid target afterwards still engages the (bounded) convergence.
    rope.setPinTarget(END, { x: 0.4, y: 0.2});
    for (let s = 0; s < 120; s += 1) rope.step(DT);
    p = readPoint(rope, END);
    expect(p.x).toBe(0.4);
    expect(p.y).toBe(0.2);
    expect(rope.maxConstraintViolation()).toBeLessThanOrEqual(0.05);
  });

  it('placeAlong disengages the carry — a fresh cord', () => {
    const rope = makeCarriedRope();
    expect(rope.carriedIndex).toBe(END);
    rope.placeAlong({ x: 0, y: PIN_Y}, { x: 0, y: 0});
    expect(rope.carriedIndex).toBe(null);
    expect(() => rope.setPinTarget(END, { x: 0, y: 0})).toThrow();
    rope.step(DT);
    expect(rope.isFiniteState()).toBe(true);
  });

  it('a single-segment rope with both ends pinned survives violent carries (both-pinned solve path)', () => {
    const rope = createVerletRope({
      segmentCount: 1,
      segmentLength: 0.1,
      gravity: 9.81,
      iterations: 4,
      damping: 0.985,
      pin: { x: 0, y: 1},
    });
    rope.placeAlong({ x: 0, y: 1}, { x: 0, y: 0.9});
    rope.carryEnd(1);
    const L = 1 * 0.1;
    for (let f = 0; f < 300; f += 1) {
      const t = f * 0.13;
      rope.setPinTarget(1, {
        x: Math.cos(t) * 1.5,
        y: 1 + Math.sin(t) * 1.2
      });
      rope.step(DT);
      expect(rope.isFiniteState()).toBe(true);
      expect(endpointDistance(rope)).toBeLessThanOrEqual(L + 1e-9);
    }
  });
});

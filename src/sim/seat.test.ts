import { describe, expect, it } from 'vitest';
import { createVerletRope, DEFAULT_ROPE_CONFIG } from './rope';
import type { Rope } from './rope';
import { createRopeSimStep } from './ropeStep';
import { createFixedTimestepDriver } from './fixedTimestep';
import type { SimState, Vec2 } from './types';

/**
 * SIM-3 acceptance (plan.md: "Seat/rest-length solve & settle tuning") — the
 * feel deliverable, asserted numerically, never eyeballed:
 *
 * (a) SETTLE WINDOW — seat a stretched cord; the damped dangle must reach
 *     visual calm (kinetic energy below the settle threshold, rope asleep)
 *     inside the approved [1.0, 2.0] s window, across four plug scenarios
 *     (two violent mid-swing plugs, a near-taut plug, a mild plug).
 * (b) ZERO JITTER — after settle the rope is asleep: per-step position
 *     deltas of the free points are EXACTLY zero (bitwise) for a full second
 *     of steps; kinetic energy is exactly zero.
 * (c) SMOOTH REDISTRIBUTION — seat adopts the stretch-to-reach geometry as
 *     the rest state (zero constraint demand at the plug: no yank), then
 *     adapts every segment to natural rest at a bounded per-step rate in
 *     lockstep (no popping wave), landing exactly on natural.
 * (d) DETERMINISM — identical drag+seat sequences are bitwise-identical, on
 *     the rope and through the production SimStep + fixed-timestep driver.
 *
 * Everything is seeded/analytic — the suite is itself deterministic.
 */

const DT = 1 / 120;
const SEGMENTS = 16;
const SEG_LEN = 0.1;
const TOTAL = SEGMENTS * SEG_LEN;
const PIN_Y = 1.6;
const PIN: Vec2 = { x: 0, y: PIN_Y};
const END = SEGMENTS;

// Plug scenarios. Socket distances from the pin: A 1.513, A2 1.331,
// B 1.550 (near-taut), C 1.076 — all inside the 1.6 leash.
const SOCKET_A: Vec2 = { x: 0.9, y: 0.4};
const SOCKET_A2: Vec2 = { x: 0.2, y: 0.3};
const SOCKET_B: Vec2 = { x: 1.35, y: 0.7};
const SOCKET_C: Vec2 = { x: 0.6, y: 0.9};

/** A rope hanging straight down from PIN (the spawn pose). */
function makeHangingRope(): Rope {
  const rope = createVerletRope({ pin: PIN });
  rope.placeAlong(PIN, { x: 0, y: PIN_Y - TOTAL});
  return rope;
}

/** `frames` of violent circular carry, then converge the pin onto `socket`. */
function dragAndConverge(rope: Rope, socket: Vec2, radius: number, frames = 120): void {
  for (let f = 0; f < frames; f += 1) {
    const t = f * 0.21;
    rope.setPinTarget(END, {
      x: Math.cos(t) * radius,
      y: 0.5 + Math.sin(t * 1.3) * radius * 0.5
    });
    rope.step(DT);
  }
  // The "hand" carries the jack onto the socket: the pin converges bitwise
  // onto it before the plug, so the seat itself injects no teleport.
  for (let f = 0; f < 24; f += 1) {
    rope.setPinTarget(END, socket);
    rope.step(DT);
  }
}

/** Near-taut drag: pull past the leash (riding the sphere), then converge. */
function tautDragAndConverge(rope: Rope, socket: Vec2): void {
  for (let f = 0; f < 90; f += 1) {
    const t = f * 0.15;
    rope.setPinTarget(END, { x: Math.cos(t) * 2.4, y: 0.4});
    rope.step(DT);
  }
  for (let f = 0; f < 24; f += 1) {
    rope.setPinTarget(END, socket);
    rope.step(DT);
  }
}

/** Seats and measures: steps (and adaptation steps) until the rope sleeps. */
function seatAndMeasure(rope: Rope, socket: Vec2): { settleSteps: number; adaptSteps: number } {
  rope.seat({ index: END, position: socket });
  let settleSteps = 0;
  let adaptSteps = 0;
  for (let s = 0; s < 3600; s += 1) {
    rope.step(DT);
    if (!rope.isSettled()) settleSteps = s + 1;
    let adapting = false;
    for (let seg = 0; seg < SEGMENTS; seg += 1) {
      if (rope.readSegmentRest(seg) !== SEG_LEN) adapting = true;
    }
    if (adapting) adaptSteps = s + 1;
  }
  return { settleSteps, adaptSteps };
}

function readPoint(rope: Rope, index: number): Vec2 {
  const out: Vec2 = { x: 0, y: 0};
  rope.readPoint(index, out);
  return out;
}

function positions(rope: Rope): number[] {
  const flat: number[] = [];
  for (let i = 0; i < rope.pointCount; i += 1) {
    const p = readPoint(rope, i);
    flat.push(p.x, p.y);
  }
  return flat;
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

function expectPointAt(rope: Rope, index: number, p: Vec2, label: string): void {
  const got = readPoint(rope, index);
  if (got.x !== p.x || got.y !== p.y) {
    throw new Error(`${label}: point ${index} at ${JSON.stringify(got)}, expected ${JSON.stringify(p)}`);
  }
}

describe('seat — settle window (SIM-3 acceptance a)', () => {
  // The approved feel target, asserted per scenario: seat a stretched cord,
  // calm (KE below settleEnergy → asleep) inside [1.0, 2.0] s. Measured with
  // the shipped defaults (2D re-sweep, seatDamping 0.968): 1.650 / 1.783 /
  // 1.233 / 1.575 s.
  const scenarios = [
    { name: 'violent mid-swing plug, r=1.2', socket: SOCKET_A, kind: 'violent' as const, radius: 1.2 },
    { name: 'violent mid-swing plug, r=2.2', socket: SOCKET_A2, kind: 'violent' as const, radius: 2.2 },
    { name: 'near-taut plug at 97% of leash', socket: SOCKET_B, kind: 'taut' as const, radius: 0 },
    { name: 'mild plug, r=0.6', socket: SOCKET_C, kind: 'violent' as const, radius: 0.6 },
  ];

  for (const sc of scenarios) {
    it(`${sc.name}: damps to calm (asleep) inside [1.0, 2.0] s, linked pins exact, no NaN`, () => {
      const rope = makeHangingRope();
      rope.carryEnd(END); // awaiting-plug: seated anchor + carried end
      if (sc.kind === 'violent') dragAndConverge(rope, sc.socket, sc.radius);
      else tautDragAndConverge(rope, sc.socket);

      const { settleSteps } = seatAndMeasure(rope, sc.socket);
      const settleSeconds = settleSteps * DT;
      expect(settleSeconds).toBeGreaterThanOrEqual(1.0);
      expect(settleSeconds).toBeLessThanOrEqual(2.0);

      // Calm means ASLEEP: bitwise-still from here (asserted harder in b).
      expect(rope.isSettled()).toBe(true);
      expect(rope.isFiniteState()).toBe(true);

      // The linked state: both endpoints pinned exactly where they belong.
      expect(rope.isEndSeated(END)).toBe(true);
      expectPointAt(rope, 0, PIN, 'anchor pin');
      expectPointAt(rope, END, sc.socket, 'plugged pin');
    });
  }

  it('rest adaptation finishes early in the window (measured 0.02–0.05 s), then the dangle decays', () => {
    const rope = makeHangingRope();
    rope.carryEnd(END);
    dragAndConverge(rope, SOCKET_A, 1.2);
    const { adaptSteps, settleSteps } = seatAndMeasure(rope, SOCKET_A);
    expect(adaptSteps * DT).toBeLessThan(0.1); // slack returns fast + smooth
    expect(settleSteps * DT).toBeGreaterThanOrEqual(1.0); // the swing carries the window
    for (let s = 0; s < SEGMENTS; s += 1) {
      expect(rope.readSegmentRest(s)).toBe(SEG_LEN); // exact natural at the end
    }
  });
});

describe('seat — zero residual jitter (SIM-3 acceptance b)', () => {
  it('after settle the rope sleeps: per-step free-point deltas exactly 0 for a full second, KE exactly 0', () => {
    const rope = makeHangingRope();
    rope.carryEnd(END);
    dragAndConverge(rope, SOCKET_A, 1.2);
    seatAndMeasure(rope, SOCKET_A);
    expect(rope.isSettled()).toBe(true);

    const STEPS = 120; // one full second at the 120 Hz slice
    for (let s = 0; s < STEPS; s += 1) {
      const before = positions(rope);
      rope.step(DT);
      const after = positions(rope);
      for (let i = 0; i < after.length; i += 1) {
        if (after[i] !== before[i]) {
          throw new Error(
            `jitter at step ${s}, element ${i}: ${before[i]} -> ${after[i]}`,
          );
        }
      }
      expect(rope.kineticEnergy(DT)).toBe(0);
      expect(rope.isSettled()).toBe(true);
      expect(rope.isFiniteState()).toBe(true);
    }

    // Still linked exactly.
    expectPointAt(rope, 0, PIN, 'anchor pin after sleep');
    expectPointAt(rope, END, SOCKET_A, 'plugged pin after sleep');
    expect(rope.maxConstraintViolation()).toBeLessThanOrEqual(0.05);
  });
});

describe('seat — smooth rest redistribution (SIM-3 acceptance c)', () => {
  it('seat adopts the stretched geometry with zero constraint demand, then adapts at a bounded per-step rate to exact natural rest', () => {
    const rope = makeHangingRope();
    // Build an (unphysical but reachable via API) stretch-to-reach state:
    // every point on a vertical line at 2x spacing — segments 200% of rest.
    const SPACING = 2 * SEG_LEN;
    for (let i = 0; i < rope.pointCount; i += 1) {
      rope.setPoint(i, 0, PIN_Y - SPACING * i);
    }
    const stretchedSeat: Vec2 = { x: 0, y: PIN_Y - SPACING * SEGMENTS};

    const violationBefore = rope.maxConstraintViolation();
    expect(violationBefore).toBeCloseTo(1.0, 5); // demanding natural rest on 2x segments
    expect(rope.readSegmentRest(0)).toBe(SEG_LEN); // rest state still natural

    rope.seat({ index: END, position: stretchedSeat });

    // NO YANK AT THE PLUG: rest adopts the geometry, so the constraint
    // demand collapses to ~zero instead of snapping 2x -> 1x in one step.
    const violationAtSeat = rope.maxConstraintViolation();
    expect(violationAtSeat).toBeLessThan(0.01);
    expect(violationAtSeat).toBeLessThan(violationBefore / 10);
    expect(rope.readSegmentRest(0)).toBeGreaterThan(SPACING * 0.99);

    // Adaptation: every segment relaxes toward natural in lockstep, the
    // per-step change bounded by seatRelaxRate * dt (no discontinuity, no
    // traveling wave), landing EXACTLY on natural.
    const maxDelta = DEFAULT_ROPE_CONFIG.seatRelaxRate * DT + 1e-12;
    let steps = 0;
    while (steps < 600) {
      const before: number[] = [];
      for (let s = 0; s < SEGMENTS; s += 1) before.push(rope.readSegmentRest(s));
      rope.step(DT);
      steps += 1;
      let allNatural = true;
      for (let s = 0; s < SEGMENTS; s += 1) {
        const after = rope.readSegmentRest(s);
        const delta = Math.abs(after - before[s]);
        if (delta > maxDelta) {
          throw new Error(
            `rest jumped at step ${steps}, segment ${s}: ${before[s]} -> ${after} (delta ${delta} > bound ${maxDelta})`,
          );
        }
        // Relaxing downward only — monotone toward natural.
        expect(after).toBeLessThanOrEqual(before[s]);
        if (after !== SEG_LEN) allNatural = false;
      }
      expect(rope.isFiniteState()).toBe(true);
      if (allNatural) break;
    }

    // Exact convergence, fast: 0.1 excess at 0.6 u/s needs 20 steps.
    expect(steps).toBeLessThanOrEqual(25);
    for (let s = 0; s < SEGMENTS; s += 1) {
      expect(rope.readSegmentRest(s)).toBe(SEG_LEN);
    }

    // The over-leash seat (3.2 span on a 1.6 rope) stays finite and damps to
    // sleep — totality, not window (INT-6's over-stretch territory).
    let guard = 0;
    while (!rope.isSettled() && guard < 3600) {
      rope.step(DT);
      guard += 1;
      expect(rope.isFiniteState()).toBe(true);
    }
    expect(rope.isSettled()).toBe(true);
  });
});

describe('seat — determinism (SIM-3 acceptance d)', () => {
  it('two ropes on the same drag+seat sequence finish bitwise-identical (positions and KE)', () => {
    const run = (): number[] => {
      const rope = makeHangingRope();
      rope.carryEnd(END);
      dragAndConverge(rope, SOCKET_A, 1.2);
      rope.seat({ index: END, position: SOCKET_A });
      for (let s = 0; s < 200; s += 1) rope.step(DT);
      expect(rope.kineticEnergy(DT)).toBe(0); // asleep: exactly zero
      return positions(rope);
    };
    expectBitwiseEqual(run(), run(), 'seated rope A vs B after drag+seat+200 steps');
  });

  it('SimInput.seatTarget through the production SimStep + fixed driver: bitwise across runs, then bitwise-still (asleep)', () => {
    const run = (): number[] => {
      const step = createRopeSimStep({ cord: { pin: PIN } });
      const driver = createFixedTimestepDriver(step, { timestep: DT, maxSubsteps: 5 });
      let state: SimState = { time: 0, cords: [] };
      // 60 frames of violent carry (2 substeps each), then the plug frame.
      for (let f = 0; f < 60; f += 1) {
        const t = f * 0.42;
        const result = driver.advance(state, 1 / 60, {
          pointerPoint: null,
          pinTarget: {
            index: END,
            position: {
              x: Math.cos(t) * 1.2,
              y: 0.5 + Math.sin(t * 1.3) * 0.6
            },
          },
        });
        expect(result.substeps).toBe(2);
        state = result.state;
      }
      driver.advance(state, 1 / 60, {
        pointerPoint: null,
        seatTarget: { index: END, position: SOCKET_A },
      });
      state = driver.advance(state, 1 / 60, { pointerPoint: null }).state;
      // ~3 s of quiet: the cord sleeps, positions freeze bitwise.
      for (let f = 0; f < 178; f += 1) {
        state = driver.advance(state, 1 / 60, { pointerPoint: null }).state;
      }
      const frozen = state.cords[0].points.flatMap((p) => [p.x, p.y]);
      for (let f = 0; f < 60; f += 1) {
        state = driver.advance(state, 1 / 60, { pointerPoint: null }).state;
        const now = state.cords[0].points.flatMap((p) => [p.x, p.y]);
        expectBitwiseEqual(now, frozen, 'driver frame after settle');
      }
      return frozen;
    };
    expectBitwiseEqual(run(), run(), 'driver seat run 1 vs run 2');
  });
});

describe('seat — awaiting-plug coexistence and guards', () => {
  it('carried end + seated anchor coexist (awaiting-plug), the plug hardens the carry, a stale pinTarget after the plug throws at the rope API', () => {
    const rope = makeHangingRope();
    rope.carryEnd(END);
    expect(rope.isEndSeated(END)).toBe(false); // nothing plugged yet
    expect(rope.carriedIndex).toBe(END);

    // Through the drag the anchor holds bitwise while the carried end moves.
    for (let f = 0; f < 120; f += 1) {
      const t = f * 0.21;
      rope.setPinTarget(END, {
        x: Math.cos(t) * 1.2,
        y: 0.5 + Math.sin(t * 1.3) * 0.6
      });
      rope.step(DT);
      expectPointAt(rope, 0, PIN, 'anchor during await');
    }

    // The plug: carried -> plugged, both ends pinned (linked).
    rope.seat({ index: END, position: SOCKET_A });
    expect(rope.isEndSeated(END)).toBe(true);
    expect(rope.carriedIndex).toBe(null);
    expectPointAt(rope, END, SOCKET_A, 'plugged pin');

    // The carry machinery is closed for a plugged end.
    expect(() => rope.carryEnd(END)).toThrow();
    expect(() => rope.setPinTarget(END, { x: 1, y: 1})).toThrow();
    expect(() => rope.seat({ index: END, position: SOCKET_A })).toThrow();
  });

  it('seat validates: non-endpoint, the original pin, fractional index, non-finite position all throw', () => {
    const rope = makeHangingRope();
    expect(() => rope.seat({ index: 5, position: SOCKET_A })).toThrow();
    expect(() => rope.seat({ index: -1, position: SOCKET_A })).toThrow();
    expect(() => rope.seat({ index: 1.5, position: SOCKET_A })).toThrow();
    expect(() => rope.seat({ index: 0, position: SOCKET_A })).toThrow(); // the anchor
    expect(() =>
      rope.seat({ index: END, position: { x: Number.NaN, y: 0} }),
    ).toThrow();
    expect(() =>
      rope.seat({ index: END, position: { x: 1, y: Number.POSITIVE_INFINITY} }),
    ).toThrow();
    expect(rope.isEndSeated(END)).toBe(false); // failed seats never half-apply
    expect(() => rope.seat({ index: END, position: SOCKET_A })).not.toThrow();
    expect(() => rope.setSeatPosition(END, 1, 2)).not.toThrow();
  });

  it('setSeatPosition moves the plugged pin bitwise and wakes the rope; the cord re-settles to sleep', () => {
    const rope = makeHangingRope();
    rope.carryEnd(END);
    dragAndConverge(rope, SOCKET_A, 1.2);
    seatAndMeasure(rope, SOCKET_A);
    expect(rope.isSettled()).toBe(true);

    // The socket's cube is dragged: the jack must ride bitwise and wake.
    const MOVED: Vec2 = { x: SOCKET_A.x + 0.2, y: SOCKET_A.y};
    rope.setSeatPosition(END, MOVED.x, MOVED.y);
    expect(rope.isSettled()).toBe(false);
    rope.step(DT);
    expectPointAt(rope, END, MOVED, 'moved plugged pin');
    expect(rope.isFiniteState()).toBe(true);

    // Non-finite moves are ignored (last valid position stands).
    rope.setSeatPosition(END, Number.NaN, 0);
    rope.step(DT);
    expectPointAt(rope, END, MOVED, 'pin after ignored garbage move');

    // Re-settles: calm again (asleep) and exactly still for another second.
    let guard = 0;
    while (!rope.isSettled() && guard < 3600) {
      rope.step(DT);
      guard += 1;
    }
    expect(rope.isSettled()).toBe(true);
    for (let s = 0; s < 120; s += 1) {
      const before = positions(rope);
      rope.step(DT);
      const after = positions(rope);
      expectBitwiseEqual(after, before, `post-move sleep step ${s}`);
    }
  });

  it('setPoint / setVelocity / setPin / wake rouse a sleeping rope; placeAlong fully resets the seat state', () => {
    const rope = makeHangingRope();
    rope.carryEnd(END);
    dragAndConverge(rope, SOCKET_A, 1.2);
    seatAndMeasure(rope, SOCKET_A);

    const rousers: Array<[string, () => void]> = [
      ['setVelocity', () => rope.setVelocity(5, 1, 0, DT)],
      ['setPoint', () => rope.setPoint(5, 0.1, 0.5)],
      ['setPin', () => rope.setPin(0.05, PIN_Y)],
      ['wake', () => rope.wake()],
    ];
    for (const [name, rouse] of rousers) {
      // Re-sleep first (each rouser runs from the settled state).
      let guard = 0;
      while (!rope.isSettled() && guard < 3600) {
        rope.step(DT);
        guard += 1;
      }
      expect(rope.isSettled()).toBe(true);
      rouse();
      if (rope.isSettled()) {
        throw new Error(`${name} must rouse the rope`);
      }
    }

    // Fresh cord: the whole seat state resets.
    rope.placeAlong(PIN, { x: 0, y: PIN_Y - TOTAL});
    expect(rope.isEndSeated(END)).toBe(false);
    expect(rope.isSettled()).toBe(false);
    for (let s = 0; s < SEGMENTS; s += 1) {
      expect(rope.readSegmentRest(s)).toBe(SEG_LEN);
    }
    rope.step(DT);
    expect(rope.isFiniteState()).toBe(true);
  });

  it('a single-segment rope seats (both pins) and survives: finite, settles, zero jitter after', () => {
    const rope = createVerletRope({
      segmentCount: 1,
      segmentLength: SEG_LEN,
      gravity: 9.81,
      iterations: 4,
      damping: 0.985,
      pin: { x: 0, y: 1},
    });
    rope.placeAlong({ x: 0, y: 1}, { x: 0, y: 0.9});
    rope.carryEnd(1);
    for (let f = 0; f < 60; f += 1) {
      const t = f * 0.3;
      rope.setPinTarget(1, { x: Math.cos(t) * 0.3, y: 1 + Math.sin(t) * 0.2});
      rope.step(DT);
    }
    const SOCKET: Vec2 = { x: 0.05, y: 0.92};
    rope.seat({ index: 1, position: SOCKET });
    for (let s = 0; s < 600; s += 1) {
      rope.step(DT);
      expect(rope.isFiniteState()).toBe(true);
    }
    expect(rope.isSettled()).toBe(true);
    expectPointAt(rope, 0, { x: 0, y: 1}, 'single-seg anchor');
    expectPointAt(rope, 1, SOCKET, 'single-seg plug');
  });

  it('clock garbage remains a no-op mid-settle: state untouched bitwise', () => {
    const rope = makeHangingRope();
    rope.carryEnd(END);
    dragAndConverge(rope, SOCKET_A, 1.2);
    rope.seat({ index: END, position: SOCKET_A });
    rope.step(DT); // one settle step, mid-dangle
    const frozen = positions(rope);
    rope.step(0);
    rope.step(Number.NaN);
    rope.step(Number.POSITIVE_INFINITY);
    rope.step(-DT);
    expectBitwiseEqual(positions(rope), frozen, 'garbage-dt no-op');
    expect(rope.isSettled()).toBe(false); // the settle has not been advanced
  });
});

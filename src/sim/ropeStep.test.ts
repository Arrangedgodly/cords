import { describe, expect, it } from 'vitest';
import { createVerletRope } from './rope';
import { createRopeSimStep } from './ropeStep';
import type { SimInput, SimState, Vec2 } from './types';

/**
 * SIM-3/INT-2 — the ropeStep input-boundary regression suite. The SimStep is
 * TOTAL: any SimInput advances to a finite state or is ignored — an input
 * naming a protected end must be dropped at this boundary, never reach the
 * rope's throwing mutators. This pins the guard hole the SIM-3 verifier
 * found (a `pinTarget` naming the ORIGINAL anchor end reached
 * `rope.carryEnd(pinnedIndex)` and THREW through the driver once INT-lane
 * plugging logic started sending intents) plus the same class of hole on the
 * seat path (`seat({ index: pinnedIndex })` throws by contract).
 */

const DT = 1 / 120;
const SEGMENTS = 8;
const END = SEGMENTS; // the free end (anchor is index 0 by default)
const PIN: Vec2 = { x: 0, y: 1.6};

/** Advance `frames` fixed slices through the production SimStep. */
function run(step: ReturnType<typeof createRopeSimStep>, state: SimState, frames: number, input: SimInput): SimState {
  let s = state;
  for (let i = 0; i < frames; i += 1) s = step(s, DT, input);
  return s;
}

function makeStep() {
  return createRopeSimStep({ cord: { pin: PIN, segmentCount: SEGMENTS } });
}

describe('ropeStep — input totality at the protected ends (INT-2 guard)', () => {
  it('REGRESSION: a pinTarget naming the ANCHOR end while linked is ignored — no throw, finite state', () => {
    const step = makeStep();
    let state: SimState = { time: 0, cords: [] };
    // Seat the free end first (the linked state: both endpoints pinned).
    state = run(step, state, 2, { pointerPoint: null, seatTarget: { index: END, position: { x: 0.4, y: 0.5} } });
    // The pre-fix crash: an upstream carry intent naming index 0 (the
    // anchor) reached rope.carryEnd(0), which throws by contract.
    state = run(step, state, 60, {
      pointerPoint: null,
      pinTarget: { index: 0, position: { x: 5, y: 5} },
    });
    // The anchor never moved: the intent was dropped, not applied.
    expect(state.cords[0].points[0]).toEqual({ x: PIN.x, y: PIN.y});
  });

  it('REGRESSION: the anchor end of a seated cord is REJECTED at the rope surface — carryEnd throws on the pinned index', () => {
    const rope = createSeatedRope();
    expect(() => rope.carryEnd(0)).toThrow(/carryEnd cannot carry the seated pin/);
  });

  it('a pinTarget naming the PLUGGED end while linked is ignored — the jack stays in its socket', () => {
    const step = makeStep();
    let state: SimState = { time: 0, cords: [] };
    const socket: Vec2 = { x: 0.4, y: 0.5};
    state = run(step, state, 2, { pointerPoint: null, seatTarget: { index: END, position: socket } });
    state = run(step, state, 60, {
      pointerPoint: null,
      pinTarget: { index: END, position: { x: 9, y: 9} },
    });
    // The plugged pin holds the seat exactly; the intent never moved it.
    expect(state.cords[0].points[END]).toEqual(socket);
  });

  it('a seatTarget naming the ANCHOR end is ignored — no throw, the rope never seats', () => {
    const step = makeStep();
    let state: SimState = { time: 0, cords: [] };
    state = run(step, state, 60, {
      pointerPoint: null,
      seatTarget: { index: 0, position: { x: 1, y: 1} },
    });
    // The anchor is where it always was; the free end is still free (dangled).
    expect(state.cords[0].points[0]).toEqual({ x: PIN.x, y: PIN.y});
  });

  it('carrying a NON-protected end still works while a seat exists on the other end (awaiting-plug stays reachable)', () => {
    const step = makeStep();
    let state: SimState = { time: 0, cords: [] };
    // Anchor is index 0 by default; carry the FREE end (not yet plugged).
    state = run(step, state, 30, {
      pointerPoint: null,
      pinTarget: { index: END, position: { x: 1.2, y: 0.3} },
    });
    const end = state.cords[0].points[END];
    // Bounded convergence: the end moved toward the target from the spawn pose.
    expect(Math.hypot(end.x - 1.2, end.y - 0.3)).toBeLessThan(1.5);
  });
});

describe('ropeStep — INT-3 seat transport (the dragged cube moves the plugged pin)', () => {
  it('a seatTarget naming the ALREADY-seated index TRANSPORTS the pin to its position (hard-follow)', () => {
    const step = makeStep();
    let state: SimState = { time: 0, cords: [] };
    const socket: Vec2 = { x: 0.4, y: 0.5};
    state = run(step, state, 2, { pointerPoint: null, seatTarget: { index: END, position: socket } });
    expect(state.cords[0].points[END]).toEqual(socket);
    // The socket's cube is dragged: the same latched field now carries the
    // moved transform, and the plugged pin rides it exactly.
    const moved: Vec2 = { x: 0.9, y: 0.3};
    state = run(step, state, 4, { pointerPoint: null, seatTarget: { index: END, position: moved } });
    expect(state.cords[0].points[END]).toEqual(moved);
    // The anchor never moved.
    expect(state.cords[0].points[0]).toEqual({ x: PIN.x, y: PIN.y});
  });

  it('a seatTarget on the seated index with a NON-FINITE position is ignored — the pin holds', () => {
    const step = makeStep();
    let state: SimState = { time: 0, cords: [] };
    const socket: Vec2 = { x: 0.4, y: 0.5};
    state = run(step, state, 2, { pointerPoint: null, seatTarget: { index: END, position: socket } });
    state = run(step, state, 4, {
      pointerPoint: null,
      seatTarget: { index: END, position: { x: Number.NaN, y: Number.POSITIVE_INFINITY} },
    });
    expect(state.cords[0].points[END]).toEqual(socket);
  });

  it('REGRESSION: the PLUG intent with a non-finite position is ignored at the boundary — never reaches rope.seat validation', () => {
    // Pre-INT-3 this crashed the step: rope.seat throws on non-finite
    // positions, and the boundary forwarded the intent verbatim. SimInput is
    // upstream data — the step must stay total.
    const step = makeStep();
    let state: SimState = { time: 0, cords: [] };
    state = run(step, state, 30, {
      pointerPoint: null,
      seatTarget: { index: END, position: { x: Number.NaN, y: 0.5} },
    });
    // Nothing seated: the end is still free (dangled from the anchor).
    state = run(step, state, 2, {
      pointerPoint: null,
      seatTarget: { index: END, position: { x: 0.4, y: 0.5} },
    });
    expect(state.cords[0].points[END]).toEqual({ x: 0.4, y: 0.5});
  });
});

/** A rope with its free end seated (the linked state), anchor at PIN. */
function createSeatedRope() {
  const rope = createVerletRope({ pin: PIN, segmentCount: SEGMENTS });
  rope.placeAlong(PIN, { x: 0.4, y: 0.5});
  rope.seat({ index: END, position: { x: 0.4, y: 0.5} });
  return rope;
}

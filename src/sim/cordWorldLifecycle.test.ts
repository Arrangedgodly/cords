import { describe, expect, it } from 'vitest';
import { createCordWorldStep } from './cordWorld';
import { createFixedTimestepDriver } from './fixedTimestep';
import { DEFAULT_GRACE_SECONDS } from './lifecycle';
import type { LifecycleRejection, LifecycleTransition } from './lifecycle';
import type { SimInput, SimState, Vec3 } from './types';

/**
 * T-LIFE-1 — the lifecycle FSM at the world-step boundary, driven through
 * the production fixed-timestep driver exactly as the composition runs it.
 * The machine-level table lives in lifecycle.test.ts; this file pins the
 * WORLD contract:
 *
 * - spawns/anchor register real lifecycle state; seats drive the approved
 *   carried → awaiting-plug → linked pipeline; transports emit nothing.
 * - AMENDMENT — HAND-PULLED PLUGS ARE LEGAL: a carry intent on a seated end
 *   un-seats it into the hand (linked → awaiting-plug with the other seat
 *   holding bitwise; awaiting-plug → carried for the last seat, the anchor
 *   included), and the composed removal path (pull + release off-cube →
 *   vanishing) is pinned. The two UN-PULLABLE seats: popped's surviving
 *   socket (strict worlds throw) and anything vanishing (locked; the intent
 *   is ignored, the plug stays bitwise).
 * - POP (the approved linked→popped): the named seat releases — the far jack
 *   dangles from the other seat, bitwise; the grace clock runs.
 * - the re-seat restores linked and CANCELS the grace (never vanishes).
 * - the grace fires at ~3s of SIM time — and a backgrounded-tab 5s frame
 *   delta burns only the driver-clamped slices (sim time, never wall-clock).
 * - RELEASE-OFF-CUBE: awaiting-plug → vanishing; the LOCK: no new seats, no
 *   pops, no pulls-by-hand — but the seat latch (transport) still flows and
 *   completion (despawnCords) removes the cord from the world.
 * - the carried cord's off-cube release is the ordinary drop (no transition).
 * - multi-cord isolation (grace clocks and locks never leak) and full
 *   bitwise determinism of a pop/re-seat/vanish/despawn scenario.
 */

const DT = 1 / 120;
const FRAME = 1 / 60;
const SEGMENTS = 8;
const END = SEGMENTS;
const PIN: Vec3 = { x: 0, y: 1.6, z: 0 };

interface World {
  advance: (frames: number, input: SimInput) => SimState;
  advanceOnce: (frameDelta: number, input: SimInput) => { state: SimState; clamped: boolean };
  getState: () => SimState;
  lifecycle: ReturnType<typeof createCordWorldStep>['lifecycle'];
  transitions: LifecycleTransition[];
  rejections: LifecycleRejection[];
}

function makeWorld(options?: { maxCords?: number; strict?: boolean }): World {
  const transitions: LifecycleTransition[] = [];
  const rejections: LifecycleRejection[] = [];
  const step = createCordWorldStep({
    anchor: { pin: PIN, segmentCount: SEGMENTS, floorY: 0 },
    cord: { segmentCount: SEGMENTS, floorY: 0 },
    ...(options?.maxCords === undefined ? {} : { maxCords: options.maxCords }),
    lifecycle: {
      ...(options?.strict === true ? { strict: true } : {}),
      onTransition: (event) => transitions.push(event),
      onRejected: (rejection) => rejections.push(rejection),
    },
  });
  const driver = createFixedTimestepDriver(step, { timestep: DT, maxSubsteps: 2 });
  let state: SimState = { time: 0, cords: [] };
  const advance = (frames: number, input: SimInput): SimState => {
    for (let f = 0; f < frames; f += 1) state = driver.advance(state, FRAME, input).state;
    return state;
  };
  return {
    advance,
    advanceOnce: (frameDelta, input) => {
      const result = driver.advance(state, frameDelta, input);
      state = result.state;
      return { state: result.state, clamped: result.clamped };
    },
    getState: () => state,
    lifecycle: step.lifecycle,
    transitions,
    rejections,
  };
}

function cordById(state: SimState, id: number) {
  const cord = state.cords.find((c) => c.id === id);
  if (cord === undefined) throw new Error(`cord ${id} missing`);
  return cord;
}

function expectFinite(state: SimState, label: string): void {
  for (const cord of state.cords) {
    for (const p of cord.points) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
        throw new Error(`${label}: non-finite point in cord ${cord.id}`);
      }
    }
  }
}

/** Spawns `cordId` and seats BOTH ends (red at A, blue at B) — the linked state. */
function spawnAndLink(
  world: World,
  cordId = 1,
  at: Vec3 = { x: 0.5, y: 1.0, z: 0 },
  A: Vec3 = { x: 0.9, y: 0.42, z: 0 },
  B: Vec3 = { x: 0.35, y: 0.42, z: 0.1 },
): void {
  world.advance(1, { pointerRay: null, spawnCord: { cordId, at } });
  world.advance(60, {
    pointerRay: null,
    pinTargets: [{ cordId, index: 0, position: { x: A.x, y: 0.9, z: A.z } }],
  });
  world.advance(3, { pointerRay: null, seatTargets: [{ cordId, index: 0, position: A }] });
  world.advance(90, {
    pointerRay: null,
    pinTargets: [{ cordId, index: END, position: { x: B.x, y: 0.9, z: B.z } }],
    seatTargets: [{ cordId, index: 0, position: A }],
  });
  world.advance(3, {
    pointerRay: null,
    seatTargets: [
      { cordId, index: 0, position: A },
      { cordId, index: END, position: B },
    ],
  });
}

describe('T-LIFE-1 — lifecycle at the world boundary: registration + the approved pipeline', () => {
  it('a spawn registers `carried` (red carrying, blue free); the anchor registers `awaiting-plug`', () => {
    const world = makeWorld();
    expect(world.lifecycle.stateOf(0)).toBe('awaiting-plug'); // the anchor: seated by construction
    expect(world.lifecycle.endMode(0, 0)).toBe('seated');
    expect(world.lifecycle.endMode(0, END)).toBe('free');
    world.advance(1, { pointerRay: null, spawnCord: { cordId: 1, at: { x: 0.5, y: 1.0, z: 0 } } });
    expect(world.lifecycle.stateOf(1)).toBe('carried');
    expect(world.lifecycle.endMode(1, 0)).toBe('carrying'); // the red end lands in hand
    expect(world.lifecycle.endMode(1, END)).toBe('free');
    expect(world.lifecycle.graceRemaining(1)).toBeNull();
    expectFinite(world.getState(), 'registration');
  });

  it('seats drive carried → awaiting-plug → linked; the transport latch emits nothing', () => {
    const world = makeWorld();
    spawnAndLink(world);
    expect(world.lifecycle.stateOf(1)).toBe('linked');
    expect(world.lifecycle.endMode(1, 0)).toBe('seated');
    expect(world.lifecycle.endMode(1, END)).toBe('seated');
    const pipeline = world.transitions.map((t) => `${t.from}->${t.to}:${t.reason}`);
    expect(pipeline).toEqual(['carried->awaiting-plug:seated', 'awaiting-plug->linked:second-seated']);
    // Now flow BOTH latches for two seconds: transports are not transitions.
    const latches: SimInput = {
      pointerRay: null,
      seatTargets: [
        { cordId: 1, index: 0, position: { x: 0.9, y: 0.42, z: 0 } },
        { cordId: 1, index: END, position: { x: 0.35, y: 0.42, z: 0.1 } },
      ],
    };
    const eventsBefore = world.transitions.length;
    world.advance(240, latches);
    expect(world.transitions).toHaveLength(eventsBefore);
    expect(world.lifecycle.stateOf(1)).toBe('linked');
  });

  it('AMENDMENT: the hand-pulled plug is legal — a carry intent on a seated end of a LINKED cord pulls it into the hand (linked → awaiting-plug) while the other seat holds bitwise; composed with an off-cube release it vanishes the cord', () => {
    const world = makeWorld();
    spawnAndLink(world);
    const B: Vec3 = { x: 0.35, y: 0.42, z: 0.1 }; // blue's socket (holds throughout)
    // Grab the seated RED end (INT-4 restored) with the blue latch flowing.
    const REGRAB: Vec3 = { x: 0, y: 0.9, z: 0 };
    for (let f = 0; f < 90; f += 1) {
      world.advance(1, {
        pointerRay: null,
        pinTargets: [{ cordId: 1, index: 0, position: REGRAB }],
        seatTargets: [{ cordId: 1, index: END, position: B }],
      });
    }
    const state = world.getState();
    const red = cordById(state, 1).points[0];
    expect(Math.hypot(red.x - REGRAB.x, red.y - REGRAB.y, red.z - REGRAB.z)).toBeLessThan(0.05); // in hand
    const blue = cordById(state, 1).points[END];
    expect(blue.x).toBe(B.x); // the other seat holds bitwise
    expect(blue.y).toBe(B.y);
    expect(blue.z).toBe(B.z);
    expect(world.lifecycle.stateOf(1)).toBe('awaiting-plug'); // transition #7 applied
    expect(world.lifecycle.endMode(1, 0)).toBe('carrying');
    expect(world.lifecycle.endMode(1, END)).toBe('seated');
    expect(world.transitions.some((t) => t.reason === 'unplugged' && t.end === 0 && t.to === 'awaiting-plug')).toBe(true);
    expectFinite(state, 'hand-pulled plug');

    // THE COMPOSED REMOVAL PATH: release the held (pulled) jack NOT over a
    // cube — awaiting-plug → vanishing, exactly the approved failure.
    world.advance(1, { pointerRay: null, releaseJack: { cordId: 1, index: 0 } });
    expect(world.lifecycle.stateOf(1)).toBe('vanishing');
    const vanish = world.transitions[world.transitions.length - 1];
    expect(vanish).toMatchObject({ cordId: 1, from: 'awaiting-plug', to: 'vanishing', reason: 'released-off-cube', end: 0 });
    expect(world.lifecycle.endMode(1, END)).toBe('seated'); // the surviving plug awaits LIFE-2's pull-out
  });

  it('AMENDMENT: the anchor end is the same kind of seat — grabbing it un-seats the anchor (awaiting-plug → carried) and the cord hangs from the hand', () => {
    const world = makeWorld();
    const HAND: Vec3 = { x: -0.7, y: 1.2, z: 0.1 };
    world.advance(90, {
      pointerRay: null,
      pinTargets: [{ cordId: 0, index: 0, position: HAND }],
    });
    const anchorEnd = cordById(world.getState(), 0).points[0];
    expect(Math.hypot(anchorEnd.x - HAND.x, anchorEnd.y - HAND.y, anchorEnd.z - HAND.z)).toBeLessThan(0.05);
    expect(world.lifecycle.stateOf(0)).toBe('carried'); // transition #8: nothing seated anymore
    expect(world.lifecycle.endMode(0, 0)).toBe('carrying');
    expect(world.transitions.some((t) => t.cordId === 0 && t.reason === 'unplugged' && t.to === 'carried')).toBe(true);
    expectFinite(world.getState(), 'anchor pull');
    // And the pulled end re-plugs anywhere (any order): carried → awaiting-plug.
    const socket: Vec3 = { x: -0.7, y: 0.42, z: 0.1 };
    world.advance(3, { pointerRay: null, seatTargets: [{ cordId: 0, index: 0, position: socket }] });
    expect(world.lifecycle.stateOf(0)).toBe('awaiting-plug');
    const seated = cordById(world.getState(), 0).points[0];
    expect(seated.x).toBe(socket.x);
    expect(seated.y).toBe(socket.y);
    expect(seated.z).toBe(socket.z);
  });

  it('the two un-pullable seats stay rejected: popped\u2019s surviving socket (strict throws) and anything vanishing', () => {
    // POPPED's surviving socket: its exits are the re-seat and the grace —
    // the over-stretch pop must not be dodgeable by grabbing it. Loud in a
    // strict world.
    const strict = makeWorld({ strict: true });
    spawnAndLink(strict);
    strict.advance(1, { pointerRay: null, popCords: [{ cordId: 1, index: END }] }); // end 0 = the socket
    expect(() =>
      strict.advance(1, {
        pointerRay: null,
        pinTargets: [{ cordId: 1, index: 0, position: { x: 0, y: 0.9, z: 0 } }],
      }),
    ).toThrow(/illegal unseat/);

    // VANISHING: a carry intent on the seated end is IGNORED (the lock —
    // LIFE-2's pullOutDuringVanish seam is the only pull), production-quiet.
    const world = makeWorld();
    world.advance(1, { pointerRay: null, spawnCord: { cordId: 1, at: { x: 0.5, y: 1.0, z: 0 } } });
    const A: Vec3 = { x: 0.9, y: 0.42, z: 0 };
    world.advance(3, { pointerRay: null, seatTargets: [{ cordId: 1, index: 0, position: A }] });
    world.advance(30, {
      pointerRay: null,
      pinTargets: [{ cordId: 1, index: END, position: { x: 1.4, y: 0.9, z: 0.2 } }],
      seatTargets: [{ cordId: 1, index: 0, position: A }],
    });
    world.advance(1, { pointerRay: null, releaseJack: { cordId: 1, index: END } });
    expect(world.lifecycle.stateOf(1)).toBe('vanishing');
    world.advance(10, {
      pointerRay: null,
      pinTargets: [{ cordId: 1, index: 0, position: { x: 0, y: 1.3, z: 0 } }],
      seatTargets: [{ cordId: 1, index: 0, position: A }],
    });
    expect(world.lifecycle.endMode(1, 0)).toBe('seated'); // locked: the intent pulled nothing
    const red = cordById(world.getState(), 1).points[0];
    expect(red.x).toBe(A.x); // bitwise in its socket
    expect(red.y).toBe(A.y);
    expect(red.z).toBe(A.z);
  });
});

describe('T-LIFE-1 — pop, grace, re-seat (the approved failure-and-recovery loop)', () => {
  it('pop releases exactly the named seat: the far jack dangles, the other seat holds bitwise, the grace opens', () => {
    const world = makeWorld();
    spawnAndLink(world);
    const A: Vec3 = { x: 0.9, y: 0.42, z: 0 };
    const B: Vec3 = { x: 0.35, y: 0.42, z: 0.1 };
    world.advance(1, { pointerRay: null, popCords: [{ cordId: 1, index: END }] });
    expect(world.lifecycle.stateOf(1)).toBe('popped');
    // One slice of the pop frame itself burned before the window opened
    // (advance runs before the pop intent within a substep): 3 − 1/120.
    expect(world.lifecycle.graceRemaining(1)).toBeCloseTo(DEFAULT_GRACE_SECONDS - DT, 12);
    expect(world.lifecycle.endMode(1, END)).toBe('free'); // the popped jack hangs
    expect(world.lifecycle.endMode(1, 0)).toBe('seated');
    world.advance(120, {
      pointerRay: null,
      seatTargets: [{ cordId: 1, index: 0, position: A }], // the surviving latch keeps flowing
    });
    const red = cordById(world.getState(), 1).points[0];
    expect(red.x).toBe(A.x); // the seated end never moved
    expect(red.y).toBe(A.y);
    expect(red.z).toBe(A.z);
    const blue = cordById(world.getState(), 1).points[END];
    expect(blue.y).toBeLessThan(B.y); // the popped end fell away from its socket
    expectFinite(world.getState(), 'popped dangle');
    const pop = world.transitions.find((t) => t.to === 'popped');
    expect(pop).toMatchObject({ cordId: 1, from: 'linked', to: 'popped', reason: 'over-stretch', end: END });
  });

  it('the re-seat restores linked and CANCELS the grace — the cord never vanishes', () => {
    const world = makeWorld();
    spawnAndLink(world);
    const A: Vec3 = { x: 0.9, y: 0.42, z: 0 };
    const B2: Vec3 = { x: 0.2, y: 0.42, z: -0.2 };
    world.advance(1, { pointerRay: null, popCords: [{ cordId: 1, index: END }] });
    // 2.83s inside the window, then re-seat the popped end at a third socket.
    for (let f = 0; f < 170 && world.lifecycle.stateOf(1) === 'popped'; f += 1) {
      world.advance(1, { pointerRay: null, seatTargets: [{ cordId: 1, index: 0, position: A }] });
    }
    expect(world.lifecycle.stateOf(1)).toBe('popped');
    world.advance(3, {
      pointerRay: null,
      seatTargets: [
        { cordId: 1, index: 0, position: A },
        { cordId: 1, index: END, position: B2 },
      ],
    });
    expect(world.lifecycle.stateOf(1)).toBe('linked');
    expect(world.lifecycle.graceRemaining(1)).toBeNull();
    world.advance(600, {
      pointerRay: null,
      seatTargets: [
        { cordId: 1, index: 0, position: A },
        { cordId: 1, index: END, position: B2 },
      ],
    });
    expect(world.lifecycle.stateOf(1)).toBe('linked'); // ten seconds later: still linked
    expect(world.transitions.some((t) => t.reason === 'grace-expired')).toBe(false);
    const blue = cordById(world.getState(), 1).points[END];
    expect(blue.x).toBe(B2.x); // the re-seat took bitwise
    expect(blue.y).toBe(B2.y);
  });

  it('the grace fires at ~3s of SIM time through the driver — and not before', () => {
    const world = makeWorld();
    spawnAndLink(world);
    world.advance(1, { pointerRay: null, popCords: [{ cordId: 1, index: 0 }] });
    const latch: SimInput = {
      pointerRay: null,
      seatTargets: [{ cordId: 1, index: END, position: { x: 0.35, y: 0.42, z: 0.1 } }],
    };
    // 2.9s of frames: still popped (the window is open the whole time).
    // (The pop frame burned one slice: 1 + 174×2 = 349 slices ≈ 2.91s.)
    for (let f = 0; f < 174; f += 1) {
      world.advance(1, latch);
      expect(world.lifecycle.stateOf(1)).toBe('popped');
    }
    expect(world.lifecycle.graceRemaining(1)).toBeLessThan(0.15);
    // Past 3.05s (8 more frames = 16 slices → 3.075s total): expired into
    // vanishing, exactly once.
    world.advance(8, latch);
    expect(world.lifecycle.stateOf(1)).toBe('vanishing');
    const expiries = world.transitions.filter((t) => t.reason === 'grace-expired');
    expect(expiries).toHaveLength(1);
    expect(expiries[0]).toMatchObject({ cordId: 1, from: 'popped', to: 'vanishing', end: 0 });
  });

  it('a backgrounded-tab 5s frame delta burns only the driver-clamped slices — grace is sim time', () => {
    const world = makeWorld();
    spawnAndLink(world);
    world.advance(1, { pointerRay: null, popCords: [{ cordId: 1, index: 0 }] });
    // One 5-second wall-clock frame: maxSubsteps 2 × (1/120) s of sim time.
    // The grace reads exactly 3s − 3 slices (the pop frame's one + the
    // clamped frame's two) — a spike can NEVER burn more than the clamp.
    const { clamped } = world.advanceOnce(5, { pointerRay: null });
    expect(clamped).toBe(true);
    expect(world.lifecycle.stateOf(1)).toBe('popped'); // NOT expired by the spike
    expect(world.lifecycle.graceRemaining(1)).toBeCloseTo(DEFAULT_GRACE_SECONDS - 3 * DT, 12);
  });
});

describe('T-LIFE-1 — the release-off-cube failure, the vanish lock, and completion', () => {
  function vanishingWorld(): World {
    const world = makeWorld();
    world.advance(1, { pointerRay: null, spawnCord: { cordId: 1, at: { x: 0.5, y: 1.0, z: 0 } } });
    world.advance(3, {
      pointerRay: null,
      seatTargets: [{ cordId: 1, index: 0, position: { x: 0.9, y: 0.42, z: 0 } }],
    });
    // Carry the free end so it is IN HAND, then release it NOT over a cube.
    world.advance(30, {
      pointerRay: null,
      pinTargets: [{ cordId: 1, index: END, position: { x: 1.4, y: 0.9, z: 0.2 } }],
      seatTargets: [{ cordId: 1, index: 0, position: { x: 0.9, y: 0.42, z: 0 } }],
    });
    world.advance(1, { pointerRay: null, releaseJack: { cordId: 1, index: END } });
    expect(world.lifecycle.stateOf(1)).toBe('vanishing');
    expect(world.lifecycle.endMode(1, END)).toBe('free');
    return world;
  }

  it('awaiting-plug + the held end released off-cube → vanishing (the user-initiated failure)', () => {
    const world = vanishingWorld();
    const event = world.transitions.find((t) => t.to === 'vanishing');
    expect(event).toMatchObject({
      cordId: 1,
      from: 'awaiting-plug',
      to: 'vanishing',
      reason: 'released-off-cube',
      end: END,
    });
  });

  it('the LOCK: no new seats, no pops, no pulls by hand — but the seat latch still flows, and completion removes the cord', () => {
    const world = vanishingWorld();
    expect(world.lifecycle.stateOf(1)).toBe('vanishing');

    // A fresh seat intent on the free end: rejected, nothing seated.
    world.advance(3, {
      pointerRay: null,
      seatTargets: [{ cordId: 1, index: END, position: { x: 0.4, y: 0.9, z: 0 } }],
    });
    expect(world.lifecycle.endMode(1, END)).toBe('free');
    expect(world.rejections.some((r) => r.action === 'seat')).toBe(true);

    // A pop intent: rejected — the FSM is locked.
    world.advance(1, { pointerRay: null, popCords: [{ cordId: 1, index: 0 }] });
    expect(world.lifecycle.stateOf(1)).toBe('vanishing');
    expect(world.lifecycle.endMode(1, 0)).toBe('seated');
    expect(world.rejections.some((r) => r.action === 'pop')).toBe(true);

    // A carry intent on the seated end: ignored (no un-seat; the choreography
    // owns the only pull-out), and the seat TRANSPORT still follows its cube.
    const MOVED: Vec3 = { x: 1.1, y: 0.55, z: -0.1 };
    world.advance(30, {
      pointerRay: null,
      pinTargets: [{ cordId: 1, index: 0, position: { x: 0, y: 1.3, z: 0 } }],
      seatTargets: [{ cordId: 1, index: 0, position: MOVED }],
    });
    expect(world.lifecycle.endMode(1, 0)).toBe('seated');
    const red = cordById(world.getState(), 1).points[0];
    expect(red.x).toBe(MOVED.x); // the latch rides — the plug stays in its socket
    expect(red.y).toBe(MOVED.y);
    expect(red.z).toBe(MOVED.z);

    // The vanish sequence reports completion → the cord leaves the world.
    world.advance(1, { pointerRay: null, despawnCords: [{ cordId: 1 }] });
    expect(world.lifecycle.stateOf(1)).toBeUndefined();
    expect(world.getState().cords.some((c) => c.id === 1)).toBe(false);
    expect(world.transitions.some((t) => t.to === 'gone' && t.reason === 'vanish-complete')).toBe(true);
    expectFinite(world.getState(), 'after despawn');

    // The freed id is reusable: a new cord, carried again.
    world.advance(1, { pointerRay: null, spawnCord: { cordId: 1, at: { x: 0.2, y: 1.0, z: 0 } } });
    expect(world.lifecycle.stateOf(1)).toBe('carried');
  });

  it('completion is only accepted while vanishing — a despawn of a linked cord is rejected and removes nothing', () => {
    const world = makeWorld();
    spawnAndLink(world);
    world.advance(1, { pointerRay: null, despawnCords: [{ cordId: 1 }] });
    expect(world.lifecycle.stateOf(1)).toBe('linked');
    expect(world.getState().cords.some((c) => c.id === 1)).toBe(true);
    expect(world.rejections.some((r) => r.action === 'complete-vanish')).toBe(true);
  });

  it('a carried cord (nothing seated) released off-cube takes the ordinary drop — no transition', () => {
    const world = makeWorld();
    world.advance(1, { pointerRay: null, spawnCord: { cordId: 1, at: { x: 0.5, y: 1.0, z: 0 } } });
    world.advance(1, { pointerRay: null, releaseJack: { cordId: 1, index: 0 } });
    expect(world.lifecycle.stateOf(1)).toBe('carried'); // survives: the fuzz-pinned spawn/drop churn
    expect(world.lifecycle.endMode(1, 0)).toBe('free'); // the end left the hand
    expect(world.getState().cords.some((c) => c.id === 1)).toBe(true);
    expect(world.transitions).toHaveLength(0);
    expect(world.rejections).toHaveLength(0);
  });

  it('LIFE-2\u2019s seam: pullOutDuringVanish releases the remaining plug; completion then lands clean', () => {
    const world = vanishingWorld();
    expect(world.lifecycle.endMode(1, 0)).toBe('seated');
    world.lifecycle.pullOutDuringVanish(1, 0);
    expect(world.lifecycle.endMode(1, 0)).toBe('free'); // the plug is out of its socket
    expect(world.lifecycle.stateOf(1)).toBe('vanishing'); // the lock holds regardless
    world.advance(120, { pointerRay: null }); // the free body falls/damps, finite
    expectFinite(world.getState(), 'pull-out fall');
    world.advance(1, { pointerRay: null, despawnCords: [{ cordId: 1 }] });
    expect(world.lifecycle.stateOf(1)).toBeUndefined();
    expect(world.getState().cords.some((c) => c.id === 1)).toBe(false);
    // Outside vanishing the seam is INERT: a linked cord is untouched (the
    // hand-pulled plug goes through the carry intent, which applies the
    // approved #7 transition — never through LIFE-2's channel).
    const linked = makeWorld();
    spawnAndLink(linked);
    const rejectionsBefore = linked.rejections.length;
    linked.lifecycle.pullOutDuringVanish(1, 0);
    expect(linked.lifecycle.stateOf(1)).toBe('linked');
    expect(linked.lifecycle.endMode(1, 0)).toBe('seated');
    const red = cordById(linked.getState(), 1).points[0];
    expect(red.x).toBe(0.9); // bitwise in its socket — the seam pulled nothing
    expect(linked.rejections).toHaveLength(rejectionsBefore); // inert, not rejected
  });
});

describe('T-LIFE-1 — multi-cord isolation + determinism of the failure loop', () => {
  it('grace clocks and vanish locks never leak across cords', () => {
    const world = makeWorld();
    const A1: Vec3 = { x: 0.9, y: 0.42, z: 0 };
    const B1: Vec3 = { x: 0.35, y: 0.42, z: 0.1 };
    const A2: Vec3 = { x: -0.4, y: 0.42, z: 0 };
    const B2: Vec3 = { x: -0.9, y: 0.42, z: -0.1 };
    spawnAndLink(world, 1, { x: 0.5, y: 1.0, z: 0 }, A1, B1);
    spawnAndLink(world, 2, { x: -0.5, y: 1.0, z: 0.1 }, A2, B2);
    expect(world.lifecycle.stateOf(1)).toBe('linked');
    expect(world.lifecycle.stateOf(2)).toBe('linked');
    // Cord 1 pops; cord 2 keeps its latches flowing for two seconds.
    world.advance(1, { pointerRay: null, popCords: [{ cordId: 1, index: END }] });
    const latches: SimInput = {
      pointerRay: null,
      seatTargets: [
        { cordId: 1, index: 0, position: A1 },
        { cordId: 2, index: 0, position: A2 },
        { cordId: 2, index: END, position: B2 },
      ],
    };
    world.advance(120, latches); // 2s of the ~3s window
    expect(world.lifecycle.stateOf(1)).toBe('popped');
    expect(world.lifecycle.graceRemaining(1)).toBeGreaterThan(0.9);
    expect(world.lifecycle.stateOf(2)).toBe('linked');
    // Two more seconds: cord 1's window expires; cord 2 is untouched.
    world.advance(120, latches);
    expect(world.lifecycle.stateOf(1)).toBe('vanishing');
    expect(world.lifecycle.stateOf(2)).toBe('linked');
    for (const [end, socket] of [
      [0, A2],
      [END, B2],
    ] as Array<[number, Vec3]>) {
      const p = cordById(world.getState(), 2).points[end];
      expect(p.x).toBe(socket.x); // bitwise: nobody else's failure moves cord 2
      expect(p.y).toBe(socket.y);
      expect(p.z).toBe(socket.z);
    }
    expectFinite(world.getState(), 'isolation');
  });

  it('full scenario determinism: pop → re-seat → pop → release-off-cube → completion is bitwise across reruns', () => {
    const A1: Vec3 = { x: 0.9, y: 0.42, z: 0 };
    const B1: Vec3 = { x: 0.35, y: 0.42, z: 0.1 };
    const run = (): number[] => {
      const world = makeWorld();
      const snapshots: number[] = [];
      const snap = (): void => {
        for (const cord of world.getState().cords) {
          for (const p of cord.points) snapshots.push(p.x, p.y, p.z);
        }
      };
      world.advance(1, { pointerRay: null, spawnCord: { cordId: 1, at: { x: 0.5, y: 1.0, z: 0 } } });
      snap();
      world.advance(3, { pointerRay: null, seatTargets: [{ cordId: 1, index: 0, position: A1 }] });
      snap();
      world.advance(30, {
        pointerRay: null,
        pinTargets: [{ cordId: 1, index: END, position: { x: 0.4, y: 0.9, z: 0.1 } }],
        seatTargets: [{ cordId: 1, index: 0, position: A1 }],
      });
      world.advance(3, {
        pointerRay: null,
        seatTargets: [
          { cordId: 1, index: 0, position: A1 },
          { cordId: 1, index: END, position: B1 },
        ],
      });
      snap(); // linked
      world.advance(1, { pointerRay: null, popCords: [{ cordId: 1, index: END }] });
      snap(); // popped
      for (let f = 0; f < 100; f += 1) {
        world.advance(1, { pointerRay: null, seatTargets: [{ cordId: 1, index: 0, position: A1 }] });
        snap();
      }
      world.advance(3, {
        pointerRay: null,
        seatTargets: [
          { cordId: 1, index: 0, position: A1 },
          { cordId: 1, index: END, position: B1 },
        ],
      });
      snap(); // re-seated (linked again)
      world.advance(1, { pointerRay: null, popCords: [{ cordId: 1, index: 0 }] });
      snap(); // popped the other way
      for (let f = 0; f < 200; f += 1) {
        world.advance(1, { pointerRay: null, releaseJack: { cordId: 1, index: END } });
        snap(); // a release intent for a NOT-held end: rejected every frame, state untouched
      }
      expect(world.lifecycle.stateOf(1)).toBe('vanishing'); // grace expired mid-loop
      world.advance(1, { pointerRay: null, despawnCords: [{ cordId: 1 }] });
      snap(); // gone — only the anchor remains
      return snapshots;
    };
    const a = run();
    const b = run();
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) throw new Error(`scenario determinism: element ${i} differs — ${a[i]} vs ${b[i]}`);
    }
  });
});

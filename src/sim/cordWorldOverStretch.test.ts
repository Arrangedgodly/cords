import { describe, expect, it } from 'vitest';
import { createCordWorldStep, DEFAULT_OVERSTRETCH_THRESHOLD } from './cordWorld';
import { createFixedTimestepDriver } from './fixedTimestep';
import type { LifecycleRejection, LifecycleTransition } from './lifecycle';
import type { SeatInput, SimInput, SimState, Vec3 } from './types';

/**
 * T-INT-6 — the OVER-STRETCH AUTO-UNPLUG at the world boundary, driven
 * through the production fixed-timestep driver with the composition's exact
 * latch discipline (main.ts mirrored): every seated end's transform is
 * re-sent EVERY frame from a per-end record, and a pop's onTransition event
 * drops the POPPED end's record AND splices its entry out of the current
 * frame's composed seatTargets array — the LIFE-1 verifier's carry-over
 * ("INT-6 must drop the popped end's seat latch in the pop's own frame"),
 * honored. One test deliberately VIOLATES that contract to pin why it
 * exists. Frame cadence: 1/60 s frames = two 1/120 s substeps, so a seat
 * transported by a frame's input is seen by the detector at the TOP of the
 * frame's SECOND substep — the pop lands in the transport's own frame.
 *
 * The rule under test (cordWorld.ts detectOverStretch):
 * - a LINKED cord fires when its two seated pins' separation ≥
 *   total rest length × (1 + threshold) — the detector reads the pins from
 *   the rope (bitwise the seats; enforcePins re-exacts them every step);
 * - the leash's machine-epsilon overshoot (≤ ~1e-9 over total) can never
 *   reach the bound, so a legal second seat never pops;
 * - the FAR jack pops — the seat that moved LESS since the previous pass
 *   (drag cube A with cord A→B: B's plug pops; exact ties pop the blue end);
 * - hysteresis: only LINKED cords are examined, so an oscillating drag
 *   fires at most ONE pop per linked window ("don't re-arm while popped").
 */

const DT = 1 / 120;
const FRAME = 1 / 60; // two substeps per frame, like the production driver
const SEGMENTS = 8;
const END = SEGMENTS;
const PIN: Vec3 = { x: 0, y: 1.6, z: 0 };
// The exact float the sim computes (segmentCount * segmentLength): 8 * 0.1
// is not 0.8 in binary — the test mirrors the sim's arithmetic bitwise.
const TOTAL = SEGMENTS * 0.1;

interface Harness {
  /** Advance one 1/60s frame: extra input merged with the flowing seat latch. */
  frame: (extra?: Partial<SimInput>) => SimState;
  /** Add (or move) a seated end's record — the latch flows from the next frame. */
  seat: (cordId: number, index: number, position: Vec3) => void;
  /** Toggle the same-frame latch drop on pop (the caller contract). */
  dropLatchOnPop: { enabled: boolean };
  getState: () => SimState;
  lifecycle: ReturnType<typeof createCordWorldStep>['lifecycle'];
  transitions: LifecycleTransition[];
  rejections: LifecycleRejection[];
}

function makeHarness(options?: {
  overStretch?: { threshold?: number } | false;
  graceSeconds?: number;
}): Harness {
  const transitions: LifecycleTransition[] = [];
  const rejections: LifecycleRejection[] = [];
  const seatRecords = new Map<string, Vec3>();
  const dropLatchOnPop = { enabled: true };
  // The CURRENT frame's composed latch array — main.ts's module-level
  // `seatTargets`, mirrored: the pop handler splices the popped end's entry
  // out of it MID-STEP, so the world's seats phase (which reads the same
  // array through input.seatTargets) cannot re-send the stale latch.
  let frameSeatTargets: SeatInput[] | null = null;
  const step = createCordWorldStep({
    anchor: { pin: PIN, segmentCount: SEGMENTS, floorY: 0 },
    cord: { segmentCount: SEGMENTS, floorY: 0 },
    // `overStretch: false` builds the DEFAULT (opt-out) world — detection off.
    ...(options?.overStretch === false ? {} : { overStretch: options?.overStretch ?? { threshold: 0.05 } }),
    lifecycle: {
      ...(options?.graceSeconds === undefined ? {} : { graceSeconds: options.graceSeconds }),
      onTransition: (event) => {
        transitions.push(event);
        // main.ts's releaseSeat semantics: the popped end's record dies in
        // the pop's OWN event, and its latch entry leaves the current
        // frame's array — before this step's seats phase re-sends it.
        if (event.to === 'popped' && dropLatchOnPop.enabled) {
          seatRecords.delete(`${event.cordId}:${event.end}`);
          if (frameSeatTargets !== null) {
            const k = frameSeatTargets.findIndex(
              (s) => s.cordId === event.cordId && s.index === event.end,
            );
            if (k >= 0) frameSeatTargets.splice(k, 1);
          }
        }
      },
      onRejected: (rejection) => rejections.push(rejection),
    },
  });
  const driver = createFixedTimestepDriver(step, { timestep: DT, maxSubsteps: 2 });
  let state: SimState = { time: 0, cords: [] };
  const frame = (extra?: Partial<SimInput>): SimState => {
    const seatTargets: SeatInput[] = [];
    for (const [key, position] of seatRecords) {
      const [cordId, index] = key.split(':');
      seatTargets.push({ cordId: Number(cordId), index: Number(index), position });
    }
    const input: SimInput = { pointerRay: null, ...(extra ?? {}) };
    if (seatTargets.length > 0) input.seatTargets = seatTargets;
    frameSeatTargets = seatTargets;
    state = driver.advance(state, FRAME, input).state;
    frameSeatTargets = null;
    return state;
  };
  return {
    frame,
    seat: (cordId, index, position) =>
      seatRecords.set(`${cordId}:${index}`, { x: position.x, y: position.y, z: position.z }),
    dropLatchOnPop,
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

/**
 * Spawn `cordId` and link it: red (end 0) seated at A, blue (END) at B —
 * through the real choreography (carry → seat → carry → seat), so the
 * machine's carried → awaiting-plug → linked pipeline is exercised on the
 * way in. |A − B| must sit under the cord's total length (the leash's own
 * limit) so the link itself never over-stretches.
 */
function spawnAndLink(
  h: Harness,
  cordId = 1,
  at: Vec3 = { x: 0.5, y: 1.0, z: 0 },
  A: Vec3 = { x: 0, y: 0.42, z: 0 },
  B: Vec3 = { x: -0.55, y: 0.42, z: 0 },
): void {
  h.frame({ spawnCord: { cordId, at } });
  for (let f = 0; f < 60; f += 1) {
    h.frame({ pinTargets: [{ cordId, index: 0, position: { x: A.x, y: 0.9, z: A.z } }] });
  }
  h.seat(cordId, 0, A);
  h.frame();
  for (let f = 0; f < 90; f += 1) {
    h.frame({ pinTargets: [{ cordId, index: END, position: { x: B.x, y: 0.9, z: B.z } }] });
  }
  h.seat(cordId, END, B);
  h.frame();
  h.frame();
}

const pops = (h: Harness): LifecycleTransition[] => h.transitions.filter((t) => t.to === 'popped');

describe('T-INT-6 — the trigger: threshold exactness + the leash epsilon', () => {
  it('fires exactly at the threshold — one hair below never fires', () => {
    const h = makeHarness(); // threshold 0.05 → bound = TOTAL * 1.05
    const A: Vec3 = { x: 0, y: 0.42, z: 0 };
    const B: Vec3 = { x: -0.55, y: 0.42, z: 0 };
    spawnAndLink(h, 1, undefined, A, B);
    expect(h.lifecycle.stateOf(1)).toBe('linked');
    const bound = TOTAL * 1.05;

    // A hair BELOW the bound (the offset is x-only and A.x is 0, so the
    // separation is bitwise the offset): three seconds of frames — no pop,
    // no event, no rejection.
    h.seat(1, END, { x: -(bound - 1e-6), y: A.y, z: A.z });
    for (let f = 0; f < 180; f += 1) {
      h.frame();
      expect(h.lifecycle.stateOf(1)).toBe('linked');
    }
    expect(pops(h)).toHaveLength(0);
    expect(h.rejections).toHaveLength(0);

    // EXACTLY at the bound (sep² === bound² bitwise): the transport frame's
    // own second substep detects and pops — the jack is free the same frame.
    h.seat(1, END, { x: -bound, y: A.y, z: A.z });
    h.frame();
    expect(h.lifecycle.stateOf(1)).toBe('popped');
    expect(pops(h)).toHaveLength(1);
    expect(pops(h)[0]).toMatchObject({
      cordId: 1,
      from: 'linked',
      to: 'popped',
      reason: 'over-stretch',
      end: 0, // A never moved: the FAR (stationary) socket pops
    });
    expectFinite(h.getState(), 'threshold pop');
  });

  it('never fires on the leash\u2019s machine-epsilon overshoot: a legal second seat lands at total + ~1e-9 and stays linked', () => {
    const h = makeHarness();
    const A: Vec3 = { x: 0, y: 0.42, z: 0 };
    h.frame({ spawnCord: { cordId: 1, at: { x: 0.5, y: 1.0, z: 0 } } });
    for (let f = 0; f < 60; f += 1) {
      h.frame({ pinTargets: [{ cordId: 1, index: 0, position: { x: A.x, y: 0.9, z: A.z } }] });
    }
    h.seat(1, 0, A);
    h.frame();
    // Carry the free end HARD past the cord's reach: the SIM-2 leash holds
    // the carried pin within TOTAL (+ ~1e-9) of the seated pin.
    for (let f = 0; f < 150; f += 1) {
      h.frame({ pinTargets: [{ cordId: 1, index: END, position: { x: 2.0, y: 0.42, z: 0 } }] });
    }
    const carried = { ...cordById(h.getState(), 1).points[END] };
    const sep = Math.hypot(carried.x - A.x, carried.y - A.y, carried.z - A.z);
    expect(sep).toBeLessThanOrEqual(TOTAL + 1e-9); // the leash overshoot, on record
    // Seat the second end AT the leash limit — the closest legal link.
    h.seat(1, END, carried);
    h.frame();
    h.frame();
    expect(h.lifecycle.stateOf(1)).toBe('linked');
    // Two seconds of latch flow: the epsilon overshoot never reaches 5%.
    for (let f = 0; f < 120; f += 1) {
      h.frame();
      expect(h.lifecycle.stateOf(1)).toBe('linked');
    }
    expect(pops(h)).toHaveLength(0);
    expect(h.rejections).toHaveLength(0);
  });

  it('detection is OPT-IN: the default world never auto-pops (explicit popCords only)', () => {
    const h = makeHarness({ overStretch: false });
    const A: Vec3 = { x: 0, y: 0.42, z: 0 };
    spawnAndLink(h, 1, undefined, A, { x: -0.55, y: 0.42, z: 0 });
    // Drag the blue seat to 3.75x the total length — absurdly over — and hold.
    h.seat(1, END, { x: -3 * TOTAL, y: A.y, z: A.z });
    for (let f = 0; f < 240; f += 1) h.frame();
    expect(h.lifecycle.stateOf(1)).toBe('linked'); // LIFE-1 behavior intact
    expect(pops(h)).toHaveLength(0);
  });

  it('overStretch: {} uses the 4% default; bad thresholds fail fast at construction', () => {
    const h = makeHarness({ overStretch: {} });
    const A: Vec3 = { x: 0, y: 0.42, z: 0 };
    spawnAndLink(h, 1, undefined, A, { x: -0.55, y: 0.42, z: 0 });
    expect(DEFAULT_OVERSTRETCH_THRESHOLD).toBe(0.04);
    // 3% over: below the default bound — never fires.
    h.seat(1, END, { x: -TOTAL * 1.03, y: A.y, z: A.z });
    for (let f = 0; f < 120; f += 1) h.frame();
    expect(h.lifecycle.stateOf(1)).toBe('linked');
    expect(pops(h)).toHaveLength(0);
    // 5% over: past the default bound — fires, in the transport's own frame.
    h.seat(1, END, { x: -TOTAL * 1.05, y: A.y, z: A.z });
    h.frame();
    expect(h.lifecycle.stateOf(1)).toBe('popped');

    for (const bad of [0, -0.1, NaN, 1, 2]) {
      expect(() =>
        createCordWorldStep({ overStretch: { threshold: bad } }),
      ).toThrow(/overStretch.threshold/);
    }
  });
});

describe('T-INT-6 — hysteresis + far-end selection', () => {
  it('an oscillating drag around the threshold fires exactly ONE pop — no spam, no rejections', () => {
    const h = makeHarness();
    const A: Vec3 = { x: 0, y: 0.42, z: 0 };
    const bound = TOTAL * 1.05;
    spawnAndLink(h, 1, undefined, A, { x: -0.55, y: 0.42, z: 0 });
    // Alternate over/under the bound for three seconds of frames.
    for (let f = 0; f < 180; f += 1) {
      const over = f % 2 === 0;
      h.seat(1, END, { x: -(bound + (over ? 0.05 : -0.05)), y: A.y, z: A.z });
      h.frame();
    }
    expect(pops(h)).toHaveLength(1); // fired at the FIRST crossing, never again
    expect(h.lifecycle.stateOf(1)).toBe('popped');
    expect(h.lifecycle.graceRemaining(1)).not.toBeNull();
    expect(h.rejections).toHaveLength(0); // no re-pop attempts, no warnings
    expectFinite(h.getState(), 'oscillation');
  });

  it('FAR-END RULE: dragging end 0\u2019s cube pops the blue plug; dragging END\u2019s cube pops the red plug', () => {
    // (a) cord A→B with end 0 at A: drag A (end 0 transports) — B's plug pops.
    const a = makeHarness();
    const A0: Vec3 = { x: 0, y: 0.42, z: 0 };
    const B: Vec3 = { x: -0.55, y: 0.42, z: 0 };
    spawnAndLink(a, 1, undefined, A0, B);
    a.seat(1, 0, { x: TOTAL * 1.1, y: A0.y, z: A0.z }); // drag A away past the bound
    a.frame();
    expect(a.lifecycle.stateOf(1)).toBe('popped');
    expect(pops(a)[0].end).toBe(END); // B's plug (the stationary socket)
    expect(a.lifecycle.endMode(1, END)).toBe('free');
    expect(a.lifecycle.endMode(1, 0)).toBe('seated');
    const blue = cordById(a.getState(), 1).points[END];
    expect(blue.y).toBeLessThan(B.y); // it fell away from its socket
    const red = cordById(a.getState(), 1).points[0];
    expect(red.x).toBe(TOTAL * 1.1); // the dragged cube's plug holds bitwise
    expect(red.y).toBe(A0.y);
    expect(red.z).toBe(A0.z);
    expectFinite(a.getState(), 'far-end (a)');

    // (b) the mirrored drag: drag B (end END transports) — A's plug pops.
    const b = makeHarness();
    spawnAndLink(b, 1, undefined, A0, B);
    b.seat(1, END, { x: -TOTAL * 1.1, y: B.y, z: B.z });
    b.frame();
    expect(b.lifecycle.stateOf(1)).toBe('popped');
    expect(pops(b)[0].end).toBe(0); // A's plug popped
    expect(b.lifecycle.endMode(1, 0)).toBe('free');
    expect(b.lifecycle.endMode(1, END)).toBe('seated');
    const redB = cordById(b.getState(), 1).points[0];
    // Physically free the same frame: a seated pin is re-exacted BITWISE
    // every step, so any movement off the socket proves the pin is gone
    // (the taut release can spring the end in any direction initially).
    expect(redB.x === A0.x && redB.y === A0.y && redB.z === A0.z).toBe(false);
    for (let f = 0; f < 30; f += 1) b.frame();
    const redSettled = cordById(b.getState(), 1).points[0];
    expect(redSettled.y).toBeLessThan(A0.y); // then it falls away for real
    const blueB = cordById(b.getState(), 1).points[END];
    expect(blueB.x).toBe(-TOTAL * 1.1); // the dragged seat holds bitwise
    expectFinite(b.getState(), 'far-end (b)');
  });

  it('EXACT TIE (both seats moved equally, or a second seat placed beyond reach) pops the blue end — deterministic', () => {
    const h = makeHarness();
    const A: Vec3 = { x: 0, y: 0.42, z: 0 };
    h.frame({ spawnCord: { cordId: 1, at: { x: 0.5, y: 1.0, z: 0 } } });
    for (let f = 0; f < 60; f += 1) {
      h.frame({ pinTargets: [{ cordId: 1, index: 0, position: { x: A.x, y: 0.9, z: A.z } }] });
    }
    h.seat(1, 0, A);
    h.frame();
    for (let f = 0; f < 90; f += 1) {
      h.frame({ pinTargets: [{ cordId: 1, index: END, position: { x: -0.4, y: 0.9, z: 0 } }] });
    }
    // Both seats stationary from the link on, but the second seat is placed
    // beyond the cord's reach (a non-leashed caller): the link itself is
    // over-stretched, both deltas tie at 0 — the BLUE end pops (the rule).
    h.seat(1, END, { x: -TOTAL * 1.2, y: A.y, z: A.z });
    h.frame(); // the link frame's second substep detects: tie → blue pops
    expect(h.lifecycle.stateOf(1)).toBe('popped');
    expect(pops(h)[0].end).toBe(END);
    expect(h.lifecycle.endMode(1, END)).toBe('free');
    expectFinite(h.getState(), 'tie break');
  });

  it('the ANCHOR cord pops the same way: its fixed pin never moves, so it is always the far end', () => {
    const h = makeHarness();
    // Cord 0: the anchor (end 0 pinned by construction). Carry and seat its
    // free end within the cord's reach of the fixed pin (the pin is high).
    for (let f = 0; f < 90; f += 1) {
      h.frame({ pinTargets: [{ cordId: 0, index: END, position: { x: 0.1, y: 0.9, z: 0 } }] });
    }
    h.seat(0, END, { x: 0.1, y: 0.82, z: 0 });
    h.frame();
    h.frame();
    expect(h.lifecycle.stateOf(0)).toBe('linked');
    // Drag the plug's seat away from the fixed anchor pin: the anchor pops.
    h.seat(0, END, { x: 0.95, y: 0.82, z: 0 });
    h.frame();
    expect(h.lifecycle.stateOf(0)).toBe('popped');
    expect(pops(h)[0]).toMatchObject({ cordId: 0, end: 0, reason: 'over-stretch' });
    expect(h.lifecycle.endMode(0, 0)).toBe('free'); // the anchor released
    expect(h.lifecycle.endMode(0, END)).toBe('seated'); // the dragged plug holds
    const anchorEnd = cordById(h.getState(), 0).points[0];
    expect(anchorEnd.y).toBeLessThan(PIN.y); // it fell away from the world pin
    expectFinite(h.getState(), 'anchor pop');
  });
});

describe('T-INT-6 — the same-frame latch drop (LIFE-1 carry-over, honored)', () => {
  it('the popped jack is physically free in the pop\u2019s OWN frame — the survivor bitwise, no #5 re-seat, grace open', () => {
    const h = makeHarness();
    const A: Vec3 = { x: 0, y: 0.42, z: 0 };
    const B: Vec3 = { x: -0.55, y: 0.42, z: 0 };
    spawnAndLink(h, 1, undefined, A, B);
    // One frame drags the blue seat far past the bound. Substep 1 moves the
    // seat (the world's detection at its top read the OLD seats); substep 2
    // detects the over-stretch and pops — BEFORE its own rope step, so the
    // freed red end already falls within THIS frame.
    h.seat(1, END, { x: -TOTAL * 1.2, y: B.y, z: B.z });
    const popFrame = h.frame();
    expect(h.lifecycle.stateOf(1)).toBe('popped');
    expect(pops(h)).toHaveLength(1);
    expect(pops(h)[0].end).toBe(0); // A stationary → red popped
    // The latch for end 0 died in the pop's own event — the seats phase of
    // the very substep that popped could NOT re-plug it through the legal #5.
    expect(h.transitions.some((t) => t.reason === 're-seated')).toBe(false);
    expect(h.rejections).toHaveLength(0);
    // Physically free THE SAME FRAME: a seated pin is re-exacted BITWISE
    // every step, so any movement off the socket within the pop frame proves
    // the pin is gone (a taut release may spring the end in any direction
    // for the first substeps — gravity wins shortly after, below). The
    // dragged seat holds bitwise, and the grace window just opened (the pop
    // ran after the substep's own clock advance — nothing has burned it).
    const red = cordById(popFrame, 1).points[0];
    expect(red.x === A.x && red.y === A.y && red.z === A.z).toBe(false);
    const blue = cordById(popFrame, 1).points[END];
    expect(blue.x).toBe(-TOTAL * 1.2);
    expect(blue.y).toBe(B.y);
    expect(blue.z).toBe(B.z);
    expect(h.lifecycle.graceRemaining(1)).toBe(3);
    // And it STAYS free: the record is gone, later frames latch only blue —
    // and the freed end falls away under gravity within a few frames.
    for (let f = 0; f < 60; f += 1) h.frame();
    expect(h.lifecycle.stateOf(1)).toBe('popped');
    expect(h.transitions.some((t) => t.reason === 're-seated')).toBe(false);
    const redLater = cordById(h.getState(), 1).points[0];
    expect(redLater.y).toBeLessThan(A.y);
    expectFinite(h.getState(), 'same-frame free');
  });

  it('WITHOUT the drop (contract violated): the substep\u2019s own latch re-seat #5s — why the drop is the contract', () => {
    const h = makeHarness();
    h.dropLatchOnPop.enabled = false; // the caller forgets releaseSeat
    const A: Vec3 = { x: 0, y: 0.42, z: 0 };
    spawnAndLink(h, 1, undefined, A, { x: -0.55, y: 0.42, z: 0 });
    h.seat(1, END, { x: -TOTAL * 1.2, y: A.y, z: A.z });
    h.frame();
    // Substep 2 detected + popped red… and then the SAME substep's seats
    // phase re-sent the stale red latch → the machine's legal #5 re-seat
    // (still over-stretched). The machine is correct on every step; the
    // CALLER broke the composition contract — hence the same-frame drop.
    expect(h.lifecycle.stateOf(1)).toBe('linked');
    expect(h.transitions.some((t) => t.reason === 're-seated')).toBe(true);
    expect(pops(h).length).toBeGreaterThanOrEqual(1);
    // Linked and still over-stretched: the pops keep coming — one per
    // substep that finds the cord linked — never settling into `popped`.
    h.frame();
    expect(pops(h).length).toBeGreaterThanOrEqual(2);
    expectFinite(h.getState(), 'stale latch');
  });
});

describe('T-INT-6 — popped physics, re-plug, expiry, isolation, determinism', () => {
  it('the popped jack dangles from the surviving seat and SETTLES — bitwise-still, no jitter', () => {
    const h = makeHarness({ graceSeconds: 30 }); // hold the window open
    const A: Vec3 = { x: 0, y: 0.42, z: 0 };
    const B: Vec3 = { x: -0.55, y: 0.42, z: 0 };
    spawnAndLink(h, 1, undefined, A, B);
    h.seat(1, END, { x: -TOTAL * 1.15, y: B.y, z: B.z });
    h.frame();
    expect(h.lifecycle.stateOf(1)).toBe('popped');
    // Let it swing out (a taut pop springs) and settle: eight seconds of
    // the surviving latch flowing (identical re-sends never re-wake).
    for (let f = 0; f < 480; f += 1) h.frame();
    expectFinite(h.getState(), 'dangle settle');
    expect(h.lifecycle.stateOf(1)).toBe('popped'); // window held open
    // Bitwise stillness over the final two seconds: the rope sleeps and the
    // latch re-send is a no-op — zero jitter by the sim's own definition.
    const still = cordById(h.getState(), 1).points.map((p) => ({ x: p.x, y: p.y, z: p.z }));
    for (let f = 0; f < 120; f += 1) {
      h.frame();
      const now = cordById(h.getState(), 1).points;
      for (let i = 0; i < now.length; i += 1) {
        expect(now[i].x).toBe(still[i].x);
        expect(now[i].y).toBe(still[i].y);
        expect(now[i].z).toBe(still[i].z);
      }
    }
    const red = cordById(h.getState(), 1).points[0];
    expect(red.y).toBeLessThan(A.y); // it genuinely dangled away
    const blue = cordById(h.getState(), 1).points[END];
    expect(blue.x).toBe(-TOTAL * 1.15); // the seat never moved again
  });

  it('RE-PLUG before expiry: grab the popped jack, seat it → linked, grace cancelled, physics re-pinned', () => {
    const h = makeHarness();
    const A: Vec3 = { x: 0, y: 0.42, z: 0 };
    const B: Vec3 = { x: -0.55, y: 0.42, z: 0 };
    spawnAndLink(h, 1, undefined, A, B);
    h.seat(1, END, { x: -TOTAL * 1.1, y: B.y, z: B.z });
    h.frame();
    expect(h.lifecycle.stateOf(1)).toBe('popped');
    expect(h.lifecycle.graceRemaining(1)).toBe(3);
    // Grab the popped red jack (the ordinary carry path — legal on a free
    // end; this is the "wire the grab path to it" seam, already legal) and
    // pull it toward a third socket near the surviving seat.
    const HAND: Vec3 = { x: -0.6, y: 0.8, z: 0.05 };
    for (let f = 0; f < 90; f += 1) {
      h.frame({ pinTargets: [{ cordId: 1, index: 0, position: HAND }] });
    }
    expect(h.lifecycle.endMode(1, 0)).toBe('carrying');
    const red = cordById(h.getState(), 1).points[0];
    expect(Math.hypot(red.x - HAND.x, red.y - HAND.y, red.z - HAND.z)).toBeLessThan(0.05);
    // Seat it inside the grace: popped → linked (#5), the grace cancels.
    const A2: Vec3 = { x: -TOTAL * 1.1 + 0.3, y: 0.42, z: 0.05 };
    h.seat(1, 0, A2);
    h.frame();
    h.frame();
    expect(h.lifecycle.stateOf(1)).toBe('linked');
    expect(h.lifecycle.graceRemaining(1)).toBeNull();
    const seated = cordById(h.getState(), 1).points[0];
    expect(seated.x).toBe(A2.x);
    expect(seated.y).toBe(A2.y);
    expect(seated.z).toBe(A2.z);
    // Five more seconds: still linked, never vanished.
    for (let f = 0; f < 300; f += 1) h.frame();
    expect(h.lifecycle.stateOf(1)).toBe('linked');
    expect(h.transitions.some((t) => t.reason === 'grace-expired')).toBe(false);
    expectFinite(h.getState(), 're-plug');
  });

  it('GRACE EXPIRY → vanishing (the transition fires; LIFE-2 owns the sequence after it)', () => {
    const h = makeHarness();
    const A: Vec3 = { x: 0, y: 0.42, z: 0 };
    spawnAndLink(h, 1, undefined, A, { x: -0.55, y: 0.42, z: 0 });
    h.seat(1, END, { x: -TOTAL * 1.1, y: A.y, z: A.z });
    h.frame();
    expect(h.lifecycle.stateOf(1)).toBe('popped');
    // 2.9s of frames: still popped. Past 3s: vanishing, exactly once.
    for (let f = 0; f < 174; f += 1) {
      h.frame();
      expect(h.lifecycle.stateOf(1)).toBe('popped');
    }
    for (let f = 0; f < 8; f += 1) h.frame();
    expect(h.lifecycle.stateOf(1)).toBe('vanishing');
    const expiries = h.transitions.filter((t) => t.reason === 'grace-expired');
    expect(expiries).toHaveLength(1);
    expect(expiries[0]).toMatchObject({ cordId: 1, from: 'popped', to: 'vanishing', end: 0 });
    // The lock: the world still simulates (LIFE-2's stage), but the FSM is
    // closed — a further pop intent is a loud rejection.
    const rejectionsBefore = h.rejections.length;
    h.frame({ popCords: [{ cordId: 1, index: END }] });
    expect(h.rejections.length).toBeGreaterThan(rejectionsBefore);
    expectFinite(h.getState(), 'expiry');
  });

  it('MULTI-CORD: dragging one host past ITS cord pops only that cord — the other stays linked bitwise', () => {
    const h = makeHarness();
    const A1: Vec3 = { x: 0, y: 0.42, z: 0 };
    const B1: Vec3 = { x: -0.55, y: 0.42, z: 0 };
    const A2: Vec3 = { x: -2.0, y: 0.42, z: 0.3 };
    const B2: Vec3 = { x: -2.55, y: 0.42, z: 0.3 };
    spawnAndLink(h, 1, { x: 0.5, y: 1.0, z: 0 }, A1, B1);
    spawnAndLink(h, 2, { x: -1.6, y: 1.0, z: 0.2 }, A2, B2);
    expect(h.lifecycle.stateOf(1)).toBe('linked');
    expect(h.lifecycle.stateOf(2)).toBe('linked');
    // Drag cord 1's blue seat far past cord 1's length; cord 2's latches
    // keep flowing identically the whole time.
    h.seat(1, END, { x: -TOTAL * 1.2, y: B1.y, z: B1.z });
    h.frame();
    expect(h.lifecycle.stateOf(1)).toBe('popped');
    expect(pops(h)).toHaveLength(1);
    expect(pops(h)[0].cordId).toBe(1);
    for (let f = 0; f < 120; f += 1) h.frame();
    expect(h.lifecycle.stateOf(2)).toBe('linked'); // untouched
    for (const [end, socket] of [
      [0, A2],
      [END, B2],
    ] as Array<[number, Vec3]>) {
      const p = cordById(h.getState(), 2).points[end];
      expect(p.x).toBe(socket.x); // bitwise: nobody else's failure moved it
      expect(p.y).toBe(socket.y);
      expect(p.z).toBe(socket.z);
    }
    expectFinite(h.getState(), 'multi-cord');
  });

  it('SUSTAINED OVER-PULL sweep (seeded): finite on every frame, one pop per window, bitwise-deterministic', () => {
    const run = (): { snaps: number[]; popCount: number } => {
      const h = makeHarness();
      const A: Vec3 = { x: 0, y: 0.42, z: 0 };
      const bound = TOTAL * 1.05;
      spawnAndLink(h, 1, undefined, A, { x: -0.55, y: 0.42, z: 0 });
      // Deterministic LCG (the sim's no-RNG rule is for the SIM; the test's
      // script is fixed data once seeded).
      let seed = 0x2f6e2b1 >>> 0;
      const rand = (): number => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      const snaps: number[] = [];
      for (let f = 0; f < 300; f += 1) {
        // Sustained over-pull with noise around the bound, both directions.
        const s = bound + (rand() - 0.35) * 0.2;
        h.seat(1, END, { x: -s, y: A.y, z: A.z });
        h.frame();
        for (const p of cordById(h.getState(), 1).points) snaps.push(p.x, p.y, p.z);
        expectFinite(h.getState(), `sweep frame ${f}`);
      }
      return { snaps, popCount: pops(h).length };
    };
    const a = run();
    const b = run();
    expect(a.popCount).toBe(1); // one linked window (no re-plug in the sweep)
    expect(a.snaps.length).toBe(b.snaps.length);
    for (let i = 0; i < a.snaps.length; i += 1) {
      if (a.snaps[i] !== b.snaps[i]) throw new Error(`sweep determinism: element ${i} differs`);
    }
  });

  it('full failure loop replays bitwise: link → drag-pop → dangle → re-plug → drag-pop → expiry', () => {
    const run = (): { snaps: string[]; events: string[] } => {
      const h = makeHarness();
      const A: Vec3 = { x: 0, y: 0.42, z: 0 };
      spawnAndLink(h, 1, undefined, A, { x: -0.55, y: 0.42, z: 0 });
      const snaps: string[] = [];
      const snap = (): void => {
        snaps.push(JSON.stringify(h.getState().cords.map((c) => c.points)));
      };
      h.seat(1, END, { x: -TOTAL * 1.1, y: A.y, z: A.z });
      h.frame(); // popped
      snap();
      for (let f = 0; f < 60; f += 1) {
        h.frame();
        snap();
      }
      for (let f = 0; f < 90; f += 1) {
        h.frame({ pinTargets: [{ cordId: 1, index: 0, position: { x: -0.7, y: 0.8, z: 0 } }] });
        snap();
      }
      const A2: Vec3 = { x: -0.8, y: 0.42, z: 0 };
      h.seat(1, 0, A2);
      h.frame(); // linked again
      snap();
      // Drag the blue seat away from the NEW red socket — over-stretched
      // relative to A2 this time.
      h.seat(1, END, { x: A2.x - TOTAL * 1.15, y: A.y, z: A.z });
      h.frame(); // popped again
      snap();
      for (let f = 0; f < 200; f += 1) {
        h.frame();
        snap();
      }
      const events = h.transitions.map(
        (t) => `${t.cordId}:${t.from}->${t.to}:${t.reason}:${t.end}`,
      );
      return { snaps, events };
    };
    const a = run();
    const b = run();
    expect(a.snaps).toEqual(b.snaps);
    expect(a.events).toEqual(b.events);
    expect(a.events.some((e) => e.includes('linked->popped:over-stretch'))).toBe(true);
    expect(a.events.some((e) => e.includes('popped->linked:re-seated'))).toBe(true);
    expect(a.events.some((e) => e.includes('popped->vanishing:grace-expired'))).toBe(true);
  });
});

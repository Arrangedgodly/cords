import { describe, expect, it } from 'vitest';
import { createCordWorldStep } from './cordWorld';
import { createFixedTimestepDriver } from './fixedTimestep';
import { createVerletRope } from './rope';
import type { LifecycleRejection, LifecycleTransition } from './lifecycle';
import type { VanishEvent, VanishOptions } from './vanish';
import type { SeatInput, SimInput, SimState, Vec3 } from './types';

/**
 * T-LIFE-2 — THE VANISH SEQUENCE CHOREOGRAPHY at the world boundary, driven
 * through the production fixed-timestep driver with the composition's exact
 * discipline (main.ts mirrored): seated ends' transforms re-sent EVERY frame
 * from per-end records; the POP event drops the popped end's record (INT-6's
 * contract); the choreography's PULL event drops the PULLED end's record AND
 * splices its entry out of the current frame's composed seatTargets array —
 * the same-frame latch drop, so this step's seats phase can never re-send a
 * latch for a plug the sequence just pulled out. One test deliberately
 * VIOLATES that contract (the converse pin).
 *
 * The approved sequence under test (vanish.ts + cordWorld.ts):
 * - FALL: the failing end becomes a FREE rope end the moment the cord enters
 *   `vanishing` (the world releases the carry — no scripted descent) and
 *   gravity + the existing floor clamp bring it down;
 * - SHATTER: exactly once, on FIRST floor contact (endY ≤ floorY + 0.05),
 *   at the impact point;
 * - PULL-OUT: the OTHER end unseats (the lock-permitted pull) and the body
 *   collapse-impulses toward the impact point;
 * - VANISH: after the 0.35s pull window the sequence reports completion and
 *   the cord leaves the world through the same completeVanish path the
 *   despawnCords intent takes — registry, rope, snapshot, gone.
 *
 * BOTH entry paths are pinned: release-off-cube (#3) and grace expiry (#6,
 * "the popped jack falls from where it dangles" — usually it already rests
 * on the floor, so the shatter is immediate).
 */

const DT = 1 / 120;
const FRAME = 1 / 60; // two substeps per frame, like the production driver
const SEGMENTS = 8;
const END = SEGMENTS;
const PIN: Vec3 = { x: 0, y: 1.6, z: 0 };
const FLOOR_Y = 0;
const CONTACT = 0.05; // DEFAULT_VANISH_CONTACT_OFFSET
const PULL_SECONDS = 0.35; // DEFAULT_VANISH_PULL_SECONDS
// T-REN-5 — widened from 1.2 (the LIFE-2 verifier's carry-forward: y≈3
// releases outran the old budget's drag padding and shattered mid-air).
const FALL_TIMEOUT = 1.55; // DEFAULT_VANISH_FALL_TIMEOUT_SECONDS
const GRAVITY = 9.81;

interface Harness {
  /** Advance one 1/60s frame: extra input merged with the flowing seat latch. */
  frame: (extra?: Partial<SimInput>) => SimState;
  /** Add (or move) a seated end's record — the latch flows from the next frame. */
  seat: (cordId: number, index: number, position: Vec3) => void;
  /** Toggle the same-frame latch drop on pull (the caller contract). */
  dropLatchOnPull: { enabled: boolean };
  getState: () => SimState;
  lifecycle: ReturnType<typeof createCordWorldStep>['lifecycle'];
  transitions: LifecycleTransition[];
  rejections: LifecycleRejection[];
  vanishEvents: VanishEvent[];
  /** Mid-event position probe (the world state object mutates in place). */
  endOf: (cordId: number, index: number) => Vec3;
  frames: () => number;
}

function makeWorld(options?: { vanish?: VanishOptions | false; graceSeconds?: number }): Harness {
  const transitions: LifecycleTransition[] = [];
  const rejections: LifecycleRejection[] = [];
  const vanishEvents: VanishEvent[] = [];
  const seatRecords = new Map<string, Vec3>();
  const dropLatchOnPull = { enabled: true };
  let frameSeatTargets: SeatInput[] | null = null;
  // The composition-side seat-latch discipline, main.ts mirrored: the record
  // dies in the transition's/event's own callback, and its entry leaves the
  // CURRENT frame's array before the world's seats phase re-sends it.
  const dropSeatRecord = (cordId: number, index: number | null): void => {
    if (index === null) return;
    seatRecords.delete(`${cordId}:${index}`);
    if (frameSeatTargets !== null) {
      const k = frameSeatTargets.findIndex(
        (s) => s.cordId === cordId && s.index === index,
      );
      if (k >= 0) frameSeatTargets.splice(k, 1);
    }
  };
  const step = createCordWorldStep({
    anchor: { pin: PIN, segmentCount: SEGMENTS, floorY: FLOOR_Y },
    cord: { segmentCount: SEGMENTS, floorY: FLOOR_Y },
    // `vanish: false` builds the DEFAULT (opt-out) world — LIFE-1 behavior.
    ...(options?.vanish === false
      ? {}
      : {
          vanish: {
            ...(options?.vanish ?? {}),
            onEvent: (event: VanishEvent) => {
              vanishEvents.push(event);
              if (event.kind === 'pull' && dropLatchOnPull.enabled) {
                dropSeatRecord(event.cordId, event.end); // releaseSeat, mirrored
              }
            },
          },
        }),
    lifecycle: {
      ...(options?.graceSeconds === undefined ? {} : { graceSeconds: options.graceSeconds }),
      onTransition: (event) => {
        transitions.push(event);
        if (event.to === 'popped') dropSeatRecord(event.cordId, event.end); // INT-6's contract
      },
      onRejected: (rejection) => rejections.push(rejection),
    },
  });
  const driver = createFixedTimestepDriver(step, { timestep: DT, maxSubsteps: 2 });
  let state: SimState = { time: 0, cords: [] };
  let frameCount = 0;
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
    frameCount += 1;
    return state;
  };
  return {
    frame,
    seat: (cordId, index, position) =>
      seatRecords.set(`${cordId}:${index}`, { x: position.x, y: position.y, z: position.z }),
    dropLatchOnPull,
    getState: () => state,
    lifecycle: step.lifecycle,
    transitions,
    rejections,
    vanishEvents,
    endOf: (cordId, index) => {
      const cord = state.cords.find((c) => c.id === cordId);
      if (cord === undefined) throw new Error(`cord ${cordId} missing`);
      return cord.points[index];
    },
    frames: () => frameCount,
  };
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

function cordById(state: SimState, id: number) {
  const cord = state.cords.find((c) => c.id === id);
  if (cord === undefined) throw new Error(`cord ${id} missing`);
  return cord;
}

const SEAT_A: Vec3 = { x: 0.9, y: 0.42, z: 0 };

/**
 * Release-path setup: cord 1 spawned, end 0 SEATED at SEAT_A (awaiting-plug),
 * end END held in hand at `hold` (carry targets every frame, main.ts's drag
 * compose mirrored). The caller then sends the release intent.
 */
function holdForRelease(h: Harness, hold: Vec3): void {
  h.frame({ spawnCord: { cordId: 1, at: { x: 0.5, y: 1.0, z: 0 } } });
  for (let f = 0; f < 60; f += 1) {
    h.frame({ pinTargets: [{ cordId: 1, index: 0, position: { x: SEAT_A.x, y: 0.9, z: SEAT_A.z } }] });
  }
  h.seat(1, 0, SEAT_A);
  for (let f = 0; f < 30; f += 1) {
    h.frame({ pinTargets: [{ cordId: 1, index: END, position: hold }] });
  }
  expect(h.lifecycle.stateOf(1)).toBe('awaiting-plug');
}

/** Drive until the cord leaves the world (cap 5s of frames); returns the frames spent. */
function driveUntilGone(h: Harness, cordId: number, maxFrames = 300): number {
  let spent = 0;
  for (let f = 0; f < maxFrames; f += 1) {
    h.frame();
    spent += 1;
    expectFinite(h.getState(), 'vanish drive');
    if (!h.getState().cords.some((c) => c.id === cordId)) return spent;
  }
  throw new Error(`cord ${cordId} did not leave the world within ${maxFrames} frames`);
}

/** Link-path setup: cord 1 linked (end 0 at A, END at B), then END popped. */
function linkAndPop(
  h: Harness,
  A: Vec3 = { x: 0, y: 0.42, z: 0 },
  B: Vec3 = { x: -0.55, y: 0.42, z: 0 },
): void {
  h.frame({ spawnCord: { cordId: 1, at: { x: 0.5, y: 1.0, z: 0 } } });
  for (let f = 0; f < 60; f += 1) {
    h.frame({ pinTargets: [{ cordId: 1, index: 0, position: { x: A.x, y: 1.0, z: A.z } }] });
  }
  h.seat(1, 0, A);
  for (let f = 0; f < 30; f += 1) {
    h.frame({ pinTargets: [{ cordId: 1, index: END, position: { x: B.x, y: 1.0, z: B.z } }] });
  }
  h.seat(1, END, B);
  for (let f = 0; f < 60; f += 1) h.frame(); // linked settle
  expect(h.lifecycle.stateOf(1)).toBe('linked');
  h.frame({ popCords: [{ cordId: 1, index: END }] }); // the far jack pops
  expect(h.lifecycle.stateOf(1)).toBe('popped');
}

describe('T-LIFE-2 — entry path #3: release-off-cube', () => {
  it('fall → shatter → pull → despawn, in order, shatter exactly once, cord gone, < 2s', () => {
    const h = makeWorld();
    const HOLD: Vec3 = { x: 1.4, y: 0.9, z: 0.2 };
    holdForRelease(h, HOLD);
    h.frame({ releaseJack: { cordId: 1, index: END } });
    expect(h.lifecycle.stateOf(1)).toBe('vanishing');
    driveUntilGone(h, 1);

    expect(h.vanishEvents.map((e) => e.kind)).toEqual(['start', 'shatter', 'pull', 'complete']);
    const [start, shatter, pull, complete] = h.vanishEvents;
    expect(start.end).toBe(END); // the released end is the failing end
    expect(shatter.end).toBe(END);
    // The shatter lands AT the floor (first contact, within the grip radius).
    expect(shatter.at).not.toBeNull();
    expect(shatter.at!.y).toBeLessThanOrEqual(FLOOR_Y + CONTACT + 1e-9);
    expect(shatter.at!.y).toBeGreaterThanOrEqual(FLOOR_Y - 1e-9);
    // The PULLED end is the seated one — the shadow-hazard regression's event
    // contract (the composition unregisters exactly this proxy at pull-out).
    expect(pull.end).toBe(0);
    expect(pull.at).toEqual(shatter.at);
    // Exactly one shatter per sequence.
    expect(h.vanishEvents.filter((e) => e.kind === 'shatter')).toHaveLength(1);
    // The cord is GONE from world state and the machine (LIFE-1's exit).
    expect(h.lifecycle.stateOf(1)).toBeUndefined();
    expect(h.getState().cords.some((c) => c.id === 1)).toBe(false);
    expect(h.transitions.some((t) => t.to === 'gone' && t.reason === 'vanish-complete')).toBe(true);
    // Timing: decisive, < 2s from entry for a typical height (0.9 → floor).
    const total = complete.time - start.time;
    expect(total).toBeGreaterThan(PULL_SECONDS);
    expect(total).toBeLessThan(2);
  });

  it('the FALL is the sim’s own: physics-speed, never faster than gravity, contact at the shatter frame', () => {
    const h = makeWorld();
    const HOLD: Vec3 = { x: 1.4, y: 0.9, z: 0.2 };
    holdForRelease(h, HOLD);
    h.frame({ releaseJack: { cordId: 1, index: END } });
    const startY = h.endOf(1, END).y;
    expect(startY).toBeCloseTo(HOLD.y, 2); // held at the release height

    // Watch the failing end every frame until the shatter fires.
    const ys: number[] = [];
    let shatterFrame = -1;
    for (let f = 0; f < 240 && shatterFrame < 0; f += 1) {
      h.frame();
      ys.push(h.endOf(1, END).y);
      if (h.vanishEvents.some((e) => e.kind === 'shatter')) shatterFrame = f;
    }
    expect(shatterFrame).toBeGreaterThanOrEqual(1);
    // FIRST contact, in observation terms: the choreography's contact read is
    // the position the rope already settled into (ys[k-1] — vanishAdvance
    // runs before each substep's solve), and the read before THAT was still
    // above the band — no earlier frame could have fired.
    expect(ys[shatterFrame - 1]).toBeLessThanOrEqual(FLOOR_Y + CONTACT + 1e-9);
    expect(ys[shatterFrame - 2]).toBeGreaterThan(FLOOR_Y + CONTACT);
    expect(ys[shatterFrame]).toBeLessThanOrEqual(FLOOR_Y + CONTACT + 1e-9);
    // It fell (gravity), and it cannot beat free fall from the release height.
    const [start, shatter] = h.vanishEvents;
    const fall = shatter.time - start.time;
    const ideal = Math.sqrt((2 * (HOLD.y - (FLOOR_Y + CONTACT))) / GRAVITY);
    expect(fall).toBeGreaterThanOrEqual(ideal - 3 * DT);
    expect(fall).toBeLessThan(ideal + 0.7); // constraint drag bounded
    driveUntilGone(h, 1);
  });

  it('the PULL-OUT frees the seated plug and the cord visibly retracts toward the failure point', () => {
    const h = makeWorld();
    holdForRelease(h, { x: 1.4, y: 0.9, z: 0.2 });
    h.frame({ releaseJack: { cordId: 1, index: END } });
    // Capture the whole polyline at the pull event (mid-step read: the world
    // state object mutates in place) and just before the cord despawns.
    let pullPoints: Vec3[] | null = null;
    let lastPoints: Vec3[] | null = null;
    let shatterAt: Vec3 | null = null;
    for (let f = 0; f < 240; f += 1) {
      h.frame();
      const cord = h.getState().cords.find((c) => c.id === 1);
      if (cord === undefined) break;
      lastPoints = cord.points.map((p) => ({ x: p.x, y: p.y, z: p.z }));
      const pull = h.vanishEvents.find((e) => e.kind === 'pull');
      if (pull !== undefined && pullPoints === null) {
        pullPoints = lastPoints;
        shatterAt = { x: pull.at!.x, y: pull.at!.y, z: pull.at!.z };
        expect(h.lifecycle.endMode(1, 0)).toBe('free'); // out of its socket
      }
    }
    expect(pullPoints).not.toBeNull();
    expect(lastPoints).not.toBeNull();
    const dist = (p: Vec3): number =>
      Math.sqrt((p.x - shatterAt!.x) ** 2 + (p.y - shatterAt!.y) ** 2 + (p.z - shatterAt!.z) ** 2);
    const centroid = (points: Vec3[]): Vec3 => {
      let x = 0; let y = 0; let z = 0;
      for (const p of points) { x += p.x; y += p.y; z += p.z; }
      return { x: x / points.length, y: y / points.length, z: z / points.length };
    };
    // The seated plug LEFT its socket (impulse > a jiggle)...
    expect(dist(lastPoints![0])).toBeGreaterThan(0.04);
    // ...and the cord BODY retracted toward the failure point: its centroid
    // traveled most of the way to the impact point ALONG the line to it (the
    // whip overshoots and slides past — momentum, not a magnet — so proximity
    // alone is the wrong metric; the toward-the-point displacement is the
    // honest one).
    const cPull = centroid(pullPoints!);
    const cLast = centroid(lastPoints!);
    const dirX = shatterAt!.x - cPull.x;
    const dirY = shatterAt!.y - cPull.y;
    const dirZ = shatterAt!.z - cPull.z;
    const gap = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ);
    const moveX = cLast.x - cPull.x;
    const moveY = cLast.y - cPull.y;
    const moveZ = cLast.z - cPull.z;
    const toward = (moveX * dirX + moveY * dirY + moveZ * dirZ) / gap;
    expect(toward).toBeGreaterThan(gap * 0.6); // it crossed most of the gap
    expect(h.getState().cords.some((c) => c.id === 1)).toBe(false);
  });

  it('the same-frame latch drop: WITH it, zero rejections; WITHOUT it, the lock still holds (but the stale latch warns)', () => {
    // The contract honored (the default harness): the pulled end's record and
    // frame-array entry die in the pull's own event — nothing to re-send.
    const h = makeWorld();
    holdForRelease(h, { x: 1.4, y: 0.9, z: 0.2 });
    h.frame({ releaseJack: { cordId: 1, index: END } });
    driveUntilGone(h, 1);
    expect(h.rejections).toHaveLength(0);
    expect(h.vanishEvents.map((e) => e.kind)).toEqual(['start', 'shatter', 'pull', 'complete']);

    // The contract violated: the stale latch keeps arriving. The machine's
    // vanishing LOCK rejects every re-send (unlike the pop's #5 re-seat, there
    // is no legal seat into a vanishing cord), so the plug still comes out —
    // but the warning channel fires, which is why the drop IS the contract.
    const v = makeWorld();
    v.dropLatchOnPull.enabled = false;
    holdForRelease(v, { x: 1.4, y: 0.9, z: 0.2 });
    v.frame({ releaseJack: { cordId: 1, index: END } });
    driveUntilGone(v, 1);
    expect(v.vanishEvents.map((e) => e.kind)).toEqual(['start', 'shatter', 'pull', 'complete']);
    expect(v.rejections.some((r) => r.action === 'seat')).toBe(true);
    expect(v.transitions.some((t) => t.reason === 're-seated')).toBe(false); // never re-plugged
    expect(v.lifecycle.stateOf(1)).toBeUndefined();
  });

  it('a stale carry latch cannot re-grab the failing end mid-fall (the vanishing carry lock)', () => {
    const h = makeWorld();
    const HOLD: Vec3 = { x: 1.4, y: 0.9, z: 0.2 };
    holdForRelease(h, HOLD);
    h.frame({ releaseJack: { cordId: 1, index: END } });
    // A caller that keeps composing the failing end's carry target every frame
    // (the driver replays one input object across substeps, so this also pins
    // the replay case): the world ignores the intent — the end FALLS.
    for (let f = 0; f < 30; f += 1) {
      h.frame({ pinTargets: [{ cordId: 1, index: END, position: HOLD }] });
    }
    expect(h.endOf(1, END).y).toBeLessThan(HOLD.y - 0.1); // it descended
    driveUntilGone(h, 1);
    expect(h.rejections).toHaveLength(0); // silent lock, not a warning storm
  });

  it('vanishInfo: null → fall/0 → pull/progress → null again (the fade read)', () => {
    const h = makeWorld();
    holdForRelease(h, { x: 1.4, y: 0.9, z: 0.2 });
    expect(h.lifecycle.vanishInfo(1)).toBeNull(); // not vanishing yet
    h.frame({ releaseJack: { cordId: 1, index: END } });
    expect(h.lifecycle.vanishInfo(1)).toEqual({ phase: 'fall', progress: 0 });
    let sawPullProgress = false;
    for (let f = 0; f < 240; f += 1) {
      h.frame();
      const info = h.lifecycle.vanishInfo(1);
      const pulled = h.vanishEvents.some((e) => e.kind === 'pull');
      if (info !== null && pulled) {
        expect(info.phase).toBe('pull');
        if (info.progress > 0.2 && info.progress < 1) sawPullProgress = true;
      }
    }
    expect(sawPullProgress).toBe(true);
    expect(h.lifecycle.vanishInfo(1)).toBeNull(); // gone
  });
});

describe('T-LIFE-2 — entry path #6: grace expiry (the popped jack falls from where it dangles)', () => {
  it('expiry → the same four events; the popped end shatters; the surviving socket is pulled; < 2s', () => {
    const h = makeWorld();
    linkAndPop(h);
    // Burn the ~3s grace; the popped end comes to REST ON THE FLOOR well
    // inside it (INT-6 pinned that dangle settles), so the shatter is
    // immediate — "falls from where it dangles", already-landed.
    for (let f = 0; f < 190; f += 1) h.frame();
    expect(h.lifecycle.stateOf(1)).toBe('vanishing');
    const expiry = h.transitions.find((t) => t.reason === 'grace-expired');
    expect(expiry).toBeDefined();
    driveUntilGone(h, 1);

    expect(h.vanishEvents.map((e) => e.kind)).toEqual(['start', 'shatter', 'pull', 'complete']);
    const [start, shatter, pull, complete] = h.vanishEvents;
    expect(start.end).toBe(END); // the POPPED end is the failing end
    expect(shatter.end).toBe(END);
    expect(pull.end).toBe(0); // the SURVIVING socket is pulled
    // Already resting on the floor: contact on the first observation.
    expect(shatter.time - start.time).toBeLessThanOrEqual(2 * DT);
    expect(shatter.at!.y).toBeLessThanOrEqual(FLOOR_Y + CONTACT + 1e-9);
    // Decisive: expiry-to-gone well under the 2s bound.
    expect(complete.time - expiry!.time).toBeLessThan(2);
    expect(h.getState().cords.some((c) => c.id === 1)).toBe(false);
    expect(h.rejections).toHaveLength(0);
  });

  it('a dangle that cannot reach the floor still completes — the fall-timeout totality guard', () => {
    const h = makeWorld();
    // Seats HIGH (1.6): the 0.8 cord hangs the popped end at ~0.8 — above the
    // contact band forever. The sequence must still finish (guard: 1.55s).
    linkAndPop(h, { x: 0, y: 1.6, z: 0 }, { x: -0.55, y: 1.6, z: 0 });
    for (let f = 0; f < 190; f += 1) h.frame();
    expect(h.lifecycle.stateOf(1)).toBe('vanishing');
    driveUntilGone(h, 1);

    const [start, shatter, , complete] = h.vanishEvents;
    expect(h.vanishEvents.map((e) => e.kind)).toEqual(['start', 'shatter', 'pull', 'complete']);
    const fall = shatter.time - start.time;
    expect(fall).toBeGreaterThanOrEqual(FALL_TIMEOUT - 3 * DT);
    expect(fall).toBeLessThan(FALL_TIMEOUT + 0.2);
    expect(shatter.at!.y).toBeGreaterThan(FLOOR_Y + CONTACT); // honest: at the dangle
    expect(complete.time - shatter.time).toBeCloseTo(PULL_SECONDS, 2);
    expect(complete.time - start.time).toBeLessThan(2); // still inside the bound
  });
});

describe('T-LIFE-2 — timing tunables + fail-fast', () => {
  it('pullSeconds is honored: a 0.1s window completes ~0.1s after the shatter', () => {
    const h = makeWorld({ vanish: { pullSeconds: 0.1 } });
    holdForRelease(h, { x: 1.4, y: 0.9, z: 0.2 });
    h.frame({ releaseJack: { cordId: 1, index: END } });
    driveUntilGone(h, 1);
    const shatter = h.vanishEvents.find((e) => e.kind === 'shatter')!;
    const complete = h.vanishEvents.find((e) => e.kind === 'complete')!;
    expect(complete.time - shatter.time).toBeGreaterThanOrEqual(0.1 - 2 * DT);
    expect(complete.time - shatter.time).toBeLessThan(0.16);
  });

  it('bad configurations fail fast at world construction', () => {
    expect(() => makeWorld({ vanish: { pullSeconds: 0 } })).toThrow();
    expect(() => makeWorld({ vanish: { pullSeconds: Number.NaN } })).toThrow();
    expect(() => makeWorld({ vanish: { pullSpeed: -1 } })).toThrow();
    expect(() => makeWorld({ vanish: { fallTimeoutSeconds: 0 } })).toThrow();
    expect(() => makeWorld({ vanish: { contactOffset: -0.01 } })).toThrow();
  });
});

describe('T-LIFE-2 — the lock, the intent path, id reuse, and the opt-out', () => {
  it('an explicit despawnCords mid-sequence still works: cord gone, the run drops silently', () => {
    const h = makeWorld();
    holdForRelease(h, { x: 1.4, y: 0.9, z: 0.2 });
    h.frame({ releaseJack: { cordId: 1, index: END } });
    h.frame();
    h.frame(); // mid-fall
    h.frame({ despawnCords: [{ cordId: 1 }] });
    expect(h.lifecycle.stateOf(1)).toBeUndefined();
    expect(h.getState().cords.some((c) => c.id === 1)).toBe(false);
    // The run died with the cord: no further choreography events, ever.
    expect(h.vanishEvents.map((e) => e.kind)).toEqual(['start']);
    for (let f = 0; f < 30; f += 1) h.frame();
    expect(h.vanishEvents.map((e) => e.kind)).toEqual(['start']);
    expectFinite(h.getState(), 'post explicit despawn');
  });

  it('the freed id is reusable — a second life runs a second, fresh sequence', () => {
    const h = makeWorld();
    holdForRelease(h, { x: 1.4, y: 0.9, z: 0.2 });
    h.frame({ releaseJack: { cordId: 1, index: END } });
    driveUntilGone(h, 1);
    h.frame({ spawnCord: { cordId: 1, at: { x: 0.5, y: 1.0, z: 0 } } });
    expect(h.lifecycle.stateOf(1)).toBe('carried');
    // Second life, same choreography: seat red, hold blue, fail it again.
    for (let f = 0; f < 60; f += 1) {
      h.frame({ pinTargets: [{ cordId: 1, index: 0, position: { x: SEAT_A.x, y: 0.9, z: SEAT_A.z } }] });
    }
    h.seat(1, 0, SEAT_A);
    for (let f = 0; f < 30; f += 1) {
      h.frame({ pinTargets: [{ cordId: 1, index: END, position: { x: 1.4, y: 0.9, z: 0.2 } }] });
    }
    h.frame({ releaseJack: { cordId: 1, index: END } });
    driveUntilGone(h, 1);
    expect(h.vanishEvents.map((e) => e.kind)).toEqual([
      'start', 'shatter', 'pull', 'complete',
      'start', 'shatter', 'pull', 'complete',
    ]);
  });

  it('ABSENT config = LIFE-1 behavior byte-for-byte: locked until an explicit despawn', () => {
    const h = makeWorld({ vanish: false });
    holdForRelease(h, { x: 1.4, y: 0.9, z: 0.2 });
    h.frame({ releaseJack: { cordId: 1, index: END } });
    expect(h.lifecycle.stateOf(1)).toBe('vanishing');
    for (let f = 0; f < 120; f += 1) h.frame(); // 2s: nothing happens by itself
    expect(h.getState().cords.some((c) => c.id === 1)).toBe(true);
    expect(h.lifecycle.stateOf(1)).toBe('vanishing');
    expect(h.vanishEvents).toHaveLength(0);
    expect(h.lifecycle.vanishInfo(1)).toBeNull();
    h.frame({ despawnCords: [{ cordId: 1 }] }); // the explicit report
    expect(h.getState().cords.some((c) => c.id === 1)).toBe(false);
  });

  it('the anchor cord vanishes too: its pinned end is the pulled one, the world empties', () => {
    const h = makeWorld();
    // Cord 0: end 0 seated by construction (awaiting-plug); hold the FREE end,
    // release it off-cube. The leash keeps the held end ~0.8 from the pin at
    // (0,1.6,0), so the fall rides the timeout guard — still a full sequence.
    for (let f = 0; f < 60; f += 1) {
      h.frame({ pinTargets: [{ cordId: 0, index: END, position: { x: 0.35, y: 0.9, z: 0 } }] });
    }
    expect(h.lifecycle.stateOf(0)).toBe('awaiting-plug');
    h.frame({ releaseJack: { cordId: 0, index: END } });
    expect(h.lifecycle.stateOf(0)).toBe('vanishing');
    let gone = false;
    for (let f = 0; f < 300 && !gone; f += 1) {
      h.frame();
      gone = !h.getState().cords.some((c) => c.id === 0);
      expectFinite(h.getState(), 'anchor vanish');
    }
    expect(gone).toBe(true);
    expect(h.vanishEvents.map((e) => e.kind)).toEqual(['start', 'shatter', 'pull', 'complete']);
    expect(h.vanishEvents[0].end).toBe(END); // the released end fails
    expect(h.vanishEvents[2].end).toBe(0); // the ANCHOR pin is what pulls out
    expect(h.getState().cords).toHaveLength(0); // the whole world is clean
  });
});

describe('T-LIFE-2 — isolation + determinism', () => {
  it('one cord vanishing never disturbs a linked neighbor (bitwise vs a solo run)', () => {
    const A2: Vec3 = { x: -0.4, y: 0.42, z: 0 };
    const B2: Vec3 = { x: -0.9, y: 0.42, z: -0.1 };
    const runSolo = (): number[] => {
      const h = makeWorld();
      h.frame({ spawnCord: { cordId: 2, at: { x: -0.5, y: 1.0, z: 0.1 } } });
      for (let f = 0; f < 60; f += 1) {
        h.frame({ pinTargets: [{ cordId: 2, index: 0, position: { x: A2.x, y: 1.0, z: A2.z } }] });
      }
      h.seat(2, 0, A2);
      for (let f = 0; f < 30; f += 1) {
        h.frame({ pinTargets: [{ cordId: 2, index: END, position: { x: B2.x, y: 1.0, z: B2.z } }] });
      }
      h.seat(2, END, B2);
      for (let f = 0; f < 150; f += 1) h.frame();
      return cordById(h.getState(), 2).points.flatMap((p) => [p.x, p.y, p.z]);
    };
    const runBusy = (): number[] => {
      const h = makeWorld();
      h.frame({ spawnCord: { cordId: 1, at: { x: 0.5, y: 1.0, z: 0 } } });
      h.frame({ spawnCord: { cordId: 2, at: { x: -0.5, y: 1.0, z: 0.1 } } });
      for (let f = 0; f < 60; f += 1) {
        h.frame({
          pinTargets: [
            { cordId: 2, index: 0, position: { x: A2.x, y: 1.0, z: A2.z } },
            { cordId: 1, index: 0, position: { x: SEAT_A.x, y: 0.9, z: SEAT_A.z } },
          ],
        });
      }
      h.seat(2, 0, A2);
      h.seat(1, 0, SEAT_A);
      for (let f = 0; f < 30; f += 1) {
        h.frame({
          pinTargets: [
            { cordId: 2, index: END, position: { x: B2.x, y: 1.0, z: B2.z } },
            { cordId: 1, index: END, position: { x: 1.4, y: 0.9, z: 0.2 } },
          ],
        });
      }
      h.seat(2, END, B2);
      // Cord 1 fails and runs its whole sequence WHILE cord 2 sits linked.
      h.frame({ releaseJack: { cordId: 1, index: END } });
      for (let f = 0; f < 150; f += 1) h.frame();
      expect(h.vanishEvents.some((e) => e.cordId === 1 && e.kind === 'complete')).toBe(true);
      expect(h.lifecycle.stateOf(2)).toBe('linked'); // untouched, still seated
      return cordById(h.getState(), 2).points.flatMap((p) => [p.x, p.y, p.z]);
    };
    const solo = runSolo();
    const busy = runBusy();
    expect(busy.length).toBe(solo.length);
    for (let i = 0; i < solo.length; i += 1) {
      if (solo[i] !== busy[i]) {
        throw new Error(`isolation: cord 2 point ${i / 3} differs — ${solo[i]} vs ${busy[i]}`);
      }
    }
  });

  it('full determinism: the release-path scenario replays bitwise, events included', () => {
    const run = (): { snapshots: number[]; events: string[] } => {
      const h = makeWorld();
      const snapshots: number[] = [];
      const events: string[] = [];
      const snap = (): void => {
        for (const cord of h.getState().cords) {
          for (const p of cord.points) snapshots.push(p.x, p.y, p.z);
        }
        for (const e of h.vanishEvents) {
          events.push(`${e.kind}@${e.end}:${e.time.toFixed(6)}@${e.at ? e.at.y.toFixed(6) : ''}`);
        }
      };
      holdForRelease(h, { x: 1.4, y: 0.9, z: 0.2 });
      h.frame({ releaseJack: { cordId: 1, index: END } });
      for (let f = 0; f < 150; f += 1) {
        h.frame();
        snap();
      }
      return { snapshots, events };
    };
    const a = run();
    const b = run();
    expect(a.snapshots.length).toBe(b.snapshots.length);
    for (let i = 0; i < a.snapshots.length; i += 1) {
      if (a.snapshots[i] !== b.snapshots[i]) {
        throw new Error(`determinism: snapshot ${i} differs — ${a.snapshots[i]} vs ${b.snapshots[i]}`);
      }
    }
    expect(a.events).toEqual(b.events);
  });
});

describe('T-LIFE-2 — rope.releaseCarry (the fall’s primitive)', () => {
  it('a released carried end falls under gravity to its true rest (floor-clamped when reachable); a held one does not', () => {
    // Setup A — the floor is REACHABLE (the anchor sits below the cord's total
    // length): pin at y=0.5, hold the end at 0.45, release → it falls to the
    // bench and rests ON it (the existing floor clamp, no scripting).
    const makeHeld = (pinY: number, holdY: number) => {
      const rope = createVerletRope({
        segmentCount: SEGMENTS,
        segmentLength: 0.1,
        pin: { x: 0, y: pinY, z: 0 },
        pinIndex: 0,
        floorY: FLOOR_Y,
      });
      rope.placeAlong({ x: 0, y: pinY, z: 0 }, { x: 0, y: pinY - 0.7, z: 0 });
      rope.carryEnd(END);
      for (let i = 0; i < 120; i += 1) {
        rope.setPinTarget(END, { x: 0.05, y: holdY, z: 0 });
        rope.step(DT);
      }
      return rope;
    };
    const readY = (rope: ReturnType<typeof createVerletRope>): number => {
      const out = { x: 0, y: 0, z: 0 };
      rope.readPoint(END, out);
      return out.y;
    };

    const reachable = makeHeld(0.5, 0.45);
    expect(readY(reachable)).toBeGreaterThan(0.35); // held: never fell
    reachable.releaseCarry(END);
    for (let i = 0; i < 300; i += 1) reachable.step(DT);
    expect(readY(reachable)).toBeLessThanOrEqual(FLOOR_Y + 1e-9); // on the bench
    expect(reachable.isFiniteState()).toBe(true);

    // Setup B — the floor is OUT OF REACH (the anchor hangs the end at
    // pinY − total): the released end falls to exactly the hanging rest,
    // neither held up nor sunk past the constraints.
    const hanging = makeHeld(0.9, 0.6);
    expect(readY(hanging)).toBeGreaterThan(0.5); // held
    hanging.releaseCarry(END);
    for (let i = 0; i < 300; i += 1) hanging.step(DT);
    const restY = readY(hanging);
    expect(restY).toBeLessThan(0.2); // it FELL from 0.6…
    expect(restY).toBeGreaterThan(0.05); // …to the ~0.1 hanging rest (0.9 − 0.8)
    expect(hanging.isFiniteState()).toBe(true);
  });

  it('releaseCarry throws on nothing-carried / wrong end (caller bug, loud)', () => {
    const rope = createVerletRope({ segmentCount: SEGMENTS, segmentLength: 0.1, pin: { x: 0, y: 1, z: 0 } });
    expect(() => rope.releaseCarry(END)).toThrow();
    rope.carryEnd(END);
    expect(() => rope.releaseCarry(0)).toThrow();
    rope.releaseCarry(END); // the legal one
    expect(() => rope.releaseCarry(END)).toThrow(); // twice: nothing carried now
  });
});

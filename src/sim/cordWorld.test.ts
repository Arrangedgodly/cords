import { describe, expect, it } from 'vitest';
import { createCordWorldStep } from './cordWorld';
import { createFixedTimestepDriver } from './fixedTimestep';
import type { PinTargetInput, SeatInput, SimInput, SimState, SpawnCordInput, Vec3 } from './types';

/**
 * INT-4 — grab-from-midair spawn at the world-step boundary (plan.md
 * "springs a coiled cord held by its red jack at the cursor, blue trailing;
 * springy uncoil; ends pluggable in any order"). Pinned here:
 *
 * - SPAWN: lands in hand ≤1 frame (the red end is bitwise at the grab point
 *   on the spawn step), coiled within sane bounds, zero NaN — and the
 *   fixed-timestep driver's same-input-across-substeps replay spawns exactly
 *   ONE cord (idempotent on the caller-owned cordId).
 * - TOTALITY: garbage requests (bad id, non-finite position), duplicate
 *   ids, and an at-cap world are ignored — the step never throws.
 * - ANY ORDER: carry → seat → carry the OTHER end → seat it → RE-GRAB a
 *   seated end (the hand-pulled plug, LIFE-1 amendment #7: it leaves the
 *   socket while the other seat holds bitwise — the cord keeps hanging from
 *   it), plus anchor un-seat on the M1 cord (#8: awaiting-plug → carried).
 *   The approved AUTO-unplug is the pop (linked → popped), whose end
 *   re-seats before the grace expires.
 * - LINKED (the INT-4 FIX, verifier reproduction): the seats are PER-END, so
 *   a spawned cord holds BOTH ends seated (300 steps, both latches flowing,
 *   bitwise), a cube drag transports exactly its own plug, an un-seat/re-seat
 *   on either end never silently frees the other, self-links transport both
 *   seats, and 2 linked cords (4 seats) isolate bitwise — the "INT-4 FIX —
 *   linked cords" describe block below.
 * - MULTI-CORD ISOLATION (bitwise): a world with an extra violently-carried
 *   cord leaves every other cord bitwise identical to the solo run.
 * - SPAWN-WHILE-CARRYING: the drop of the old end and the new cord's carry
 *   compose in one frame's pinTargets.
 * - DETERMINISM + RAPID SPAWN/DROP FUZZ: a full scripted scenario and a
 *   seeded 300-frame spawn/drag/drop churn are bitwise-identical across
 *   reruns and finite on every frame.
 */

const DT = 1 / 120;
const FRAME = 1 / 60;
const SEGMENTS = 8;
const END = SEGMENTS;
const PIN: Vec3 = { x: 0, y: 1.6, z: 0 };

function makeWorld(maxCords?: number) {
  const step = createCordWorldStep({
    anchor: { pin: PIN, segmentCount: SEGMENTS, floorY: 0 },
    cord: { segmentCount: SEGMENTS, floorY: 0 },
    ...(maxCords === undefined ? {} : { maxCords }),
  });
  const driver = createFixedTimestepDriver(step, { timestep: DT, maxSubsteps: 2 });
  let state: SimState = { time: 0, cords: [] };
  const advance = (frames: number, input: SimInput): SimState => {
    for (let f = 0; f < frames; f += 1) state = driver.advance(state, FRAME, input).state;
    return state;
  };
  return { advance, getState: () => state, lifecycle: step.lifecycle };
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

function flat(cord: { points: Vec3[] }): number[] {
  const out: number[] = [];
  for (const p of cord.points) out.push(p.x, p.y, p.z);
  return out;
}

function expectBitwiseEqual(a: ArrayLike<number>, b: ArrayLike<number>, label: string): void {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) throw new Error(`${label}: element ${i} differs — ${a[i]} vs ${b[i]}`);
  }
}

describe('INT-4 — cord world: spawn', () => {
  it('a spawned cord lands in hand ≤1 frame (red end bitwise at the grab point), coiled, finite — and a re-sent intent spawns nothing more', () => {
    const world = makeWorld();
    const spawn: SpawnCordInput = { cordId: 1, at: { x: 0.5, y: 1.0, z: 0.2 } };
    const input: SimInput = { pointerRay: null, spawnCord: spawn };
    // ONE substep is enough: the cord exists and its red end is in hand.
    world.advance(1, input);
    let state = world.getState();
    expect(state.cords.length).toBe(2); // anchor + the spawn
    const spawned = cordById(state, 1);
    expect(spawned.points.length).toBe(SEGMENTS + 1);
    expect(spawned.points[0].x).toBe(spawn.at.x); // bitwise in hand
    expect(spawned.points[0].y).toBe(spawn.at.y);
    expect(spawned.points[0].z).toBe(spawn.at.z);
    // Coiled start state: sane bounds around the grab point, no NaN.
    for (const p of spawned.points) {
      expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
      expect(Math.hypot(p.x - spawn.at.x, p.y - spawn.at.y, p.z - spawn.at.z)).toBeLessThan(0.35);
    }
    // The driver replays the SAME input across the frame's substeps and the
    // composition may latch it for more frames — every replay is a no-op.
    world.advance(20, input);
    state = world.getState();
    expect(state.cords.length).toBe(2);
    expectFinite(state, 'spawn idempotence');
  });

  it('totality: garbage and duplicate spawn requests are ignored; the cap is an honest no-op', () => {
    const world = makeWorld(3); // anchor + 2 spawns
    const bad: SimInput = {
      pointerRay: null,
      spawnCord: { cordId: Number.NaN, at: { x: 0, y: 1, z: 0 } },
    };
    world.advance(3, bad);
    expect(world.getState().cords.length).toBe(1);
    const nanAt: SimInput = {
      pointerRay: null,
      spawnCord: { cordId: 1, at: { x: Number.NaN, y: 1, z: 0 } },
    };
    world.advance(3, nanAt);
    expect(world.getState().cords.length).toBe(1);
    const infAt: SimInput = {
      pointerRay: null,
      spawnCord: { cordId: 1, at: { x: Number.POSITIVE_INFINITY, y: 1, z: 0 } },
    };
    world.advance(3, infAt);
    expect(world.getState().cords.length).toBe(1);
    const ok: SimInput = { pointerRay: null, spawnCord: { cordId: 1, at: { x: 0.4, y: 1.0, z: 0 } } };
    world.advance(1, ok);
    expect(world.getState().cords.length).toBe(2);
    world.advance(2, ok); // duplicate id: ignored
    expect(world.getState().cords.length).toBe(2);
    world.advance(1, { pointerRay: null, spawnCord: { cordId: 2, at: { x: -0.4, y: 1.0, z: 0 } } });
    expect(world.getState().cords.length).toBe(3);
    world.advance(2, { pointerRay: null, spawnCord: { cordId: 3, at: { x: 0, y: 1.0, z: 0 } } });
    expect(world.getState().cords.length).toBe(3); // at cap: ignored
    expectFinite(world.getState(), 'cap totality');
  });
});

describe('INT-4 — cord world: ends pluggable in ANY order', () => {
  it('carry red → seat red → carry blue → seat blue → RE-GRAB the seated red (the hand-pulled plug, LIFE-1 #7) → re-plug → POP → re-seat', () => {
    const world = makeWorld();
    world.advance(1, { pointerRay: null, spawnCord: { cordId: 1, at: { x: 0.5, y: 1.0, z: 0 } } });

    // Carry the RED end (point 0) — the spawned cord's already-carried pin.
    const RED_TARGET: Vec3 = { x: 0.9, y: 1.0, z: 0 };
    const carryRed: SimInput = {
      pointerRay: null,
      pinTargets: [{ cordId: 1, index: 0, position: RED_TARGET }],
    };
    world.advance(60, carryRed);
    let state = world.getState();
    let red = cordById(state, 1).points[0];
    expect(Math.hypot(red.x - RED_TARGET.x, red.y - RED_TARGET.y, red.z - RED_TARGET.z)).toBeLessThan(0.05);

    // Seat it: the red jack plugs into a socket (bitwise hard pin).
    const RED_SOCKET: Vec3 = { x: 0.9, y: 0.42, z: 0 };
    const seatRed: SimInput = {
      pointerRay: null,
      seatTargets: [{ cordId: 1, index: 0, position: RED_SOCKET }],
    };
    world.advance(3, seatRed);
    red = cordById(world.getState(), 1).points[0];
    expect(red.x).toBe(RED_SOCKET.x);
    expect(red.y).toBe(RED_SOCKET.y);
    expect(red.z).toBe(RED_SOCKET.z);

    // Carry the BLUE end (point END) while the red seat's latch keeps
    // flowing (the production composition re-sends every seated transform).
    // The blue target stays inside the leash sphere around the red socket
    // (0.735 < 0.8) — carrying one end of a plugged cord leashes at the seat.
    const BLUE_TARGET: Vec3 = { x: 0.35, y: 0.9, z: 0.1 };
    const carryBlue: SimInput = {
      pointerRay: null,
      pinTargets: [{ cordId: 1, index: END, position: BLUE_TARGET }],
      seatTargets: [{ cordId: 1, index: 0, position: RED_SOCKET }],
    };
    world.advance(90, carryBlue);
    state = world.getState();
    const blue = cordById(state, 1).points[END];
    expect(Math.hypot(blue.x - BLUE_TARGET.x, blue.y - BLUE_TARGET.y, blue.z - BLUE_TARGET.z)).toBeLessThan(0.05);
    red = cordById(state, 1).points[0];
    expect(red.x).toBe(RED_SOCKET.x); // the red seat never moved
    expectFinite(state, 'blue carry');

    // Seat the blue end too — the linked state (both ends socketed).
    const BLUE_SOCKET: Vec3 = { x: 0.35, y: 0.42, z: 0.1 };
    const seatBlue: SimInput = {
      pointerRay: null,
      seatTargets: [
        { cordId: 1, index: 0, position: RED_SOCKET },
        { cordId: 1, index: END, position: BLUE_SOCKET },
      ],
    };
    world.advance(3, seatBlue);
    state = world.getState();
    expect(cordById(state, 1).points[END].x).toBe(BLUE_SOCKET.x);
    // THE INT-4 FIX (the verifier's defect): seating the blue end must NOT
    // free the red one — the old single-slot model silently unplugged red
    // the frame blue seated. Per-end seats: both hold, bitwise.
    red = cordById(state, 1).points[0];
    expect(red.x).toBe(RED_SOCKET.x);
    expect(red.y).toBe(RED_SOCKET.y);
    expect(red.z).toBe(RED_SOCKET.z);

    // LIFE-1 (amendment) — the hand-pulled plug: a carry intent naming the
    // seated red end IS INT-4's un-seat-and-grab (linked → awaiting-plug).
    // The jack pulls out of its socket into the hand while the blue seat
    // holds bitwise (the cord keeps hanging from it).
    const REGRAB: SimInput = {
      pointerRay: null,
      pinTargets: [{ cordId: 1, index: 0, position: { x: 0, y: 0.9, z: 0 } }],
      // NOTE: the red latch is gone from seatTargets — grabbing a seated
      // end stops its latch in the composition (a flowing latch would
      // re-plug the carried end).
      seatTargets: [{ cordId: 1, index: END, position: BLUE_SOCKET }],
    };
    world.advance(90, REGRAB);
    state = world.getState();
    red = cordById(state, 1).points[0];
    expect(Math.hypot(red.x - 0, red.y - 0.9, red.z - 0)).toBeLessThan(0.05); // left the socket, in hand
    const blueSeat = cordById(state, 1).points[END];
    expect(blueSeat.x).toBe(BLUE_SOCKET.x); // the other seat holds bitwise
    expect(blueSeat.y).toBe(BLUE_SOCKET.y);
    expect(blueSeat.z).toBe(BLUE_SOCKET.z);
    expect(world.lifecycle.stateOf(1)).toBe('awaiting-plug'); // transition #7
    expectFinite(state, 'hand-pulled plug');

    // The APPROVED auto-unplug is the pop (linked → popped, INT-6's
    // transition): re-plug red (awaiting-plug → linked), pop the RED seat —
    // the end dangles free while the OTHER seat holds bitwise — and the
    // popped end re-seats before the grace expires.
    world.advance(3, {
      pointerRay: null,
      seatTargets: [
        { cordId: 1, index: 0, position: RED_SOCKET }, // re-plug: awaiting-plug → linked
        { cordId: 1, index: END, position: BLUE_SOCKET },
      ],
    });
    expect(world.lifecycle.stateOf(1)).toBe('linked');
    world.advance(1, { pointerRay: null, popCords: [{ cordId: 1, index: 0 }] });
    state = world.getState();
    expect(world.lifecycle.stateOf(1)).toBe('popped');
    expect(world.lifecycle.endMode(1, 0)).toBe('free');
    const blueSeatAfterPop = cordById(state, 1).points[END];
    expect(blueSeatAfterPop.x).toBe(BLUE_SOCKET.x); // the other seat holds bitwise
    expect(blueSeatAfterPop.y).toBe(BLUE_SOCKET.y);
    expect(blueSeatAfterPop.z).toBe(BLUE_SOCKET.z);
    world.advance(3, {
      pointerRay: null,
      seatTargets: [
        { cordId: 1, index: 0, position: RED_SOCKET }, // the re-seat: popped → linked
        { cordId: 1, index: END, position: BLUE_SOCKET },
      ],
    });
    expect(world.lifecycle.stateOf(1)).toBe('linked');
    red = cordById(world.getState(), 1).points[0];
    expect(red.x).toBe(RED_SOCKET.x); // the re-seat took, bitwise
    expectFinite(world.getState(), 'pop/re-seat');
  });

  it('the M1 anchor is a seat too: grabbing it un-seats the anchor (awaiting-plug → carried) and the cord hangs from the hand', () => {
    const world = makeWorld();
    // A carry intent on cord 0's ANCHOR end (index 0, pinned at PIN) is the
    // hand-pulled plug on the anchor seat (INT-4, restored).
    const grabAnchor: SimInput = {
      pointerRay: null,
      pinTargets: [{ cordId: 0, index: 0, position: { x: -0.7, y: 1.2, z: 0.1 } }],
    };
    world.advance(90, grabAnchor);
    const state = world.getState();
    const anchorEnd = cordById(state, 0).points[0];
    expect(
      Math.hypot(anchorEnd.x + 0.7, anchorEnd.y - 1.2, anchorEnd.z - 0.1),
    ).toBeLessThan(0.05); // the former pin follows the hand
    expectFinite(state, 'anchor un-seat');
    expect(world.lifecycle.stateOf(0)).toBe('carried'); // transition #8
    expect(world.lifecycle.endMode(0, 0)).toBe('carrying');
    // And it can seat in a socket afterwards (any order).
    const socket: Vec3 = { x: -0.7, y: 0.42, z: 0.1 };
    world.advance(3, { pointerRay: null, seatTargets: [{ cordId: 0, index: 0, position: socket }] });
    expect(world.lifecycle.stateOf(0)).toBe('awaiting-plug');
    const seated = cordById(world.getState(), 0).points[0];
    expect(seated.x).toBe(socket.x);
    expect(seated.y).toBe(socket.y);
    expect(seated.z).toBe(socket.z);
  });
});

describe('INT-4 — multi-cord world', () => {
  it('ISOLATION, bitwise: violently carrying cord 1 leaves cords 0 and 1 bitwise identical to the solo run', () => {
    const carry1Target = (f: number): Vec3 => ({
      x: 0.5 + 0.8 * Math.sin(0.9 * f),
      y: 1.0 + 0.4 * Math.sin(1.1 * f + 1),
      z: 0.8 * Math.cos(0.7 * f),
    });
    const runSolo = (): { zero: number[]; one: number[] } => {
      const world = makeWorld();
      world.advance(1, { pointerRay: null, spawnCord: { cordId: 1, at: { x: 0.5, y: 1.0, z: 0 } } });
      for (let f = 0; f < 120; f += 1) {
        world.advance(1, { pointerRay: null, pinTargets: [{ cordId: 1, index: 0, position: carry1Target(f) }] });
      }
      return { zero: flat(cordById(world.getState(), 0)), one: flat(cordById(world.getState(), 1)) };
    };
    const solo = runSolo();

    // A second world spawns ANOTHER cord (2) and violently carries it, while
    // cord 1 gets the identical script. Nobody else may move by even an ulp.
    const world = makeWorld();
    world.advance(1, { pointerRay: null, spawnCord: { cordId: 1, at: { x: 0.5, y: 1.0, z: 0 } } });
    for (let f = 0; f < 120; f += 1) {
      world.advance(1, {
        pointerRay: null,
        pinTargets: [
          { cordId: 1, index: 0, position: carry1Target(f) },
          {
            cordId: 2,
            index: 0,
            position: { x: -1.2 + 0.6 * Math.cos(0.5 * f), y: 1.3 + 0.3 * Math.sin(0.8 * f), z: 0 },
          },
        ],
        spawnCord: f === 0 ? { cordId: 2, at: { x: -0.5, y: 1.1, z: 0 } } : null,
      });
    }
    const busy = world.getState();
    expect(busy.cords.length).toBe(3);
    expectBitwiseEqual(flat(cordById(busy, 0)), solo.zero, 'cord 0 disturbed by cord 2');
    expectBitwiseEqual(flat(cordById(busy, 1)), solo.one, 'cord 1 disturbed by cord 2');
    expectFinite(busy, 'isolation');
  });

  it('spawn-while-carrying composes: the old end drops per the release policy while the new cord lands in hand, same frame', () => {
    const world = makeWorld();
    world.advance(1, { pointerRay: null, spawnCord: { cordId: 1, at: { x: 0.5, y: 1.0, z: 0 } } });
    // Cord 1's red end is in hand (the sim self-carries it at the spawn point).
    // The N-while-carrying flow: cord 1's end begins its DROP (floor target
    // at the released spot, per the M1 release) while the NEW cord spawns
    // and its red end is carried — one frame's pinTargets carries both.
    const DROP_SPOT: Vec3 = { x: 0.5, y: 0.055, z: 0 };
    const NEW_AT: Vec3 = { x: 0, y: 1.0, z: 0 };
    for (let f = 0; f < 120; f += 1) {
      const carries: PinTargetInput[] = [{ cordId: 1, index: 0, position: DROP_SPOT }];
      if (f === 0) {
        world.advance(1, {
          pointerRay: null,
          spawnCord: { cordId: 2, at: { x: NEW_AT.x, y: NEW_AT.y, z: NEW_AT.z } },
          pinTargets: carries,
        });
      }
      carries.push({ cordId: 2, index: 0, position: { x: -0.8 + 0.02 * f, y: 1.2, z: 0 } });
      world.advance(1, { pointerRay: null, pinTargets: carries });
    }
    const state = world.getState();
    expect(state.cords.length).toBe(3);
    const dropped = cordById(state, 1).points[0];
    expect(Math.hypot(dropped.x - DROP_SPOT.x, dropped.y - DROP_SPOT.y, dropped.z - DROP_SPOT.z)).toBeLessThan(0.02);
    const inHand = cordById(state, 2).points[0];
    expect(Math.hypot(inHand.x + 0.8 - 0.02 * 119, inHand.y - 1.2, inHand.z)).toBeLessThan(0.05);
    expectFinite(state, 'spawn-while-carrying');
  });
});

describe('INT-4 — determinism + rapid spawn/drop fuzz', () => {
  /** A full scripted scenario through the production driver. */
  function runScenario(): number[] {
    const world = makeWorld();
    const snapshots: number[] = [];
    const snap = (): void => {
      snapshots.push(...world.getState().cords.map((c) => flat(c)).flat());
    };
    const spawn: SimInput = { pointerRay: null, spawnCord: { cordId: 1, at: { x: 0.4, y: 1.0, z: 0 } } };
    for (let f = 0; f < 3; f += 1) {
      world.advance(1, spawn);
      snap();
    }
    const at = (f: number, c: number, a: number): Vec3 => ({
      x: c + a * Math.sin(0.31 * f),
      y: 0.95 + 0.25 * Math.sin(0.43 * f + 0.7),
      z: c + a * Math.cos(0.27 * f),
    });
    for (let f = 0; f < 40; f += 1) {
      world.advance(1, {
        pointerRay: null,
        pinTargets: [{ cordId: 1, index: 0, position: at(f, 1.0, 0.6) }],
      });
      snap();
    }
    const RED_SOCKET: Vec3 = { x: 1.0, y: 0.42, z: 0.3 };
    for (let f = 0; f < 60; f += 1) {
      world.advance(1, {
        pointerRay: null,
        seatTargets: [{ cordId: 1, index: 0, position: RED_SOCKET }],
      });
      snap();
    }
    for (let f = 0; f < 40; f += 1) {
      world.advance(1, {
        pointerRay: null,
        pinTargets: [{ cordId: 1, index: END, position: at(f, -0.8, 0.5) }],
        seatTargets: [{ cordId: 1, index: 0, position: RED_SOCKET }],
      });
      snap();
    }
    // Un-seat the red end (re-grab, the hand-pulled plug) and carry it; the
    // blue end seats into its socket over the same frames (any order).
    for (let f = 0; f < 40; f += 1) {
      world.advance(1, {
        pointerRay: null,
        pinTargets: [{ cordId: 1, index: 0, position: at(f, 0.2, 0.4) }],
        seatTargets: [{ cordId: 1, index: END, position: { x: -0.8, y: 0.42, z: -0.2 } }],
      });
      snap();
    }
    // A second spawn while the first is mid-carry; then everything releases.
    for (let f = 0; f < 60; f += 1) {
      const carries: PinTargetInput[] = [{ cordId: 1, index: 0, position: at(f, 0.2, 0.4) }];
      const input: SimInput = { pointerRay: null, pinTargets: carries };
      if (f < 40) {
        carries.push({ cordId: 2, index: 0, position: at(f, -0.5, 0.45) });
        if (f === 0) input.spawnCord = { cordId: 2, at: { x: -0.5, y: 1.1, z: 0.2 } };
      }
      world.advance(1, input);
      snap();
    }
    return snapshots;
  }

  it('the full scenario is bitwise-identical across reruns', () => {
    const a = runScenario();
    const b = runScenario();
    expect(a.length).toBe(b.length);
    expectBitwiseEqual(a, b, 'scenario determinism');
  });

  it('rapid spawn/drop churn: 8 spawns with violent carries and drops — finite every frame, deterministic, all cords present', () => {
    // mulberry32 — seeded, so the fuzz is itself deterministic.
    let seed = 0x1abe11ed;
    const rand = (): number => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    const runFuzz = (): { snapshots: number[]; spawns: number; final: SimState } => {
      seed = 0x1abe11ed;
      const world = makeWorld(9); // anchor + 8 spawns
      const snapshots: number[] = [];
      let spawns = 0;
      let nextId = 1;
      let held: { cordId: number; index: number } | null = null;
      let heldTarget: Vec3 = { x: 0, y: 1, z: 0 };
      for (let f = 0; f < 300; f += 1) {
        const input: SimInput = { pointerRay: null };
        const carries: PinTargetInput[] = [];
        const seats: SeatInput[] = [];
        // Rapid spawns: ~every 20 frames a new cord appears in hand; the
        // previously held end DROPS (its floor target keeps flowing).
        if (f % 20 === 0 && spawns < 8) {
          const at: Vec3 = { x: -1 + 2 * rand(), y: 0.7 + 0.6 * rand(), z: -0.5 + rand() };
          input.spawnCord = { cordId: nextId, at };
          if (held !== null) {
            carries.push({ cordId: held.cordId, index: held.index, position: { x: heldTarget.x, y: 0.055, z: heldTarget.z } });
          }
          held = { cordId: nextId, index: 0 };
          heldTarget = { ...at };
          spawns += 1;
          nextId += 1;
        }
        if (held !== null) {
          // Violent hand path far beyond hand scale.
          heldTarget = {
            x: 1.4 * Math.sin(2.3 * f + 3 * spawns),
            y: 0.4 + 1.1 * Math.abs(Math.sin(1.7 * f)),
            z: 1.2 * Math.cos(1.9 * f),
          };
          carries.push({ cordId: held.cordId, index: held.index, position: heldTarget });
          // Occasionally seat the held end into a socket, then re-grab an
          // end later (the hand-pulled plug when that end is the seated
          // one — LIFE-1 amendment #7/#8).
          if (f % 53 === 0) {
            seats.push({ cordId: held.cordId, index: held.index, position: { x: heldTarget.x, y: 0.42, z: heldTarget.z } });
            held = null;
          }
        } else if (f % 37 === 0 && spawns > 0) {
          // Re-grab an end of a spawned cord (the un-seat flow when seated —
          // the hand-pulled plug is legal again, so ANY end, seated or not).
          const cordId = 1 + (spawns - 1);
          held = { cordId, index: rand() > 0.5 ? 0 : END };
          heldTarget = { x: 0, y: 1.1, z: 0 };
          carries.push({ cordId, index: held.index, position: heldTarget });
        }
        if (carries.length > 0) input.pinTargets = carries;
        if (seats.length > 0) input.seatTargets = seats;
        world.advance(1, input);
        expectFinite(world.getState(), `fuzz frame ${f}`);
        snapshots.push(...world.getState().cords.map((c) => flat(c)).flat());
      }
      return { snapshots, spawns, final: world.getState() };
    };

    const a = runFuzz();
    expect(a.spawns).toBe(8);
    expect(a.final.cords.length).toBe(9);
    const b = runFuzz();
    expectBitwiseEqual(a.snapshots, b.snapshots, 'fuzz determinism');
  });
});

/**
 * INT-4 FIX — THE VERIFIER'S REPRODUCTION, pinned as regression tests. The
 * prior single-slot seat model could not hold a spawned cord's BOTH ends:
 * seating the second end silently unplugged the first, so the approved
 * `linked` state (town-hall: "both ends seated"; DoD: >=4 linked cords;
 * self-links included) was unreachable and a dragged cube transported only
 * one plug per cord. Through `createCordWorldStep` + the production driver,
 * with BOTH seat latches flowing every frame exactly as `main.ts` composes
 * them, these pin:
 *
 * - LINKED: spawn -> seat red on cube A -> seat blue on cube B -> BOTH pins
 *   bitwise-stable for 300 steps while both latches keep flowing.
 * - TWO-SEAT TRANSPORT: dragging cube A moves exactly its plug, bitwise;
 *   the other seat holds bitwise.
 * - RE-SEAT SEQUENCE: un-seat/re-seat on either end never silently frees
 *   the other (loudness: a silent unplug is impossible in the approved
 *   flows — asserted, not tolerated).
 * - SELF-LINK: both ends on the SAME cube; a cube drag hard-follows both
 *   pins bitwise.
 * - MULTI-CORD LINKED ISOLATION: 2 cords, 4 seats, all latches flowing;
 *   every seat bitwise at its socket, and dragging one cube moves only its
 *   own plug.
 */
describe('INT-4 FIX — linked cords: both seats hold (verifier reproduction)', () => {
  const RED_SOCKET: Vec3 = { x: 0.9, y: 0.42, z: 0 }; // cube A
  const BLUE_SOCKET: Vec3 = { x: 0.35, y: 0.42, z: 0.1 }; // cube B

  interface LinkedWorld {
    advance: (frames: number, input: SimInput) => SimState;
    getState: () => SimState;
    spawnAndLink: () => void;
    pin: (cordId: number, index: number) => Vec3;
    lifecycle: ReturnType<typeof makeWorld>['lifecycle'];
  }

  /** A world where spawned cord 1 has BOTH ends seated: red on A, blue on B. */
  function makeLinkedWorld(): LinkedWorld {
    const world = makeWorld();
    const pin = (cordId: number, index: number): Vec3 => cordById(world.getState(), cordId).points[index];
    const spawnAndLink = (): void => {
      world.advance(1, { pointerRay: null, spawnCord: { cordId: 1, at: { x: 0.5, y: 1.0, z: 0 } } });
      // Carry red to its socket, seat it (red latch flows from here on).
      world.advance(60, {
        pointerRay: null,
        pinTargets: [{ cordId: 1, index: 0, position: { x: RED_SOCKET.x, y: 1.0, z: RED_SOCKET.z } }],
      });
      world.advance(3, {
        pointerRay: null,
        seatTargets: [{ cordId: 1, index: 0, position: RED_SOCKET }],
      });
      // Carry blue (inside the leash sphere around the red socket) while the
      // red latch keeps flowing, then seat blue — the old model silently
      // freed red exactly here.
      world.advance(90, {
        pointerRay: null,
        pinTargets: [{ cordId: 1, index: END, position: { x: BLUE_SOCKET.x, y: 0.9, z: BLUE_SOCKET.z } }],
        seatTargets: [{ cordId: 1, index: 0, position: RED_SOCKET }],
      });
      world.advance(3, {
        pointerRay: null,
        seatTargets: [
          { cordId: 1, index: 0, position: RED_SOCKET },
          { cordId: 1, index: END, position: BLUE_SOCKET },
        ],
      });
    };
    return {
      advance: (frames, input) => {
        world.advance(frames, input);
        return world.getState();
      },
      getState: () => world.getState(),
      spawnAndLink,
      pin,
      lifecycle: world.lifecycle,
    };
  }

  it('LINKED: both pins hold bitwise for 300 steps with BOTH seat latches flowing (the exact verifier probe)', () => {
    const world = makeLinkedWorld();
    world.spawnAndLink();
    // The production composition re-sends EVERY seated transform every frame.
    const bothLatches: SimInput = {
      pointerRay: null,
      seatTargets: [
        { cordId: 1, index: 0, position: RED_SOCKET },
        { cordId: 1, index: END, position: BLUE_SOCKET },
      ],
    };
    for (let f = 0; f < 300; f += 1) {
      const state = world.advance(1, bothLatches);
      expectFinite(state, `linked frame ${f}`);
      const red = cordById(state, 1).points[0];
      const blue = cordById(state, 1).points[END];
      if (red.x !== RED_SOCKET.x || red.y !== RED_SOCKET.y || red.z !== RED_SOCKET.z) {
        throw new Error(`frame ${f}: red pin silently moved to ${JSON.stringify(red)}`);
      }
      if (blue.x !== BLUE_SOCKET.x || blue.y !== BLUE_SOCKET.y || blue.z !== BLUE_SOCKET.z) {
        throw new Error(`frame ${f}: blue pin silently moved to ${JSON.stringify(blue)}`);
      }
    }
    // The cord still settles into bitwise stillness while linked.
    let last = flat(cordById(world.advance(60, bothLatches), 1));
    world.advance(240, bothLatches);
    const final = flat(cordById(world.getState(), 1));
    expectBitwiseEqual(final, last, 'linked cord keeps moving past the settle window');
  });

  it('TWO-SEAT TRANSPORT: dragging cube A moves its plug bitwise; the blue seat on B holds bitwise', () => {
    const world = makeLinkedWorld();
    world.spawnAndLink();
    for (let f = 0; f < 120; f += 1) {
      // Cube A is dragged on a violent path; its socket transform moves, B's
      // stays put — both latches keep flowing (the composition latches all
      // seated transforms every frame).
      const A: Vec3 = {
        x: RED_SOCKET.x + 0.25 * Math.sin(0.5 * f),
        y: RED_SOCKET.y + 0.15 * Math.abs(Math.sin(0.31 * f)),
        z: RED_SOCKET.z + 0.2 * Math.cos(0.4 * f),
      };
      const state = world.advance(1, {
        pointerRay: null,
        seatTargets: [
          { cordId: 1, index: 0, position: A },
          { cordId: 1, index: END, position: BLUE_SOCKET },
        ],
      });
      expectFinite(state, `transport frame ${f}`);
      const red = cordById(state, 1).points[0];
      if (red.x !== A.x || red.y !== A.y || red.z !== A.z) {
        throw new Error(`frame ${f}: dragged plug at ${JSON.stringify(red)}, expected ${JSON.stringify(A)}`);
      }
      const blue = cordById(state, 1).points[END];
      if (blue.x !== BLUE_SOCKET.x || blue.y !== BLUE_SOCKET.y || blue.z !== BLUE_SOCKET.z) {
        throw new Error(`frame ${f}: blue seat disturbed by the A drag: ${JSON.stringify(blue)}`);
      }
    }
  });

  it('RE-SEAT SEQUENCE (LIFE-1): pop/re-seat on either end never silently frees the other', () => {
    const world = makeLinkedWorld();
    world.spawnAndLink();
    const state0 = world.getState();
    expect(state0.cords.length).toBe(2);

    // POP the BLUE end (the approved un-plug): it dangles free while the RED
    // seat holds bitwise (the cord hangs from it). Its latch is gone — the
    // composition stops latching an end that is no longer seated.
    world.advance(1, { pointerRay: null, popCords: [{ cordId: 1, index: END }] });
    expect(world.lifecycle.stateOf(1)).toBe('popped');
    world.advance(60, {
      pointerRay: null,
      seatTargets: [{ cordId: 1, index: 0, position: RED_SOCKET }],
    });
    let state = world.getState();
    let red = cordById(state, 1).points[0];
    expect(red.x).toBe(RED_SOCKET.x); // red never moved
    expect(red.y).toBe(RED_SOCKET.y);
    expect(red.z).toBe(RED_SOCKET.z);
    const blue = cordById(state, 1).points[END];
    expect(blue.y).toBeLessThan(BLUE_SOCKET.y); // blue fell away from its socket

    // Re-seat blue at a THIRD socket before the grace expires: linked again.
    const C_SOCKET: Vec3 = { x: 0.35, y: 0.42, z: -0.25 };
    world.advance(3, {
      pointerRay: null,
      seatTargets: [
        { cordId: 1, index: 0, position: RED_SOCKET },
        { cordId: 1, index: END, position: C_SOCKET },
      ],
    });
    expect(world.lifecycle.stateOf(1)).toBe('linked');
    // Now pop and re-seat the RED end at A': the blue seat must hold
    // bitwise through the whole sequence (the old model freed it here).
    const A2: Vec3 = { x: 0.95, y: 0.42, z: -0.05 };
    world.advance(1, { pointerRay: null, popCords: [{ cordId: 1, index: 0 }] });
    world.advance(3, {
      pointerRay: null,
      seatTargets: [
        { cordId: 1, index: 0, position: A2 },
        { cordId: 1, index: END, position: C_SOCKET },
      ],
    });
    for (let f = 0; f < 60; f += 1) {
      state = world.advance(1, {
        pointerRay: null,
        seatTargets: [
          { cordId: 1, index: 0, position: A2 },
          { cordId: 1, index: END, position: C_SOCKET },
        ],
      });
      red = cordById(state, 1).points[0];
      const blueSeat = cordById(state, 1).points[END];
      if (red.x !== A2.x || red.y !== A2.y || red.z !== A2.z) {
        throw new Error(`frame ${f}: re-seated red at ${JSON.stringify(red)}, expected ${JSON.stringify(A2)}`);
      }
      if (blueSeat.x !== C_SOCKET.x || blueSeat.y !== C_SOCKET.y || blueSeat.z !== C_SOCKET.z) {
        throw new Error(`frame ${f}: blue seat lost during the re-seat sequence: ${JSON.stringify(blueSeat)}`);
      }
    }
    expect(world.lifecycle.stateOf(1)).toBe('linked');
    expectFinite(state, 're-seat sequence');
  });

  it('SELF-LINK: both ends seated on the SAME cube — a cube drag hard-follows BOTH pins bitwise', () => {
    const world = makeWorld();
    world.advance(1, { pointerRay: null, spawnCord: { cordId: 1, at: { x: 0.4, y: 1.0, z: 0 } } });
    const SA: Vec3 = { x: 0.5, y: 0.42, z: 0.05 }; // two sockets, one cube top
    const SB: Vec3 = { x: 0.7, y: 0.42, z: 0.05 };
    world.advance(60, { pointerRay: null, pinTargets: [{ cordId: 1, index: 0, position: { x: SA.x, y: 1.0, z: SA.z } }] });
    world.advance(3, { pointerRay: null, seatTargets: [{ cordId: 1, index: 0, position: SA }] });
    world.advance(60, {
      pointerRay: null,
      pinTargets: [{ cordId: 1, index: END, position: { x: SB.x, y: 0.9, z: SB.z } }],
      seatTargets: [{ cordId: 1, index: 0, position: SA }],
    });
    world.advance(3, {
      pointerRay: null,
      seatTargets: [
        { cordId: 1, index: 0, position: SA },
        { cordId: 1, index: END, position: SB },
      ],
    });
    // The cube (both seats) is dragged: the SAME delta rides both transforms
    // (main.ts transports every record hosted by the dragged cube), both
    // latches flow, both pins hard-follow bitwise — "still linked, still
    // glows".
    for (let f = 0; f < 120; f += 1) {
      const d: Vec3 = {
        x: 0.5 * Math.sin(0.4 * f),
        y: 0.2 * Math.abs(Math.sin(0.27 * f)),
        z: 0.5 * Math.cos(0.33 * f),
      };
      const state = world.advance(1, {
        pointerRay: null,
        seatTargets: [
          { cordId: 1, index: 0, position: { x: SA.x + d.x, y: SA.y + d.y, z: SA.z + d.z } },
          { cordId: 1, index: END, position: { x: SB.x + d.x, y: SB.y + d.y, z: SB.z + d.z } },
        ],
      });
      expectFinite(state, `self-link frame ${f}`);
      const a = cordById(state, 1).points[0];
      const b = cordById(state, 1).points[END];
      if (a.x !== SA.x + d.x || a.y !== SA.y + d.y || a.z !== SA.z + d.z) {
        throw new Error(`frame ${f}: self-linked pin A at ${JSON.stringify(a)}, expected +${JSON.stringify(d)}`);
      }
      if (b.x !== SB.x + d.x || b.y !== SB.y + d.y || b.z !== SB.z + d.z) {
        throw new Error(`frame ${f}: self-linked pin B at ${JSON.stringify(b)}, expected +${JSON.stringify(d)}`);
      }
    }
  });

  it('MULTI-CORD LINKED ISOLATION: 2 cords, 4 seats, all latches flowing — every seat bitwise; a cube drag moves only its plug', () => {
    const world = makeWorld();
    const A1: Vec3 = { x: 0.9, y: 0.42, z: 0 };
    const B1: Vec3 = { x: 0.35, y: 0.42, z: 0.1 };
    const A2: Vec3 = { x: -0.4, y: 0.42, z: 0 };
    const B2: Vec3 = { x: -0.9, y: 0.42, z: -0.1 };
    const link = (cordId: number, A: Vec3, B: Vec3): void => {
      world.advance(1, { pointerRay: null, spawnCord: { cordId, at: { x: A.x, y: 1.0, z: A.z } } });
      world.advance(60, { pointerRay: null, pinTargets: [{ cordId, index: 0, position: { x: A.x, y: 0.9, z: A.z } }] });
      world.advance(3, { pointerRay: null, seatTargets: [{ cordId, index: 0, position: A }] });
      world.advance(60, {
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
    };
    link(1, A1, B1);
    link(2, A2, B2);

    // All four latches flow for two seconds: every seat bitwise at its
    // socket on every frame (4 seats, 2 cords, nobody fights).
    const latches = (): SeatInput[] => [
      { cordId: 1, index: 0, position: A1 },
      { cordId: 1, index: END, position: B1 },
      { cordId: 2, index: 0, position: A2 },
      { cordId: 2, index: END, position: B2 },
    ];
    const sockets: Array<[number, number, Vec3]> = [
      [1, 0, A1],
      [1, END, B1],
      [2, 0, A2],
      [2, END, B2],
    ];
    let state = world.getState();
    for (let f = 0; f < 120; f += 1) {
      state = world.advance(1, { pointerRay: null, seatTargets: latches() });
      for (const [cordId, index, socket] of sockets) {
        const p = cordById(state, cordId).points[index];
        if (p.x !== socket.x || p.y !== socket.y || p.z !== socket.z) {
          throw new Error(`frame ${f}: cord ${cordId} end ${index} at ${JSON.stringify(p)}, expected ${JSON.stringify(socket)}`);
        }
      }
    }

    // Drag cube A1: ITS plug follows bitwise; the other three seats hold.
    for (let f = 0; f < 90; f += 1) {
      const moved: Vec3 = {
        x: A1.x + 0.3 * Math.sin(0.45 * f),
        y: A1.y + 0.18 * Math.abs(Math.sin(0.3 * f)),
        z: A1.z + 0.25 * Math.cos(0.37 * f),
      };
      const targets = latches();
      targets[0] = { cordId: 1, index: 0, position: moved };
      state = world.advance(1, { pointerRay: null, seatTargets: targets });
      expectFinite(state, `linked transport frame ${f}`);
      const p = cordById(state, 1).points[0];
      if (p.x !== moved.x || p.y !== moved.y || p.z !== moved.z) {
        throw new Error(`frame ${f}: dragged plug at ${JSON.stringify(p)}, expected ${JSON.stringify(moved)}`);
      }
      for (const [cordId, index, socket] of sockets.slice(1)) {
        const q = cordById(state, cordId).points[index];
        if (q.x !== socket.x || q.y !== socket.y || q.z !== socket.z) {
          throw new Error(`frame ${f}: cord ${cordId} end ${index} disturbed by the A1 drag: ${JSON.stringify(q)}`);
        }
      }
    }
  });
});

import { describe, expect, it } from 'vitest';
import { createVerletRope } from './rope';
import type { Rope } from './rope';
import type { Vec2 } from './types';

/**
 * INT-4 — the rope-level un-seat (plan.md INT-4: "ends pluggable in ANY
 * order — either end can be carried, seated first, re-grabbed"). `unseat`
 * releases a seated end so the ordinary carry/seat machinery takes over.
 * Pinned here:
 *
 * - UN-SEAT THE PLUG: the end re-enters integration AT REST (gentle: it
 *   keeps its position — the cord keeps hanging from its other seated end,
 *   bitwise), the anchor never moves, the state stays finite. (The fixture
 *   has SLACK between anchor and socket — an un-seat from a taut,
 *   overstretched seat legitimately springs; slack is the product case.)
 * - UN-SEAT THE ANCHOR: the original pin releases (anchorReleased), the
 *   formerly-pinned end becomes carriable AND seatable — the carry/seat
 *   anchor guards only protect an anchor that still pins.
 * - GUARDS: unseating a free end or a non-endpoint throws; the pre-release
 *   guards still throw with the documented messages.
 * - LEASH RE-AIM: with the anchor released and the OTHER end plugged, the
 *   carried pin leashes around the plug seat (SIM-2 bound holds exactly);
 *   with nothing else pinned, no leash exists (a held cord with a free tail
 *   is bounded by its own constraints).
 * - WAKE + RESET: unseat wakes a settled rope; placeAlong fully resets the
 *   release (a fresh cord hangs from its anchor again).
 */

const DT = 1 / 120;
const SEGMENTS = 8; // total rope length 0.8
const END = SEGMENTS;
const PIN: Vec2 = { x: 0, y: 1.6};
// A socket WITH SLACK from the anchor (0.592 < 0.8): the seated cord hangs
// with pooled slack, so an un-seat reads as a gentle pull, not a slingshot.
const SOCKET: Vec2 = { x: 0.3, y: 1.1};
const TOTAL = SEGMENTS * 0.1;

function makeSeatedRope(): Rope {
  const rope = createVerletRope({ pin: PIN, segmentCount: SEGMENTS });
  rope.placeAlong(PIN, { x: SOCKET.x, y: SOCKET.y});
  rope.carryEnd(END);
  for (let f = 0; f < 30; f += 1) {
    rope.setPinTarget(END, SOCKET);
    rope.step(DT);
  }
  rope.seat({ index: END, position: SOCKET });
  return rope;
}

function point(rope: Rope, index: number): Vec2 {
  const out: Vec2 = { x: 0, y: 0};
  rope.readPoint(index, out);
  return out;
}

function expectPointAt(rope: Rope, index: number, p: Vec2, label: string): void {
  const got = point(rope, index);
  if (got.x !== p.x || got.y !== p.y) {
    throw new Error(`${label}: point ${index} at ${JSON.stringify(got)}, expected ${JSON.stringify(p)}`);
  }
}

function positions(rope: Rope): number[] {
  const flat: number[] = [];
  for (let i = 0; i < rope.pointCount; i += 1) {
    const p = point(rope, i);
    flat.push(p.x, p.y);
  }
  return flat;
}

/** Bitwise array equality — the determinism/stillness bar is exact. */
function expectBitwiseEqual(a: ArrayLike<number>, b: ArrayLike<number>, label: string): void {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) throw new Error(`${label}: element ${i} differs — ${a[i]} vs ${b[i]}`);
  }
}

describe('INT-4 — rope unseat (re-grab a seated end)', () => {
  it('unseating the PLUGged end re-enters integration at rest — the cord keeps hanging from its seated anchor, bitwise', () => {
    const rope = makeSeatedRope();
    let guard = 0;
    while (!rope.isSettled() && guard < 3600) {
      rope.step(DT);
      guard += 1;
    }
    expect(rope.isSettled()).toBe(true);

    const plugged = point(rope, END);
    expect(plugged.x).toBe(SOCKET.x); // the settle hardened it at the socket
    rope.unseat(END);
    expect(rope.isEndSeated(END)).toBe(false);
    expect(rope.isSettled()).toBe(false); // the release wakes the rope

    // Gentle: one step later the released plug has barely moved (gravity's
    // first slice plus a hair of slack redistribution) — a pulled plug keeps
    // its position, never pops.
    rope.step(DT);
    const after = point(rope, END);
    expect(Math.hypot(after.x - SOCKET.x, after.y - SOCKET.y)).toBeLessThan(5e-3);

    // The cord keeps hanging from its other seated end: the anchor bitwise
    // unmoved across a full second of settling, all finite throughout.
    for (let s = 0; s < 120; s += 1) {
      rope.step(DT);
      expect(rope.isFiniteState()).toBe(true);
      const anchor = point(rope, 0);
      expect(anchor.x).toBe(PIN.x);
      expect(anchor.y).toBe(PIN.y);
    }
  });

  it('unseating the ANCHOR releases the pin: the end becomes carriable and seatable like any other', () => {
    const rope = makeSeatedRope(); // anchor pinned at PIN, plug at SOCKET
    rope.unseat(0);
    expect(rope.anchorReleased).toBe(true);
    expect(rope.isEndSeated(END)).toBe(true); // the plug is untouched

    // The formerly-pinned end is now carriable (this threw pre-INT-4).
    // The target stays inside the leash sphere around the remaining seat.
    expect(() => rope.carryEnd(0)).not.toThrow();
    const HAND: Vec2 = { x: -0.2, y: 1.3}; // 0.55 from SOCKET < 0.8
    for (let f = 0; f < 90; f += 1) {
      rope.setPinTarget(0, HAND);
      rope.step(DT);
      expect(rope.isFiniteState()).toBe(true);
    }
    const held = point(rope, 0);
    expect(Math.hypot(held.x - HAND.x, held.y - HAND.y)).toBeLessThan(0.05);
    // …and seatable (the anchor guard only protects an anchor that pins).
    const NEW_SOCKET: Vec2 = { x: -0.4, y: 0.9};
    expect(() => rope.seat({ index: 0, position: NEW_SOCKET })).not.toThrow();
    rope.step(DT);
    const seated = point(rope, 0);
    expect(seated.x).toBe(NEW_SOCKET.x);
    expect(seated.y).toBe(NEW_SOCKET.y);
  });

  it('guards: unseating a free end or non-endpoint throws; the pre-release guards still throw as documented', () => {
    const rope = makeSeatedRope();
    // A rope with NO plug: END is free, so unseating it is a caller bug.
    const free = createVerletRope({ pin: PIN, segmentCount: SEGMENTS });
    free.placeAlong(PIN, { x: 0, y: PIN.y - TOTAL});
    expect(() => free.unseat(END)).toThrow(/not a seated end/);
    expect(() => rope.unseat(3)).toThrow(/not a seated end/);
    expect(() => rope.unseat(-1)).toThrow(/out of range/);
    // Pre-release anchor guards (unchanged messages, unchanged behavior).
    expect(() => free.carryEnd(0)).toThrow(/carryEnd cannot carry the seated pin/);
    expect(() => free.seat({ index: 0, position: PIN })).toThrow(/seat cannot plug the original pinned end/);
    // Re-unseating an already-released anchor is also "not a seat".
    rope.unseat(0);
    expect(() => rope.unseat(0)).toThrow(/not a seated end/);
  });

  it('leash re-aim: carrying the released end of a cord whose other end is PLUGGED leashes around the seat, exactly', () => {
    const rope = makeSeatedRope(); // plug at SOCKET, anchor released next
    rope.unseat(0);
    rope.carryEnd(0);
    // Drag the released end violently toward a point far past the cord's
    // total length from the SOCKET (the only remaining pin).
    const FAR: Vec2 = { x: SOCKET.x + 0.9, y: SOCKET.y + 0.6}; // 1.083 away
    let worst = 0;
    for (let f = 0; f < 600; f += 1) {
      rope.setPinTarget(0, FAR);
      rope.step(DT);
      expect(rope.isFiniteState()).toBe(true);
      const carried = point(rope, 0);
      const d = Math.hypot(carried.x - SOCKET.x, carried.y - SOCKET.y);
      worst = Math.max(worst, d - TOTAL);
      expect(d).toBeLessThanOrEqual(TOTAL + 1e-9); // the SIM-2 bound, re-aimed
    }
    expect(worst).toBeLessThanOrEqual(1e-9);
  });

  it('no leash with nothing else pinned: a held cord with a free tail runs past the stale anchor spot', () => {
    const rope = makeSeatedRope();
    rope.unseat(END); // plug out — the anchor is the only pin
    rope.unseat(0); // anchor out — nothing pins anymore
    expect(rope.anchorReleased).toBe(true);
    expect(rope.isEndSeated(END)).toBe(false);
    expect(rope.isEndSeated(0)).toBe(false);
    rope.carryEnd(0);
    // A target 5 units from where the anchor used to be: no leash fires
    // (nothing to leash against), the pin converges to the target.
    const FAR: Vec2 = { x: PIN.x + 5, y: PIN.y};
    for (let f = 0; f < 480; f += 1) {
      rope.setPinTarget(0, FAR);
      rope.step(DT);
      expect(rope.isFiniteState()).toBe(true);
    }
    const carried = point(rope, 0);
    expect(Math.hypot(carried.x - FAR.x, carried.y - FAR.y)).toBeLessThan(0.02);
  });

  it('placeAlong resets the release: a fresh cord hangs from its anchor and the guards re-engage', () => {
    const rope = makeSeatedRope();
    rope.unseat(0);
    expect(rope.anchorReleased).toBe(true);
    rope.placeAlong(PIN, { x: 0.2, y: 0.6});
    expect(rope.anchorReleased).toBe(false);
    expect(() => rope.carryEnd(0)).toThrow(/carryEnd cannot carry the seated pin/);
  });
});

/**
 * INT-4 FIX — PER-END SEATS (the verifier's defect): `Rope` used to keep ONE
 * plug slot, so seating a spawned cord's second end silently unplugged the
 * first — the linked state (both ends seated) was unreachable for every
 * spawned cord. The seats are now PER-END: each end owns its own seat slot,
 * both can hold at once (linked, including both on the same cube), and
 * seating one end cannot touch the other. Pinned here at the rope level:
 *
 * - LINKED: a released-anchor cord seats BOTH ends; both hard pins hold
 *   bitwise for a full second and the cord still settles to bitwise sleep.
 * - UN-SEAT IS PER-END: releasing one end of a linked cord leaves the other
 *   seat bitwise; re-seating restores the linked state.
 * - PER-END TRANSPORT: `setSeatPosition(index, ...)` moves exactly the named
   * seat bitwise; identical re-sends of either seat never wake the rope;
 *   a genuine move of one seat wakes it without disturbing the other.
 * - LOUDNESS GUARDS: with both ends seated nothing is carried (`carryEnd`
 *   throws on both), a released end's transport throws, and seat/unseat of
 *   one end never throws away the other's state.
 */
describe('INT-4 FIX — per-end seats: a cord holds BOTH ends seated', () => {
  const SOCKET_2: Vec2 = { x: -0.25, y: 1.05}; // 0.619 from SOCKET < 0.8

  /** A LINKED rope: anchor released, re-seated at SOCKET_2; plug still at SOCKET. */
  function makeLinkedRope(): Rope {
    const rope = makeSeatedRope(); // anchor pinned at PIN, plug seated at SOCKET
    rope.unseat(0); // release the anchor (the plug at SOCKET holds bitwise)
    rope.carryEnd(0);
    for (let f = 0; f < 90; f += 1) {
      rope.setPinTarget(0, SOCKET_2); // inside the leash sphere around SOCKET
      rope.step(DT);
      expect(rope.isFiniteState()).toBe(true);
    }
    const held = point(rope, 0);
    expect(Math.hypot(held.x - SOCKET_2.x, held.y - SOCKET_2.y)).toBeLessThan(0.05);
    rope.seat({ index: 0, position: SOCKET_2 });
    expect(rope.isEndSeated(0)).toBe(true);
    expect(rope.isEndSeated(END)).toBe(true);
    return rope;
  }

  function settle(rope: Rope): void {
    let guard = 0;
    while (!rope.isSettled() && guard < 3600) {
      rope.step(DT);
      guard += 1;
    }
    expect(rope.isSettled()).toBe(true);
  }

  it('seating the SECOND end never frees the first: both hard pins hold bitwise through the settle and a full second', () => {
    const rope = makeLinkedRope();
    // THE VERIFIER'S PROBE, at the rope level: 300 steps with the cord live —
    // both seats must be bitwise-exact on every step (the old single slot
    // ended each step single-seated).
    for (let s = 0; s < 300; s += 1) {
      rope.step(DT);
      expect(rope.isFiniteState()).toBe(true);
      expectPointAt(rope, 0, SOCKET_2, `end 0 seat, step ${s}`);
      expectPointAt(rope, END, SOCKET, `end ${END} seat, step ${s}`);
    }
    // And the linked cord still settles: bitwise stillness forever after.
    settle(rope);
    const frozen = positions(rope);
    for (let s = 0; s < 120; s += 1) {
      rope.step(DT);
      expectBitwiseEqual(positions(rope), frozen, `linked sleep step ${s}`);
    }
    expectPointAt(rope, 0, SOCKET_2, 'end 0 seat after sleep');
    expectPointAt(rope, END, SOCKET, 'end END seat after sleep');
  });

  it('un-seating ONE end of a linked cord leaves the other seat bitwise; re-seating restores the linked state', () => {
    const rope = makeLinkedRope();
    settle(rope);
    rope.unseat(0); // grab end 0 out of its socket
    expect(rope.isEndSeated(0)).toBe(false);
    expect(rope.isEndSeated(END)).toBe(true); // the other seat untouched
    // The cord keeps hanging from the END seat, bitwise, while end 0 dangles.
    for (let s = 0; s < 120; s += 1) {
      rope.step(DT);
      expect(rope.isFiniteState()).toBe(true);
      expectPointAt(rope, END, SOCKET, `surviving seat, step ${s}`);
    }
    // Re-seat end 0: linked again, both pins bitwise.
    rope.seat({ index: 0, position: SOCKET_2 });
    for (let s = 0; s < 60; s += 1) {
      rope.step(DT);
      expectPointAt(rope, 0, SOCKET_2, `re-seated end 0, step ${s}`);
      expectPointAt(rope, END, SOCKET, `end END still seated, step ${s}`);
    }
  });

  it('seat transport is per-end: moving one socket moves only its seat bitwise; unchanged re-sends of BOTH never wake', () => {
    const rope = makeLinkedRope();
    settle(rope);
    // Unchanged re-sends of both seats (the per-frame latch pattern): asleep
    // stays true, state frozen for a full second.
    const frozen = positions(rope);
    for (let s = 0; s < 120; s += 1) {
      rope.setSeatPosition(0, SOCKET_2.x, SOCKET_2.y);
      rope.setSeatPosition(END, SOCKET.x, SOCKET.y);
      expect(rope.isSettled()).toBe(true);
      rope.step(DT);
      expectBitwiseEqual(positions(rope), frozen, `double latch step ${s}`);
    }
    // A genuine move of ONE seat: that pin rides bitwise, the other is
    // untouched bitwise (two-seat transport — a dragged cube moves exactly
    // the plugs seated on it).
    const MOVED_0: Vec2 = { x: SOCKET_2.x + 0.12, y: SOCKET_2.y + 0.05};
    rope.setSeatPosition(0, MOVED_0.x, MOVED_0.y);
    expect(rope.isSettled()).toBe(false); // the genuine move wakes
    rope.step(DT);
    expectPointAt(rope, 0, MOVED_0, 'moved end-0 seat');
    expectPointAt(rope, END, SOCKET, 'end END seat unmoved');
    // Non-finite garbage on either transport is ignored (last valid stands).
    rope.setSeatPosition(END, Number.NaN, 0);
    rope.step(DT);
    expectPointAt(rope, END, SOCKET, 'seat after ignored garbage move');
  });

  it('loudness guards: with both ends seated nothing is carried; a released end takes no transport; one seat never mirrors the other', () => {
    const rope = makeLinkedRope();
    expect(rope.carriedIndex).toBe(null); // a jack in a socket is not in a hand
    expect(() => rope.carryEnd(0)).toThrow(/carryEnd cannot carry the plugged end/);
    expect(() => rope.carryEnd(END)).toThrow(/carryEnd cannot carry the plugged end/);
    // Un-seat end 0: its transport now throws (nothing plugged there) and
    // END's transport still works — the slots are independent.
    rope.unseat(0);
    expect(() => rope.setSeatPosition(0, 1, 1)).toThrow(/no plug seated there/);
    expect(() => rope.setSeatPosition(END, SOCKET.x, SOCKET.y)).not.toThrow();
    // Un-seating the LAST seat is fine too — the old message contract holds.
    rope.unseat(END);
    expect(rope.isEndSeated(0)).toBe(false);
    expect(rope.isEndSeated(END)).toBe(false);
    expect(() => rope.unseat(END)).toThrow(/not a seated end/);
  });
});

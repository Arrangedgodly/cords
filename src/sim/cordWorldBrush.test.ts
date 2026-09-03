import { describe, expect, it } from 'vitest';
import { createCordWorldStep } from './cordWorld';
import type { CordWorldConfig, CordWorldStep } from './cordWorld';
import { createFixedTimestepDriver } from './fixedTimestep';
import type { LifecycleRejection } from './lifecycle';
import type { VanishEvent } from './vanish';
import type {
  CordState,
  PinTargetInput,
  SeatInput,
  SimInput,
  SimState,
  Vec2,
} from './types';

/**
 * T-INT-5 — the passive cursor-brush at the WORLD boundary, driven through
 * the production fixed-timestep driver (two 1/120 substeps per 1/60 frame,
 * like main.ts). The semantics pinned here are the task's contract:
 *
 * - MOVE-ONLY: impulses ride NEW pointer-move counter values; the driver's
 *   replay of one input across a frame's substeps is idempotent, and an
 *   IDLE pointer (same counter forever) injects nothing — even while the
 *   cord swings through the cursor (Thor's zero-idle-cost rule).
 * - PINS WIN: seated and carried ends never move under the brush.
 * - INSIDE perturbed / OUTSIDE untouched, BITWISE, differentially against a
 *   control world advancing identical frames without the brush (the
 *   constraint solve propagates at most `iterations` segments per substep,
 *   so points beyond that reach are bitwise identical after one substep).
 * - Falloff monotonicity at the world boundary; determinism (the same move
 *   sequence replays bitwise); multi-cord (one cursor brushes every cord near
 *   it, far cords bitwise untouched); garbage totality; the wake path (a
 *   settled seated cord sways again); and the documented call that VANISHING
 *   CORDS STAY BRUSHABLE without derailing the sequence.
 */

const DT = 1 / 120;
const FRAME = 1 / 60; // two substeps per frame, like the production driver
const SEGMENTS = 24;
const END = SEGMENTS;
const PIN: Vec2 = { x: 0, y: 1.6};
const SEGMENT_LENGTH = 0.1;
const R = 1.5 * SEGMENT_LENGTH; // the default halo radius, world units

interface World {
  frame: (extra?: Partial<SimInput>) => SimState;
  /** One raw 1/120 substep straight through the step (propagation-bounded diffs). */
  raw: (extra?: Partial<SimInput>) => SimState;
  state: () => SimState;
  lifecycle: CordWorldStep['lifecycle'];
  rejections: LifecycleRejection[];
}

function makeWorld(config?: CordWorldConfig): World {
  const rejections: LifecycleRejection[] = [];
  const step = createCordWorldStep({
    anchor: { pin: PIN, segmentCount: SEGMENTS, floorY: 0 },
    cord: { segmentCount: SEGMENTS, floorY: 0 },
    lifecycle: {
      onRejected: (rejection) => rejections.push(rejection),
    },
    ...config,
  });
  const driver = createFixedTimestepDriver(step, { timestep: DT, maxSubsteps: 2 });
  let state: SimState = { time: 0, cords: [] };
  return {
    frame: (extra) => {
      state = driver.advance(state, FRAME, { pointerPoint: null, ...(extra ?? {}) }).state;
      return state;
    },
    raw: (extra) => {
      state = step(state, DT, { pointerPoint: null, ...(extra ?? {}) });
      return state;
    },
    state: () => state,
    lifecycle: step.lifecycle,
    rejections,
  };
}

/** A cursor point `offset` away in +x of (px, py). */
function cursorNear(px: number, py: number, offset: number): Vec2 {
  return { x: px + offset, y: py };
}

function distanceToCursor(p: Vec2, cursor: Vec2): number {
  return Math.hypot(p.x - cursor.x, p.y - cursor.y);
}

function pointDiffers(a: CordState, b: CordState, i: number): boolean {
  const pa = a.points[i];
  const pb = b.points[i];
  return !Object.is(pa.x, pb.x) || !Object.is(pa.y, pb.y);
}

function cordBitwiseEqual(a: CordState, b: CordState): boolean {
  if (a.points.length !== b.points.length) return false;
  for (let i = 0; i < a.points.length; i += 1) {
    if (pointDiffers(a, b, i)) return false;
  }
  return true;
}

function settle(w: World, frames = 600): void {
  for (let i = 0; i < frames; i += 1) w.frame();
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('cordWorld brush — inside perturbed, outside untouched (bitwise)', () => {
  it('brushes points inside the halo and leaves the far points bitwise identical', () => {
    const brushed = makeWorld();
    const control = makeWorld();
    settle(brushed);
    settle(control);
    const mid = brushed.state().cords[0].points[12];
    const cursor = cursorNear(mid.x, mid.y, R * 0.5); // half a radius off point 12
    brushed.raw({ brush: { move: 1, point: cursor } });
    control.raw();
    const a = brushed.state().cords[0];
    const b = control.state().cords[0];
    // Classification from the same geometry the impulse math sees.
    const strongInside: number[] = [];
    for (let i = 0; i < a.points.length; i += 1) {
      const d = distanceToCursor(b.points[i], cursor);
      if (d <= R * 0.9) strongInside.push(i); // weight ≥ ~0.024: a real impulse
    }
    expect(strongInside.length).toBeGreaterThanOrEqual(1);
    expect(strongInside).toContain(12); // the aim point itself
    expect(strongInside).not.toContain(0); // the anchor pin is never inside the assert set
    for (const i of strongInside) expect(pointDiffers(a, b, i)).toBe(true);
    // OUTSIDE, BITWISE, is pinned at the impulse layer (brush.test.ts: weight
    // 0 leaves the output untouched; the pass count is EXACTLY the free
    // inside-halo set). After the solver, full-rope bitwise stillness beyond
    // the halo is not physical: one forward Gauss–Seidel sweep propagates a
    // correction along the whole chain within a single pass. What is pinned
    // here at the world level is LOCALITY: outside the halo (and away from
    // the aim point's immediate neighbors) every point moved strictly less
    // than the brushed point — the impulse, not the wave, owns the motion.
    const displacement = (x: CordState, y: CordState, i: number): number =>
      Math.hypot(x.points[i].x - y.points[i].x, x.points[i].y - y.points[i].y);
    const aim = displacement(a, b, 12);
    expect(aim).toBeGreaterThan(0);
    for (let i = 0; i < a.points.length; i += 1) {
      if (distanceToCursor(b.points[i], cursor) < R) continue; // inside the halo
      if (Math.abs(i - 12) <= 3) continue; // the wave's first hop
      expect(displacement(a, b, i)).toBeLessThan(aim * 0.5);
    }
    // The pins never moved even where the halo touched them.
    if (distanceToCursor(b.points[0], cursor) < R) expect(pointDiffers(a, b, 0)).toBe(false);
    if (distanceToCursor(b.points[END], cursor) < R) expect(pointDiffers(a, b, END)).toBe(false);
    expect(brushed.rejections).toHaveLength(0);
  });

  it('falloff at the boundary: a nearer pass displaces more than a farther one', () => {
    const near = makeWorld();
    const far = makeWorld();
    const control = makeWorld();
    settle(near);
    settle(far);
    settle(control);
    const mid = control.state().cords[0].points[12];
    near.raw({ brush: { move: 1, point: cursorNear(mid.x, mid.y, R * 0.25) } });
    far.raw({ brush: { move: 1, point: cursorNear(mid.x, mid.y, R * 0.75) } });
    control.raw();
    const c = control.state().cords[0].points[12];
    const dn = near.state().cords[0].points[12];
    const df = far.state().cords[0].points[12];
    const magN = Math.hypot(dn.x - c.x, dn.y - c.y);
    const magF = Math.hypot(df.x - c.x, df.y - c.y);
    expect(magN).toBeGreaterThan(magF * 3); // weights 0.85 vs 0.15 at the aim point
  });
});

describe('cordWorld brush — MOVE-ONLY semantics (Thor rule)', () => {
  it('an idle pointer never injects, even while the cord swings through the cursor', () => {
    const idle = makeWorld(); // keeps sending the SAME move counter forever
    const once = makeWorld(); // sends the brush exactly once, then nothing
    settle(idle);
    settle(once);
    const mid = idle.state().cords[0].points[12];
    const cursor = cursorNear(mid.x, mid.y, R * 0.4);
    idle.raw({ brush: { move: 4, point: cursor } }); // the one real move…
    once.raw({ brush: { move: 4, point: cursor } }); // …identical in both worlds
    // 300 frames: `idle` re-sends brush(move:4, cursor THROUGH the swaying cord)
    // every frame; `once` sends nothing. They must stay bitwise identical.
    for (let k = 0; k < 300; k += 1) {
      idle.frame({ brush: { move: 4, point: cursor } });
      once.frame();
      expect(cordBitwiseEqual(idle.state().cords[0], once.state().cords[0])).toBe(true);
    }
    expect(idle.rejections).toHaveLength(0);
  });

  it('a NEW move counter brushes again (one impulse per move, not per frame)', () => {
    const again = makeWorld();
    const once = makeWorld();
    settle(again);
    settle(once);
    const mid = again.state().cords[0].points[12];
    const cursor = cursorNear(mid.x, mid.y, R * 0.4);
    again.frame({ brush: { move: 4, point: cursor } });
    once.frame({ brush: { move: 4, point: cursor } });
    again.frame({ brush: { move: 5, point: cursor } }); // the pointer moved again
    once.frame(); // still: no new move, no brush
    expect(pointDiffers(again.state().cords[0], once.state().cords[0], 12)).toBe(true);
  });

  it('substep replays of one input brush exactly once per frame', () => {
    // Differential: one frame whose input carries move=k must equal ONE raw
    // brush substep followed by an un-brushed substep — not two brushes.
    const replay = makeWorld();
    const manual = makeWorld();
    settle(replay);
    settle(manual);
    const mid = replay.state().cords[0].points[12];
    const cursor = cursorNear(mid.x, mid.y, R * 0.4);
    replay.frame({ brush: { move: 1, point: cursor } });
    manual.raw({ brush: { move: 1, point: cursor } });
    manual.raw(); // the second substep: counter already consumed
    expect(cordBitwiseEqual(replay.state().cords[0], manual.state().cords[0])).toBe(true);
  });
});

describe('cordWorld brush — pins win', () => {
  it('a seated end holds its socket bitwise under a cursor through the seat', () => {
    const SOCKET: Vec2 = { x: 0.8, y: 1.2};
    const seatLatch: SeatInput = { cordId: 0, index: END, position: SOCKET };
    const brushed = makeWorld();
    const control = makeWorld();
    for (const w of [brushed, control]) {
      for (let i = 0; i < 240; i += 1) w.frame({ seatTargets: [seatLatch] });
    }
    expect(brushed.lifecycle.stateOf(0)).toBe('linked');
    // The cursor passes exactly through the seated plug's socket.
    const seatCursor = cursorNear(SOCKET.x, SOCKET.y, 0);
    for (let k = 0; k < 30; k += 1) {
      brushed.frame({ brush: { move: k + 1, point: seatCursor }, seatTargets: [seatLatch] });
      control.frame({ seatTargets: [seatLatch] });
      const a = brushed.state().cords[0];
      expect(Object.is(a.points[END].x, SOCKET.x)).toBe(true);
      expect(Object.is(a.points[END].y, SOCKET.y)).toBe(true);
      expect(Object.is(a.points[0].x, PIN.x)).toBe(true); // the anchor pin too
      expect(Object.is(a.points[0].y, PIN.y)).toBe(true);
    }
    // The body around the socket DID sway (the halo is not a no-op).
    const bodyMoved = Array.from({ length: END + 1 }, (_, i) => i).some((i) =>
      pointDiffers(brushed.state().cords[0], control.state().cords[0], i),
    );
    expect(bodyMoved).toBe(true);
    expect(brushed.rejections).toHaveLength(0);
  });

  it('a carried end tracks its target bitwise; only the body brushes', () => {
    const HELD: Vec2 = { x: -0.6, y: 1.1};
    const carry: PinTargetInput = { cordId: 0, index: END, position: HELD };
    const brushed = makeWorld();
    const control = makeWorld();
    for (const w of [brushed, control]) {
      for (let i = 0; i < 240; i += 1) w.frame({ pinTargets: [carry] });
    }
    const heldCursor = cursorNear(HELD.x, HELD.y, 0); // exactly through the held jack
    for (let k = 0; k < 30; k += 1) {
      brushed.frame({ brush: { move: k + 1, point: heldCursor }, pinTargets: [carry] });
      control.frame({ pinTargets: [carry] });
      expect(pointDiffers(brushed.state().cords[0], control.state().cords[0], END)).toBe(false);
    }
    expect(brushed.rejections).toHaveLength(0);
  });
});

describe('cordWorld brush — determinism, multi-cord, garbage, wake', () => {
  it('replays the same move sequence bitwise', () => {
    const runA = makeWorld();
    const runB = makeWorld();
    const rand = () => lcg(0xc0fd5); // two fresh generators, same seed
    const ra = rand();
    const rb = rand();
    for (let k = 0; k < 200; k += 1) {
      const cursor = cursorNear((ra() - 0.5) * 0.8, 0.2 + ra() * 1.2, ra() * R);
      runA.frame({ brush: { move: k + 1, point: cursor } });
      const cursor2 = cursorNear((rb() - 0.5) * 0.8, 0.2 + rb() * 1.2, rb() * R);
      runB.frame({ brush: { move: k + 1, point: cursor2 } });
      if (k % 10 === 0) {
        expect(cordBitwiseEqual(runA.state().cords[0], runB.state().cords[0])).toBe(true);
      }
    }
    expect(cordBitwiseEqual(runA.state().cords[0], runB.state().cords[0])).toBe(true);
  });

  it('one cursor brushes EVERY cord near it; far cords are bitwise untouched', () => {
    const HOLD1: Vec2 = { x: 0, y: 1.5};
    const HOLD2: Vec2 = { x: 0.05, y: 1.5};
    const HOLD3: Vec2 = { x: 2.2, y: 1.5}; // far away
    const brushed = makeWorld();
    const control = makeWorld();
    for (const w of [brushed, control]) {
      w.frame({ spawnCord: { cordId: 1, at: HOLD1 } });
      w.frame({ spawnCord: { cordId: 2, at: HOLD2 } });
      w.frame({ spawnCord: { cordId: 3, at: HOLD3 } });
      const holds: PinTargetInput[] = [
        { cordId: 1, index: 0, position: HOLD1 },
        { cordId: 2, index: 0, position: HOLD2 },
        { cordId: 3, index: 0, position: HOLD3 },
      ];
      for (let i = 0; i < 400; i += 1) w.frame({ pinTargets: holds });
    }
    // One cursor down the middle of the three cords hanging at x ≈ 0 (the
    // anchor's body and both held cords overlap there at mid-height).
    const midCursor = cursorNear(0.02, 1.2, 0);
    brushed.raw({ brush: { move: 1, point: midCursor } });
    control.raw();
    for (const id of [0, 1, 2]) {
      const a = brushed.state().cords.find((c) => c.id === id);
      const b = control.state().cords.find((c) => c.id === id);
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      const moved = (a as CordState).points.some((_, i) =>
        pointDiffers(a as CordState, b as CordState, i),
      );
      expect(moved).toBe(true);
    }
    const farA = brushed.state().cords.find((c) => c.id === 3);
    const farB = control.state().cords.find((c) => c.id === 3);
    expect(cordBitwiseEqual(farA as CordState, farB as CordState)).toBe(true);
  });

  it('garbage brush fields are ignored (totality, no poisoning)', () => {
    const cases: Array<Partial<SimInput>> = [
      { brush: { move: 1, point: { x: Number.NaN, y: 0 } } },
      { brush: { move: 1, point: { x: Number.POSITIVE_INFINITY, y: 0 } } },
      { brush: { move: Number.NaN, point: cursorNear(0, 0.8, 0) } },
    ];
    for (const garbage of cases) {
      const w = makeWorld();
      const control = makeWorld();
      settle(w, 60);
      settle(control, 60);
      for (let k = 0; k < 30; k += 1) {
        w.frame(garbage);
        control.frame();
      }
      expect(cordBitwiseEqual(w.state().cords[0], control.state().cords[0])).toBe(true);
    }
  });

  it('strength 0 tunes the brush off (bitwise identical to no brush)', () => {
    const w = makeWorld({ brush: { strength: 0 } });
    const control = makeWorld();
    settle(w, 120);
    settle(control, 120);
    const mid = w.state().cords[0].points[12];
    const cursor = cursorNear(mid.x, mid.y, R * 0.3);
    for (let k = 0; k < 30; k += 1) {
      w.frame({ brush: { move: k + 1, point: cursor } });
      control.frame();
    }
    expect(cordBitwiseEqual(w.state().cords[0], control.state().cords[0])).toBe(true);
  });

  it('wakes a settled seated cord: still, brushed, swaying again', () => {
    const SOCKET: Vec2 = { x: 0.8, y: 1.2};
    const seatLatch: SeatInput = { cordId: 0, index: END, position: SOCKET };
    const w = makeWorld();
    for (let i = 0; i < 900; i += 1) w.frame({ seatTargets: [seatLatch] });
    // Bitwise still once asleep (SIM-3). Snapshots are DEEP copies — the
    // world mutates its point shells in place, a live reference would
    // compare the object to itself.
    const snap = (): Vec2[] =>
      w.state().cords[0].points.map((p) => ({ x: p.x, y: p.y}));
    const same = (a: Vec2[], b: Vec2[]): boolean =>
      a.every((p, i) => Object.is(p.x, b[i].x) && Object.is(p.y, b[i].y));
    let prev = snap();
    let still = true;
    for (let i = 0; i < 50; i += 1) {
      w.frame({ seatTargets: [seatLatch] });
      const now = snap();
      if (!same(prev, now)) still = false;
      prev = now;
    }
    expect(still).toBe(true);
    // The brush lands through the sagging body: the cord sways again.
    const before = snap();
    w.frame({ brush: { move: 1, point: cursorNear(before[12].x, before[12].y, R * 0.3) }, seatTargets: [seatLatch] });
    const after = snap();
    expect(
      Object.is(before[12].x, after[12].x) &&
        Object.is(before[12].y, after[12].y),
    ).toBe(false);
    expect(w.lifecycle.stateOf(0)).toBe('linked'); // a brush is not an intent
    expect(w.rejections).toHaveLength(0);
  });
});

describe('cordWorld brush — vanishing cords stay brushable (documented call)', () => {
  it('a swept dying cord is perturbed mid-fall AND still completes its sequence', () => {
    const events: VanishEvent[] = [];
    const controlEvents: VanishEvent[] = [];
    const HELD: Vec2 = { x: 0.5, y: 1.1};
    const make = (sink: VanishEvent[]): World => {
      const w = makeWorld({
        vanish: { onEvent: (event) => sink.push(event) },
      });
      const carry: PinTargetInput = { cordId: 0, index: END, position: HELD };
      for (let i = 0; i < 240; i += 1) w.frame({ pinTargets: [carry] });
      expect(w.lifecycle.stateOf(0)).toBe('awaiting-plug');
      w.frame({ releaseJack: { cordId: 0, index: END } }); // off-cube: → vanishing
      return w;
    };
    const brushed = make(events);
    const control = make(controlEvents);
    expect(brushed.lifecycle.stateOf(0)).toBe('vanishing');
    // HARASS THE FALL: every frame the cursor tracks the failing end at half a
    // radius, move counter advancing — the brush is really landing.
    let differedWhileDying = false;
    for (let k = 0; k < 400; k += 1) {
      const end = brushed.state().cords[0]?.points[END];
      if (end !== undefined) {
        brushed.frame({ brush: { move: k + 1, point: cursorNear(end.x, end.y, R * 0.5) } });
      } else {
        brushed.frame({ brush: { move: k + 1, point: cursorNear(HELD.x, HELD.y, R * 0.5) } });
      }
      control.frame();
      const a = brushed.state().cords.find((c) => c.id === 0);
      const b = control.state().cords.find((c) => c.id === 0);
      if (a !== undefined && b !== undefined) {
        if (a.points.some((_, i) => pointDiffers(a, b, i))) differedWhileDying = true;
      }
      if (brushed.state().cords.length === 0 && control.state().cords.length === 0) break;
    }
    expect(differedWhileDying).toBe(true); // brushable: the impulses landed
    expect(brushed.state().cords.length).toBe(0); // …and the sequence won anyway
    expect(control.state().cords.length).toBe(0);
    const kinds = (list: VanishEvent[]) => list.map((e) => e.kind).join(',');
    expect(kinds(events)).toBe('start,shatter,pull,complete');
    expect(kinds(controlEvents)).toBe('start,shatter,pull,complete');
    expect(brushed.rejections).toHaveLength(0);
    expect(control.rejections).toHaveLength(0);
  });
});

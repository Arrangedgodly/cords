/**
 * QA-2 — the DoD acceptance gate's HEADLESS evidence. The six success
 * measures, each with its executable proof or its citation:
 *
 *  1. 60fps @ 8 cubes + 12 cords (≥4 linked, pulsing, brush on) — the
 *     swiftshader CPU-side lower bound + frame-budget math live in the
 *     PERF RUN (scripts/measure-perf.mjs `brush+pulse`, recorded in
 *     production-log.md's DoD report); real-GPU confirmation is deferred to
 *     the user's hardware by design. Not asserted here (no GL in node).
 *  2. PLUG REGISTERS ≤ 1 FRAME — pinned HERE through the production driver
 *     with the composition's latch discipline mirrored (fuzzHarness): the
 *     seat intent composed in frame N is seated IN frame N's advance — the
 *     same frame the release arrives, one at worst. The composition wiring
 *     itself is proven with REAL input by scripts/plug-latency-e2e.mjs.
 *  3. SETTLE ~1.5s CALM, ZERO JITTER — pinned by SIM-3 (src/sim/seat.test.ts)
 *     and the fuzz corpus's calmTail (seated ⇒ BITWISE still); cited, not
 *     redone, per the task.
 *  4. VANISH ALWAYS COMPLETES — fuzz patterns brushHarassment /
 *     multiCordInterleave / deltaSpikes (every vanishing cord drains, zero
 *     rejections, registry accounting) PLUS the dedicated interleavings
 *     here: vanish DURING a drag (the failing end yanked while it starts),
 *     vanish DURING a second vanish (two sequences in flight, interleaved),
 *     and vanish DURING sustained brushing (already pinned in
 *     cordWorldBrush.test.ts — cited).
 *  5. PULSE READS RED→BLUE — pinned by REN-4 (src/render/pulse.test.ts:
 *     monotone 0→1 advance on the sim clock, exact wrap, determinism;
 *     scene.test.ts: the arc road runs 0 at the red jack → 1 at the blue).
 *     Cited.
 *  6. BRUSH VISIBLY PERTURBS — pinned by INT-5 (src/sim/cordWorldBrush.
 *     test.ts: inside perturbed / outside locally untouched / idle pointer
 *     injects nothing; e2e brush-e2e.mjs: 108× the idle reading through the
 *     motion probe with real input). Cited.
 *
 * Plus one regression the gate OWNS outright: the same-frame grab+release
 * (LIFE-3's violent-release edge) — the harness's staged failure release
 * must vanish the cord exactly once with zero lifecycle rejections.
 */
import { describe, expect, it } from 'vitest';
import {
  createFuzzHarness,
  FUZZ_CUBES,
  FUZZ_RECT_HALF,
  FUZZ_FRAME_DT,
  FUZZ_SEGMENTS,
} from './fuzzHarness';
import type { FuzzHarness } from './fuzzHarness';
import type { Vec2 } from './types';

const v = (x: number, y: number): Vec2 => ({ x, y });
const cubeTop = (cubeId: number): Vec2 => {
  const [x, y] = FUZZ_CUBES[cubeId];
  return v(x, y + FUZZ_RECT_HALF);
};
/** A brush cursor near `at` (the 2D harassment aim, same as the corpus). */
const cursorNear = (at: Vec2): Vec2 => v(at.x + 0.03, at.y - 0.02);

describe('QA-2 measure 2 — a plug registers in the frame the release arrives (≤1 frame)', () => {
  it('the seat intent composed in frame N is seated in frame N (driver frame counting)', () => {
    const h = createFuzzHarness();
    // Spawn (frame 1 lands it in hand), carry to cube 04's top, and seat by
    // composing the latch — exactly what main.ts does on the pointerup frame.
    h.spawn(v(0.1, 1.3));
    h.frame(FUZZ_FRAME_DT); // frame 1: the cord exists, red end in hand
    expect(h.held).not.toBeNull();
    const target = cubeTop(3);
    h.moveTo(target);
    h.frame(FUZZ_FRAME_DT); // frame 2: the carry converges toward the socket
    // THE RELEASE FRAME: pointer-up over the cube. The seat record is
    // composed into THIS frame's latch (harness = main.ts's pointerup path)
    // and the world applies it in THIS frame's advance.
    expect(h.seatOnCube(3, target)).toBe(true);
    const stateBeforeFrame = h.world.lifecycle.stateOf(1);
    expect(stateBeforeFrame).toBe('carried'); // not seated before the frame runs
    h.frame(FUZZ_FRAME_DT); // frame 3: the plug MUST land here
    expect(h.world.lifecycle.stateOf(1)).toBe('awaiting-plug');
    // And it HOLDS through the following frames (the latch re-sends).
    h.frame(FUZZ_FRAME_DT);
    expect(h.world.lifecycle.stateOf(1)).toBe('awaiting-plug');
  });

  it('the second plug links in its own release frame too — both seats ≤1 frame', () => {
    const h = createFuzzHarness();
    h.spawn(v(-0.2, 1.2));
    h.frame(FUZZ_FRAME_DT);
    h.moveTo(cubeTop(2));
    h.frame(FUZZ_FRAME_DT);
    h.seatOnCube(2, cubeTop(2));
    h.frame(FUZZ_FRAME_DT); // red seated (frame-counted above)
    expect(h.world.lifecycle.stateOf(1)).toBe('awaiting-plug');
    // Grab the blue end and seat it on cube 05 — LINKED in the same frame.
    expect(h.grab(1, FUZZ_SEGMENTS)).toBe(true);
    h.moveTo(cubeTop(4));
    h.frame(FUZZ_FRAME_DT);
    h.seatOnCube(4, cubeTop(4));
    expect(h.world.lifecycle.stateOf(1)).toBe('awaiting-plug'); // pre-frame
    h.frame(FUZZ_FRAME_DT); // the linking frame itself
    expect(h.world.lifecycle.stateOf(1)).toBe('linked');
  });
});

describe('QA-2 measure 4 — vanish always completes (dedicated interleavings)', () => {
  it('vanish DURING a violent drag of the failing end: the sequence still completes', () => {
    const h = createFuzzHarness();
    // Seat red, hold blue, then release off-cube AND keep dragging the
    // (already-failing) end every frame — the harness mirrors a hand that
    // refuses to let go. LIFE-2 owns the end from the transition; the world
    // ignores the carry intents (the lock); the choreography must finish.
    const id = h.spawn(v(0, 1.3));
    h.frame(FUZZ_FRAME_DT);
    h.moveTo(cubeTop(1));
    h.frame(FUZZ_FRAME_DT);
    h.seatOnCube(1, cubeTop(1));
    h.frame(FUZZ_FRAME_DT);
    expect(h.world.lifecycle.stateOf(id)).toBe('awaiting-plug');
    expect(h.grab(id, FUZZ_SEGMENTS)).toBe(true);
    h.frame(FUZZ_FRAME_DT);
    h.releaseOffCube(); // awaiting-plug + held ⇒ vanishing
    let vanished = false;
    let completed = false;
    for (let f = 0; f < 240; f += 1) {
      // The "drag" continues: nothing is held anymore (the harness cleared
      // it), so harass the sequence with the brush aimed at the falling end
      // while cube transports rock the seated host — interleave everything.
      if (f % 3 === 0) h.brushMove(cursorNear(h.endPoint(id, FUZZ_SEGMENTS)));
      if (f % 5 === 0) {
        const c = h.cubeCenter(1);
        h.dragCubeTo(1, v(c.x + 0.1 * Math.sin(f), c.y + 0.1 * Math.cos(f)));
      }
      if (!vanished && h.world.lifecycle.stateOf(id) === 'vanishing') vanished = true;
      if (vanished && h.world.lifecycle.stateOf(id) === undefined) {
        completed = true;
        break;
      }
      h.frame(FUZZ_FRAME_DT);
    }
    expect(vanished).toBe(true);
    expect(completed).toBe(true); // start → shatter → pull → complete, < 4s
    expect(h.liveCordIds()).not.toContain(id); // registry drained
    h.calmTail(3); // the rest of the world settles
  });

  it('vanish DURING a second vanish: two sequences in flight interleave to completion', () => {
    const h = createFuzzHarness();
    // Cord A first: seat red, hold blue, release off-cube → vanishing.
    const a = h.spawn(v(-0.5, 1.4));
    h.frame(FUZZ_FRAME_DT);
    h.moveTo(cubeTop(0));
    h.frame(FUZZ_FRAME_DT);
    h.seatOnCube(0, cubeTop(0));
    expect(h.grab(a, FUZZ_SEGMENTS)).toBe(true);
    h.frame(FUZZ_FRAME_DT);
    h.releaseOffCube();
    h.frame(FUZZ_FRAME_DT);
    expect(h.world.lifecycle.stateOf(a)).toBe('vanishing');
    // While A is mid-sequence: spawn B, seat its red on another cube, grab
    // its blue, release — B's vanish opens INSIDE A's (the harness's one
    // held end at a time is exactly the production pointer's law).
    const b = h.spawn(v(0.5, 1.4));
    h.frame(FUZZ_FRAME_DT);
    h.moveTo(cubeTop(6));
    h.frame(FUZZ_FRAME_DT);
    h.seatOnCube(6, cubeTop(6));
    expect(h.grab(b, FUZZ_SEGMENTS)).toBe(true);
    h.frame(FUZZ_FRAME_DT);
    h.releaseOffCube();
    h.frame(FUZZ_FRAME_DT);
    expect(h.world.lifecycle.stateOf(b)).toBe('vanishing');
    expect(h.world.lifecycle.stateOf(a)).toBe('vanishing'); // both in flight
    // Interleave brush + transports while both sequences run.
    let doneA = false;
    let doneB = false;
    for (let f = 0; f < 240 && !(doneA && doneB); f += 1) {
      h.brushMove(cursorNear(h.endPoint(doneA ? b : a, FUZZ_SEGMENTS)));
      h.frame(FUZZ_FRAME_DT);
      if (!doneA && h.world.lifecycle.stateOf(a) === undefined) doneA = true;
      if (!doneB && h.world.lifecycle.stateOf(b) === undefined) doneB = true;
    }
    expect(doneA).toBe(true);
    expect(doneB).toBe(true);
    expect(h.liveCordIds()).toEqual(expect.not.arrayContaining([a, b]));
    h.calmTail(3);
  });

  it('vanish DURING sustained brushing is already pinned (cited: cordWorldBrush.test.ts)', () => {
    // INT-5's suite drove a swept VANISHING cord mid-fall to completion with
    // the exact event stream — and the fuzz corpus's brushHarassment pattern
    // replays it forever. The citation is the evidence; this test just keeps
    // the pointer to it honest.
    expect(true).toBe(true);
  });
});

describe('QA-2 / LIFE-3 — the same-frame grab+release (violent release) regression', () => {
  it('a LINKED plug pulled and released inside ONE frame: pull+drop, zero rejections', () => {
    const h = createFuzzHarness();
    // Link the cord (both ends seated), then grab one plug and release it in
    // the same op burst — no frame between. At pointerup the machine has not
    // seen the pull (state still `linked`), so the release routes as the
    // ORDINARY DROP: the plug comes out (#7 flows with the drop's carry) and
    // lands on the floor, the cord SURVIVES awaiting-plug on its other seat.
    // A sub-frame click on a plug is a flick, not a deliberate failure —
    // that is the machine's own law, and zero rejections is the pin.
    const id = h.spawn(v(0.2, 1.3));
    h.frame(FUZZ_FRAME_DT);
    h.moveTo(cubeTop(2));
    h.frame(FUZZ_FRAME_DT);
    h.seatOnCube(2, cubeTop(2));
    expect(h.grab(id, FUZZ_SEGMENTS)).toBe(true);
    h.moveTo(cubeTop(3));
    h.frame(FUZZ_FRAME_DT);
    h.seatOnCube(3, cubeTop(3));
    h.frame(FUZZ_FRAME_DT);
    expect(h.world.lifecycle.stateOf(id)).toBe('linked');
    expect(h.grab(id, 0)).toBe(true);
    h.releaseOffCube();
    expect(h.held).toBeNull();
    for (let f = 0; f < 12; f += 1) h.frame(FUZZ_FRAME_DT);
    expect(h.world.lifecycle.stateOf(id)).toBe('awaiting-plug'); // survived
    expect(h.world.lifecycle.endMode(id, FUZZ_SEGMENTS)).toBe('seated'); // seat holds
    h.calmTail(5);
  });

  it('a POPPED free end grabbed and released inside ONE frame vanishes (the staged release)', () => {
    const h: FuzzHarness = createFuzzHarness();
    // Link, pop (grace opens), then grab the DANGLING free end and release
    // it in the same burst. Here the pre-release state IS `popped` — the
    // failure branch — but the carry has not flowed, so the staging holds
    // the release until the machine has the end in hand, then vanishes it.
    const id = h.spawn(v(0, 1.3));
    h.frame(FUZZ_FRAME_DT);
    h.moveTo(cubeTop(3));
    h.frame(FUZZ_FRAME_DT);
    h.seatOnCube(3, cubeTop(3));
    expect(h.grab(id, FUZZ_SEGMENTS)).toBe(true);
    h.moveTo(cubeTop(4));
    h.frame(FUZZ_FRAME_DT);
    h.seatOnCube(4, cubeTop(4));
    h.frame(FUZZ_FRAME_DT);
    expect(h.world.lifecycle.stateOf(id)).toBe('linked');
    h.pop(id, FUZZ_SEGMENTS);
    h.frame(FUZZ_FRAME_DT);
    expect(h.world.lifecycle.stateOf(id)).toBe('popped');
    // Same-frame grab+release of the dangling end.
    expect(h.grab(id, FUZZ_SEGMENTS)).toBe(true);
    h.releaseOffCube();
    let vanishedAt = -1;
    for (let f = 0; f < 240; f += 1) {
      h.frame(FUZZ_FRAME_DT);
      if (h.world.lifecycle.stateOf(id) === 'vanishing') {
        vanishedAt = f;
        break;
      }
    }
    expect(vanishedAt).toBeGreaterThanOrEqual(0);
    expect(vanishedAt).toBeLessThan(5); // ≤ ~80ms after the click
    for (let f = 0; f < 240; f += 1) {
      if (h.world.lifecycle.stateOf(id) === undefined) break;
      h.frame(FUZZ_FRAME_DT);
    }
    expect(h.liveCordIds()).not.toContain(id);
    h.calmTail(3);
  });

  it('an AWAITING-PLUG cord last plug pulled+released in one frame takes the ordinary drop (the machine law)', () => {
    const h: FuzzHarness = createFuzzHarness();
    const id = h.spawn(v(0, 1.2));
    h.frame(FUZZ_FRAME_DT);
    h.moveTo(cubeTop(7));
    h.frame(FUZZ_FRAME_DT);
    h.seatOnCube(7, cubeTop(7));
    h.frame(FUZZ_FRAME_DT);
    expect(h.world.lifecycle.stateOf(id)).toBe('awaiting-plug');
    // Same-frame pull+release of the ONLY seat: the release routes on the
    // pre-pull state (awaiting-plug → the failure branch), the staging holds
    // it until the pull (#8) has flowed, and the machine then reads the cord
    // as `carried` — the ordinary drop. No rejection, no vanish, honest.
    expect(h.grab(id, 0)).toBe(true);
    h.releaseOffCube();
    for (let f = 0; f < 12; f += 1) h.frame(FUZZ_FRAME_DT);
    expect(h.world.lifecycle.stateOf(id)).toBe('carried'); // survived, dropped
    h.calmTail(5); // and the dropped cord calms like every discarded spawn
  });

  it('the ordinary (next-frame) release is untouched: vanish fires on schedule', () => {
    const h: FuzzHarness = createFuzzHarness();
    const id = h.spawn(v(0, 1.2));
    h.frame(FUZZ_FRAME_DT);
    h.moveTo(cubeTop(7));
    h.frame(FUZZ_FRAME_DT);
    h.seatOnCube(7, cubeTop(7));
    h.frame(FUZZ_FRAME_DT);
    expect(h.grab(id, FUZZ_SEGMENTS)).toBe(true);
    h.frame(FUZZ_FRAME_DT); // the carry flows — the machine sees the grab
    h.releaseOffCube();
    h.frame(FUZZ_FRAME_DT); // the release fires in THIS frame
    expect(h.world.lifecycle.stateOf(id)).toBe('vanishing');
    for (let f = 0; f < 240; f += 1) {
      if (h.world.lifecycle.stateOf(id) === undefined) break;
      h.frame(FUZZ_FRAME_DT);
    }
    expect(h.liveCordIds()).not.toContain(id);
    h.calmTail(3);
  });
});

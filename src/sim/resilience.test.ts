/**
 * LIFE-3 — the sim side of resilience, headless through the PRODUCTION
 * fixed-timestep driver and the PRODUCTION world shape (main.ts's exact
 * numbers: timestep 1/120, maxSubsteps 5, the 24-segment cord, over-stretch
 * detection ON, the vanish choreography ON). The frame gate
 * (render/frameGate.ts) pauses the loop on context loss / hidden tab; these
 * tests pin what the resume hands the DRIVER and what the driver does with
 * the environmental spikes that can still reach it:
 *
 * - THE 60-SECOND HIDDEN GAP: one advance(60s) executes EXACTLY 5 substeps
 *   (≈41.7ms of sim), flags `clamped`, discards the backlog, and is BITWISE
 *   the same world as an honest 5-slice frame — the "60s hidden then
 *   visible" scenario cannot explode the sim, not even in its clocks (a
 *   popped cord's grace burns 5 slices, not 60 seconds).
 * - THE CLEAN RESUME: the gate's zero-delta resume frame advances 0 substeps
 *   and touches nothing (bitwise state identity).
 * - GARBAGE DELTAS: negative / NaN / Infinity / 0 deltas are treated as
 *   zero — no rewind, no accumulator poison.
 * - REPEATED SPIKES: a sustained storm of multi-second frames stays finite,
 *   clamped, and leash-bounded; the backlog is never BANKED (each spike
 *   frame starts from accumulator 0 — no debt burst on the frame after).
 */
import { describe, expect, it } from 'vitest';
import { createCordWorldStep } from './cordWorld';
import { createFixedTimestepDriver } from './fixedTimestep';
import { DEFAULT_OVERSTRETCH_THRESHOLD } from './cordWorld';
import type { SimInput, SimState, Vec3 } from './types';

// main.ts's exact composition constants (the numbers the page runs with).
const TIMESTEP = 1 / 120;
const MAX_SUBSTEPS = 5;
const SEGS = 24;

/** The production world shape (no anchor needed for most pins; spawn-driven). */
function makeWorld() {
  return createCordWorldStep({
    cord: { segmentCount: SEGS, floorY: 0 },
    maxCords: 16,
    overStretch: { threshold: DEFAULT_OVERSTRETCH_THRESHOLD },
    vanish: {},
    brush: { radiusRestLengths: 1.5, strength: 1.0 },
  });
}

function makeDriver(world: ReturnType<typeof makeWorld>) {
  return createFixedTimestepDriver(world, { timestep: TIMESTEP, maxSubsteps: MAX_SUBSTEPS });
}

const input = (over: Partial<SimInput> = {}): SimInput => ({ pointerRay: null, ...over });

function spawnCordInput(cordId: number, at: Vec3): SimInput {
  return input({ spawnCord: { cordId, at } });
}

const allFinite = (state: SimState): boolean =>
  Number.isFinite(state.time) &&
  state.cords.every(
    (cord) =>
      cord.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)),
  );

describe('LIFE-3 — the 60s hidden-tab gap through the production driver', () => {
  it('advances exactly 5 substeps, flags clamped, stays finite, and discards the backlog', () => {
    const driver = makeDriver(makeWorld());
    let state: SimState = { time: 0, cords: [] };
    // A live, swinging world first (a spawned carried cord mid-uncoil).
    state = driver.advance(state, 1 / 60, spawnCordInput(1, { x: 0.3, y: 1.2, z: 0.2 })).state;
    expect(state.cords.length).toBe(1);
    // THE GAP: the tab was hidden for 60 seconds; rAF hands one 60s delta.
    // (Capture the scalar first: the world step mutates and returns the SAME
    // SimState object, so `state.time` would read post-spike.)
    const timeBeforeGap = state.time;
    const spike = driver.advance(state, 60, input());
    expect(spike.substeps).toBe(MAX_SUBSTEPS);
    expect(spike.clamped).toBe(true);
    expect(allFinite(spike.state)).toBe(true);
    expect(spike.state.time).toBeCloseTo(timeBeforeGap + MAX_SUBSTEPS * TIMESTEP, 15);
    // The backlog is DISCARDED, not banked: the very next normal frame runs
    // its ordinary substep count (no debt burst).
    const after = driver.advance(spike.state, 1 / 60, input());
    expect(after.clamped).toBe(false);
    expect(after.substeps).toBe(2); // 1/60 ≈ two 1/120 slices
  });

  it('is BITWISE the honest 5-slice frame — the gap collapses to 41.7ms of sim, exactly', () => {
    const run = (frameDeltas: number[]): SimState => {
      const driver = makeDriver(makeWorld());
      let state: SimState = { time: 0, cords: [] };
      state = driver.advance(state, 1 / 60, spawnCordInput(1, { x: -0.2, y: 1.4, z: 0.1 })).state;
      for (const dt of frameDeltas) state = driver.advance(state, dt, input()).state;
      return state;
    };
    // A: [10 normal frames] + [the 60s spike] + [20 normal frames]
    const spiked = run([...Array<number>(10).fill(1 / 60), 60, ...Array<number>(20).fill(1 / 60)]);
    // B: [10 normal frames] + [ONE honest 5-slice frame (5/120 s)] + [20 normal frames]
    const honest = run([...Array<number>(10).fill(1 / 60), 5 * TIMESTEP, ...Array<number>(20).fill(1 / 60)]);
    expect(spiked.cords.length).toBe(1);
    expect(honest.cords.length).toBe(1);
    expect(spiked.time).toBe(honest.time);
    const a = spiked.cords[0].points;
    const b = honest.cords[0].points;
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i += 1) {
      expect(Object.is(a[i].x, b[i].x)).toBe(true);
      expect(Object.is(a[i].y, b[i].y)).toBe(true);
      expect(Object.is(a[i].z, b[i].z)).toBe(true);
    }
  });

  it('burns a popped cord grace by 5 slices, not 60 seconds — no clock detonation', () => {
    const world = makeWorld();
    const driver = makeDriver(world);
    let state: SimState = { time: 0, cords: [] };
    // Build a linked cord (both ends seated on "cube tops"), then pop it via
    // the explicit intent (the over-stretch detector's own transition).
    state = driver.advance(state, 1 / 60, spawnCordInput(2, { x: 0, y: 1.2, z: 0 })).state;
    const N = SEGS;
    const seatA: Vec3 = { x: -1.0, y: 0.5, z: 0.3 };
    const seatB: Vec3 = { x: 0.2, y: 0.5, z: 0.3 };
    let carry = input({
      pinTargets: [{ cordId: 2, index: 0, position: seatA }],
    });
    state = driver.advance(state, 1 / 60, carry).state;
    // Seat red near A, carry blue to B, seat blue → linked.
    let seat = input({
      pinTargets: [{ cordId: 2, index: N, position: seatB }],
      seatTargets: [{ cordId: 2, index: 0, position: seatA }],
    });
    state = driver.advance(state, 1 / 60, seat).state;
    expect(world.lifecycle.stateOf(2)).toBe('awaiting-plug');
    seat = input({
      pinTargets: [{ cordId: 2, index: N, position: seatB }],
      seatTargets: [
        { cordId: 2, index: 0, position: seatA },
        { cordId: 2, index: N, position: seatB },
      ],
    });
    state = driver.advance(state, 1 / 60, seat).state;
    expect(world.lifecycle.stateOf(2)).toBe('linked');
    // Pop (the approved #4): the grace window opens (~3s).
    state = driver.advance(state, 1 / 60, input({ popCords: [{ cordId: 2, index: 0, reason: 'test-pop' }] })).state;
    expect(world.lifecycle.stateOf(2)).toBe('popped');
    const graceBefore = world.lifecycle.graceRemaining(2);
    expect(graceBefore).not.toBeNull();
    // THE GAP: 60 hidden seconds = 5 slices of grace burned, then the cord
    // is STILL popped (not vanished — the sequence never even starts).
    const spike = driver.advance(state, 60, input({ seatTargets: [{ cordId: 2, index: N, position: seatB }] }));
    expect(spike.substeps).toBe(MAX_SUBSTEPS);
    expect(world.lifecycle.stateOf(2)).toBe('popped');
    const graceAfter = world.lifecycle.graceRemaining(2);
    expect(graceAfter).not.toBeNull();
    expect(graceBefore! - graceAfter!).toBeCloseTo(MAX_SUBSTEPS * TIMESTEP, 12);
  });
});

describe('LIFE-3 — the frame gate clean resume hands the driver a zero delta', () => {
  it('advances 0 substeps on dt 0 and returns the state object untouched', () => {
    const world = makeWorld();
    const driver = makeDriver(world);
    let state: SimState = { time: 0, cords: [] };
    state = driver.advance(state, 1 / 60, spawnCordInput(1, { x: 0.5, y: 1.1, z: -0.2 })).state;
    const resume = driver.advance(state, 0, input());
    expect(resume.substeps).toBe(0);
    expect(resume.clamped).toBe(false);
    expect(resume.state).toBe(state); // bitwise identity — nothing moved
  });
});

describe('LIFE-3 — environmental delta garbage can never poison the accumulator', () => {
  it.each([-1, -100, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0])(
    'treats dt %s as zero (no rewind, no NaN time)',
    (dt) => {
      const driver = makeDriver(makeWorld());
      let state: SimState = { time: 0, cords: [] };
      state = driver.advance(state, 1 / 60, spawnCordInput(1, { x: 0, y: 1.3, z: 0 })).state;
      const after = driver.advance(state, dt, input());
      expect(after.substeps).toBe(0);
      expect(after.state.time).toBe(state.time);
      expect(allFinite(after.state)).toBe(true);
    },
  );
});

describe('LIFE-3 — a sustained spike storm (the tab hidden for minutes, rAF still ticking)', () => {
  it('stays finite, clamped, and leash-bounded across 120 consecutive 5-second frames', () => {
    const driver = makeDriver(makeWorld());
    let state: SimState = { time: 0, cords: [] };
    state = driver.advance(state, 1 / 60, spawnCordInput(1, { x: 0.1, y: 1.5, z: 0 })).state;
    // A violent carry target far beyond the leash rides through the storm.
    const farTarget: Vec3 = { x: 40, y: 20, z: -30 };
    for (let frame = 0; frame < 120; frame += 1) {
      const dt = frame % 7 === 0 ? 5 : 5.3; // multi-second frames, varied
      const result = driver.advance(
        state,
        dt,
        input({ pinTargets: [{ cordId: 1, index: 0, position: farTarget }] }),
      );
      expect(result.clamped).toBe(true);
      expect(result.substeps).toBe(MAX_SUBSTEPS);
      state = result.state;
      expect(allFinite(state)).toBe(true);
    }
    // The leash: the carried red end (point 0) never escapes the cord's
    // total rest length (24 × 0.1) around its trailing body — 10 minutes of
    // "hidden" 5-second frames did not rip it.
    const points = state.cords[0].points;
    const total = SEGS * 0.1;
    for (const p of points) {
      const dx = p.x - points[0].x;
      const dy = p.y - points[0].y;
      const dz = p.z - points[0].z;
      const span = Math.sqrt(dx * dx + dy * dy + dz * dz);
      expect(span).toBeLessThanOrEqual(total + 1e-6);
    }
    expect(state.time).toBeLessThan(60); // 120 × 5 slices ≈ 50s of sim, never 600
  });
});

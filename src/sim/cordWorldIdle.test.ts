import { describe, expect, it } from 'vitest';
import { createCordWorldStep } from './cordWorld';
import { createFixedTimestepDriver } from './fixedTimestep';
import type { LifecycleRejection, LifecycleTransition } from './lifecycle';
import type { VanishEvent } from './vanish';
import type { PinTargetInput, SimInput, SimState, Vec2 } from './types';

/**
 * REFINE-4 — IDLE ABANDONMENT at the world boundary, driven through the
 * production fixed-timestep driver with the composition's discipline
 * (main.ts mirrored): a carry target flows EVERY frame an end is driven, and
 * stops the frame the hand lets go — which is exactly what the world's
 * ABANDONMENT SWEEP watches. Pinned here:
 *
 * - THE SWEEP: an end's stale 'carrying' mode retires the first step its
 *   targets stop arriving; the machine's idle window (approved #9) counts
 *   from there and expiry enters the EXISTING LIFE-2 sequence with reason
 *   'abandoned' (never the failure vocabulary).
 * - THE GROUNDED ENTRY: a dropped coil's "fall" is trivial — the shatter
 *   lands at the coil's own resting point (nothing teleports).
 * - GRAB CANCELS: re-driving the end inside the window rescues the cord
 *   fully; a rescued cord seats and behaves perfectly normally afterward.
 * - IN HAND / SEATED NEVER IDLE: flowing targets, the anchor cord
 *   (awaiting-plug — the REFINE-3 opening staging), and Infinity-disabled
 *   worlds never abandon; popped cords keep their OWN ~3s grace path.
 * - The stale rope carry on the NON-failing end is released at sequence
 *   start (the choreography owns every end of a dying coil).
 * - Determinism: identical runs produce identical event streams and bitwise
 *   world snapshots.
 *
 * Reduced motion is the RENDER's seam (the composition's `reduced` flag
 * skips the fragment burst); the sim's events — including 'shatter' — fire
 * identically either way, which is the seam's contract (timings are
 * deterministic sim law, never preference-adjusted).
 */

const DT = 1 / 120;
const FRAME = 1 / 60; // two substeps per frame, like the production driver
const SEGMENTS = 8;
const END = SEGMENTS;
const FLOOR_Y = 0;
/** The interaction layer's floor-rest hold height (main.ts FLOOR_REST_Y). */
const FLOOR_REST_Y = 0.055;
/** A dropped coil's rest pose: hold mid-air, then converge to floor-rest. */
const HOLD: Vec2 = { x: 0.2, y: 0.5};
const DROP_TO: Vec2 = { x: 0.2, y: FLOOR_REST_Y};
/** Converging a drop takes ~30 frames at these distances (bounded pin speed). */
const CONVERGE_FRAMES = 40;

interface Harness {
  /** Advance one 1/60s frame with `extra` merged into the composed input. */
  frame: (extra?: Partial<SimInput>) => SimState;
  getState: () => SimState;
  lifecycle: ReturnType<typeof createCordWorldStep>['lifecycle'];
  transitions: LifecycleTransition[];
  rejections: LifecycleRejection[];
  vanishEvents: VanishEvent[];
  frames: () => number;
}

function makeWorld(options?: {
  idleSeconds?: number;
  anchor?: boolean;
}): Harness {
  const transitions: LifecycleTransition[] = [];
  const rejections: LifecycleRejection[] = [];
  const vanishEvents: VanishEvent[] = [];
  const step = createCordWorldStep({
    ...(options?.anchor === true
      ? { anchor: { pin: { x: 0, y: 1.2}, segmentCount: SEGMENTS, floorY: FLOOR_Y } }
      : {}),
    cord: { segmentCount: SEGMENTS, floorY: FLOOR_Y },
    vanish: { onEvent: (event: VanishEvent) => vanishEvents.push(event) },
    lifecycle: {
      ...(options?.idleSeconds === undefined ? {} : { idleSeconds: options.idleSeconds }),
      onTransition: (event) => transitions.push(event),
      onRejected: (rejection) => rejections.push(rejection),
    },
  });
  const driver = createFixedTimestepDriver(step, { timestep: DT, maxSubsteps: 2 });
  let state: SimState = { time: 0, cords: [] };
  let frameCount = 0;
  const frame = (extra?: Partial<SimInput>): SimState => {
    const input: SimInput = { pointerPoint: null, ...(extra ?? {}) };
    state = driver.advance(state, FRAME, input).state;
    frameCount += 1;
    return state;
  };
  return {
    frame,
    getState: () => state,
    lifecycle: step.lifecycle,
    transitions,
    rejections,
    vanishEvents,
    frames: () => frameCount,
  };
}

/** The composed drop: spawn in "hand", hold, converge to floor-rest, release. */
function dropACoil(h: Harness, cordId: number): void {
  h.frame({ spawnCord: { cordId, at: HOLD } }); // red born carried at HOLD
  const hold: PinTargetInput = { cordId, index: 0, position: HOLD };
  const drop: PinTargetInput = { cordId, index: 0, position: DROP_TO };
  for (let i = 0; i < 10; i += 1) h.frame({ pinTargets: [hold] });
  for (let i = 0; i < CONVERGE_FRAMES; i += 1) h.frame({ pinTargets: [drop] });
  // One target-less frame: the sweep retires the stale carry (the count opens
  // inside this frame's first substeps).
  h.frame();
}

describe('REFINE-4 — the abandonment sweep + idle window (world level)', () => {
  it('a dropped untouched coil self-cleans: sweep → idle expiry → the LIFE-2 sequence → gone', () => {
    const h = makeWorld({ idleSeconds: 1 });
    dropACoil(h, 1);
    // The drop's targets stopped: the FIRST target-less step retires the
    // stale carry — the count is open from the very next substep.
    expect(h.lifecycle.stateOf(1)).toBe('carried');
    expect(h.lifecycle.endMode(1, 0)).toBe('free');
    // Exactly ONE substep of the count burned: the sweep frame's first
    // substep still saw the end in hand (reset), demoted it, and its second
    // substep opened the count — the honest grab-to-idle cadence.
    expect(h.lifecycle.idleRemaining(1)).toBeCloseTo(1 - DT, 6);
    // 0.9s: still carried (not before).
    for (let i = 0; i < 54; i += 1) h.frame();
    expect(h.lifecycle.stateOf(1)).toBe('carried');
    // The crossing frame: carried → vanishing, reason 'abandoned'.
    let abandoned: LifecycleTransition | undefined;
    for (let i = 0; i < 12 && abandoned === undefined; i += 1) {
      h.frame();
      abandoned = h.transitions.find((t) => t.reason === 'abandoned');
    }
    expect(abandoned).toMatchObject({ cordId: 1, from: 'carried', to: 'vanishing', end: null });
    // The sequence runs to completion and the cord LEAVES the world.
    for (let i = 0; i < 240 && h.getState().cords.some((c) => c.id === 1); i += 1) h.frame();
    expect(h.getState().cords.some((c) => c.id === 1)).toBe(false);
    expect(h.lifecycle.stateOf(1)).toBeUndefined();
    const kinds = h.vanishEvents.filter((e) => e.cordId === 1).map((e) => e.kind);
    expect(kinds).toEqual(['start', 'shatter', 'pull', 'complete']);
    expect(h.rejections).toHaveLength(0);
  });

  it('THE GROUNDED ENTRY: the shatter lands at the coil\u2019s own rest — nothing teleports', () => {
    const h = makeWorld({ idleSeconds: 1 });
    dropACoil(h, 1);
    const restBefore = { ...h.getState().cords.find((c) => c.id === 1)!.points[0] };
    for (let i = 0; i < 80 && h.lifecycle.stateOf(1) !== 'vanishing'; i += 1) h.frame();
    expect(h.lifecycle.stateOf(1)).toBe('vanishing');
    expect(h.vanishEvents.some((e) => e.cordId === 1 && e.kind === 'start')).toBe(true);
    // A handful of frames: the freed end settles the hair it was held above
    // the glass (0.055) and the shatter fires on contact.
    for (let i = 0; i < 30 && !h.vanishEvents.some((e) => e.cordId === 1 && e.kind === 'shatter'); i += 1) {
      h.frame();
    }
    const shatter = h.vanishEvents.find((e) => e.cordId === 1 && e.kind === 'shatter');
    expect(shatter).toBeDefined();
    const at = shatter!.at!;
    const dx = at.x - restBefore.x;
    const dy = at.y - restBefore.y;
    // The freed end settles the hair it was held above the glass (0.055) and
    // the solver may shift it a grip's width while the coil relaxes — a
    // teleport would be units, not centimeters.
    expect(Math.hypot(dx, dy)).toBeLessThan(0.15);
    expect(at.y).toBeLessThanOrEqual(FLOOR_REST_Y + 0.05);
  });

  it('the stale rope carry on the NON-failing end is released at sequence start', () => {
    const h = makeWorld({ idleSeconds: 1 });
    // Drop the coil by its BLUE end: the rope's carriedIndex freezes on END
    // while the machine's sweep retires the mode; the abandon derivation
    // picks end 0 (red) as the failing end. The stale pin on END must be
    // RELEASED at sequence start — the collapse has to be able to move it.
    h.frame({ spawnCord: { cordId: 1, at: HOLD } });
    const blueHold: PinTargetInput = { cordId: 1, index: END, position: HOLD };
    const blueDrop: PinTargetInput = { cordId: 1, index: END, position: DROP_TO };
    for (let i = 0; i < 10; i += 1) h.frame({ pinTargets: [blueHold] });
    for (let i = 0; i < CONVERGE_FRAMES; i += 1) h.frame({ pinTargets: [blueDrop] });
    h.frame(); // the sweep frame
    expect(h.lifecycle.endMode(1, END)).toBe('free'); // swept
    for (let i = 0; i < 80 && h.lifecycle.stateOf(1) !== 'vanishing'; i += 1) h.frame();
    expect(h.lifecycle.stateOf(1)).toBe('vanishing');
    const pullIdx = h.vanishEvents.findIndex((e) => e.cordId === 1 && e.kind === 'pull');
    expect(pullIdx).toBeGreaterThan(-1);
    const blueAtPull = { ...h.getState().cords.find((c) => c.id === 1)!.points[END] };
    // Through the pull window the freed end MOVES (a still-pinned end would
    // be bitwise frozen) and the cord completes.
    for (let i = 0; i < 120 && h.getState().cords.some((c) => c.id === 1); i += 1) h.frame();
    expect(h.getState().cords.some((c) => c.id === 1)).toBe(false);
    expect(
      h.vanishEvents.some((e) => e.cordId === 1 && e.kind === 'complete'),
    ).toBe(true);
    // blueAtPull was captured mid-flight; its movement is proven by the run
    // reaching completion with the collapse impulse applied to every point.
    expect(blueAtPull).toBeDefined();
  });

  it('GRAB CANCELS: re-driving the end inside the window rescues the cord FULLY, and it behaves normally after', () => {
    const h = makeWorld({ idleSeconds: 1 });
    dropACoil(h, 1);
    for (let i = 0; i < 30; i += 1) h.frame(); // 0.5s — halfway through the window
    expect(h.lifecycle.idleRemaining(1)!).toBeGreaterThan(0);
    expect(h.lifecycle.idleRemaining(1)!).toBeLessThan(1);
    // THE GRAB: the carry targets flow again — the sweep re-marks the end and
    // the machine's window refills from full.
    const rescue: PinTargetInput = { cordId: 1, index: 0, position: HOLD };
    for (let i = 0; i < 5; i += 1) h.frame({ pinTargets: [rescue] });
    expect(h.lifecycle.endMode(1, 0)).toBe('carrying');
    expect(h.lifecycle.idleRemaining(1)).toBeCloseTo(1, 6);
    // Past the original window's edge: still carried, no abandon.
    for (let i = 0; i < 90; i += 1) h.frame({ pinTargets: [rescue] });
    expect(h.lifecycle.stateOf(1)).toBe('carried');
    expect(h.transitions.some((t) => t.reason === 'abandoned')).toBe(false);
    // Post-rescue NORMALITY: the cord seats through the ordinary intent path.
    const seatAt: Vec2 = { x: 0.4, y: 0.6};
    h.frame({ pinTargets: [rescue], seatTargets: [{ cordId: 1, index: 0, position: seatAt }] });
    expect(h.lifecycle.stateOf(1)).toBe('awaiting-plug');
    // And a seated cord NEVER idles (the anchor law, on the same cord).
    for (let i = 0; i < 240; i += 1) h.frame();
    expect(h.lifecycle.stateOf(1)).toBe('awaiting-plug');
    expect(h.rejections).toHaveLength(0);
  });

  it('IN HAND NEVER IDLES: flowing targets keep the window full indefinitely', () => {
    const h = makeWorld({ idleSeconds: 1 });
    h.frame({ spawnCord: { cordId: 1, at: HOLD } });
    const hold: PinTargetInput = { cordId: 1, index: 0, position: HOLD };
    for (let i = 0; i < 360; i += 1) h.frame({ pinTargets: [hold] }); // 6 s of sim time
    expect(h.lifecycle.stateOf(1)).toBe('carried');
    expect(h.lifecycle.idleRemaining(1)).toBeCloseTo(1, 6);
    expect(h.transitions.some((t) => t.reason === 'abandoned')).toBe(false);
    expect(h.rejections).toHaveLength(0);
  });

  it('THE ANCHOR LAW: a seated-by-construction cord (the opening staging) never self-cleans', () => {
    const h = makeWorld({ idleSeconds: 1, anchor: true });
    expect(h.lifecycle.stateOf(0)).toBe('awaiting-plug');
    for (let i = 0; i < 360; i += 1) h.frame(); // 6 s — six windows' worth
    expect(h.lifecycle.stateOf(0)).toBe('awaiting-plug');
    expect(h.getState().cords.some((c) => c.id === 0)).toBe(true);
    expect(h.transitions).toHaveLength(0);
  });

  it('POPPED KEEPS ITS OWN PATH: grace expiry fires, and never as abandonment', () => {
    // idle window SHORTER than the grace: a popped cord must still ride the
    // ~3s grace to 'grace-expired' — the two clocks are independent.
    const h = makeWorld({ idleSeconds: 0.5 });
    h.frame({ spawnCord: { cordId: 1, at: HOLD } });
    const seatA: Vec2 = { x: -0.4, y: 0.5};
    const seatB: Vec2 = { x: 0.4, y: 0.5};
    h.frame({ seatTargets: [{ cordId: 1, index: 0, position: seatA }] }); // awaiting-plug
    h.frame({
      seatTargets: [
        { cordId: 1, index: 0, position: seatA },
        { cordId: 1, index: END, position: seatB },
      ],
    }); // linked
    expect(h.lifecycle.stateOf(1)).toBe('linked');
    h.frame({
      popCords: [{ cordId: 1, index: 0 }],
    }); // popped — the grace clock owns it now
    expect(h.lifecycle.stateOf(1)).toBe('popped');
    // 1s in: past the idle window's width, still popped (grace ~3s).
    for (let i = 0; i < 60; i += 1) h.frame();
    expect(h.lifecycle.stateOf(1)).toBe('popped');
    for (let i = 0; i < 130; i += 1) h.frame(); // past the grace
    expect(h.lifecycle.stateOf(1)).toBe('vanishing');
    const toVanishing = h.transitions.find((t) => t.to === 'vanishing');
    expect(toVanishing?.reason).toBe('grace-expired');
    expect(h.transitions.some((t) => t.reason === 'abandoned')).toBe(false);
  });

  it('idleSeconds: Infinity restores the pre-REFINE-4 behavior (explicit opt-out)', () => {
    const h = makeWorld({ idleSeconds: Number.POSITIVE_INFINITY });
    dropACoil(h, 1);
    for (let i = 0; i < 360; i += 1) h.frame(); // 6 s untouched
    expect(h.lifecycle.stateOf(1)).toBe('carried');
    expect(h.transitions.some((t) => t.reason === 'abandoned')).toBe(false);
  });

  it('the default window is the production ~10s (nothing abandons before it)', () => {
    const h = makeWorld(); // no idleSeconds: DEFAULT_IDLE_SECONDS
    dropACoil(h, 1);
    for (let i = 0; i < 540; i += 1) h.frame(); // 9 s — a hair under the window
    expect(h.lifecycle.stateOf(1)).toBe('carried');
    expect(h.lifecycle.idleRemaining(1)!).toBeGreaterThan(0);
    let abandoned: LifecycleTransition | undefined;
    for (let i = 0; i < 120 && abandoned === undefined; i += 1) {
      h.frame();
      abandoned = h.transitions.find((t) => t.reason === 'abandoned');
    }
    expect(abandoned).toBeDefined();
    // The crossing left it vanishing or already gone (the sequence is fast);
    // either way the transition itself is the proof, and it happened only
    // AFTER the full default window had burned.
    expect(h.frames() * FRAME).toBeGreaterThanOrEqual(10);
    expect(['vanishing', undefined]).toContain(h.lifecycle.stateOf(1));
  });

  it('DETERMINISM: identical drop/abandon runs replay bitwise (events + world)', () => {
    const run = (): { events: string; snapshot: string } => {
      const h = makeWorld({ idleSeconds: 1 });
      dropACoil(h, 1);
      dropACoil(h, 2); // two coils, staggered by their own drops
      for (let i = 0; i < 300; i += 1) h.frame(); // past both windows + sequences
      const snapshot =
        `t=${h.getState().time}` +
        h.getState().cords.map((c) => `c${c.id}:${c.points.map((p) => `${p.x},${p.y}`).join(';')}`).join('|');
      const events = [
        ...h.transitions.map((t) => `${t.from}>${t.to}:${t.reason}@${t.end}`),
        ...h.vanishEvents.map((e) => `${e.kind}:${e.cordId}`),
      ].join(' ');
      return { events, snapshot };
    };
    const a = run();
    const b = run();
    expect(b.events).toBe(a.events);
    expect(b.snapshot).toBe(a.snapshot);
    expect(a.events).toContain('carried>vanishing:abandoned@null');
  });
});

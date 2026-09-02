import type { Vec3 } from './types';

/**
 * T-LIFE-2 — the VANISH SEQUENCE CHOREOGRAPHY, phase half (Hulk, LIFE lane).
 * The approved behavior, in the user's own words (the toy's signature
 * moment): when a cord fails — a carried end released off-cube, or the popped
 * grace expiring — the end FALLS to the ground, the jack SHATTERS, the cord
 * PULLS OUT of the seated cube, and the whole cord VANISHES.
 *
 * This module is the PURE PHASE MACHINE: plain data in, plain decisions out,
 * no three.js, no DOM, no wall-clock, no RNG (check:sim scans it). The WORLD
 * STEP (cordWorld.ts) owns the application — it observes the failing end,
 * feeds the observation here, and executes the returned actions against the
 * rope/lifecycle through the same primitives everything else uses:
 *
 *   FALL   the failing end becomes a FREE ROPE END (the world releases the
 *          carry — rope.releaseCarry, T-LIFE-2) and gravity + the existing
 *          floor clamp bring it down. There is NO scripted fall anywhere:
 *          the phase only WATCHES the end's height. Phase ends at FIRST
 *          FLOOR CONTACT (endY ≤ floorY + contactOffset — the plug rests on
 *          its grip radius, so "contact" means within a grip of the bench)
 *          or at the fall timeout (the totality guard: a floorless or
 *          pathological world still completes — see fallTimeoutSeconds).
 *   SHATTER  instant on contact (one action, exactly once per sequence —
 *          `shattered` latches): the impact point is captured and the
 *          shatter/pull window opens. The RENDER reacts (dark fragment
 *          particles at the impact point; the end jack's mesh despawns with
 *          them) — this module only decides WHEN and WHERE.
 *   PULL-OUT the same step the shatter fires: the cord's OTHER end unseats
 *          (the world pairs the machine's vanishing-locked unseat with
 *          rope.unseat — the pullOutDuringVanish seam) and the cord is
 *          given a COLLAPSE IMPULSE toward the impact point (every point's
 *          velocity aimed at the shatter, speed proportional to its
 *          distance — the far plug whips in, points at the point barely
 *          move). The rope's own distance constraints + damping carry the
 *          retraction: the motion is the solver's, never a keyframe.
 *   VANISH  the pull window runs pullSeconds while the render fades the cord
 *          out; at its end the sequence reports COMPLETION and the world
 *          applies the despawn through the SAME completeVanish path the
 *          `despawnCords` intent takes (LIFE-1's exit contract) — registry,
 *          rope, and world.cords snapshot all drop, the scene is clean.
 *
 * TIMING (all tunable here, measured at the production geometry in
 * cordWorldVanish.test.ts): the fall is physics-speed — ~0.3–0.6 s for
 * typical in-scene heights, longer only against constraint drag; the shatter
 * is instant; the pull+vanish window is pullSeconds (0.35 s) so failure feels
 * decisive, not drawn out. Both entry paths reuse the EXACT same sequence:
 * a grace-expiry cord's popped jack "falls from where it dangles" — usually
 * it already dangles ON the floor (it had the whole ~3 s grace to fall), so
 * its first observation reads contact and the shatter is immediate.
 *
 * DETERMINISM: the phase machine is a pure function of (run, args) and the
 * run mutates only plain scalars — identical inputs produce identical
 * actions, and the world's application of them is deterministic (insertion
 * order, no RNG). The A11Y-1 SEAM: nothing here needs a reduced-motion
 * branch (the phases are physics observations), but the timings are options
 * and the FRAGMENT effect is the render's — the composition passes a
 * `reduced` flag to the render's shatter (skip/simplify particles) and may
 * shorten pullSeconds; both seams are documented in main.ts.
 */

/** The pull-out + fade window, in seconds of sim time. Default 0.35. */
export const DEFAULT_VANISH_PULL_SECONDS = 0.35;
/**
 * The collapse impulse speed at MAXIMUM distance (world units/second): the
 * far plug — up to one total cord length from the shatter point — enters the
 * window at this speed; nearer points proportionally less. 8 u/s covers a
 * full 2.4 u cord inside the 0.35 s window under the rope's damping.
 */
export const DEFAULT_VANISH_PULL_SPEED = 8;
/**
 * Totality guard on the fall, in seconds of sim time: if the failing end has
 * not reached the floor by now (a floorless world, or a pathological
 * high-dangle rest the cord's own length cannot reach past), the shatter
 * fires anyway so the sequence always completes.
 *
 * T-REN-5 (the LIFE-2 verifier's carry-forward, resolved): the old 1.2s
 * budget fired MID-AIR (y≈1.4–1.5) on the extreme y≈3 release class (a
 * lifted cube's socket + the leash limit). Widened to 1.55s — the MAXIMUM
 * that keeps the < 2s sequence bound (1.55 + 0.35 = 1.90). Verifier-measured
 * effect at this budget (headless, production 2.4 cord): the landing class
 * rises to ≲y1.6, and the y≈3 guard shatter lands lower (mid-air y≈1.0).
 * A TRUE y≈3 landing cannot fit the bound: the sim's actual descent drag is
 * ≈2.2× ideal gravity (the earlier "1.55×" figure was a time ratio, not a
 * distance ratio), so such a fall needs ≈1.95s + the 0.35s pull — the guard
 * is the sanctioned behavior for that extreme, per the LIFE-2 verifier's
 * original ruling.
 */
export const DEFAULT_VANISH_FALL_TIMEOUT_SECONDS = 1.55;
/**
 * "Floor contact" tolerance above the floor plane, in world units: the plug
 * rests on its GRIP RADIUS (~0.055), so the end's point is "on the ground"
 * when it is within a grip of the bench. Grace-expiry rests read contact on
 * the first observation; a falling jack shatters the frame it visually
 * lands.
 */
export const DEFAULT_VANISH_CONTACT_OFFSET = 0.05;

/** One choreography event, emitted by the WORLD in deterministic order. */
export type VanishEventKind = 'start' | 'shatter' | 'pull' | 'complete';

export interface VanishEvent {
  readonly cordId: number;
  readonly kind: VanishEventKind;
  /**
   * The end the event concerns: the FAILING end for start/shatter, the
   * PULLED (previously seated) end for pull, null for complete. The
   * composition keys its bookkeeping on this (proxy unregistration, the
   * same-frame seat-latch drop).
   */
  readonly end: number | null;
  /** The impact point (shatter/pull: the collapse target); null otherwise. */
  readonly at: Vec3 | null;
  /** The lifecycle machine's sim clock at the event (advanced by advance()). */
  readonly time: number;
}

export interface VanishOptions {
  /** Pull-out + fade window in seconds. Default DEFAULT_VANISH_PULL_SECONDS. */
  pullSeconds?: number;
  /** Collapse impulse speed (u/s) at max distance. Default DEFAULT_VANISH_PULL_SPEED. */
  pullSpeed?: number;
  /** Fall totality guard in seconds. Default DEFAULT_VANISH_FALL_TIMEOUT_SECONDS. */
  fallTimeoutSeconds?: number;
  /** Floor-contact tolerance in world units. Default DEFAULT_VANISH_CONTACT_OFFSET. */
  contactOffset?: number;
  /** Choreography events (start → shatter → pull → complete, once each). */
  onEvent?: (event: VanishEvent) => void;
}

/** Fail-fast-resolved options (programmer error throws at world construction). */
export interface ResolvedVanishOptions {
  readonly pullSeconds: number;
  readonly pullSpeed: number;
  readonly fallTimeoutSeconds: number;
  readonly contactOffset: number;
  readonly onEvent?: (event: VanishEvent) => void;
}

export function resolveVanishOptions(options: VanishOptions): ResolvedVanishOptions {
  const pullSeconds = options.pullSeconds ?? DEFAULT_VANISH_PULL_SECONDS;
  const pullSpeed = options.pullSpeed ?? DEFAULT_VANISH_PULL_SPEED;
  const fallTimeoutSeconds =
    options.fallTimeoutSeconds ?? DEFAULT_VANISH_FALL_TIMEOUT_SECONDS;
  const contactOffset = options.contactOffset ?? DEFAULT_VANISH_CONTACT_OFFSET;
  if (!Number.isFinite(pullSeconds) || pullSeconds <= 0) {
    throw new Error(`vanish: pullSeconds must be a positive finite number, got ${pullSeconds}`);
  }
  if (!Number.isFinite(pullSpeed) || pullSpeed <= 0) {
    throw new Error(`vanish: pullSpeed must be a positive finite number, got ${pullSpeed}`);
  }
  if (!Number.isFinite(fallTimeoutSeconds) || fallTimeoutSeconds <= 0) {
    throw new Error(
      `vanish: fallTimeoutSeconds must be a positive finite number, got ${fallTimeoutSeconds}`,
    );
  }
  if (!Number.isFinite(contactOffset) || contactOffset < 0) {
    throw new Error(`vanish: contactOffset must be a finite number >= 0, got ${contactOffset}`);
  }
  return { pullSeconds, pullSpeed, fallTimeoutSeconds, contactOffset, onEvent: options.onEvent };
}

/** The live phase names ('shatter' is an instant inside the fall→pull crossing). */
export type VanishPhase = 'fall' | 'pull';

/** What the composition/render may read per frame (REN-5 fades on progress). */
export interface VanishInfo {
  readonly phase: VanishPhase;
  /** 0..1 through the PULL window (0 during the fall — physics owns that). */
  readonly progress: number;
}

/** One cord's in-flight sequence (created at the → vanishing transition). */
export interface VanishRun {
  readonly cordId: number;
  /** The failing end (0 or segmentCount): the one that falls and shatters. */
  readonly failEnd: number;
  phase: VanishPhase;
  /** Seconds spent in the CURRENT phase (sim time). */
  phaseElapsed: number;
  /** Seconds since sequence entry (the fall-timeout clock). */
  fallElapsed: number;
  /** Latched at the shatter — the sequence shatters EXACTLY once. */
  shattered: boolean;
  /** The impact point, captured at the shatter (the collapse target). */
  readonly at: Vec3;
}

export function beginVanishRun(cordId: number, failEnd: number): VanishRun {
  return {
    cordId,
    failEnd,
    phase: 'fall',
    phaseElapsed: 0,
    fallElapsed: 0,
    shattered: false,
    at: { x: 0, y: 0, z: 0 },
  };
}

/** What the world must DO this step (consumed in order, then discarded). */
export type VanishAction =
  /** Fire the shatter at `at` (exactly once per run): fragments + jack despawn. */
  | { readonly kind: 'shatter'; readonly at: Vec3 }
  /** Unseat the other end + collapse-impulse the rope toward the shatter point. */
  | { readonly kind: 'pull-out' }
  /** Report completion → completeVanish → the cord leaves the world. */
  | { readonly kind: 'complete' };

export interface VanishStepArgs {
  /** The step's fixed slice (sim time). Non-positive/non-finite holds the run. */
  readonly dt: number;
  /** The failing end's CURRENT point (observed by the world from the rope). */
  readonly endX: number;
  readonly endY: number;
  readonly endZ: number;
  /** The cord's floor plane, or null in a floorless world (timeout carries it). */
  readonly floorY: number | null;
  readonly options: ResolvedVanishOptions;
}

/**
 * Advances one run by `dt` and returns the actions for THIS step. Pure over
 * (run, args): the fall phase only decides (contact observed? timeout?);
 * the pull phase is a plain timer. `shatter` and `pull-out` arrive together
 * on the crossing step (the choreography's order: the jack shatters, THEN
 * the cord pulls out — the same frame reads as one decisive instant).
 */
export function stepVanishRun(run: VanishRun, args: VanishStepArgs): VanishAction[] {
  const actions: VanishAction[] = [];
  const { options } = args;
  if (!(args.dt > 0) || !Number.isFinite(args.dt)) return actions; // clock garbage: hold
  if (run.phase === 'fall') {
    run.fallElapsed += args.dt;
    const contact =
      args.floorY !== null && args.endY <= args.floorY + options.contactOffset;
    if (contact || run.fallElapsed >= options.fallTimeoutSeconds) {
      run.phase = 'pull';
      run.phaseElapsed = 0;
      run.shattered = true;
      run.at.x = args.endX;
      run.at.y = args.endY;
      run.at.z = args.endZ;
      actions.push({ kind: 'shatter', at: { x: args.endX, y: args.endY, z: args.endZ } });
      actions.push({ kind: 'pull-out' });
    }
    return actions;
  }
  run.phaseElapsed += args.dt;
  if (run.phaseElapsed >= options.pullSeconds) {
    actions.push({ kind: 'complete' });
  }
  return actions;
}

/** The read-side projection (the world exposes it through the lifecycle view). */
export function vanishInfoOf(run: VanishRun, options: ResolvedVanishOptions): VanishInfo {
  const progress =
    run.phase === 'pull' ? Math.min(1, run.phaseElapsed / options.pullSeconds) : 0;
  return { phase: run.phase, progress };
}

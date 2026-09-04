import type {
  CordDespawnInput,
  CordState,
  CordPopInput,
  PinTargetInput,
  ReleaseJackInput,
  SeatInput,
  SimInput,
  SimState,
  SimStep,
  SpawnCordInput,
  Vec2,
} from './types';
import { createVerletRope, resolveRopeConfig } from './rope';
import type { RopeConfig } from './rope';
import { applyBrushToRope, resolveBrushOptions } from './brush';
import type { BrushOptions, ResolvedBrushOptions } from './brush';
import { coilPoints, DEFAULT_COIL } from './coilSpawn';
import { createCordLifecycle } from './lifecycle';
import type {
  CordLifecycle,
  CordLifecycleOptions,
  CordLifecycleView,
} from './lifecycle';
import {
  beginVanishRun,
  resolveVanishOptions,
  stepVanishRun,
  vanishInfoOf,
} from './vanish';
import type {
  ResolvedVanishOptions,
  VanishAction,
  VanishEvent,
  VanishEventKind,
  VanishOptions,
  VanishRun,
} from './vanish';

/**
 * INT-4 — the multi-cord WORLD step: the registry-backed SimStep that owns N
 * ropes, spawns new ones from `SimInput.spawnCord`, and routes the carry and
 * seat intents per cord (`cordId`, absent = 0). This is the step the
 * composition root drives once INT-4 lands; the M1 single-cord
 * `createRopeSimStep` stays untouched beside it (its tests are the single-rope
 * regression net, and LIFE-1's formal world may replace both later). The
 * per-rope intent application is the SAME rope machinery and the SAME guard
 * structure ropeStep.ts uses — nothing here forks solver math:
 *
 * - CARRY (each entry of `input.pinTargets`): engages/updates the carry on
 *   the named end — except that INT-4 gives a carry intent on a SEATED end
 *   its approved meaning: UN-SEAT-AND-GRAB. Re-grabbing a plugged jack (or
 *   the still-pinned M1 anchor) pulls it out of its socket and into the
 *   hand: `rope.unseat(index)` then the ordinary `carryEnd`/`setPinTarget`
 *   path. The un-seat is gentle by construction — the released point
 *   re-enters integration at rest, so the cord keeps hanging from its other
 *   seated end (or falls under damping when nothing else pins). Callers must
 *   stop sending a seated end's SEAT latch when they grab it (the
 *   composition root does, in the same event); a carry intent that arrives
 *   while the end is seated is by definition the un-seat.
 * - SEAT (each entry of `input.seatTargets`): exactly the singular field's
 *   semantics per cord — a non-seated endpoint plugs (the settle runs), an
 *   already-seated index transports (the dragged rectangle's socket), repeats
 *   are no-ops, the still-pinned anchor is ignored (it only becomes
 *   seatable after `unseat` releases it).
 * - SPAWN (`input.spawnCord`): a NEW cord appears coiled at `at` (see
 *   coilSpawn.ts) with its RED end (point 0) already a carried pin held at
 *   the spawn point and its BLUE end free to trail; the springy uncoil is
 *   the sim's (gravity + the compressed coil), never keyframes. The spawn is
 *   IDEMPOTENT on its caller-owned `cordId` — the fixed-timestep driver
 *   replays the same input across a frame's substeps, and the duplicate-id
 *   guard turns every replay after the first into a no-op. Garbage requests
 *   (malformed id, non-finite position), duplicate ids, and an at-cap world
 *   are IGNORED — the step stays total.
 *
 * T-LIFE-1 — THE LIFECYCLE FSM rides the same intent stream (see
 * lifecycle.ts for the approved transition table). The world owns one
 * `CordLifecycle` machine (per-cord records, grace clocks, transition +
 * rejection events) and gates every intent through it, so machine and rope
 * can never disagree: the machine validates FIRST, and only an APPLIED
 * transition mutates the rope.
 *
 * - Every spawn REGISTERS its cord as `carried` (red end carrying, blue
 *   free); the anchor cord registers `awaiting-plug` (its pin is seated by
 *   construction).
 * - SEAT intents route through the machine: transport on a seated end stays
 *   a rope-only no-transition latch (legal even while vanishing — until
 *   LIFE-2's choreography pulls the plug in its own event, after which the
 *   composition drops the latch, the same-frame discipline INT-6 set); a
 *   fresh seat is the approved carried→awaiting-plug / awaiting-plug→linked
 *   / popped→linked transition.
 * - CARRY intents on a SEATED end are the AMENDED manual un-plug (approved
 *   #7/#8, the coordinator ruling — INT-4's re-grab-a-seated-jack stands):
 *   the machine applies the unseat transition and the rope releases the
 *   seat in lockstep, then the ordinary SIM-2 carry takes the jack into the
 *   hand. A carry intent naming anything on a VANISHING cord is IGNORED
 *   entirely (T-LIFE-2: the choreography owns the cord's every end from the
 *   moment it starts — a replayed latch must not re-grab the failing end
 *   mid-fall).
 * - POP intents (`input.popCords`, INT-6's seam) apply the approved #4
 *   linked→popped transition: the named end's seat is released and the grace
 *   clock starts.
 * - T-INT-6 — OVER-STRETCH AUTO-UNPLUG (config-gated, `overStretch`): every
 *   step, each LINKED cord's two seated pins are measured against the cord's
 *   total rest length; crossing the threshold fires the SAME approved #4
 *   through the SAME applyPop path the input intents use (a synthesized
 *   `CordPopInput`). See detectOverStretch below for the exact rule.
 * - RELEASE (`input.releaseJack`) is the user-initiated failure routing:
 *   awaiting-plug/popped + the end in hand → vanishing; carried → the
 *   ordinary drop (no transition).
 * - COMPLETION (`input.despawnCords`) is only accepted while `vanishing`;
 *   it removes the cord from the world (registry, state snapshot, step
 *   loop) — the FSM locks the cord until it arrives.
 * - T-LIFE-2 — THE VANISH CHOREOGRAPHY (config-gated, `vanish`; see
 *   vanish.ts): every cord that ENTERS `vanishing` runs the approved
 *   sequence — fall (the failing end released to gravity), shatter on first
 *   floor contact (exactly once), pull-out (the other end unseats + a
 *   collapse impulse toward the impact point), and, after the pull window,
 *   an AUTOMATIC completion report through the same applyDespawn path the
 *   intent takes. An explicit `despawnCords` still works at any point of
 *   the sequence (the run drops silently — the machine's acceptance is the
 *   only gate). ABSENT config = LIFE-1 behavior byte-for-byte: vanishing
 *   cords sit locked until an explicit report.
 * - The grace clock advances ONCE per step with the driver's fixed slice
 *   (sim time, never wall-clock): a backgrounded-tab spike is clamped by the
 *   fixed-timestep driver, so the ~3s window cannot be burned by clamped
 *   frames. Expiry fires popped→vanishing; a re-seat cancels.
 * - REFINE-4 — THE ABANDONMENT SWEEP + IDLE WINDOW: the world retires an
 *   end's stale 'carrying' mode the step its carry targets stop arriving
 *   (the sweep, below), and the machine's idle clock — same sim-time
 *   discipline as the grace clock, per cord — counts an untouched `carried`
 *   coil down to approved #9 (carried→vanishing, reason 'abandoned'; default
 *   window ~10s, `lifecycle.idleSeconds`). The cord then runs the SAME
 *   LIFE-2 sequence (a grounded coil's "fall" is first contact — the decay
 *   reads as powering down, nothing teleports), and the composition speaks
 *   its own line ("Cord put away.", distinct from the shattered failure).
 *   A cord in hand NEVER idles: carry intents reset the window every step,
 *   and GRABBING cancels it instantly (noteCarrying's reset).
 * - T-INT-5 — THE PASSIVE CURSOR-BRUSH (`input.brush`, see brush.ts): every
 *   frame the pointer MOVED, each live cord's FREE points inside the halo
 *   around the cursor POINT take a small additive velocity impulse away from
 *   the cursor (cosine falloff; radius/strength tunable on `CordWorldConfig.
 *   brush`, defaults in brush.ts). ONE pass per NEW move-counter value — the
 *   driver's substep replays of one input are idempotent, and an idle
 *   pointer (no `brush` composed) injects nothing even when a swinging cord
 *   passes through the cursor point (Thor's zero-idle-cost rule). PINS WIN —
 *   seated, carried, and anchored ends are skipped. VANISHING CORDS ARE
 *   STILL BRUSHABLE (documented call): the sequence is contact/time-driven
 *   and its completion is guaranteed by the fall-timeout totality guard, so
 *   body impulses cannot derail it — a dying cord swept on its way out keeps
 *   dying on schedule while its body reacts.
 *
 * 2D PIVOT (town-hall Revision 2): Vec2 points, the leash projects onto a
 * CIRCLE, the over-stretch detector measures planar separation, the brush
 * halo is a circle around the cursor point. Every behavioral law identical.
 *
 * Zero steady-state allocation: entries and point shells are preallocated
 * per cord and mutated in place; only a spawn allocates (a new rope, its
 * shells — an event, not a frame path). Deterministic: the step is a pure
 * function of (initial world, call sequence); intent application order is
 * insertion order and per-rope work is independent, so N ropes cannot
 * disturb each other (pinned bitwise in cordWorld.test.ts).
 */

/**
 * T-INT-6 — the over-stretch auto-unplug trigger's tuning (see
 * `CordWorldConfig.overStretch`). Presence of the object ENABLES the
 * detector; an absent/undefined `overStretch` leaves the world at its
 * T-LIFE-1 behavior (only explicit `popCords` intents pop — the manual-pop
 * tests and any world that has not opted in are untouched).
 */
export interface OverStretchOptions {
  /**
   * The fraction of the cord's TOTAL REST LENGTH (segmentCount ×
   * segmentLength) by which the two seated pins' separation may exceed the
   * length before the FAR jack pops: a linked cord fires when
   * separation ≥ total × (1 + threshold). Tunable per the approved scope
   * ("~2–5%"); must be a finite number in (0, 1). The SIM-2 leash's
   * machine-epsilon overshoot (≤ ~1e-9 over total) can NEVER reach the bound
   * at any legal threshold — the detector does not need, and has no, an
   * extra epsilon. Default DEFAULT_OVERSTRETCH_THRESHOLD (0.04, 4%).
   */
  threshold?: number;
}

/** Default over-stretch threshold: 4% beyond total rest length (plan.md INT-6: ~2–5%). */
export const DEFAULT_OVERSTRETCH_THRESHOLD = 0.04;

export interface CordWorldConfig {
  /**
   * Overrides for the ANCHOR cord (id 0) — the M1 cord that hangs from its
   * original pin. Omit to start with an empty world (spawn-only).
   */
  anchor?: Partial<RopeConfig>;
  /**
   * Overrides for SPAWNED cords. `pin`/`pinIndex` are forced per spawn
   * (pinIndex 0 = the red end, `pin` = the grab point); everything else
   * (segment count/length, gravity, damping, floor) applies to every spawn.
   */
  cord?: Partial<RopeConfig>;
  /**
   * Registry cap. Spawning past it is ignored. Default 48 (2D-7's raised
   * ceiling; v1's "render pool capacity" rationale was a 3D leftover — Canvas
   * 2D has no such pool, so 16 was an inherited number, now honest at 48).
   */
  maxCords?: number;
  /**
   * T-LIFE-1 — options for the world's lifecycle machine: grace window,
   * strict mode (tests: illegal transitions THROW; production default:
   * reject with a warning event), and the event subscriptions. The machine
   * itself is created inside the world and exposed read-only on the step
   * (`step.lifecycle`).
   */
  lifecycle?: CordLifecycleOptions;
  /**
   * T-INT-6 — the over-stretch auto-unplug detector (see OverStretchOptions).
   * ABSENT = DISABLED: the world keeps its T-LIFE-1 behavior (pops arrive
   * only as explicit `popCords` intents). The production composition opts in;
   * tests construct either kind.
   */
  overStretch?: OverStretchOptions;
  /**
   * T-LIFE-2 — the VANISH CHOREOGRAPHY (see VanishOptions in vanish.ts):
   * fall → shatter → pull-out → vanish, per vanishing cord, with an automatic
   * completion report (the despawn) at sequence end. ABSENT = DISABLED: the
   * world keeps its T-LIFE-1 behavior byte-for-byte (vanishing cords sit
   * locked until an explicit `despawnCords` intent — every pre-LIFE-2 test
   * constructs exactly that world). The production composition opts in.
   */
  vanish?: VanishOptions;
  /**
   * T-INT-5 — the passive cursor-brush feel-tunables (see BrushOptions in
   * brush.ts). UNLIKE overStretch/vanish, ABSENT IS NOT "disabled": the
   * brush is INPUT-gated, not config-gated — a world whose inputs never
   * carry `SimInput.brush` is bitwise its pre-INT-5 self (pinned by test),
   * so the defaults are safe to leave in. Bad values fail fast here.
   */
  brush?: BrushOptions;
}

/**
 * The world step plus its lifecycle read side: queries for the composition
 * (it refuses grabs of seated ends; REN-5 lights states; INT-6 reads
 * the grace clock) and LIFE-2's single choreography seam.
 */
export interface CordWorldStep extends SimStep {
  readonly lifecycle: CordLifecycleView;
}

interface CordEntry {
  readonly id: number;
  readonly rope: ReturnType<typeof createVerletRope>;
  readonly points: Vec2[];
  readonly cord: CordState;
  /**
   * T-LIFE-2 — this cord's floor line (from its rope template), the
   * choreography's contact reference. The Rope itself does not expose it.
   */
  readonly floorY: number | null;
  /**
   * T-INT-6 — the two seated pins' positions as of the previous detection
   * pass, for the FAR-END rule (which seat moved less). Written only while
   * the cord is linked (initialized at the seat that links it, dropped on
   * pop/un-seat); null in every other state. Plain scalars, zero allocation.
   */
  linkPrev: {
    ax: number; ay: number;
    bx: number; by: number;
  } | null;
}

export function createCordWorldStep(config: CordWorldConfig = {}): CordWorldStep {
  const maxCords = config.maxCords ?? 48;
  if (!Number.isInteger(maxCords) || maxCords < 1) {
    throw new Error(`cordWorld: maxCords must be an integer >= 1, got ${maxCords}`);
  }
  // Fail fast at construction on bad templates (programmer error), the same
  // discipline as every other config resolution in the core.
  const anchorTemplate = config.anchor === undefined ? undefined : resolveRopeConfig(config.anchor);
  const cordTemplate = config.cord ?? {};
  // T-LIFE-2 — the vanish choreography's tuning. Presence of `vanish`
  // ENABLES the sequencer; absent, the world is exactly its T-LIFE-1 self.
  const vanishOptions: ResolvedVanishOptions | null =
    config.vanish === undefined ? null : resolveVanishOptions(config.vanish);
  // T-INT-5 — the passive cursor-brush tunables (fail-fast; defaults when
  // absent — the feature is input-gated, see CordWorldConfig.brush).
  const brushOptions: ResolvedBrushOptions = resolveBrushOptions(config.brush);
  // A11Y-1 — the reduced-motion dampening's EFFECTIVE pass options: the tuned
  // config with its strength multiplied by the input's `strengthScale` (the
  // composition's prefers-reduced-motion seam). One scratch object (a plain
  // mutable twin of ResolvedBrushOptions) refilled only when the scale
  // CHANGES (it flips rarely — zero allocation in steady state);
  // `brushScale` tracks the scale currently baked in, so the default path
  // (no scale field) never writes anything and is bitwise the pre-A11Y-1
  // pass.
  const brushPassOptions: { radiusRestLengths: number; strength: number } = {
    radiusRestLengths: brushOptions.radiusRestLengths,
    strength: brushOptions.strength,
  };
  let brushScale = 1;
  // T-INT-5 — the last consumed pointer-move counter. NaN initially, so the
  // first finite counter value (0 included) counts as a new move. Scalar
  // closure state: deterministic, zero allocation.
  let lastBrushMove = Number.NaN;
  // T-LIFE-2 — one in-flight sequence per vanishing cord, insertion-ordered
  // (deterministic). Runs are created at the → vanishing transition and
  // dropped at completion (or when any despawn removes the cord first).
  const vanishRuns = new Map<number, VanishRun>();
  const vanishScratch: Vec2 = { x: 0, y: 0 };
  // REFINE-4 — the abandonment sweep's per-step scratch: the (cordId, end)
  // keys this step's carry intents drive, membership-only. One reused Set —
  // cleared and refilled every step, allocation-free in steady state.
  const carrySeen = new Set<number>();
  // T-LIFE-1 — the lifecycle machine: validates every transition before the
  // rope hears about it (rejections leave the rope untouched, so the two can
  // never disagree). Its options flow in verbatim (grace, strict, events) —
  // EXCEPT that a configured choreography wraps onTransition to observe every
  // → vanishing entry (the sequencer must begin in the transition's own step,
  // with the event's `end` tag naming the failing end).
  const beginVanish = (cordId: number, end: number | null): void => {
    if (vanishOptions === null) return;
    const entry = entries.find((e) => e.id === cordId);
    if (entry === undefined) return; // already gone (a racing report): nothing to run
    if (vanishRuns.has(cordId)) return; // idempotent (the lock prevents a second entry)
    const N = entry.rope.segmentCount;
    let failEnd = end;
    if (failEnd !== 0 && failEnd !== N) {
      // Totality over upstream event shapes: the failing end is the one that
      // is NOT seated (both real triggers tag the end correctly; this only
      // covers a hand-rolled transition event with a null/garbage end tag).
      // REFINE-4 — the 'abandoned' transition tags null BY DESIGN: a dropped
      // coil has NO seat to fail, so the derivation lands on end 0 (the red
      // input end leads the decay — deterministic, and the band shard the
      // shatter throws is the coil's own red).
      failEnd = lifecycle.endMode(cordId, 0) === 'seated' ? N : 0;
    }
    vanishRuns.set(cordId, beginVanishRun(cordId, failEnd));
    // THE FALL IS THE SIM'S: a failing end still in the hand becomes a FREE
    // rope end (gravity + the existing floor clamp own the descent — there is
    // no scripted fall anywhere in this choreography). A popped/dangling end
    // is already free; wake covers the frozen-mid-air settled case.
    if (entry.rope.carriedIndex === failEnd) entry.rope.releaseCarry(failEnd);
    else if (
      entry.rope.carriedIndex !== null &&
      !entry.rope.isEndSeated(entry.rope.carriedIndex)
    ) {
      // REFINE-4 — an abandoned coil may still hold a STALE carry on its
      // other end (the rope keeps the frozen pin after a drop's targets
      // stopped; the machine's sweep retired the mode, the rope's slot
      // remained). The choreography owns every end from this moment: release
      // the stale pin so nothing on a dying cord is held by a hand that let
      // go. Seated ends are NOT touched — the pull-out owns those.
      entry.rope.releaseCarry(entry.rope.carriedIndex);
    }
    entry.rope.wake();
    emitVanish(cordId, 'start', failEnd, null);
  };
  const lifecycle: CordLifecycle = createCordLifecycle(
    vanishOptions === null
      ? config.lifecycle
      : {
          ...config.lifecycle,
          onTransition: (event) => {
            if (event.to === 'vanishing') beginVanish(event.cordId, event.end);
            config.lifecycle?.onTransition?.(event);
          },
        },
  );
  const emitVanish = (
    cordId: number,
    kind: VanishEventKind,
    end: number | null,
    at: Vec2 | null,
  ): void => {
    if (vanishOptions?.onEvent === undefined) return;
    const event: VanishEvent = { cordId, kind, end, at, time: lifecycle.now() };
    vanishOptions.onEvent(event);
  };

  const entries: CordEntry[] = [];
  const world: SimState = { time: 0, cords: [] };
  // Reused coil scratch — shells survive across spawns.
  const coilScratch: Vec2[] = [];
  // T-INT-6 — reused read scratch for the detector's two pin reads (and the
  // link-arming snapshot in applySeat). Zero per-step allocation.
  const scratchA: Vec2 = { x: 0, y: 0 };
  const scratchB: Vec2 = { x: 0, y: 0 };

  const spawnCord = (req: SpawnCordInput, dt: number): void => {
    if (!Number.isInteger(req.cordId) || req.cordId < 0) return; // garbage id: ignore
    const p = req.at;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    if (entries.length >= maxCords) return; // at cap: ignore (totality)
    if (entries.some((e) => e.id === req.cordId)) return; // idempotent per cordId
    const resolved = resolveRopeConfig({
      ...cordTemplate,
      pin: { x: p.x, y: p.y },
      pinIndex: 0, // the RED end is point 0
    });
    const rope = createVerletRope(resolved);
    // Spawn pose: a flat coil centered on the grab point. placeAlong zeroes
    // everything (all points at `at`); the coil then teleports the points
    // and the velocities are zeroed explicitly, so the ONLY energy in the
    // cord at birth is gravity + the coil's compression — the uncoil is the
    // solver's, never a placement pop and never keyframes.
    rope.placeAlong(p, p);
    coilPoints(p, resolved.segmentCount, resolved.segmentLength, DEFAULT_COIL, coilScratch);
    for (let i = 0; i <= resolved.segmentCount; i += 1) {
      const c = coilScratch[i];
      if (c !== undefined) rope.setPoint(i, c.x, c.y);
    }
    if (dt > 0 && Number.isFinite(dt)) {
      for (let i = 0; i <= resolved.segmentCount; i += 1) rope.setVelocity(i, 0, 0, dt);
    }
    // The RED end becomes the carried pin: release the spawn's anchor seat
    // (both ends of a fresh cord are free-to-grab — "either end"), engage
    // the carry exactly where the cord appeared (in hand on the spawn
    // frame), and let the composition's carry controller drive it from the
    // next frame. The BLUE end (point segmentCount) stays free: it trails.
    rope.unseat(0);
    rope.carryEnd(0);
    rope.setPinTarget(0, p);
    const points: Vec2[] = [];
    rope.writePointsTo(points);
    const cord: CordState = { id: req.cordId, points };
    entries.push({ id: req.cordId, rope, points, cord, floorY: resolved.floorY, linkPrev: null });
    world.cords.push(cord);
    // T-LIFE-1 — the lifecycle mirror: a spawned cord is BORN `carried` (red
    // end in hand, blue free). The spawn id is already unique here, so the
    // registration always applies.
    lifecycle.register(req.cordId);
    lifecycle.noteCarrying(req.cordId, 0);
  };

  // The anchor cord: the M1 hang — pinned at its configured pin, body
  // straight down (identical spawn pose to the M1 single-cord step). Its
  // lifecycle: `awaiting-plug` — the anchor is a seat BY CONSTRUCTION, the
  // other end free until grabbed.
  if (anchorTemplate !== undefined) {
    const rope = createVerletRope(anchorTemplate);
    const pin = anchorTemplate.pin;
    rope.placeAlong(
      pin,
      {
        x: pin.x,
        y: pin.y - anchorTemplate.segmentCount * anchorTemplate.segmentLength,
      },
    );
    const points: Vec2[] = [];
    rope.writePointsTo(points);
    const cord: CordState = { id: 0, points };
    entries.push({ id: 0, rope, points, cord, floorY: anchorTemplate.floorY, linkPrev: null });
    world.cords.push(cord);
    lifecycle.register(0, { seatedEnd: anchorTemplate.pinIndex });
  }

  // Carry intent → the named rope, gated by the lifecycle. A carry on a
  // SEATED end is the INT-4 un-seat-and-grab (restored by the coordinator
  // amendment — hand-pulled plugs are legal): the machine applies the
  // approved unseat transition (linked → awaiting-plug with the other seat
  // holding, awaiting-plug → carried) and only acceptance releases the
  // rope's seat, then the ordinary SIM-2 carry takes the jack into the
  // hand. Rejections leave the plug bitwise in its socket: POPPED's
  // surviving socket (its exits are the re-seat and the grace — the pop
  // must not be dodgeable). In a strict world the rejection THROWS; in
  // production it emits the warning event. T-LIFE-2: a VANISHING cord
  // ignores the intent ENTIRELY — the choreography owns both ends from the
  // moment it starts (a replayed carry latch must not re-grab the failing
  // end mid-fall), so the lock is checked first, before any rope mutation.
  // Free ends take the ordinary engage/update; noteCarrying books the
  // per-end mode (advisory — never a transition). Guards mirror ropeStep.ts
  // so the step stays total over upstream data (a garbage intent is ignored,
  // never fatal).
  const applyCarry = (entry: CordEntry, carry: PinTargetInput): void => {
    const rope = entry.rope;
    const index = carry.index;
    if (!Number.isInteger(index) || (index !== 0 && index !== rope.segmentCount)) return;
    if (lifecycle.stateOf(entry.id) === 'vanishing') return; // locked (T-LIFE-2)
    if (lifecycle.endMode(entry.id, index) === 'seated') {
      if (!lifecycle.unseat(entry.id, index)) return; // rejected: nothing moves
      rope.unseat(index); // the plug pulls out, in lockstep with the machine
      if (entry.linkPrev !== null) entry.linkPrev = null; // T-INT-6: not linked anymore
    }
    if (rope.isEndSeated(index) || (index === rope.pinnedIndex && !rope.anchorReleased)) {
      return; // unreachable while machine and rope agree — refuse, never fork
    }
    if (rope.carriedIndex !== index) rope.carryEnd(index);
    rope.setPinTarget(index, carry.position); // non-finite targets are ignored inside
    lifecycle.noteCarrying(entry.id, index);
  };

  // Seat/transport intent → the named rope, gated by the lifecycle. Same
  // semantics as the singular INT-2 field, PER END: an already-seated index
  // TRANSPORTS (the dragged rectangle's socket) — idempotent physics, NOT a
  // lifecycle transition, and legal even while vanishing (the seated plug
  // stays in its socket until LIFE-2 pulls it). A fresh seat is the approved
  // carried→awaiting-plug / awaiting-plug→linked / popped→linked transition:
  // the machine validates first, and only an APPLIED seat mutates the rope
  // (the machine's acceptance pairs exactly with rope.seat — no forked
  // state). The still-pinned anchor is transport-only (it is machine-seated
  // by construction; a seat intent on it is a no-op, as before).
  const applySeat = (entry: CordEntry, seatTo: SeatInput): void => {
    const rope = entry.rope;
    const index = seatTo.index;
    if (!Number.isInteger(index) || (index !== 0 && index !== rope.segmentCount)) return;
    if (index === rope.pinnedIndex && !rope.anchorReleased) return;
    if (rope.isEndSeated(index)) {
      rope.setSeatPosition(index, seatTo.position.x, seatTo.position.y);
      return;
    }
    const p = seatTo.position;
    if (!(Number.isFinite(p.x) && Number.isFinite(p.y))) return;
    if (lifecycle.seat(entry.id, index)) {
      rope.seat({ index, position: p });
      // T-INT-6 — the seat that LINKS the cord arms the far-end rule: both
      // seated pins' positions are captured NOW (zero displacement), so the
      // first detection pass after the link measures motion FROM the linked
      // rest, never from a stale pre-link pose.
      if (lifecycle.stateOf(entry.id) === 'linked') {
        entry.rope.readPoint(0, scratchA);
        entry.rope.readPoint(entry.rope.segmentCount, scratchB);
        entry.linkPrev = {
          ax: scratchA.x, ay: scratchA.y,
          bx: scratchB.x, by: scratchB.y,
        };
      }
    }
  };

  // T-LIFE-1 — the approved linked→popped trigger (INT-6 composes these;
  // tests may fire them directly). The machine validates (only a LINKED
  // cord's seated end pops) and opens the grace window; acceptance releases
  // the rope seat so the far jack dangles from the other.
  const applyPop = (entry: CordEntry, pop: CordPopInput): void => {
    if (lifecycle.pop(pop.cordId, pop.index, pop.reason)) {
      entry.rope.unseat(pop.index);
      if (entry.linkPrev !== null) entry.linkPrev = null; // T-INT-6: disarmed
    }
  };

  // T-INT-6 — THE OVER-STRETCH DETECTOR (config-gated; see OverStretchOptions).
  // Runs every step, AFTER the grace clock and any input pop intents, BEFORE
  // the carry/seat intents — the same point in the step where pops apply, so:
  // (a) a pop and its re-seat may still legally share a step (LIFE-1's
  // ordering), and (b) the pop's onTransition event reaches the composition
  // BEFORE this step's seat latch re-sends flow — the caller's same-frame
  // latch drop therefore lands in time (the LIFE-1 verifier's carry-over
  // note, honored).
  //
  // THE RULE (deterministic, documented):
  // - MEASURE: the two seated pins' PLANAR separation, read from the ROPE
  //   (the end points are re-exacted to their seats every step —
  //   enforcePins — so the read is bitwise the seats) vs the cord's total
  //   rest length (segmentCount × segmentLength).
  // - FIRE when separation ≥ total × (1 + threshold). The SIM-2 leash holds a
  //   carried end within total + ~1e-9 of the other hard pin, so a legal
  //   second seat LANDS below the bound at any supported threshold — the
  //   machine-epsilon overshoot can never fire. Over-stretch therefore only
  //   arises from seat TRANSPORT (a dragged rectangle) or a direct far seat.
  // - WHICH END POPS — THE FAR END: the seat that moved LESS since the
  //   previous detection pass (the stationary socket; the rectangle the hand
  //   is dragging keeps its plug — "drag rectangle A, cord A→B: B's plug
  //   pops", the town-hall's approved far-jack-pops rule). A stationary
  //   seat's latch re-sends a bitwise-identical transform (the INT-3 no-op),
  //   so its displacement is exactly 0 and the dragged side is > 0. EXACT
  //   TIES (both seats moved bitwise-equally — including both stationary,
  //   e.g. a second seat placed beyond reach by a non-leashed caller) pop
  //   the BLUE end (the higher index) — arbitrary but fixed.
  // - HYSTERESIS: the detector only examines LINKED cords. The pop itself
  //   moves the cord to `popped`, which the detector skips — an oscillating
  //   dragged rectangle can fire at most ONE pop per linked window ("don't
  //   re-arm while popped"). A re-seat re-arms by re-entering `linked` (with
  //   fresh linkPrev); if the cord is STILL over-stretched there, it pops
  //   again — honest (the geometry is genuinely past the bound).
  const detectOverStretch: (() => void) | null = (() => {
    const options = config.overStretch;
    if (options === undefined) return null; // not configured: detector off
    const threshold = options.threshold ?? DEFAULT_OVERSTRETCH_THRESHOLD;
    if (!Number.isFinite(threshold) || threshold <= 0 || threshold >= 1) {
      throw new Error(
        `cordWorld: overStretch.threshold must be a finite fraction in (0, 1), got ${threshold}`,
      );
    }
    // Scratch — the detector allocates nothing per step (one reused pop
    // shell, two reused Vec2 reads).
    const popShell: CordPopInput = { cordId: 0, index: 0, reason: 'over-stretch' };
    return (): void => {
      for (const entry of entries) {
        if (lifecycle.stateOf(entry.id) !== 'linked') continue; // hysteresis gate
        const rope = entry.rope;
        rope.readPoint(0, scratchA);
        rope.readPoint(rope.segmentCount, scratchB);
        const dx = scratchB.x - scratchA.x;
        const dy = scratchB.y - scratchA.y;
        const sep2 = dx * dx + dy * dy;
        const total = rope.segmentCount * rope.segmentLength;
        const bound = total * (1 + threshold);
        if (sep2 >= bound * bound) {
          // The FAR end pops: the seat that moved LESS since the last pass.
          const prev = entry.linkPrev;
          let far = rope.segmentCount; // tie (or no history): the blue end
          if (prev !== null) {
            const d0x = scratchA.x - prev.ax;
            const d0y = scratchA.y - prev.ay;
            const d0 = d0x * d0x + d0y * d0y;
            const dNx = scratchB.x - prev.bx;
            const dNy = scratchB.y - prev.by;
            const dN = dNx * dNx + dNy * dNy;
            if (d0 < dN) far = 0; // end 0 moved less: it is the far socket
          }
          popShell.cordId = entry.id;
          popShell.index = far;
          applyPop(entry, popShell);
          continue; // popped: no linkPrev update (it was dropped)
        }
        if (entry.linkPrev === null) {
          entry.linkPrev = {
            ax: scratchA.x, ay: scratchA.y,
            bx: scratchB.x, by: scratchB.y,
          };
        } else {
          const prev = entry.linkPrev;
          prev.ax = scratchA.x; prev.ay = scratchA.y;
          prev.bx = scratchB.x; prev.by = scratchB.y;
        }
      }
    };
  })();

  // T-LIFE-1 — the release routing (the composition replaces the interim M1
  // drop with this): the HELD jack was released not over a rectangle. No rope
  // mutation on either outcome — the carried pin keeps falling through
  // whatever carry targets still flow (LIFE-2 choreographs over it); the FSM
  // owns the LIFECYCLE consequence: awaiting-plug/popped → vanishing,
  // carried → drop.
  const applyRelease = (release: ReleaseJackInput): void => {
    lifecycle.releaseCarriedJack(release.cordId, release.index);
  };

  // T-LIFE-1 — the completion report (LIFE-2): only `vanishing` cords are
  // removed, and the removal is total — registry entry, rope (GC), and the
  // cord's snapshot in world.cords.
  const applyDespawn = (despawn: CordDespawnInput): void => {
    if (!lifecycle.completeVanish(despawn.cordId)) return;
    vanishRuns.delete(despawn.cordId); // T-LIFE-2: an explicit report ends any sequence
    const entryIndex = entries.findIndex((e) => e.id === despawn.cordId);
    if (entryIndex >= 0) entries.splice(entryIndex, 1);
    const cordIndex = world.cords.findIndex((c) => c.id === despawn.cordId);
    if (cordIndex >= 0) world.cords.splice(cordIndex, 1);
  };

  // T-LIFE-2 — THE PULL-OUT, the one un-seat the vanish lock permits: the
  // machine's vanishing-only mode bookkeeping PAIRED with rope.unseat. The
  // same body serves the manual seam (`pullOutDuringVanish`, LIFE-1's
  // contract) and the choreography's pull action — one law, two callers.
  const pullOutSeat = (entry: CordEntry, index: number): void => {
    if (lifecycle.stateOf(entry.id) !== 'vanishing') return; // inert outside the lock
    if (lifecycle.unseat(entry.id, index)) entry.rope.unseat(index);
  };

  // T-LIFE-2 — THE COLLAPSE IMPULSE: every point's velocity aimed at the
  // impact point, speed proportional to its distance (clamped to pullSpeed).
  // The far plug whips toward the shatter; points already at the point
  // barely move. The rope's own distance constraints + damping carry the
  // retraction from here — the solver's motion, never a keyframe.
  const applyCollapseImpulse = (entry: CordEntry, at: Vec2, pullSpeed: number, dt: number): void => {
    const rope = entry.rope;
    const total = rope.segmentCount * rope.segmentLength;
    const points = entry.points; // the last-written snapshot == the live rope here
    for (let i = 0; i < points.length; i += 1) {
      const p = points[i];
      const dx = at.x - p.x;
      const dy = at.y - p.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 1e-9) continue; // already at the point: nothing to pull
      const s = Math.min(1, d / total) * pullSpeed;
      rope.setVelocity(i, (dx / d) * s, (dy / d) * s, dt);
    }
  };

  // T-LIFE-2 — THE CHOREOGRAPHY'S PULSE, once per step (after the release
  // intent, BEFORE carries/seats — so a pull action's event reaches the
  // composition before this step's seat-latch re-sends flow: the caller's
  // same-frame latch drop lands in time, exactly like INT-6's pop). Runs
  // only when `vanish` is configured and a sequence is in flight; a run
  // whose cord left the world any other way drops silently.
  const vanishAdvance = (dt: number): void => {
    if (vanishOptions === null || vanishRuns.size === 0) return;
    for (const run of vanishRuns.values()) {
      const entry = entries.find((e) => e.id === run.cordId);
      if (entry === undefined || lifecycle.stateOf(run.cordId) !== 'vanishing') {
        vanishRuns.delete(run.cordId); // gone by another hand: drop the run
        continue;
      }
      entry.rope.readPoint(run.failEnd, vanishScratch);
      const actions: VanishAction[] = stepVanishRun(run, {
        dt,
        endX: vanishScratch.x,
        endY: vanishScratch.y,
        floorY: entry.floorY,
        options: vanishOptions,
      });
      for (const action of actions) {
        if (action.kind === 'shatter') {
          // Instant, exactly once (the run's `shattered` latch). The impact
          // point is the collapse target for the pull that follows.
          emitVanish(run.cordId, 'shatter', run.failEnd, { x: action.at.x, y: action.at.y });
        } else if (action.kind === 'pull-out') {
          // The cord pulls out of its seated rectangle: the OTHER end unseats
          // (the lock-permitted pull) and the collapse impulse reels the
          // body toward the shatter point.
          const other = run.failEnd === 0 ? entry.rope.segmentCount : 0;
          if (lifecycle.endMode(run.cordId, other) === 'seated') {
            pullOutSeat(entry, other);
            if (entry.linkPrev !== null) entry.linkPrev = null;
          }
          applyCollapseImpulse(entry, run.at, vanishOptions.pullSpeed, dt);
          emitVanish(run.cordId, 'pull', other, { x: run.at.x, y: run.at.y });
        } else {
          // Sequence end: the completion report goes through the SAME
          // applyDespawn an explicit `despawnCords` intent takes (LIFE-1's
          // exit contract) — the machine's acceptance is the only gate.
          emitVanish(run.cordId, 'complete', null, null);
          vanishRuns.delete(run.cordId);
          applyDespawn({ cordId: run.cordId });
        }
      }
    }
  };

  // T-LIFE-1 — the read side: composition/render/interaction queries plus
  // LIFE-2's pull-out seam (machine un-seat + rope un-seat in lockstep).
  // The seam is LIFE-2's EXCLUSIVE channel and lives entirely inside the
  // vanish lock: outside `vanishing` it is INERT (no un-seat, no rejection —
  // the hand-pulled plug goes through the carry intent instead).
  const lifecycleView: CordLifecycleView = {
    stateOf: (cordId) => lifecycle.stateOf(cordId),
    endMode: (cordId, index) => lifecycle.endMode(cordId, index),
    graceRemaining: (cordId) => lifecycle.graceRemaining(cordId),
    idleRemaining: (cordId) => lifecycle.idleRemaining(cordId),
    vanishInfo: (cordId) => {
      if (vanishOptions === null) return null;
      const run = vanishRuns.get(cordId);
      return run === undefined ? null : vanishInfoOf(run, vanishOptions);
    },
    pullOutDuringVanish: (cordId, index) => {
      const entry = entries.find((e) => e.id === cordId);
      if (entry === undefined) return;
      pullOutSeat(entry, index);
    },
  };

  const step = (state: SimState, dt: number, input: SimInput): SimState => {
    const spawn = input.spawnCord;
    if (spawn !== null && spawn !== undefined) spawnCord(spawn, dt);
    // Completion reports first: a cord whose sequence finished THIS frame is
    // gone before the grace clock runs (deterministic — the report can only
    // exist after the lock, which only grace expiry or a release opens).
    const despawns = input.despawnCords;
    if (despawns !== null && despawns !== undefined) {
      for (let k = 0; k < despawns.length; k += 1) applyDespawn(despawns[k]);
    }
    // The grace clock: sim time only, one fixed slice per step — the
    // fixed-timestep driver's clamp bounds how much grace a frame can burn.
    lifecycle.advance(dt);
    const pops = input.popCords;
    if (pops !== null && pops !== undefined) {
      for (let k = 0; k < pops.length; k += 1) {
        const pop = pops[k];
        const entry = entries.find((e) => e.id === pop.cordId);
        if (entry !== undefined) applyPop(entry, pop);
      }
    }
    // T-INT-6 — the over-stretch detector, at the pops point of the step
    // (before carries/seats: a pop's onTransition latch-drop lands before
    // this step's seat latch re-sends flow). Null when not configured.
    if (detectOverStretch !== null) detectOverStretch();
    const release = input.releaseJack;
    if (release !== null && release !== undefined) applyRelease(release);
    // T-LIFE-2 — the vanish choreography's pulse: begins sequences opened by
    // this step's release/grace transitions (the wrapped onTransition) and
    // advances the ones in flight — before carries/seats, so a pull event's
    // same-frame latch drop beats this step's seat re-sends. Null when not
    // configured; a no-op when nothing is vanishing.
    vanishAdvance(dt);
    // T-INT-5 — consume the passive cursor-brush: ONE impulse pass per NEW
    // pointer-move counter value. The driver replays this same input object
    // across the frame's substeps — the counter makes every replay after the
    // first a no-op — and an idle pointer (no `brush` composed, or the same
    // counter) never brushes, even when a swinging cord passes straight
    // through the cursor point (Thor's zero-idle-cost rule: impulses ride
    // MOVE events, never time). A garbage move counter or non-finite cursor
    // point consumes the move and brushes nothing (totality). Vanishing
    // cords are still brushable — the documented call; their pins win like
    // every cord's.
    let brushPoint: Vec2 | null = null;
    const brush = input.brush;
    if (brush !== null && brush !== undefined && Number.isFinite(brush.move)) {
      if (brush.move !== lastBrushMove) {
        lastBrushMove = brush.move;
        const c = brush.point;
        if (
          c !== null && c !== undefined &&
          Number.isFinite(c.x) && Number.isFinite(c.y)
        ) {
          brushPoint = c;
        }
        // A11Y-1 — resolve the frame's strength scale with the move (inside
        // the new-counter branch: the scale rides move events like the
        // point). Absent/garbage = 1; a changed scale refills the scratch
        // strength (config strength × scale) so the pass below stays
        // allocation-free.
        const rawScale = brush.strengthScale;
        const scale =
          typeof rawScale === 'number' && Number.isFinite(rawScale) && rawScale >= 0
            ? rawScale
            : 1;
        if (scale !== brushScale) {
          brushScale = scale;
          brushPassOptions.strength = brushOptions.strength * scale;
        }
      }
    }
    // REFINE-4 — THE ABANDONMENT SWEEP: retire an end's stale 'carrying' mode
    // the step its carry targets STOP arriving. The composition composes a
    // carry target EVERY frame it drives an end (a drag, a staged grab, a
    // drop still converging) — and composes NO pinTargets field at all the
    // frame nothing is driven; both shapes mean "nobody is driving this end"
    // now, and that is the honest moment the machine's idle-abandon count
    // OPENS (approved #9: a converging drop is still being carried, a settled
    // coil is idle). Placement is load-bearing, twice:
    // - AFTER the release routing: a held end's 'carrying' mode must survive
    //   until its `releaseJack` intent lands in this same step (the failure
    //   release fires on a frame whose input no longer carries the target —
    //   retiring first would reject the release and fork the composition).
    // - BEFORE the carry intents: this step's own targets then re-promote
    //   their ends in the same step (the sweep demotes, the carry re-marks —
    //   a driven end never flickers). A fresh spawn's carry note retires
    //   until its controller's first target flows (the composition registers
    //   the runtime after the spawn's first render and composes from the
    //   next frame) — at a 10 s window, the sub-frame of idle it accrues is
    //   nothing; the note is re-marked the moment the cord is actually held.
    // Deterministic under the driver's substep replay (every replay sees the
    // same input, so the same demote/re-mark decisions). Seated ends never
    // read 'carrying' and vanishing cords' bookkeeping is frozen inside the
    // machine — both are naturally skipped.
    carrySeen.clear();
    const carriesIn = input.pinTargets;
    if (carriesIn !== null && carriesIn !== undefined) {
      for (let k = 0; k < carriesIn.length; k += 1) {
        const t = carriesIn[k];
        carrySeen.add((t.cordId ?? 0) * 2 + (t.index === 0 ? 0 : 1));
      }
    }
    for (const entry of entries) {
      const N = entry.rope.segmentCount;
      if (lifecycle.endMode(entry.id, 0) === 'carrying' && !carrySeen.has(entry.id * 2)) {
        lifecycle.noteCarryStopped(entry.id, 0);
      }
      if (lifecycle.endMode(entry.id, N) === 'carrying' && !carrySeen.has(entry.id * 2 + 1)) {
        lifecycle.noteCarryStopped(entry.id, N);
      }
    }
    for (const entry of entries) {
      const carries = input.pinTargets;
      if (carries !== null && carries !== undefined) {
        for (let k = 0; k < carries.length; k += 1) {
          const t = carries[k];
          if ((t.cordId ?? 0) === entry.id) applyCarry(entry, t);
        }
      }
      const seats = input.seatTargets;
      if (seats !== null && seats !== undefined) {
        for (let k = 0; k < seats.length; k += 1) {
          const s = seats[k];
          if ((s.cordId ?? 0) === entry.id) applySeat(entry, s);
        }
      }
      // T-INT-5 — the brush impulse pass LAST, after every intent mutation
      // and immediately before integration, so the impulse lands in the very
      // substep the pointer moved (visible same-frame) and no later intent
      // can zero it. Pins were skipped inside the pass. The options are the
      // A11Y-1-scaled scratch (identity unless the frame carried a scale).
      if (brushPoint !== null) applyBrushToRope(entry.rope, brushPoint, brushPassOptions, dt);
      entry.rope.step(dt);
      entry.rope.writePointsTo(entry.points);
    }
    world.time = state.time + dt;
    return world;
  };

  return Object.assign(step, { lifecycle: lifecycleView });
}

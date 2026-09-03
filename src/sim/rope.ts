import type { SeatInput, Vec2 } from './types';

/**
 * SIM-1 — the Verlet rope core: N segments, N+1 points, distance constraints,
 * gravity, one pinned endpoint. This is the product-feel engine (plan.md SIM
 * lane: "the cord IS the product feel") kept liftable: pure TypeScript, no
 * renderer, no DOM, no wall-clock, no RNG inside the core — the same (config,
 * initial pose, call sequence) always produces bitwise-identical positions.
 *
 * 2D PIVOT (town-hall Revision 2): the world is the plane — flat [x,y] pairs
 * (the v1 vec3 triplets with z dropped). Every behavioral law carries over
 * verbatim; only the dimension changed.
 *
 * Integration is position-based Verlet: implicit per-point velocity
 * (pos - prev), gravity as an acceleration term, then `iterations` rounds of
 * Gauss-Seidel distance-constraint projection. The pinned point is re-exact
 * after every pass, so the pin is hard — never a spring.
 *
 * STEADY-STATE ALLOCATION CONTRACT (owner lane): `step` touches only
 * preallocated flat Float64Arrays and number locals — zero allocation per
 * step, and no objects are created in any hot loop. Consumers read points
 * through `readPoint`/`writePointsTo`, which copy into caller-owned objects.
 *
 * SIM-2 — the carried end: `carryEnd` turns the free endpoint into a second,
 * kinematic pin. Each step it converges toward the target set by
 * `setPinTarget` with BOUNDED VELOCITY — at most `maxPinSpeed * dt` of travel
 * per step — so a violent cursor teleport drags the cord instead of ripping
 * it (the pin is Lipschitz in time; it never teleports). On top of that sits
 * the STRETCH LEASH: the carried pin's distance from the seated pin is
 * projected back onto the CIRCLE of radius `segmentCount * segmentLength`
 * whenever the drag would exceed it, so the carried cord hard-stops at the
 * rope's total length — it stretches and dangles, never extends. Both pins
 * are re-exacted after every solver pass; the leash is checked before the
 * solve and the pins win over every constraint.
 *
 * Robustness contract: the solver is total — every input state advances to a
 * finite state. The one degenerate case (two coincident endpoints, where the
 * constraint direction 0/0 is undefined) is resolved by a deterministic
 * index-derived separation nudge, never by skipping the constraint, so a
 * collapsed rope un-stacks instead of fusing. Verified across the 10k-state
 * fuzz corpus in rope.test.ts and the violent-drag corpus in carry.test.ts.
 *
 * SIM-3 — the seat/rest-length solve: plugging a cord end is `seat()`. The
 * seated end becomes a hard pin (a plugged jack, distinct from the original
 * `pinIndex` anchor while that still pins), which is what makes the linked
 * state: both endpoints pinned. Two pieces of feel engineering ride on that
 * event:
 *
 * 1. REST-LENGTH ADAPTATION. While a cord is carried it is "stretched to
 *    reach" — mid-drag segments sit transiently above natural rest (up to
 *    ~40% during violent carries). Seating freezes that geometry; naively the
 *    constraint target would then snap every stretched segment back to
 *    natural rest in ONE step — a visible pop that runs down the cord. So the
 *    rope carries a per-segment rest-length state: `seat()` adopts the
 *    current segment lengths as the rest state (zero constraint demand at the
 *    plug instant — the cord keeps its shape), then adapts every segment's
 *    rest toward its natural length at a bounded rate (`seatRelaxRate`), all
 *    segments in lockstep — the slack returns smoothly and uniformly, never
 *    as a traveling discontinuity.
 *
 * 2. SETTLE + SLEEP. A plugged cord dangles under `seatDamping` (stronger
 *    than the free `damping` — plugging should sigh into stillness within the
 *    approved ~1.0–2.0 s window). The moment the kinetic energy drops below
 *    `settleEnergy` (and adaptation is done), the rope FALLS ASLEEP: every
 *    free point's implicit velocity is zeroed exactly and integration is
 *    skipped entirely, so a plugged cord is BITWISE motionless — zero
 *    residual jitter, forever. Any mutator (setPoint, setVelocity, setPin,
 *    setSeatPosition, wake) rouses it; a fresh `placeAlong` fully resets the
 *    seat state.
 *
 * Seat/rest state is scalar + preallocated-array closure state like the carry
 * machinery: zero allocation, no RNG, no wall-clock. Without a seat the
 * solver executes with `rest[s] === segmentLength` and no end seated
 * (`isEndSeated` false on both ends) on every branch — arithmetically
 * identical to the pre-seat solver (the SIM-1/SIM-2 suites, including bitwise
 * driver-vs-direct equivalence, pass untouched). Seating beyond the leash
 * radius is allowed (totality: INT-3 rectangle drags can pull linked pins
 * past total length before INT-6's auto-unplug fires); the state stays finite
 * and damped throughout.
 *
 * INT-4 — UN-SEAT. A seat is a seat, whoever made it: `unseat(index)` releases
 * a seated end so it can be carried (re-grabbed) or re-seated elsewhere. Three
 * kinds of seat exist: the TWO PLUGS (`seat()`, one per end — each end owns
 * its own seat slot) and the ORIGINAL ANCHOR (`pinnedIndex` — the M1 cord's
 * red jack is "seated by construction"). Un-seating a plug clears THAT end's
 * seat and touches nothing else; un-seating the anchor sets `anchorReleased`,
 * after which the anchor point is an ordinary free endpoint — carriable and
 * seatable like any other (the `carryEnd` / `seat` anchor guards only protect
 * an anchor that still pins). Because the seats are PER-END, both ends can be
 * seated simultaneously — THE LINKED STATE for a spawned cord, including both
 * ends on the same rectangle (self-link) — and seating one end can never
 * silently free the other: there is no shared slot left to overwrite.
 * The released point re-enters integration AT REST (zero velocity — a pulled
 * plug keeps its position; the cord keeps hanging from its other seated end,
 * or falls gently under damping when nothing else pins). While the anchor is
 * released the SIM-2 stretch leash re-aims: the carried pin leashes around
 * the OTHER end's hard pin (the plug seat when the other end is plugged, the
 * anchor pin while it still sits), and a cord with NO remaining hard pin
 * (both ends released — a spawned cord held in hand) needs no leash at all:
 * its own distance constraints bound it. Every branch is bitwise-identical to
 * the pre-INT-4 solver while `anchorReleased` is false and at most one seat
 * exists — the anchor is released only by an explicit `unseat(pinnedIndex)`.
 */

/** One pinned-end Verlet rope, fully specified. */
export interface RopeConfig {
  /** Number of segments; the rope has segmentCount + 1 points. */
  segmentCount: number;
  /** Rest length of one segment, in world units. */
  segmentLength: number;
  /** Gravitational acceleration magnitude, applied along -Y (screen-down). */
  gravity: number;
  /** Distance-constraint projection passes per step (Gauss-Seidel). */
  iterations: number;
  /**
   * Velocity retained per step, in (0, 1]. 1 = undamped. Verlet damping is
   * inherently per-slice; at the fixed timestep it is frame-rate independent.
   */
  damping: number;
  /** Which end is seated (hard-pinned): 0 (the first point, default) or segmentCount. */
  pinIndex: number;
  /** World position of the seated pin. */
  pin: Vec2;
  /**
   * Carry speed cap in world units per second: the most ground a carried pin
   * can cover in one step is `maxPinSpeed * dt`. Bounds the kinematic pin's
   * convergence so violent target jumps stay drags, not rips.
   */
  maxPinSpeed: number;
  /**
   * SIM-3 — velocity retained per step while the rope is SEATED (plugged).
   * Stronger than `damping`: a plugged cord should sigh into stillness inside
   * the approved ~1.0–2.0 s settle window (tuned: see seat.test.ts).
   */
  seatDamping: number;
  /**
   * SIM-3 — max per-segment rest-length change per second while the seated
   * rope's rest state adapts from its seat-time("stretched to reach")
   * geometry back to natural. Bounds the redistribution: no step ever
   * demands a discontinuous segment length, so no popping wave runs down the
   * cord. World units per second, applied to every segment in lockstep.
   */
  seatRelaxRate: number;
  /**
   * SIM-3 — kinetic-energy threshold below which a seated rope (with rest
   * adaptation finished) counts as visually calm and falls asleep: velocities
   * zero exactly, integration stops, residual jitter is exactly zero until
   * something wakes the rope. Must sit safely above the Verlet micro-oscillation
   * floor that gravity re-injects each step (measured ≲1e-4 with the shipped
   * seatDamping), or the rope would never sleep.
   */
  settleEnergy: number;
  /**
   * REN-1 — ground collision line: free points are projected to stay at or
   * above this world Y every solver pass (a bench floor at y=0). Contact is
   * frictionless with ZERO restitution: clamping also raises the stored
   * previous position to the floor, so the implicit normal velocity reads
   * exactly zero and the cord rests on the line instead of bouncing.
   *
   * `null` (the default) means NO floor — execution is bit-identical to the
   * pre-floor solver, which is why every earlier sim suite passes untouched.
   * Pins (seated, original, carried) are exempt: they are re-exacted after
   * every pass and win over the clamp — the interaction layer is responsible
   * for keeping its own pin targets above the floor. A resting rope shows no
   * jitter: the per-step gravity dip below the line is clamped away inside
   * the same step, so stored positions sit exactly on the line, and a SEATED
   * rope still falls asleep on the floor (bitwise stillness, as everywhere).
   */
  floorY: number | null;
};

export const DEFAULT_ROPE_CONFIG: Readonly<RopeConfig> = {
  segmentCount: 16,
  segmentLength: 0.1,
  gravity: 9.81,
  iterations: 4,
  damping: 0.985,
  pinIndex: 0,
  pin: { x: 0, y: 0 },
  // At the 120 Hz slice this caps the carried pin at 0.1 units/step — one
  // rest length — fast enough to track a hand, slow enough that the constraint
  // solve absorbs the motion without transiently exceeding 2x rest length.
  maxPinSpeed: 12,
  // SIM-3 tuning (measured, see seat.test.ts): swept against four plug
  // scenarios (two violent mid-swing plugs, a near-taut plug, a mild plug)
  // AND the INT-3 re-settle bound (a dragged seated cord re-sleeps inside
  // the window). 2D re-sweep (the planar cord carries no z-oscillation, so
  // the v1 0.94 settled scenarios BELOW the window at 0.71–1.29 s): 0.968
  // lands every scenario inside the approved window with margin on both
  // edges.
  seatDamping: 0.968,
  // 0.6 u/s = 6% of a rest length per 120 Hz step: even a violent 40%
  // transient stretch relaxes inside ~0.1 s, smoothly and in lockstep.
  seatRelaxRate: 0.6,
  // Settle threshold (kinetic energy of the free points) tuned with
  // seatDamping 0.968: every measured plug scenario crosses inside the window.
  // Free-point speed at this level is ~0.03 u/s (< 3 cm/s at product scale,
  // invisible), and the measured never-sleep micro-oscillation floor is
  // ~1e-16 — twelve orders of margin, so sleep engages reliably.
  settleEnergy: 5e-3,
  // No ground line unless the world asks for one (the M1 bench sets 0).
  floorY: null,
};

/**
 * Merges `overrides` onto DEFAULT_ROPE_CONFIG and validates — programmer
 * error fails fast at construction, purely (same discipline as the
 * fixed-timestep driver's resolveConfig).
 */
export function resolveRopeConfig(overrides: Partial<RopeConfig> = {}): RopeConfig {
  const c: RopeConfig = {
    segmentCount: overrides.segmentCount ?? DEFAULT_ROPE_CONFIG.segmentCount,
    segmentLength: overrides.segmentLength ?? DEFAULT_ROPE_CONFIG.segmentLength,
    gravity: overrides.gravity ?? DEFAULT_ROPE_CONFIG.gravity,
    iterations: overrides.iterations ?? DEFAULT_ROPE_CONFIG.iterations,
    damping: overrides.damping ?? DEFAULT_ROPE_CONFIG.damping,
    pinIndex: overrides.pinIndex ?? DEFAULT_ROPE_CONFIG.pinIndex,
    pin: overrides.pin ?? DEFAULT_ROPE_CONFIG.pin,
    maxPinSpeed: overrides.maxPinSpeed ?? DEFAULT_ROPE_CONFIG.maxPinSpeed,
    seatDamping: overrides.seatDamping ?? DEFAULT_ROPE_CONFIG.seatDamping,
    seatRelaxRate: overrides.seatRelaxRate ?? DEFAULT_ROPE_CONFIG.seatRelaxRate,
    settleEnergy: overrides.settleEnergy ?? DEFAULT_ROPE_CONFIG.settleEnergy,
    floorY: overrides.floorY ?? DEFAULT_ROPE_CONFIG.floorY,
  };
  if (!Number.isInteger(c.segmentCount) || c.segmentCount < 1) {
    throw new Error(`rope: segmentCount must be an integer >= 1, got ${c.segmentCount}`);
  }
  if (!Number.isFinite(c.segmentLength) || c.segmentLength <= 0) {
    throw new Error(`rope: segmentLength must be a positive finite number, got ${c.segmentLength}`);
  }
  if (!Number.isFinite(c.gravity) || c.gravity < 0) {
    throw new Error(`rope: gravity must be a finite number >= 0, got ${c.gravity}`);
  }
  if (!Number.isInteger(c.iterations) || c.iterations < 1) {
    throw new Error(`rope: iterations must be an integer >= 1, got ${c.iterations}`);
  }
  if (!Number.isFinite(c.damping) || c.damping <= 0 || c.damping > 1) {
    throw new Error(`rope: damping must be a finite number in (0, 1], got ${c.damping}`);
  }
  if (c.pinIndex !== 0 && c.pinIndex !== c.segmentCount) {
    throw new Error(`rope: pinIndex must be 0 or ${c.segmentCount}, got ${c.pinIndex}`);
  }
  if (!Number.isFinite(c.pin.x) || !Number.isFinite(c.pin.y)) {
    throw new Error(`rope: pin must be finite, got ${JSON.stringify(c.pin)}`);
  }
  if (!Number.isFinite(c.maxPinSpeed) || c.maxPinSpeed <= 0) {
    throw new Error(`rope: maxPinSpeed must be a positive finite number, got ${c.maxPinSpeed}`);
  }
  if (!Number.isFinite(c.seatDamping) || c.seatDamping <= 0 || c.seatDamping > 1) {
    throw new Error(`rope: seatDamping must be a finite number in (0, 1], got ${c.seatDamping}`);
  }
  if (!Number.isFinite(c.seatRelaxRate) || c.seatRelaxRate <= 0) {
    throw new Error(`rope: seatRelaxRate must be a positive finite number, got ${c.seatRelaxRate}`);
  }
  if (!Number.isFinite(c.settleEnergy) || c.settleEnergy <= 0) {
    throw new Error(`rope: settleEnergy must be a positive finite number, got ${c.settleEnergy}`);
  }
  if (c.floorY !== null && !Number.isFinite(c.floorY)) {
    throw new Error(`rope: floorY must be null (no floor) or finite, got ${c.floorY}`);
  }
  return c;
}

/** The liftable rope surface — data in, data out, nothing else. */
export interface Rope {
  readonly segmentCount: number;
  readonly pointCount: number;
  readonly segmentLength: number;
  /** Index of the seated (hard-pinned) point (0 or segmentCount). */
  readonly pinnedIndex: number;
  /**
   * Index of the carried (kinematic) end once `carryEnd` is engaged, else
   * null. `placeAlong` disengages the carry (it spawns a fresh cord).
   */
  readonly carriedIndex: number | null;

  /**
   * SIM-3/INT-4 — true while END `index` (0 or segmentCount) holds a plug
   * seat installed by `seat()`. The seats are PER-END: both ends can read
   * true at once — that IS the linked state (both jacks seated), including
   * both on the same rectangle. A still-pinned original anchor is NOT a plug
   * seat: it reads through `pinnedIndex`/`anchorReleased` instead. A
   * non-endpoint index returns false (the query is total — it guards
   * upstream intent routing, it does not throw).
   */
  isEndSeated(index: number): boolean;

  /**
   * INT-4 — true once the original anchor end has been un-seated
   * (`unseat(pinnedIndex)`): the anchor point is an ordinary free endpoint
   * (carriable, seatable) and the hard pin no longer applies. A fresh
   * `placeAlong` resets it (a fresh cord hangs from its anchor again).
   */
  readonly anchorReleased: boolean;

  /**
   * INT-4 — releases the seated end `index` so it can be carried or re-seated
   * (the un-seat half of "ends pluggable in any order"). Accepts exactly the
   * seats that exist: either per-end plug (`isEndSeated(index)`) or the
   * original anchor (`pinnedIndex` while it still pins). Anything else
   * throws — un-seating a free end is a caller bug, not an input edge. ONLY
   * the named end is released: with both ends seated (linked), un-seating
   * one leaves the other hard-pinned bitwise (the cord keeps hanging from
   * it). The released point re-enters
   * integration AT REST (prev = pos: no snap, no impulse — a pulled plug
   * keeps its position and the cord hangs from whatever else pins it, or
   * falls gently). The seat's rest-length adaptation, if mid-flight,
   * CONTINUES at the bounded `seatRelaxRate` — the geometry relaxes smoothly
   * instead of snapping to natural. Wakes a sleeping rope. Zero allocation.
   */
  unseat(index: number): void;

  /**
   * Advances the rope by exactly `dt` seconds: converge the carried pin
   * (bounded velocity + stretch leash), then integrate every free point, then
   * project distance constraints `iterations` times — each pass followed by
   * the ground clamp (when `floorY` is set) and the re-exact pins. A
   * non-finite or non-positive dt is a no-op (clock garbage can never poison
   * the state). Zero allocation.
   */
  step(dt: number): void;

  /**
   * Places the points on the straight line from `from` to `to` (inclusive)
   * with zero velocity, moves the seated pin to `from`, and disengages any
   * carry. The spawn primitive.
   */
  placeAlong(from: Vec2, to: Vec2): void;

  /** Teleports point `index` (velocity unchanged). Bounds-checked. */
  setPoint(index: number, x: number, y: number): void;

  /** Sets the implicit velocity of point `index` for steps of size `dt`. */
  setVelocity(index: number, x: number, y: number, dt: number): void;

  /**
   * T-INT-5 — ADDS velocity `(x, y)` (world units per second) to point
   * `index` on top of its current implicit velocity: the passive cursor-brush
   * impulse. External forces act through their own mutation, and a brush
   * must not erase the motion it lands on — a swaying cord keeps its sway
   * and gains the nudge (the impulse is additive by design; `setVelocity`
   * remains the aiming primitive for authored velocities). A non-zero
   * impulse wakes a sleeping rope (an impulse must move the cord); a zero
   * impulse changes nothing, not even the sleep state. Pins are NOT
   * protected here — the caller skips them (the brush pass does; the pins
   * would re-exact over any velocity next step anyway). Zero allocation.
   */
  addImpulse(index: number, x: number, y: number, dt: number): void;

  /** Teleports the seated pin (pinned point snaps there on the next step). */
  setPin(x: number, y: number): void;

  /**
   * SIM-2 — engages the carry: endpoint `index` (the end that is NOT the
   * seated pin) becomes a kinematic pin starting at its current position,
   * holding until a target arrives. Re-grabbing resets the target. Throws on
   * a non-endpoint index or on the seated pin. INT-4: an anchor that has been
   * released (`unseat(pinnedIndex)`) is no longer a seated pin — the
   * formerly-anchored end is carriable like any other.
   */
  carryEnd(index: number): void;

  /**
   * SIM-3 — plugs endpoint `index` at `position`: the end becomes a HARD pin
   * in ITS OWN seat slot (the plugged jack; with the other end also hard —
   * anchor pin or plug — the linked state), any carry on it disengages, and
   * the seat transition engages: the per-segment rest state adopts the
   * current geometry (zero constraint demand at the plug instant — no pop)
   * and begins adapting smoothly to the natural rest lengths, while the cord
   * dangles under `seatDamping` until it falls asleep at `settleEnergy`. The
   * settle — shape adaptation plus damped decay to bitwise stillness — lands
   * inside the approved ~1.0–2.0 s window. The OTHER end's seat, if any, is
   * untouched: seating one end can never unseat the other (INT-4's loudness
   * rule — the silent-unplug class is structurally impossible).
   * Throws on a non-endpoint index, the original pinned end (INT-4: unless it
   * has been released — a released anchor seats like any other end), an end
   * that already holds a plug seat (transport goes through
   * `setSeatPosition(index, ...)`), or a non-finite position.
   */
  seat(options: SeatInput): void;

  /**
   * SIM-3 — moves the plugged pin of END `index` (the jack rides its socket,
   * e.g. when the socket's rectangle is dragged). Per-end: with both ends
   * seated (linked), each seat transports independently — a dragged rectangle
   * moves exactly the plugs seated on it, bitwise. Non-finite input is IGNORED
   * (the last valid position stands — same discipline as setPinTarget). A
   * bitwise-identical position is a NO-OP that does not wake the rope
   * (INT-3: the per-frame re-sent seat transform must never restart the
   * settle — the post-drag calm-down is bounded by the settle window,
   * starting at the last genuine change). A genuine move wakes a sleeping
   * rope. Throws when the named end holds no plug seat.
   */
  setSeatPosition(index: number, x: number, y: number): void;

  /**
   * SIM-3 — rouses a sleeping (settled) rope: integration resumes from zero
   * velocity. Mutators like setPoint/setVelocity/setPin/setSeatPosition wake
   * automatically; this is for external forces (e.g. a brush impulse) that
   * act through their own mutation. No-op when not asleep.
   */
  wake(): void;

  /** True while the seated rope is asleep: bitwise-still until woken. */
  isSettled(): boolean;

  /**
   * SIM-3 — the rest length the constraint solve currently targets for
   * segment `s`. Equals the natural length except during seat adaptation
   * (between `seat()` and the bounded relaxation back to natural). Pure read.
   */
  readSegmentRest(segment: number): number;

  /**
   * SIM-2 — sets where the carried end should converge. The convergence is
   * dt-aware inside `step` (bounded by `maxPinSpeed * dt` per step, then
   * leash-projected); this only records the destination — the target is
   * copied immediately, so later mutation of `target` by the caller is
   * invisible to the rope. A non-finite target is IGNORED (the last valid
   * target stands): garbage from upstream math can never poison the state.
   * Throws unless `index` is the currently carried end.
   */
  setPinTarget(index: number, target: Vec2): void;

  /**
   * T-LIFE-2 — disengages the carried pin: the end stops being kinematic and
   * becomes an ORDINARY FREE POINT again, re-entering integration AT REST
   * (prev = pos — a letting-go, not a fling), after which gravity and the
   * floor clamp own its descent. This is the FALL half of the vanish
   * choreography's honesty: the failing end is never scripted downward — it
   * is released, and the same solver that drops every dropped cord drops
   * this one. Throws unless `index` is the currently carried end (releasing
   * nothing is a caller bug). Zero allocation; wakes a sleeping rope.
   */
  releaseCarry(index: number): void;

  /** Copies point `index` into `out` (caller-owned — no allocation). */
  readPoint(index: number, out: Vec2): Vec2;

  /** Copies the seated pin position into `out`. */
  readPin(out: Vec2): Vec2;

  /**
   * Copies every point into `points`, creating shell Vec2s only for slots
   * that are still undefined. Called once per step by consumers, it mutates
   * the existing shells thereafter — zero steady-state allocation.
   */
  writePointsTo(points: Vec2[]): void;

  /** max over segments of |length - restLength| / restLength. 0 = perfect. */
  maxConstraintViolation(): number;

  /** Sum of ½|v|² over free points, velocity read at slice `dt`. */
  kineticEnergy(dt: number): number;

  /** True when every stored position and previous position is finite. */
  isFiniteState(): boolean;
}

/**
 * Below this squared length the constraint direction is treated as
 * undefined (two coincident points). (1e-8 world units)² — far below any
 * visible scale, far above float noise.
 */
const DEGENERATE_LEN2 = 1e-16;

export function createVerletRope(overrides: Partial<RopeConfig> = {}): Rope {
  const config = resolveRopeConfig(overrides);
  const {
    segmentCount,
    segmentLength,
    gravity,
    iterations,
    damping,
    maxPinSpeed,
    seatDamping,
    seatRelaxRate,
    settleEnergy,
    floorY,
  } = config;
  const pointCount = segmentCount + 1;
  const pinnedIndex = config.pinIndex;

  // Flat [x0,y0,x1,y1,...] storage — the solve loops are typed-array
  // arithmetic only. Float64 so in-engine determinism is plain JS number math.
  const pos = new Float64Array(pointCount * 2);
  const prev = new Float64Array(pointCount * 2);

  let pinX = config.pin.x;
  let pinY = config.pin.y;
  // INT-4 — the anchor seat: false while the original pin hard-pins (every
  // pre-INT-4 world), true once unseat(pinnedIndex) releases it.
  let anchorReleased = false;

  // SIM-2 carried end: kinematic pin + convergence target. Scalar closure
  // state — the carry machinery allocates nothing, ever.
  let carriedIndex: number | null = null;
  let cx = 0;
  let cy = 0;
  let tx = 0;
  let ty = 0;
  let hasTarget = false;

  // SIM-3/INT-4 seat state: each END owns its own plug seat (a hard pin at
  // its own seat position), so both ends can be seated at once — the linked
  // state — and seating one can never overwrite the other. `rest[s]` is the
  // per-segment rest-length state (natural until a seat adopts the
  // stretch-to-reach geometry and adapts it back); `asleep` freezes a fully
  // settled cord bitwise. All scalars + one preallocated array.
  let plugged0 = false; // end 0 holds a plug seat
  let pluggedN = false; // end segmentCount holds a plug seat
  let seat0X = 0;
  let seat0Y = 0;
  let seatNX = 0;
  let seatNY = 0;
  let seatAdapting = false;
  let asleep = false;
  const rest = new Float64Array(segmentCount);
  rest.fill(segmentLength);

  // The stretch leash: endpoint separation can never exceed total rest length.
  const maxLen = segmentCount * segmentLength;
  const maxLen2 = maxLen * maxLen;

  // REN-1 ground contact: project every FREE point back onto/above the floor
  // line. Frictionless, zero restitution — raising the stored previous Y too
  // means the implicit normal velocity reads exactly zero at contact, so a
  // dropped cord settles onto the line and stays (no bounce, no sink). The
  // per-step gravity dip below the line is clamped away inside the same
  // step, so STORED positions rest exactly on the line: nothing penetrates,
  // nothing jitters. Pins are exempt (they are re-exacted after this and win);
  // a null floorY skips the pass entirely — bit-identical to the pre-floor
  // solver that every earlier suite verified.
  const projectFloor = (): void => {
    if (floorY === null) return;
    for (let i = 0; i < pointCount; i += 1) {
      // Exactly the active hard pins are exempt; a RELEASED anchor is an
      // ordinary free point and clamps like one (INT-4).
      if (isPinned(i)) continue;
      const k = i * 2 + 1;
      if (pos[k] < floorY) {
        pos[k] = floorY;
        if (prev[k] < floorY) prev[k] = floorY;
      }
    }
  };

  const isPinned = (i: number): boolean =>
    (i === pinnedIndex && !anchorReleased) || i === carriedIndex || (i === 0 ? plugged0 : i === segmentCount && pluggedN);

  const enforcePins = (): void => {
    if (!anchorReleased) {
      const k = pinnedIndex * 2;
      pos[k] = pinX;
      pos[k + 1] = pinY;
      prev[k] = pinX;
      prev[k + 1] = pinY;
    }
    if (carriedIndex !== null) {
      const c = carriedIndex * 2;
      pos[c] = cx;
      pos[c + 1] = cy;
      prev[c] = cx;
      prev[c + 1] = cy;
    }
    if (plugged0) {
      const p = 0;
      pos[p] = seat0X;
      pos[p + 1] = seat0Y;
      prev[p] = seat0X;
      prev[p + 1] = seat0Y;
    }
    if (pluggedN) {
      const p = segmentCount * 2;
      pos[p] = seatNX;
      pos[p + 1] = seatNY;
      prev[p] = seatNX;
      prev[p + 1] = seatNY;
    }
  };
  enforcePins();

  // Kinetic energy of the free points at slice `dt` — shared by the public
  // read and the SIM-3 settle check.
  const computeKineticEnergy = (dt: number): number => {
    if (!(dt > 0) || !Number.isFinite(dt)) return 0;
    let sum = 0;
    for (let i = 0; i < pointCount; i += 1) {
      if (isPinned(i)) continue;
      const k = i * 2;
      const vx = (pos[k] - prev[k]) / dt;
      const vy = (pos[k + 1] - prev[k + 1]) / dt;
      sum += vx * vx + vy * vy;
    }
    return 0.5 * sum;
  };

  const step = (dt: number): void => {
    if (!(dt > 0) || !Number.isFinite(dt)) return; // clock garbage: no-op
    if (asleep) return; // SIM-3: settled cord — bitwise still until woken

    // SIM-2 carry: converge the kinematic pin toward its target with bounded
    // velocity — at most maxPinSpeed * dt of travel per step, so a violent
    // cursor jump is a drag, never a rip. Then the stretch leash: project the
    // carried pin back onto the max-length CIRCLE around the OTHER end's
    // hard pin — the original anchor while it sits, else that end's plug
    // seat (INT-4: carrying one end of a cord whose OTHER end is plugged
    // leashes against the socket; per-end seats make "the other end's seat"
    // unambiguous). A cord with no remaining hard pin (a spawned cord held
    // in hand, nothing seated) has nothing to leash against: its own
    // distance constraints bound it. The anchor branch is the pre-INT-4 code
    // path verbatim — bitwise when the anchor still pins.
    if (carriedIndex !== null && hasTarget) {
      const dx = tx - cx;
      const dy = ty - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > 0) {
        const cap = maxPinSpeed * dt;
        const d = Math.sqrt(d2);
        if (d <= cap) {
          cx = tx;
          cy = ty;
        } else {
          const s = cap / d;
          cx += dx * s;
          cy += dy * s;
        }
      }
      // The leash center: the OTHER end's hard pin, if one exists. The
      // carried end is never itself a seat (`seat` disengages the carry,
      // `carryEnd` refuses a seated end), so "other" is well defined.
      const other = carriedIndex === 0 ? segmentCount : 0;
      let hasCenter = false;
      let lx0 = 0;
      let ly0 = 0;
      if (other === pinnedIndex && !anchorReleased) {
        lx0 = pinX;
        ly0 = pinY;
        hasCenter = true;
      } else if (other === 0 ? plugged0 : pluggedN) {
        lx0 = other === 0 ? seat0X : seatNX;
        ly0 = other === 0 ? seat0Y : seatNY;
        hasCenter = true;
      }
      if (hasCenter) {
        const lx = cx - lx0;
        const ly = cy - ly0;
        const l2 = lx * lx + ly * ly;
        if (l2 > maxLen2) {
          const s = maxLen / Math.sqrt(l2);
          cx = lx0 + lx * s;
          cy = ly0 + ly * s;
        }
      }
    }

    // SIM-3 rest adaptation: walk every segment's rest length toward its
    // natural value at a bounded rate, ALL segments in lockstep, so the
    // seat-time stretch relaxes smoothly — the constraint demand changes by
    // at most seatRelaxRate * dt per segment per step (never a discontinuity,
    // never a wave) and lands exactly on natural.
    if (seatAdapting) {
      const maxDelta = seatRelaxRate * dt;
      let adapting = false;
      for (let s = 0; s < segmentCount; s += 1) {
        const r = rest[s];
        if (r === segmentLength) continue;
        if (r < segmentLength) {
          const next = r + maxDelta;
          rest[s] = next < segmentLength ? next : segmentLength;
        } else {
          const next = r - maxDelta;
          rest[s] = next > segmentLength ? next : segmentLength;
        }
        if (rest[s] !== segmentLength) adapting = true;
      }
      seatAdapting = adapting;
    }

    // Integrate (position Verlet): implicit velocity, damped, plus gravity.
    // Unrolled per axis — no allocation, no per-point objects. All pins are
    // kinematic: they are never integrated. A seated rope dangles under the
    // stronger seatDamping (the plugging settle), free/carried under damping.
    const gy = -gravity * dt * dt;
    const seated = plugged0 || pluggedN;
    const activeDamping = seated ? seatDamping : damping;
    for (let i = 0; i < pointCount; i += 1) {
      if (isPinned(i)) continue;
      const k = i * 2;
      const vx = (pos[k] - prev[k]) * activeDamping;
      const vy = (pos[k + 1] - prev[k + 1]) * activeDamping;
      prev[k] = pos[k];
      prev[k + 1] = pos[k + 1];
      pos[k] += vx;
      pos[k + 1] += vy + gy;
    }
    enforcePins();

    // Project distance constraints, Gauss–Seidel, re-pinning every pass.
    for (let iter = 0; iter < iterations; iter += 1) {
      for (let s = 0; s < segmentCount; s += 1) {
        const a = s;
        const b = s + 1;
        const ak = a * 2;
        const bk = b * 2;
        const dx = pos[bk] - pos[ak];
        const dy = pos[bk + 1] - pos[ak + 1];
        const len2 = dx * dx + dy * dy;

        if (len2 < DEGENERATE_LEN2) {
          // Coincident endpoints: 0/0 has no direction. Separate along a
          // deterministic axis derived from the indices — a pure function of
          // (a, b), so every run picks the same nudge. Skipping instead would
          // fuse a collapsed rope permanently.
          const push = 0.05 * segmentLength;
          const axis = (a + b) % 2;
          const sign = ((a ^ b) & 1) === 0 ? 1 : -1;
          const d = push * sign;
          if (!isPinned(a)) pos[ak + axis] -= d;
          if (!isPinned(b)) pos[bk + axis] += d;
          continue;
        }

        const len = Math.sqrt(len2);
        const diff = (len - rest[s]) / len;
        const aPinned = isPinned(a);
        const bPinned = isPinned(b);
        if (aPinned && bPinned) {
          // Both endpoints hard (a single-segment rope with both ends
          // pinned): the pins win, there is nothing free to move.
          continue;
        }
        if (aPinned) {
          // The free point takes the full correction against a hard pin.
          pos[bk] -= dx * diff;
          pos[bk + 1] -= dy * diff;
        } else if (bPinned) {
          pos[ak] += dx * diff;
          pos[ak + 1] += dy * diff;
        } else {
          const w = 0.5 * diff;
          pos[ak] += dx * w;
          pos[ak + 1] += dy * w;
          pos[bk] -= dx * w;
          pos[bk + 1] -= dy * w;
        }
      }
      projectFloor();
      enforcePins();
    }

    // SIM-3 settle: a plugged cord whose swing has decayed below the
    // threshold (with rest adaptation finished) falls asleep — free-point
    // velocities zeroed exactly and integration skipped from here on, so the
    // perpetual Verlet micro-oscillation (gravity re-injects every step) is
    // replaced by BITWISE stillness: zero residual jitter until woken.
    if ((plugged0 || pluggedN) && !seatAdapting && computeKineticEnergy(dt) < settleEnergy) {
      asleep = true;
      for (let i = 0; i < pointCount; i += 1) {
        if (isPinned(i)) continue;
        const k = i * 2;
        prev[k] = pos[k];
        prev[k + 1] = pos[k + 1];
      }
    }
  };

  const checkIndex = (index: number, where: string): void => {
    if (!Number.isInteger(index) || index < 0 || index >= pointCount) {
      throw new Error(`rope: ${where} index ${index} out of range [0, ${pointCount})`);
    }
  };

  return {
    segmentCount,
    pointCount,
    segmentLength,
    pinnedIndex,

    get carriedIndex() {
      return carriedIndex;
    },

    isEndSeated(index) {
      if (index === 0) return plugged0;
      if (index === segmentCount) return pluggedN;
      return false; // a non-endpoint holds no seat (total query)
    },

    get anchorReleased() {
      return anchorReleased;
    },

    step,

    placeAlong(from, to) {
      // A fresh cord: any carry is disengaged (carriedIndex back to null) and
      // the SIM-3 seat state fully resets — no plugs on either end, natural
      // rests, awake, the anchor pin restored.
      carriedIndex = null;
      hasTarget = false;
      plugged0 = false;
      pluggedN = false;
      seatAdapting = false;
      asleep = false;
      anchorReleased = false; // a fresh cord hangs from its anchor again
      rest.fill(segmentLength);
      pinX = from.x;
      pinY = from.y;
      for (let i = 0; i < pointCount; i += 1) {
        const t = i / segmentCount;
        const k = i * 2;
        pos[k] = from.x + (to.x - from.x) * t;
        pos[k + 1] = from.y + (to.y - from.y) * t;
        prev[k] = pos[k];
        prev[k + 1] = pos[k + 1];
      }
      enforcePins();
    },

    setPoint(index, x, y) {
      checkIndex(index, 'setPoint');
      const k = index * 2;
      pos[k] = x;
      pos[k + 1] = y;
      asleep = false; // an externally moved point cannot be bitwise still
    },

    setVelocity(index, x, y, dt) {
      checkIndex(index, 'setVelocity');
      if (!(dt > 0) || !Number.isFinite(dt)) {
        throw new Error(`rope: setVelocity needs a positive finite dt, got ${dt}`);
      }
      const k = index * 2;
      prev[k] = pos[k] - x * dt;
      prev[k + 1] = pos[k + 1] - y * dt;
      asleep = false; // an impulse (e.g. INT-5 brush) must move the cord
    },

    addImpulse(index, x, y, dt) {
      checkIndex(index, 'addImpulse');
      if (!(dt > 0) || !Number.isFinite(dt)) {
        throw new Error(`rope: addImpulse needs a positive finite dt, got ${dt}`);
      }
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        // Garbage must never reach `prev` — one NaN would poison the rope.
        throw new Error(
          `rope: addImpulse velocity must be finite, got (${x}, ${y})`,
        );
      }
      if (x === 0 && y === 0) return; // nothing to add, nothing to wake
      const k = index * 2;
      prev[k] -= x * dt;
      prev[k + 1] -= y * dt;
      asleep = false; // a real impulse must move even a settled cord
    },

    setPin(x, y) {
      pinX = x;
      pinY = y;
      asleep = false; // the anchor moved (e.g. its rectangle): re-settle
    },

    carryEnd(index) {
      checkIndex(index, 'carryEnd');
      if (index !== 0 && index !== segmentCount) {
        throw new Error(`rope: carryEnd index must be an endpoint (0 or ${segmentCount}), got ${index}`);
      }
      if (index === pinnedIndex && !anchorReleased) {
        throw new Error(
          `rope: carryEnd cannot carry the seated pin (index ${pinnedIndex}) — unseat it first (INT-4)`,
        );
      }
      if (index === 0 ? plugged0 : pluggedN) {
        throw new Error(
          `rope: carryEnd cannot carry the plugged end (index ${index}) — a jack in a socket is not a hand-held end`,
        );
      }
      const k = index * 2;
      carriedIndex = index;
      cx = pos[k];
      cy = pos[k + 1];
      tx = cx;
      ty = cy;
      hasTarget = false; // grabbed where it hangs; holds until a target arrives
      enforcePins();
    },

    setPinTarget(index, target) {
      if (carriedIndex !== index) {
        throw new Error(
          carriedIndex === null
            ? `rope: setPinTarget on index ${index} but nothing is carried — call carryEnd first`
            : `rope: setPinTarget on index ${index} but the carried end is ${carriedIndex}`,
        );
      }
      // Violent/garbage targets (NaN/Inf from upstream math) are ignored —
      // the last valid target stands and the state can never be poisoned.
      if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) {
        return;
      }
      // A GENUINE target wakes a sleeping rope (this interface's own
      // contract): a settled cord whose free end is grabbed and dragged must
      // follow the hand — `carryEnd` holds at the grab point and `step`
      // early-returns while asleep, so without this wake the pin never moves
      // (T-REN-5's e2e caught it: grab a deeply settled cord and drag —
      // nothing). Bitwise-identical targets do NOT wake (a holding hand
      // sends the same target every frame; the INT-3 latch discipline).
      if (tx !== target.x || ty !== target.y) {
        asleep = false;
      }
      tx = target.x;
      ty = target.y;
      hasTarget = true;
    },

    releaseCarry(index) {
      if (carriedIndex !== index) {
        throw new Error(
          carriedIndex === null
            ? `rope: releaseCarry on index ${index} but nothing is carried — call carryEnd first`
            : `rope: releaseCarry on index ${index} but the carried end is ${carriedIndex}`,
        );
      }
      // T-LIFE-2 — the hand opens. The kinematic pin disengages and the end
      // re-enters integration AT REST (prev = pos, exactly like `unseat`'s
      // letting-go): no fling, no scripted descent — gravity integrates it and
      // the floor clamp catches it, the same machinery as every dropped cord.
      carriedIndex = null;
      hasTarget = false;
      const k = index * 2;
      prev[k] = pos[k];
      prev[k + 1] = pos[k + 1];
      asleep = false; // a released end must fall, even from a settled rope
    },

    seat(options) {
      const { index, position } = options;
      checkIndex(index, 'seat');
      if (index !== 0 && index !== segmentCount) {
        throw new Error(`rope: seat index must be an endpoint (0 or ${segmentCount}), got ${index}`);
      }
      if (index === pinnedIndex && !anchorReleased) {
        throw new Error(
          `rope: seat cannot plug the original pinned end (index ${pinnedIndex}) — unseat it first (INT-4)`,
        );
      }
      if (index === 0 ? plugged0 : pluggedN) {
        throw new Error(`rope: seat cannot plug the already-plugged end (index ${index})`);
      }
      if (
        !Number.isFinite(position.x) ||
        !Number.isFinite(position.y)
      ) {
        throw new Error(`rope: seat position must be finite, got ${JSON.stringify(position)}`);
      }
      // Seating a carried end IS the plug: the kinematic pin hardens.
      if (carriedIndex === index) {
        carriedIndex = null;
        hasTarget = false;
      }
      // The end's OWN seat slot takes the plug — the other end's seat (if
      // any) is untouched. This is the INT-4 fix: there is no shared slot
      // left for a second seat to overwrite, so the silent unplug is
      // structurally impossible.
      if (index === 0) {
        plugged0 = true;
        seat0X = position.x;
        seat0Y = position.y;
      } else {
        pluggedN = true;
        seatNX = position.x;
        seatNY = position.y;
      }
      // Adopt the current geometry as the rest-length state — the "stretched
      // to reach" moment. Constraint demand at the plug instant is therefore
      // ~zero: the cord keeps its shape, then relaxes to natural rest at the
      // bounded rate (never a snapping wave down the segments).
      for (let s = 0; s < segmentCount; s += 1) {
        const a = s * 2;
        const b = a + 2;
        const dx = pos[b] - pos[a];
        const dy = pos[b + 1] - pos[a + 1];
        rest[s] = Math.sqrt(dx * dx + dy * dy);
        if (rest[s] !== segmentLength) seatAdapting = true;
      }
      asleep = false; // a fresh plug always begins a new settle
      enforcePins();
    },

    unseat(index) {
      checkIndex(index, 'unseat');
      if (index === 0 ? plugged0 : index === segmentCount && pluggedN) {
        // That end's plug comes out: it is an ordinary free point again. The
        // OTHER end's seat is untouched (per-end slots) — with both ends
        // seated, un-seating one leaves the cord hanging from the other,
        // bitwise. The seat's rest adaptation, if mid-flight, keeps running
        // at the bounded rate (smooth relax, never a snap).
        if (index === 0) plugged0 = false;
        else pluggedN = false;
      } else if (index === pinnedIndex && !anchorReleased) {
        // The anchor seat: the original pin stops pinning. The end becomes an
        // ordinary free endpoint (carriable, seatable — INT-4's "either end").
        anchorReleased = true;
      } else {
        throw new Error(
          `rope: unseat index ${index} is not a seated end (plugs: end 0 ${plugged0 ? 'seated' : 'free'}, end ${segmentCount} ${pluggedN ? 'seated' : 'free'}, anchor ${anchorReleased ? 'released' : `seated at ${pinnedIndex}`})`,
        );
      }
      // The released point re-enters integration AT REST: zero implicit
      // velocity, so a pulled plug keeps its exact position — the un-seat is
      // gentle (the cord keeps hanging from its other seated end, or falls
      // under damping when nothing else pins). A released end cannot stay
      // bitwise still.
      const k = index * 2;
      prev[k] = pos[k];
      prev[k + 1] = pos[k + 1];
      asleep = false;
    },

    setSeatPosition(index, x, y) {
      if (index === 0 ? !plugged0 : !(index === segmentCount && pluggedN)) {
        throw new Error(
          `rope: setSeatPosition on end ${index} with no plug seated there — call seat first`,
        );
      }
      // Per-frame mutator, same tolerance as setPinTarget: garbage from
      // upstream math is ignored, the last valid position stands.
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      // INT-3 (closes the SIM-3 verifier's "setSeatPosition re-settle not
      // window-bounded" carry-over): a bitwise-identical position is a NO-OP
      // — it must not wake a settled rope. The composition re-sends the seat
      // transform every frame (the latched seatTarget), so after a rectangle
      // drag ends the same transform keeps arriving; without this guard every
      // re-send would restart the settle forever and a plugged cord could
      // never reach bitwise stillness (the "endless re-settle"). With it, the
      // settle window bounds the post-drag calm-down: it starts at the LAST
      // genuine position change and runs the standard SIM-3 damped decay.
      if (index === 0) {
        if (x === seat0X && y === seat0Y) return;
        seat0X = x;
        seat0Y = y;
      } else {
        if (x === seatNX && y === seatNY) return;
        seatNX = x;
        seatNY = y;
      }
      asleep = false; // the socket moved (its rectangle was dragged): re-settle
    },

    wake() {
      asleep = false;
    },

    isSettled() {
      return asleep;
    },

    readSegmentRest(segment) {
      if (!Number.isInteger(segment) || segment < 0 || segment >= segmentCount) {
        throw new Error(`rope: readSegmentRest ${segment} out of range [0, ${segmentCount})`);
      }
      return rest[segment];
    },

    readPoint(index, out) {
      checkIndex(index, 'readPoint');
      const k = index * 2;
      out.x = pos[k];
      out.y = pos[k + 1];
      return out;
    },

    readPin(out) {
      out.x = pinX;
      out.y = pinY;
      return out;
    },

    writePointsTo(points) {
      for (let i = 0; i < pointCount; i += 1) {
        // Shells are created once, on the first sync; every later call
        // mutates them in place — the steady state allocates nothing.
        const p = points[i] ?? (points[i] = { x: 0, y: 0 });
        const k = i * 2;
        p.x = pos[k];
        p.y = pos[k + 1];
      }
    },

    maxConstraintViolation() {
      let worst = 0;
      for (let s = 0; s < segmentCount; s += 1) {
        const ak = s * 2;
        const bk = ak + 2;
        const dx = pos[bk] - pos[ak];
        const dy = pos[bk + 1] - pos[ak + 1];
        const len = Math.sqrt(dx * dx + dy * dy);
        // Measured against the CURRENT rest state — during seat adaptation
        // the target itself is relaxing, so the demand (not the geometry)
        // is what stays fair. Rest equals the natural length outside a seat.
        const target = rest[s];
        const violation = Math.abs(len - target) / target;
        if (violation > worst) worst = violation;
      }
      return worst;
    },

    kineticEnergy(dt) {
      return computeKineticEnergy(dt);
    },

    isFiniteState() {
      for (let k = 0; k < pos.length; k += 1) {
        if (!Number.isFinite(pos[k]) || !Number.isFinite(prev[k])) return false;
      }
      return true;
    },
  };
}

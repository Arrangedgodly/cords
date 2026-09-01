/**
 * Cords sim core — the liftable, headless domain.
 *
 * PRODUCT.md "Positioning": a liftable, headless cord-physics core with
 * Three.js as a disposable render layer. THIS directory is the durable asset;
 * the renderer is not. Everything here is pure TypeScript plain data.
 *
 * HOUSE RULE: zero three.js imports, zero DOM, zero wall-clock reads inside
 * src/sim/. Enforced by `npm run check:sim` (scripts/check-sim-purity.mjs),
 * which runs as part of `npm run build` and `npm test`.
 */

/** Plain 3-vector in world units. Data, not a class, so the core lifts anywhere. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Position + direction ray in sim space (pointer probes; later other probes). */
export interface Ray3 {
  origin: Vec3;
  direction: Vec3;
}

/**
 * One cord: an ordered polyline of sample points. SIM-1 adds the Verlet
 * internals behind this shape; consumers only ever see sampled points.
 */
export interface CordState {
  id: number;
  points: Vec3[];
}

/** Complete headless world snapshot at one sim instant. */
export interface SimState {
  /** Sim clock in seconds — advanced only by fixed-timestep steps (ARC-3). */
  time: number;
  cords: CordState[];
}

/**
 * SIM-2 — per-frame carry intent from the interaction layer. Plain data so
 * QA-1 can record/replay drag sequences headless. The grab/release FSM itself
 * is INT/LIFE lane work; this is only the sim-side carry contract.
 */
export interface PinTargetInput {
  /**
   * INT-4 — which cord the intent names. Optional; ABSENT MEANS 0 (the
   * anchor cord), so every pre-INT-4 producer of this shape is unchanged.
   * The M1 single-cord step ignores it; the multi-cord world step routes
   * by it.
   */
  cordId?: number;
  /** Which endpoint is carried: 0 or the rope's last point index. */
  index: number;
  /** World position the carried end should converge toward this step. */
  position: Vec3;
}

/**
 * SIM-3 — the plug event as plain data: endpoint `index` becomes the plugged
 * (hard-pinned) jack at `position`. Sent once by the interaction layer when a
 * plug lands; the sim-side settle (rest adaptation, damped decay, sleep) is
 * automatic from that instant. Repeats with the same index are idempotent.
 */
export interface SeatInput {
  /**
   * INT-4 — which cord the intent names. Optional; ABSENT MEANS 0 (the
   * anchor cord), same convention as PinTargetInput.cordId.
   */
  cordId?: number;
  /** Which endpoint is plugged: 0 or the rope's last point index. */
  index: number;
  /** World position of the socket the jack seats into. */
  position: Vec3;
}

/**
 * T-LIFE-1 — the over-stretch auto-unplug trigger (the approved linked→popped
 * transition, plan.md INT-6): end `index` of cord `cordId` pops out of its
 * socket and the cord enters `popped` — it dangles from the OTHER (still
 * seated) end under a grace timer (~3s of sim time; re-seating the popped end
 * before expiry restores `linked`, expiry sends it to `vanishing`). INT-6
 * owns the trigger wiring (endpoint distance vs total length); this is the
 * plain-data intent it composes. `reason` defaults to 'over-stretch'.
 * One-shot per entry: an illegal pop (not linked, not a seated end, locked
 * cord) is a lifecycle REJECTION — no-op with a warning event in production,
 * a throw in a strict-mode world.
 */
export interface CordPopInput {
  cordId: number;
  /** Which end pops: the seated end being unplugged (0 or the last index). */
  index: number;
  /** Transition reason carried on the event. Default 'over-stretch'. */
  reason?: string;
}

/**
 * T-LIFE-1 — the user-initiated release failure: the HELD jack of cord
 * `cordId` was released NOT over a cube (main.ts's release routing, which
 * replaces the interim M1 "drop" release). The lifecycle decides:
 * `awaiting-plug` or `popped` → `vanishing` (the approved failure); `carried`
 * (nothing seated) → the ordinary floor drop, no transition. One-shot per
 * frame (one pointer).
 */
export interface ReleaseJackInput {
  cordId: number;
  /** The released end (0 or the last index) — must be the held end. */
  index: number;
}

/** T-LIFE-1 — the vanish-sequence completion report (one entry per cord). */
export interface CordDespawnInput {
  cordId: number;
}

/**
 * INT-4 — the grab-from-midair spawn request: a NEW cord appears at `at`
 * in a coiled start state, its RED end (point 0) already a carried pin,
 * its BLUE end free to trail; gravity + the constraint solve produce the
 * springy uncoil. `cordId` is CALLER-OWNED and must be unique in the world —
 * the spawn is idempotent on it (an id that already exists is ignored), so
 * a per-frame latched re-send spawns exactly one cord. Uniqueness also
 * keeps the composition root's render registration in lockstep with the
 * sim (CordState.id === this id).
 */
export interface SpawnCordInput {
  cordId: number;
  /** World position the coil appears at — the carried red end starts here. */
  at: Vec3;
}

/**
 * Per-frame input snapshot the interaction layer hands to the sim. Grows as
 * the INT lane lands (grabbed jack, brush position, ...). Kept plain-data so
 * QA-1 can record/replay input sequences headless.
 */
export interface SimInput {
  /** Pointer ray in sim space, or null when the pointer is off the stage. */
  pointerRay: Ray3 | null;
  /**
   * SIM-2 — carry target for a grabbed cord end, or null/undefined when
   * nothing is carried. While present, the named endpoint is a kinematic pin
   * converging to `position` with bounded velocity under the stretch leash;
   * when it stops arriving, the pin holds where it converged (release stub).
   */
  pinTarget?: PinTargetInput | null;
  /**
   * SIM-3 — the plug event, or null/undefined while nothing plugs. When an
   * endpoint plugs, it becomes a second hard pin at `position` and the cord
   * settles (rest adaptation + damped decay + sleep) into the linked state.
   * A carried end and a seated end coexist before this fires — the
   * awaiting-plug state. Idempotent for an already-plugged index.
   *
   * INT-3 — the same field is also the SEAT TRANSPORT while linked: a
   * seatTarget naming the already-seated index moves that plugged pin to
   * `position` (the socket's cube is being dragged; the seated jack follows
   * its cube — hard-follow, the approved reading of "cords follow the
   * cube"). Re-sending an unchanged transform is the INT-2 latch pattern and
   * is a bitwise no-op in the rope that never restarts the settle.
   */
  seatTarget?: SeatInput | null;
  /**
   * INT-4 — the multi-cord carry list: one entry per currently driven end.
   * A drop on one cord can overlap a carry on another (spawning while
   * carrying, spamming N), and a cube hosting several plugs transports all
   * of them at once — the M1 singular fields above cannot express that.
   * Each entry routes by `cordId` (absent = 0, the anchor cord). Absent or
   * empty means nothing is carried. Plain data; callers reuse shells.
   */
  pinTargets?: readonly PinTargetInput[] | null;
  /**
   * INT-4 — the multi-cord plug/transport list: every seated end whose
   * transform the composition wants to (re-)send this frame — the INT-2
   * latch generalized, since a dragged cube can carry several seated plugs.
   * Semantics per entry are exactly the singular field's: a NON-seated
   * endpoint plugs, an already-seated index transports, repeats are no-ops.
   * Each entry routes by `cordId` (absent = 0). Absent or empty means no
   * plug intent.
   */
  seatTargets?: readonly SeatInput[] | null;
  /**
   * INT-4 — the grab-from-midair spawn request (see SpawnCordInput).
   * Consumed once per unique cordId: re-sends of the same intent are
   * idempotent no-ops, so a fixed-timestep frame that repeats the input
   * across substeps still spawns exactly one cord. Ignored when the world
   * is at its cord cap or the request is malformed (garbage input is
   * never fatal). At most one spawn per step call.
   */
  spawnCord?: SpawnCordInput | null;
  /**
   * T-LIFE-1 — the linked→popped triggers (see CordPopInput): every entry
   * pops its named seated end this step (INT-6 composes one per
   * over-stretched cord, so the field is plural). Applied AFTER the grace
   * clock advances and BEFORE carry/seat intents, so a pop and its re-seat
   * can legally share one step. Invalid entries are lifecycle rejections
   * (no-op + warning in production; a throw in a strict-mode world).
   */
  popCords?: readonly CordPopInput[] | null;
  /**
   * T-LIFE-1 — the user-initiated release failure (see ReleaseJackInput):
   * the held jack left the hand NOT over a cube. At most one per step (one
   * pointer). Routed by the lifecycle: awaiting-plug/popped → vanishing,
   * carried → ordinary drop (no transition), anything else rejected.
   */
  releaseJack?: ReleaseJackInput | null;
  /**
   * T-LIFE-1 — the vanish-sequence completion reports (see
   * CordDespawnInput): LIFE-2's choreography reports here when a vanishing
   * cord's sequence ends; the cord is then REMOVED from the world (state,
   * registry, step loop). Only legal while the cord is `vanishing` — the
   * FSM is locked until this arrives; a despawn of anything else is a
   * rejection (no-op + warning in production, throw in strict mode).
   */
  despawnCords?: readonly CordDespawnInput[] | null;
}

/**
 * The sim's step contract: advance `state` by exactly one timestep `dt`
 * (seconds) under `input`, returning the NEXT state. Implementations must be
 * deterministic functions of (state, dt, input) — no I/O of any kind — so the
 * whole simulation stays fuzzable headless and liftable into the larger
 * product untouched.
 */
export interface SimStep {
  (state: SimState, dt: number, input: SimInput): SimState;
}

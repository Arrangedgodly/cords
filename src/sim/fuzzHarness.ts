/**
 * QA-1 — the PERMANENT fuzz harness: a composition-faithful driver for the
 * production multi-cord world, built once and reused by every adversarial
 * pattern (fuzz.test.ts) and the DoD gate scenarios (dodGate.test.ts).
 *
 * It is the COMPOSITION MIRROR of src/main.ts — every discipline that makes
 * the real page legal is reproduced here, because the fuzz's whole job is to
 * prove those disciplines hold under adversarial input, not to re-derive
 * them:
 *
 * - the PRODUCTION world shape (the REFINE-3 opening cord — spawned coiled on
 *   a module top with its red end plugged through the same seat latch any
 *   release composes, exactly main.ts's load staging — 24-segment cords,
 *   over-stretch detection ON, vanish choreography ON, brush ON) — but with
 *   `lifecycle.strict = true`: an ILLEGAL transition THROWS in this harness,
 *   so "FSM legality" is not an assertion, it is the test's failure mode;
 * - the SAME-FRAME LATCH DROP: the seat-latch array handed to the driver as
 *   `input.seatTargets` is the live array; the pop/pull event handlers
 *   SPLICE the popped end's entry out of it mid-step, exactly like main.ts's
 *   releaseSeat — without it the substep that popped would legally re-seat
 *   the plug through the replayed latch;
 * - the carry/seat/drop lifecycle: one held end at a time (grab guard =
 *   jackGrabbable: vanishing cords and popped surviving sockets refuse),
 *   seats only from a held end, drops converge to the floor-rest point then
 *   stop sending targets (the release stub), transports ride cube deltas;
 * - INTENT ACCOUNTING: every one-shot intent sent in a frame is tagged, and
 *   every lifecycle TRANSITION the world emits must be accounted for by that
 *   frame's tags or by the machine's own automatic reasons
 *   ('over-stretch', 'grace-expired', 'vanish-complete') — an unaccounted
 *   transition IS a silent unplug, and fails the run.
 *
 * Invariants are checked AFTER EVERY FRAME (checkInvariants): finiteness,
 * the two-tier stretch law (the EXACT SIM-2 leash wherever it is exact, the
 * explosion bound everywhere), position bounds, and zero lifecycle
 * rejections. After the scenario finishes, `calmTail()` proves the settle
 * window: a few quiet seconds and every surviving cord is BITWISE STILL
 * (asleep) — or gone entirely (grace expiry → vanish completes).
 *
 * DETERMINISTIC BY CONSTRUCTION: the harness holds no clocks and no RNG —
 * scenarios drive it with a seeded PRNG (fuzz.test.ts), so the same seed
 * replays the same run bitwise (pinned by test).
 */
import { createCordWorldStep, DEFAULT_OVERSTRETCH_THRESHOLD } from './cordWorld';
import type { CordWorldStep } from './cordWorld';
import { createFixedTimestepDriver } from './fixedTimestep';
import type { LifecycleTransition } from './lifecycle';
import type { VanishEvent } from './vanish';
import type {
  CordPopInput,
  PinTargetInput,
  Ray3,
  ReleaseJackInput,
  SeatInput,
  SimInput,
  SimState,
  SpawnCordInput,
  Vec3,
} from './types';

/** The production numbers (main.ts): the page's exact stepping discipline. */
export const FUZZ_TIMESTEP = 1 / 120;
export const FUZZ_MAX_SUBSTEPS = 5;
export const FUZZ_SEGMENTS = 24;
export const FUZZ_SEGMENT_LENGTH = 0.1;
/** Total rest length of every cord — the leash denominator. */
export const FUZZ_TOTAL_REST = FUZZ_SEGMENTS * FUZZ_SEGMENT_LENGTH;
/** The interaction layer's floor-rest height (main.ts FLOOR_REST_Y). */
export const FUZZ_FLOOR_REST_Y = 0.055;
/**
 * The loose absolute cap on a NO-SEAT cord's residual motion at the end of a
 * calm tail (the DECAY assertion beside it is the sharp law): discarded
 * coils keep relaxing outward on the floor well past SIM-3's window —
 * measured 0.11 u/s at 5s on the worst corpus seed, decaying — so the cap
 * catches sustained swings and jitter loops, not the slow spread.
 */
export const FUZZ_CALM_SPEED = 0.25;
/** The perpetual micro-oscillation floor: at/below this a no-seat cord IS calm. */
export const FUZZ_CALM_FLOOR = 0.01;
/** One frame at 60 fps — the standard fuzz delta. */
export const FUZZ_FRAME_DT = 1 / 60;

/**
 * The bench's eight cubes (the harness's own layout, independent of the
 * render stage): spread over a ~2-unit patch so any two FACE POINTS sit
 * inside one cord's reach (< total × 1.04 ≈ 2.496) — the geometry the
 * production seat rule produces on the real bench.
 */
export const FUZZ_CUBES: ReadonlyArray<readonly [number, number]> = [
  [0.0, 0.9],
  [-0.85, 0.95],
  [0.85, 1.05],
  [1.7, 0.15],
  [1.25, -1.35],
  [-1.65, -0.35],
  [-1.25, -1.55],
  [-1.7, 0.15],
];

/** The largest cube-top-to-cube-top span the bench can produce at link time. */
export const MAX_CUBE_TOP_SPAN: number = (() => {
  let worst = 0;
  for (const [ax, az] of FUZZ_CUBES) {
    for (const [bx, bz] of FUZZ_CUBES) {
      const d = Math.hypot(ax - bx, az - bz);
      if (d > worst) worst = d;
    }
  }
  return worst;
})();

/** The largest per-frame cube transport any scenario performs (the TIER-2 allowance). */
export const FUZZ_CUBE_DRAG_STEP = 0.35;
/** Scenario-side clamp on dragged cube centers (the TIER-2/3 geometry bound). */
export const FUZZ_CUBE_CLAMP = 3.5;
/**
 * The largest span a LINKED cord can legitimately reach: seats live on cube
 * tops, cubes clamp to ±FUZZ_CUBE_CLAMP, and one seat may teleport to its
 * cube top at link time (seating beyond the leash is legal totality — the
 * detector pops the next pass).
 */
export const MAX_LINKED_SPAN =
  2 * FUZZ_CUBE_CLAMP + MAX_CUBE_TOP_SPAN + FUZZ_CUBE_DRAG_STEP;

/** A seat the composition holds for one end (main.ts SeatRecord's mirror). */
interface SeatRecord {
  readonly cordId: number;
  readonly index: number;
  readonly cubeId: number;
  readonly baseCenter: Vec3;
  readonly basePin: Vec3;
  /** Mutated in place by cube transports; `seatInput.position` aliases it. */
  readonly position: Vec3;
  readonly seatInput: SeatInput;
}

/** An in-flight drop: targets flow until the end rests at floor-rest height. */
interface DropRecord {
  readonly cordId: number;
  readonly index: number;
  readonly target: Vec3;
  framesLeft: number;
}

/** One scenario-side intent tag, consumed by the transition accounting. */
type IntentTag = `spawn:${number}` | `grab:${number}:${number}` | `seat:${number}:${number}` |
  `pop:${number}:${number}` | `release:${number}`;

export interface FuzzHarness {
  readonly world: CordWorldStep;
  readonly state: () => SimState;
  /** The ids the world still holds (fresh array). */
  readonly liveCordIds: () => number[];
  /**
   * Advance one frame under `dt` with whatever ops the scenario has staged.
   * Runs the invariant checks on the resulting state (throws on violation).
   */
  frame(dt: number): void;
  // --- composition ops (scenarios call these; all mirror main.ts) ---
  /** N key / HUD button: a new cord lands coiled in hand at `at`. */
  spawn(at: Vec3): number;
  /** Pointer-down on a jack end. Returns false when the grab is refused. */
  grab(cordId: number, index: number): boolean;
  /** The held end's carry target this frame (violent targets are the point). */
  moveTo(position: Vec3): void;
  /** Pointer-up over a cube face: seat the held end at the world point. */
  seatOnCube(cubeId: number, at: Vec3): boolean;
  /** Pointer-up over open floor: the FSM routes (drop or → vanishing). */
  releaseOffCube(): void;
  /** INT-3: drag a cube (translate-only); its seated plugs ride the delta. */
  dragCubeTo(cubeId: number, center: Vec3): void;
  /** An explicit pop intent (INT-6's seam; scenarios may fire it directly). */
  pop(cordId: number, index: number): void;
  /** INT-5: a pointer-move frame — the brush sweeps `ray` once. */
  brushMove(ray: Ray3, strengthScale?: number): void;
  /** True when the end obeys the production grabability law right now. */
  grabbable(cordId: number, index: number): boolean;
  /** The live world point of a cord end (for aiming rays and drops). */
  endPoint(cordId: number, index: number): Vec3;
  /** The cube center (for transport scenarios). */
  cubeCenter(cubeId: number): Vec3;
  /** A held-end read ({cordId, index} or null). */
  readonly held: { readonly cordId: number; readonly index: number } | null;
  /**
   * The settle-window proof: run `seconds` of quiet frames (no intents, no
   * brush), then require every surviving cord to be BITWISE STILL across a
   * final frame pair (the rope's sleep) and in a settled lifecycle state.
   */
  calmTail(seconds: number): { survivors: number[] };
  /** The full event log (transitions + vanish events), in order. */
  readonly eventLog: readonly string[];
  /** Deterministic snapshot for bitwise replay comparison. */
  snapshot(): string;
}

export interface FuzzHarnessOptions {
  /**
   * Include the production opening cord (id 0, awaiting-plug, red end seated
   * on a module top — the REFINE-3 staging, mirroring main.ts's load step).
   */
  withAnchor?: boolean;
  /** Skip invariant checks (determinism A/B runs still assert equality). */
  relaxed?: boolean;
  /**
   * REFINE-4 — the idle-abandon window for the harness world (production
   * tunable `lifecycle.idleSeconds`, default ~10 s). The corpus's dedicated
   * abandonment pattern TUNES IT SHORT (2 s) so the fast corpus exercises
   * the sweep/#9/laws within its frame budget; every other pattern runs the
   * production default.
   */
  idleSeconds?: number;
}

export function createFuzzHarness(options: FuzzHarnessOptions = {}): FuzzHarness {
  const withAnchor = options.withAnchor ?? true;
  const relaxed = options.relaxed ?? false;

  const eventLog: string[] = [];
  const transitionsSeen: Array<{ frame: number; event: LifecycleTransition }> = [];
  let frames = 0;

  // The seat latch — THE live array the driver replays across substeps. The
  // pop/pull handlers below splice it mid-step (main.ts releaseSeat).
  const seatLatch: SeatInput[] = [];
  const carryTargets: PinTargetInput[] = [];
  const seatRecords = new Map<string, SeatRecord>();
  const drops: DropRecord[] = [];
  const cubeCenters: Vec3[] = FUZZ_CUBES.map(([x, z]) => ({ x, y: 0.25, z }));
  let held: { cordId: number; index: number; target: Vec3 } | null = null;
  /**
   * A failure release whose carry intent has not FLOWED yet (a same-frame
   * grab+release): the carry keeps composing until the machine has seen the
   * grab (#7/#8), THEN the releaseJack intent fires — mirroring main.ts's
   * staging fix exactly. Without it the intent would race the machine and
   * draw a rejection (a strict-world throw).
   */
  let stagedFailure: { cordId: number; index: number; target: Vec3 } | null = null;
  let pendingSpawn: SpawnCordInput | null = null;
  let pendingRelease: ReleaseJackInput | null = null;
  let pendingPop: CordPopInput | null = null;
  let nextCordId = withAnchor ? 1 : 0;
  let brushCounter = 0;
  let brush: { move: number; ray: Ray3; strengthScale?: number } | null = null;
  /**
   * Intent tags staged by ops BETWEEN frames; `frame()` swaps the set at its
   * start, so the tags a transition must be accounted against are exactly the
   * ones whose intents flow in that advance.
   */
  let pendingTags: Set<IntentTag> = new Set();
  /** Cords the world removed (completeVanish) — for registry accounting. */
  const goneCords = new Set<number>();

  const seatKey = (cordId: number, index: number): string => `${cordId}:${index}`;

  function releaseSeat(cordId: number, index: number): void {
    const key = seatKey(cordId, index);
    const record = seatRecords.get(key);
    if (record === undefined) return;
    seatRecords.delete(key);
    const latchIndex = seatLatch.indexOf(record.seatInput);
    if (latchIndex >= 0) seatLatch.splice(latchIndex, 1);
  }

  const world = createCordWorldStep({
    cord: { segmentCount: FUZZ_SEGMENTS, floorY: 0 },
    maxCords: 16,
    overStretch: { threshold: DEFAULT_OVERSTRETCH_THRESHOLD },
    vanish: {
      onEvent: (event: VanishEvent): void => {
        eventLog.push(`vanish:${event.kind}|${event.cordId}|${event.end ?? -1}|${event.time.toFixed(6)}`);
        if (event.kind === 'pull' && event.end !== null) {
          releaseSeat(event.cordId, event.end); // same-frame latch drop
        }
        if (event.kind === 'complete') {
          goneCords.add(event.cordId);
          releaseSeat(event.cordId, 0);
          releaseSeat(event.cordId, FUZZ_SEGMENTS);
          if (held !== null && held.cordId === event.cordId) held = null;
          if (stagedFailure !== null && stagedFailure.cordId === event.cordId) stagedFailure = null;
        }
      },
    },
    brush: { radiusRestLengths: 1.5, strength: 1.0 },
    lifecycle: {
      // STRICT: an illegal transition THROWS — FSM legality is the harness's
      // own failure mode, not an after-the-fact assertion.
      strict: true,
      ...(options.idleSeconds === undefined ? {} : { idleSeconds: options.idleSeconds }),
      onTransition: (event) => {
        eventLog.push(
          `lifecycle:${event.from}>${event.to}|${event.cordId}|${event.end ?? -1}|${event.reason}`,
        );
        transitionsSeen.push({ frame: frames, event });
        if (event.to === 'popped' && event.end !== null) {
          releaseSeat(event.cordId, event.end); // INT-6's same-frame drop
        }
      },
      onRejected: (rejection) => {
        throw new Error(
          `fuzz: lifecycle REJECTED ${rejection.action} on cord ${rejection.cordId} ` +
            `(${rejection.from}) at frame ${frames}: ${rejection.detail}`,
        );
      },
    },
  });

  const driver = createFixedTimestepDriver(world, {
    timestep: FUZZ_TIMESTEP,
    maxSubsteps: FUZZ_MAX_SUBSTEPS,
  });
  let simState: SimState = { time: 0, cords: [] };

  // REFINE-3 — the composition-faithful OPENING CORD, mirroring main.ts's
  // load staging exactly: cord 0 is SPAWNED coiled on a module's top (the
  // ordinary INT-4 spawn) and its RED end is PLUGGED through the same seat
  // latch any release composes, in ONE explicit production step before the
  // first frame — deterministic, and outside frame() so the accounting below
  // sees its transitions against the seeded tags on frame 1. The pin sits
  // PLUG_SEATED_DEPTH (socket.ts, 0.082) inside the top face, the coil one
  // tube radius above it — the page's own opening numbers.
  if (withAnchor) {
    const [ox, oz] = FUZZ_CUBES[7];
    const seatPosition = { x: ox, y: 0.5 - 0.082, z: oz };
    const record: SeatRecord = {
      cordId: 0,
      index: 0,
      cubeId: 7,
      baseCenter: { x: cubeCenters[7].x, y: cubeCenters[7].y, z: cubeCenters[7].z },
      basePin: { x: seatPosition.x, y: seatPosition.y, z: seatPosition.z },
      position: seatPosition,
      seatInput: { cordId: 0, index: 0, position: seatPosition },
    };
    record.seatInput.position = record.position; // alias: transports mutate in place
    seatRecords.set(seatKey(0, 0), record);
    pendingTags.add('spawn:0');
    pendingTags.add('seat:0:0');
    simState = world(simState, FUZZ_TIMESTEP, {
      pointerRay: null,
      spawnCord: { cordId: 0, at: { x: ox, y: 0.53, z: oz } },
      seatTargets: [record.seatInput],
    });
  }

  // --- invariant checks (thrown as loud failures, frame-stamped) -----------

  const dist2 = (a: Vec3, b: Vec3): number => {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return dx * dx + dy * dy + dz * dz;
  };

  function fail(message: string): never {
    throw new Error(`fuzz invariant VIOLATED at frame ${frames}: ${message}`);
  }

  /** TIER 2 bookkeeping: the last frame each cord was seen linked AND over. */
  const linkedOverFrame = new Map<number, number>();
  /**
   * The carries composed into the CURRENT frame's pinTargets (held + staged +
   * in-flight drops, keyed by cord id → carried end index) — the rope-level
   * truth of what the leash governs this step. The MACHINE's carrying mode is
   * advisory and deliberately lags (it survives a ended drop until the next
   * noteCarrying), so TIER 1 reads THIS, not endMode.
   */
  let activeCarries = new Map<number, number>();

  function checkInvariants(): void {
    if (relaxed) return;
    if (!Number.isFinite(simState.time)) fail('sim time is not finite');
    for (const cord of simState.cords) {
      const n = cord.points.length - 1;
      const end0 = cord.points[0];
      const endN = cord.points[n];
      for (const p of cord.points) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
          fail(`cord ${cord.id} has a non-finite point`);
        }
        if (Math.abs(p.x) > 100 || Math.abs(p.y) > 100 || Math.abs(p.z) > 100) {
          fail(`cord ${cord.id} exploded to ${JSON.stringify(p)}`);
        }
      }
      const state = world.lifecycle.stateOf(cord.id);
      if (state === undefined) fail(`cord ${cord.id} is in the snapshot but not the machine`);
      const mode0 = world.lifecycle.endMode(cord.id, 0);
      const modeN = world.lifecycle.endMode(cord.id, n);
      const endSeated0 = mode0 === 'seated';
      const endSeatedN = modeN === 'seated';
      // TIER 1 — the EXACT SIM-2 leash: an end the harness is ACTIVELY
      // carrying this frame (a composed pinTarget — held, staged, or an
      // in-flight drop) cannot escape the other end's hard seat: the rope
      // projects the carried pin onto the max-length sphere around it every
      // step (pinned bitwise ≤ total + 1e-9 in the rope tests; 1e-6 absorbs
      // long-run float drift). Not applicable to vanishing cords (the
      // choreography owns their ends) or ends nobody is driving (a stale
      // machine mode is advisory, never rope truth).
      if (state !== 'vanishing') {
        const carriedEnd = activeCarries.get(cord.id);
        if (carriedEnd === 0 && endSeatedN) {
          if (dist2(end0, endN) > (FUZZ_TOTAL_REST + 1e-6) ** 2) {
            fail(`carried red end of cord ${cord.id} broke the leash (${Math.sqrt(dist2(end0, endN))})`);
          }
        } else if (carriedEnd === n && endSeated0) {
          if (dist2(end0, endN) > (FUZZ_TOTAL_REST + 1e-6) ** 2) {
            fail(`carried blue end of cord ${cord.id} broke the leash (${Math.sqrt(dist2(end0, endN))})`);
          }
        }
      }
      // TIER 2 — over-stretch while LINKED is TRANSIENT: the detector runs
      // every step, so a span past the threshold may survive at most a
      // frame-boundary or two (seat placement + the pop's own substep). A
      // cord that is STILL linked and over the bound after ~2 consecutive
      // frames means the detector failed to fire — violation.
      if (state === 'linked' && endSeated0 && endSeatedN) {
        const overBound = FUZZ_TOTAL_REST * (1 + DEFAULT_OVERSTRETCH_THRESHOLD);
        if (Math.sqrt(dist2(end0, endN)) > overBound) {
          const prev = linkedOverFrame.get(cord.id);
          if (prev !== undefined && frames - prev >= 2) {
            fail(`linked cord ${cord.id} stayed over-stretched for ${frames - prev + 1} frames (detector did not fire)`);
          }
          linkedOverFrame.set(cord.id, frames);
        } else {
          linkedOverFrame.delete(cord.id);
        }
      } else {
        linkedOverFrame.delete(cord.id);
      }
      // TIER 3 — the explosion bound (the loose safety net; the sharp laws
      // are TIER 1/2): for any cord that is NOT doubly-seated, solver
      // transients keep a violently yanked free chain under ~2.3× total rest
      // (measured 5.45 ≈ 2.27× on the worst corpus seed — maxPinSpeed bounds
      // the yank, the constraint solve absorbs the rest), so the detonation
      // net sits at 3×. A real solver blowup reaches hundreds instantly and
      // is caught here or by the |p| ≤ 100 position bound. A linked cord is
      // exempt up to the bench-geometry bound (seats ride dragged cubes; the
      // detector pops the step after crossing).
      let maxSpan2 = 0;
      for (let i = 0; i < cord.points.length; i += 1) {
        for (let k = i + 1; k < cord.points.length; k += 1) {
          const d2 = dist2(cord.points[i], cord.points[k]);
          if (d2 > maxSpan2) maxSpan2 = d2;
        }
      }
      const explosion =
        state === 'linked' && endSeated0 && endSeatedN
          ? MAX_LINKED_SPAN
          : FUZZ_TOTAL_REST * 3 + 0.5;
      if (maxSpan2 > explosion * explosion) {
        fail(`cord ${cord.id} max pairwise span ${Math.sqrt(maxSpan2)} exceeds the transient bound`);
      }
    }
    // Registry accounting: the snapshot and the machine agree, and no cord
    // leaked past its despawn.
    for (const id of goneCords) {
      if (simState.cords.some((c) => c.id === id)) fail(`cord ${id} completed vanish yet still renders`);
    }
  }

  // --- transition accounting: NO SILENT UNPLUGS -----------------------------
  //
  // Every transition recorded during the just-advanced frame must map to an
  // intent tagged for that frame, or to one of the machine's own automatic
  // reasons (the over-stretch detector, grace expiry, the vanish completion).
  function accountTransitions(fromIndex: number, tags: Set<IntentTag>): void {
    if (relaxed) return;
    for (let i = fromIndex; i < transitionsSeen.length; i += 1) {
      const { event } = transitionsSeen[i];
      const { cordId, from, to, reason, end } = event;
      let ok = false;
      if (to === 'popped') {
        ok = reason === 'over-stretch' || tags.has(`pop:${cordId}:${end}` as IntentTag);
      } else if (from === 'linked' && to === 'awaiting-plug') {
        ok = tags.has(`grab:${cordId}:${end}` as IntentTag);
      } else if (to === 'carried') {
        ok = tags.has(`grab:${cordId}:${end}` as IntentTag);
      } else if (to === 'awaiting-plug' || to === 'linked') {
        ok = tags.has(`seat:${cordId}:${end}` as IntentTag);
      } else if (to === 'vanishing') {
        // REFINE-4 — 'abandoned' is the machine's OWN automatic reason (the
        // idle clock, exactly like 'grace-expired': no pointer intent names
        // it); every other entry to vanishing must be a tagged release.
        ok =
          reason === 'grace-expired' ||
          reason === 'abandoned' ||
          tags.has(`release:${cordId}` as IntentTag);
      } else if (to === 'gone') {
        ok = reason === 'vanish-complete';
      }
      if (!ok) {
        fail(`unaccounted transition ${from}>${to} on cord ${cordId} (reason ${reason}, end ${end}) — a silent unplug`);
      }
    }
  }

  const harness: FuzzHarness = {
    world,
    state: () => simState,
    liveCordIds: () => simState.cords.map((c) => c.id),
    get held() {
      return held === null ? null : { cordId: held.cordId, index: held.index };
    },
    get eventLog() {
      return eventLog;
    },
    frame(dt: number) {
      frames += 1;
      const tags = pendingTags;
      pendingTags = new Set();
      const input: SimInput = { pointerRay: null };
      // A staged failure release matures once the machine has SEEN the grab
      // (the carry intent flowed in an earlier frame → endMode 'carrying'):
      // fire the one-shot release intent now, stop composing its target.
      if (stagedFailure !== null) {
        const { cordId, index } = stagedFailure;
        const mode = world.lifecycle.endMode(cordId, index);
        const state = world.lifecycle.stateOf(cordId);
        if (mode === 'carrying' || state === undefined || state === 'vanishing' || state === 'gone') {
          if (mode === 'carrying') {
            pendingRelease = { cordId, index };
            tags.add(`release:${cordId}`);
          }
          stagedFailure = null;
        }
      }
      // Compose carries: the held end, a staged pull, and every in-flight drop.
      carryTargets.length = 0;
      activeCarries = new Map();
      if (held !== null) {
        carryTargets.push({ cordId: held.cordId, index: held.index, position: held.target });
        activeCarries.set(held.cordId, held.index);
      }
      if (stagedFailure !== null) {
        carryTargets.push({ cordId: stagedFailure.cordId, index: stagedFailure.index, position: stagedFailure.target });
        activeCarries.set(stagedFailure.cordId, stagedFailure.index);
      }
      for (let i = drops.length - 1; i >= 0; i -= 1) {
        const drop = drops[i];
        const dropState = world.lifecycle.stateOf(drop.cordId);
        if (dropState === undefined || dropState === 'vanishing') {
          drops.splice(i, 1); // the choreography owns the end from here
          continue;
        }
        carryTargets.push({ cordId: drop.cordId, index: drop.index, position: drop.target });
        activeCarries.set(drop.cordId, drop.index);
        drop.framesLeft -= 1;
        const end = harness.endPoint(drop.cordId, drop.index);
        const done =
          drop.framesLeft <= 0 || dist2(end, drop.target) < 0.03 * 0.03 || dropState === 'gone';
        if (done) drops.splice(i, 1); // targets stop → the release stub freezes
      }
      if (carryTargets.length > 0) input.pinTargets = carryTargets;
      // The seat latch: every seated end's transform re-sends every frame.
      seatLatch.length = 0;
      for (const record of seatRecords.values()) seatLatch.push(record.seatInput);
      if (seatLatch.length > 0) input.seatTargets = seatLatch;
      // One-shot intents, consumed by the first substep (driver replays).
      if (pendingSpawn !== null) {
        input.spawnCord = pendingSpawn;
        pendingSpawn = null;
      }
      if (pendingRelease !== null) {
        input.releaseJack = pendingRelease;
        pendingRelease = null;
      }
      if (pendingPop !== null) {
        input.popCords = [pendingPop];
        pendingPop = null;
      }
      if (brush !== null) {
        input.brush = brush;
        brush = null; // one impulse pass per NEW move counter — the next move re-arms
      }
      const transitionIndex = transitionsSeen.length;
      const result = driver.advance(simState, dt, input);
      simState = result.state;
      accountTransitions(transitionIndex, tags);
      checkInvariants();
    },
    spawn(at: Vec3) {
      const cordId = nextCordId;
      nextCordId += 1;
      pendingSpawn = { cordId, at: { x: at.x, y: at.y, z: at.z } };
      pendingTags.add(`spawn:${cordId}`);
      // The spawned red end lands in hand at the spawn point (INT-4).
      held = { cordId, index: 0, target: { x: at.x, y: at.y, z: at.z } };
      return cordId;
    },
    grabbable(cordId, index) {
      const state = world.lifecycle.stateOf(cordId);
      if (state === undefined || state === 'vanishing') return false;
      if (state === 'popped' && world.lifecycle.endMode(cordId, index) === 'seated') return false;
      return true;
    },
    grab(cordId, index) {
      if (held !== null) return false; // one pointer, one drag
      if (index !== 0 && index !== FUZZ_SEGMENTS) return false;
      if (!harness.grabbable(cordId, index)) return false;
      // A seated end pulls its plug: drop the record + latch (main.ts does
      // this in the pointerdown handler, before the carry intent flows).
      releaseSeat(cordId, index);
      // ONE CONTROLLER PER CORD (main.ts's law): grabbing an end cancels the
      // other end's in-flight drop — a mid-drop end simply falls (the rope
      // re-frees it when the carry switches). Without this, two carry
      // targets flap one rope's carriedIndex between its ends.
      for (let i = drops.length - 1; i >= 0; i -= 1) {
        if (drops[i].cordId === cordId) drops.splice(i, 1);
      }
      if (stagedFailure !== null && stagedFailure.cordId === cordId) stagedFailure = null;
      held = { cordId, index, target: harness.endPoint(cordId, index) };
      pendingTags.add(`grab:${cordId}:${index}`);
      return true;
    },
    moveTo(position) {
      if (held === null) return;
      held.target = { x: position.x, y: position.y, z: position.z };
    },
    seatOnCube(cubeId, at) {
      if (held === null) return false;
      const { cordId, index } = held;
      const center = cubeCenters[cubeId];
      const record: SeatRecord = {
        cordId,
        index,
        cubeId,
        baseCenter: { x: center.x, y: center.y, z: center.z },
        basePin: { x: at.x, y: at.y, z: at.z },
        position: { x: at.x, y: at.y, z: at.z },
        seatInput: { cordId, index, position: { x: at.x, y: at.y, z: at.z } },
      };
      record.seatInput.position = record.position; // alias: transports mutate in place
      seatRecords.set(seatKey(cordId, index), record);
      pendingTags.add(`seat:${cordId}:${index}`);
      held = null; // a seat is not a drop — no floor targets follow
      return true;
    },
    releaseOffCube() {
      if (held === null) return;
      const { cordId, index, target } = held;
      const state = world.lifecycle.stateOf(cordId);
      held = null;
      if (state === 'awaiting-plug' || state === 'popped') {
        if (world.lifecycle.endMode(cordId, index) === 'carrying') {
          // The grab already flowed: the failure release fires now.
          pendingRelease = { cordId, index };
          pendingTags.add(`release:${cordId}`);
          return; // the FALL is the sim's — LIFE-2 owns the end from here
        }
        // SAME-FRAME grab+release (the violent-release edge): the machine has
        // not seen the grab yet — keep the carry composing until it has, then
        // fire the release (main.ts's staged path, mirrored exactly).
        stagedFailure = { cordId, index, target };
        return;
      }
      // The ordinary drop: converge to floor-rest height, then stop sending.
      const end = harness.endPoint(cordId, index);
      drops.push({
        cordId,
        index,
        target: { x: end.x, y: FUZZ_FLOOR_REST_Y, z: end.z },
        framesLeft: 90,
      });
    },
    dragCubeTo(cubeId, center) {
      const c = cubeCenters[cubeId];
      c.x = center.x;
      c.y = center.y;
      c.z = center.z;
      // Every seated plug hosted by this cube rides the translate delta.
      for (const record of seatRecords.values()) {
        if (record.cubeId !== cubeId) continue;
        record.position.x = record.basePin.x + (c.x - record.baseCenter.x);
        record.position.y = record.basePin.y + (c.y - record.baseCenter.y);
        record.position.z = record.basePin.z + (c.z - record.baseCenter.z);
      }
    },
    pop(cordId, index) {
      pendingPop = { cordId, index, reason: 'fuzz' };
      pendingTags.add(`pop:${cordId}:${index}`);
    },
    brushMove(ray, strengthScale) {
      brushCounter += 1;
      brush = {
        move: brushCounter,
        ray: { origin: { x: ray.origin.x, y: ray.origin.y, z: ray.origin.z }, direction: { x: ray.direction.x, y: ray.direction.y, z: ray.direction.z } },
        ...(strengthScale === undefined ? {} : { strengthScale }),
      };
    },
    endPoint(cordId, index) {
      const cord = simState.cords.find((c) => c.id === cordId);
      if (cord === undefined || cord.points[index] === undefined) return { x: 0, y: 0, z: 0 };
      const p = cord.points[index];
      return { x: p.x, y: p.y, z: p.z };
    },
    cubeCenter(cubeId) {
      const c = cubeCenters[cubeId];
      return { x: c.x, y: c.y, z: c.z };
    },
    calmTail(seconds) {
      // Quiet frames: nothing held, nothing dropped, no brush, no intents.
      held = null;
      drops.length = 0;
      pendingSpawn = null;
      pendingRelease = null;
      pendingPop = null;
      stagedFailure = null;
      const framesToRun = Math.round(seconds / FUZZ_FRAME_DT);
      for (let i = 0; i < framesToRun; i += 1) harness.frame(FUZZ_FRAME_DT);
      // THE SETTLE WINDOW, in the rope's own two currencies:
      // - a cord WITH A SEAT (the harness seated an end; also every linked,
      //   popped-dangle, and dropped-from-awaiting survivor) must be BITWISE
      //   STILL one frame to the next — the rope's sleep zeroes velocity
      //   exactly (SIM-3), so this is the DoD's "zero jitter", exact;
      // - a cord with NO seat (a discarded spawn) never sleeps BY DESIGN
      //   (sleep requires a plug — rope.ts) — discarded coils keep relaxing
      //   outward on the floor for a while. Their contract is DECAY: the
      //   residual motion
      //   over the tail's final second must be strictly below the previous
      //   second's and inside the loose absolute cap (a jitter loop or a
      //   sustained swing would hold or grow).
      const survivors = harness.liveCordIds();
      if (survivors.length === 0) return { survivors };
      const windowFrames = Math.round(1 / FUZZ_FRAME_DT);
      const residual = new Map<number, number[]>(); // per no-seat cord, u/s per frame
      const before = new Map<number, Vec3[]>();
      for (const cord of simState.cords) {
        before.set(
          cord.id,
          cord.points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
        );
      }
      for (let w = 0; w < windowFrames * 2; w += 1) {
        harness.frame(FUZZ_FRAME_DT);
        for (const cord of simState.cords) {
          // REFINE-4 — a coil whose idle window expires MID-TAIL is entering
          // the vanish sequence (the choreography owns it from here); its
          // collapse impulse is the sequence's own motion, not a settle
          // failure, so it neither samples into the decay series…
          if (world.lifecycle.stateOf(cord.id) === 'vanishing') continue;
          if (seatRecords.has(seatKey(cord.id, 0)) || seatRecords.has(seatKey(cord.id, FUZZ_SEGMENTS))) {
            continue; // seated: bitwise-still check below covers it
          }
          const was = before.get(cord.id);
          if (was === undefined) continue;
          let maxSpeed = 0;
          for (let i = 0; i < cord.points.length; i += 1) {
            const dx = cord.points[i].x - was[i].x;
            const dy = cord.points[i].y - was[i].y;
            const dz = cord.points[i].z - was[i].z;
            const speed = Math.sqrt(dx * dx + dy * dy + dz * dz) / FUZZ_FRAME_DT;
            if (speed > maxSpeed) maxSpeed = speed;
          }
          let series = residual.get(cord.id);
          if (series === undefined) {
            series = [];
            residual.set(cord.id, series);
          }
          series.push(maxSpeed);
          for (let i = 0; i < cord.points.length; i += 1) {
            was[i] = { x: cord.points[i].x, y: cord.points[i].y, z: cord.points[i].z };
          }
        }
        // Refresh the baseline for seated cords too (single frame pair each).
        if (w === windowFrames * 2 - 1) break;
        for (const cord of simState.cords) {
          const was = before.get(cord.id);
          if (was === undefined) continue;
          for (let i = 0; i < cord.points.length; i += 1) {
            was[i] = { x: cord.points[i].x, y: cord.points[i].y, z: cord.points[i].z };
          }
        }
      }
      // Seated cords: bitwise still across the final frame pair.
      const finalBefore = new Map<number, Vec3[]>();
      for (const cord of simState.cords) {
        finalBefore.set(cord.id, cord.points.map((p) => ({ x: p.x, y: p.y, z: p.z })));
      }
      harness.frame(FUZZ_FRAME_DT);
      for (const cord of simState.cords) {
        const was = finalBefore.get(cord.id);
        if (was === undefined) fail(`cord ${cord.id} appeared during the calm tail`);
        // REFINE-4 — …and a cord still mid-sequence at the tail's final
        // frame is skipped here for the same reason (the registry accounting
        // + the goneCords check below prove it left; its exit is the
        // sequence's, not a settle failure).
        if (world.lifecycle.stateOf(cord.id) === 'vanishing') continue;
        const seated =
          seatRecords.has(seatKey(cord.id, 0)) || seatRecords.has(seatKey(cord.id, FUZZ_SEGMENTS));
        if (seated) {
          for (let i = 0; i < cord.points.length; i += 1) {
            if (
              !Object.is(cord.points[i].x, was[i].x) ||
              !Object.is(cord.points[i].y, was[i].y) ||
              !Object.is(cord.points[i].z, was[i].z)
            ) {
              fail(`cord ${cord.id} (seated) is not bitwise-still after ${seconds}s of calm`);
            }
          }
        } else {
          const series = residual.get(cord.id) ?? [];
          const last = series.slice(windowFrames);
          const prev = series.slice(0, windowFrames);
          const mean = (xs: number[]): number =>
            xs.length === 0 ? Number.POSITIVE_INFINITY : xs.reduce((a, b) => a + b, 0) / xs.length;
          const lastMean = mean(last);
          const prevMean = mean(prev);
          // DECAY with a deadband: either still slowing, or already AT the
          // perpetual micro-oscillation floor (a fully calm rope wobbles
          // between ~0 and a few 1e-4 u/s frame to frame — that IS calm).
          if (lastMean > Math.max(prevMean, FUZZ_CALM_FLOOR)) {
            fail(
              `cord ${cord.id} (no seat) is not calming after ${seconds}s: last-second mean ${lastMean} u/s did not decay below the prior second (${prevMean})`,
            );
          }
          if (Math.max(...last) > FUZZ_CALM_SPEED) {
            fail(`cord ${cord.id} (no seat) exceeds the calm cap after ${seconds}s (${Math.max(...last)} u/s > ${FUZZ_CALM_SPEED})`);
          }
        }
        const state = world.lifecycle.stateOf(cord.id);
        if (state !== 'linked' && state !== 'awaiting-plug' && state !== 'carried') {
          fail(`cord ${cord.id} survived the tail in state ${state} (mid-countdown?)`);
        }
      }
      // Seat records and the world agree: no latch outlives its cord.
      for (const key of seatRecords.keys()) {
        const cordId = Number(key.split(':')[0]);
        if (!survivors.includes(cordId)) fail(`seat latch leaked for dead cord ${cordId}`);
      }
      return { survivors };
    },
    snapshot() {
      // A canonical, order-stable digest of the whole world — bitwise replay
      // equality means string equality here: JS Number→string conversion is
      // round-trip EXACT for doubles (shortest representation that parses
      // back to the same bits), so equal strings ⇔ equal bit patterns.
      const parts: string[] = [`t=${simState.time}`];
      for (const cord of simState.cords) {
        parts.push(`c${cord.id}:` + cord.points.map((p) => `${p.x},${p.y},${p.z}`).join(';'));
      }
      return parts.join('|');
    },
  };

  return harness;
}

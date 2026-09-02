/**
 * Composition root — the one place that knows about both sides of the
 * boundary at construction time:
 *
 *   src/interaction/   DOM events    → SimInput
 *   src/sim/           pure TS core  → SimState   (stepped HERE, per frame)
 *   src/render/        three.js      → pixels, from a SimState snapshot
 *
 * The loop feeds each rAF frame delta to the fixed-timestep driver (ARC-3),
 * which emits 0..MAX_SUBSTEPS_PER_FRAME fixed SIM_TIMESTEP slices to the sim
 * and clamps backgrounded-tab spikes by discarding the backlog.
 *
 * M1 — "one live cord": the REN-1 stage renders the already-simulated rope
 * through the REN-2 cord + 1/4" jack renderer, and the interaction loop is
 * wired through the INT-1 picking integration point: pointer-down on an end's
 * invisible grab proxy (pick class 'jack') engages the SIM-2 carry; while
 * dragging, the carried end follows the cursor on the camera-facing plane
 * through the grab point (targets clamped a hair above the REN-1 floor);
 * pointer-up RELEASES — and the release has the LIFECYCLE's outcomes: INT-2
 * seats the jack released OVER A CUBE (the socket rule: perpendicular to the
 * face, deterministic nearest-face at edges/corners, soft cap of 12 plugs per
 * cube with a red-ring deny); released ANYWHERE ELSE the LIFE-1 FSM decides
 * (below). The seat flows through the SIM-3 `seatTarget` seam and the
 * renderer snaps the seated jack to that transform.
 *
 * INT-3 — CUBE DRAGGING (translate-only): pointer-down on a cube grabs it on
 * the camera-parallel plane through the grab point (offset preserved,
 * continuous floor clamp); pointer-up releases (kinematic: dropping is
 * stopping). Attached cords follow: the seat pose rides the cube's delta and
 * the sim's plugged pin HARD-FOLLOWS through the latched seat seam.
 *
 * INT-4 — GRAB-FROM-MIDAIR SPAWN + a BOTH-ENDS, MULTI-CORD world. The single
 * M1 cord generalizes into a registry of cords owned by the multi-cord world
 * step (src/sim/cordWorld.ts):
 *
 * - SPAWN: the N key — or `window.cords.spawnCord()`, the seam the future
 *   REN-3 HUD button will call — puts a NEW coiled cord in your hand: the
 *   sim spawns it (coiled at the cursor's world point, red end = point 0
 *   already a carried pin, blue end free) and the springy uncoil is the
 *   SIM'S — gravity plus the coil's stored compression; there is no
 *   scripted uncoil animation anywhere. The spawned cord's red-end carry
 *   rides the SAME carry controller machinery a grab uses. Guards, chosen
 *   as the simple honest defaults and documented: spawning while ALREADY
 *   CARRYING is allowed — the new cord lands in hand and the previously
 *   carried end drops per the ordinary M1 release; spawning while DRAGGING
 *   A CUBE behaves symmetrically (the cube is released — dropping is
 *   stopping — and the cord lands in hand); at the world's cord cap the N
 *   key is an honest no-op; with no cursor (or no plane hit) the cord
 *   appears at a default stage point. One key press, one cord (key repeat
 *   is ignored); several presses in one frame: the last request wins.
 * - BOTH ENDS GRABBABLE: every cord registers BOTH end proxies as pick
 *   class 'jack' — seated ends included. Grabbing a SEATED end is INT-4's
 *   hand-pulled plug (legal, per the coordinator amendment): the sim-side
 *   carry intent on a seated end un-seats it (the lifecycle applies
 *   linked→awaiting-plug / awaiting-plug→carried in the same step) while
 *   this layer releases the socket bookkeeping (cap registry count, seat
 *   override, seat record). The still-pinned M1 anchor is the same kind of
 *   seat: grabbing it un-seats the anchor and the cord hangs from the hand.
 *   After an un-seat, either end can seat in ANY order. The grabability
 *   law (see `jackGrabbable`): POPPED's surviving socket is NOT grabbable
 *   (its exits are the re-seat and the grace — the over-stretch pop must
 *   not be dodgeable), and nothing is grabbable while VANISHING (the lock;
 *   LIFE-2 owns the exit). Note the approved priority (jack > cube) means a
 *   seated plug near the cursor shadows the face point behind it — aim at a
 *   clear spot on the face.
 * - LIFE-1 — THE LIFECYCLE FSM (src/sim/lifecycle.ts, carried →
 *   awaiting-plug → linked → popped → vanishing) rides the world step:
 *   every spawn registers its cord; seats and hand-pulled plugs drive the
 *   approved transitions; the grace clock runs on sim time; transitions
 *   emit events (a pop releases this layer's socket bookkeeping in the same
 *   event — cap registry, seat override, latch). The RELEASE a life owns: a
 *   held jack released NOT over a cube is reported as a one-shot
 *   `releaseJack` intent — for an awaiting-plug/popped cord that is the
 *   user-initiated failure (→ vanishing, FSM locked until LIFE-2's sequence
 *   reports completion and the cord leaves the world); a plain carried cord
 *   takes the ordinary drop. MANUAL UNPLUG + OFF-CUBE RELEASE IS THE
 *   COMPOSED REMOVAL PATH: pulling a linked cord's plug leaves it
 *   awaiting-plug, and dropping that held jack anywhere but a cube vanishes
 *   it. Illegal transitions are impossible to provoke through this
 *   composition (popped sockets and vanishing cords are refused here
 *   first); anything that slips through is a lifecycle rejection the
 *   machine warns about and the rope ignores.
 * - INT-6 — OVER-STRETCH AUTO-UNPLUG (the approved failure): the world step
 *   itself watches every LINKED cord's seated-pin separation against its
 *   total rest length (`overStretch`, 4% over). Dragging linked cubes past
 *   the cord's length pops the FAR jack — the stationary socket's plug, the
 *   dragged cube keeps its — through the same approved linked→popped
 *   transition an explicit popCords intent takes. The popped jack dangles
 *   from the seated end (free rope end + gravity; its render override is
 *   cleared so it rides the rope), the ~3s grace opens, and grabbing the
 *   popped jack and seating it before expiry re-links the cord (the ordinary
 *   grab + INT-2 seat path — already legal; nothing new to permit). The
 *   composition's one obligation is the SAME-FRAME LATCH DROP: see
 *   `releaseSeat`.
 * - LIFE-2 — THE VANISH SEQUENCE (src/sim/vanish.ts, the sim's own
 *   choreography; this layer REACTS to its events): when a cord fails — a
 *   carried end released off-cube, or the popped grace expiring — the
 *   failing end becomes a FREE rope end and FALLS under gravity (the sim's
 *   own fall — no scripted descent, no drop targets), the jack SHATTERS on
 *   first floor contact (dark fragment particles at the impact point, its
 *   mesh despawning with them), the cord PULLS OUT of its seated cube (the
 *   far end unseats and the body collapse-impulses toward the shatter
 *   point), and after a short pull window the whole cord fades and VANISHES
 *   — the sequence itself reports completion and the world removes the cord
 *   (scene clean; no leaked proxies or meshes). THE SHADOW-HAZARD FIX (the
 *   LIFE-1 verifier's carry-forward): a vanishing plug stops shadowing its
 *   host cube's face — the FAILING end's pick proxy unregisters at sequence
 *   START (nothing on a vanishing cord is grabbable, so its proxy is pure
 *   shadow), and the SEATED end's proxy unregisters at PULL-OUT (the exact
 *   moment its plug physically leaves the socket — until then it is an
 *   honest visible plug). After the pull-out, releases onto that face seat
 *   on the cube again.
 * - MULTI-CORD INPUT: one pointer can drive at most one DRAG, but a drop on
 *   one cord can overlap a carry on another (spawn-while-carrying), and one
 *   dragged cube can transport several seated plugs — so this layer composes
 *   PLURAL intents (`SimInput.pinTargets` / `seatTargets`, each entry routed
 *   by cordId) into reused arrays; the world step routes them per rope.
 *   Per cord, at most one controller may emit targets: grabbing one end
 *   cancels the other end's controller (a mid-drop other end simply falls —
 *   the rope re-frees it when the carry switches).
 * - INT-5 — THE PASSIVE CURSOR-BRUSH (src/sim/brush.ts): moving the mouse —
 *   hover, NO button — sweeps a halo through the scene and every cord's free
 *   segments inside it get a small velocity impulse away from the cursor ray
 *   ("running your mouse against the cord triggers a little bit of physics
 *   collision animation so you see the dangle"). The pointer mapper composes
 *   `SimInput.brush` ONLY on frames a real pointermove arrived (an idle
 *   cursor costs nothing and never injects energy, even when a cord swings
 *   through the ray); the world applies one impulse pass per new move.
 *   Seated/carried/anchored ends are pins and never impulse; vanishing cords
 *   stay brushable to their last frame (documented in brush.ts). The
 *   tunables below (BRUSH) are the feel knobs: halo reach in rest lengths
 *   and peak impulse speed.
 * - REN-3 — THE FACEPLATE HUD (src/hud/): the Drum Machine Panel strip
 *   along the bottom edge — segmented CORDS / LINKED readouts (lit segments
 *   = the sim's real counts, read from the lifecycle every frame), the NEW
 *   CORD and RESET keycaps (real buttons: keyboard-reachable, lit-bracket
 *   focus), and the aria-live scene summary. The buttons route through the
 *   same functions the N and R keys use. RESET clears the CORDS only —
 *   cubes keep their positions (repositioning them is not approved scope)
 *   — by rebuilding the world without the anchor cord: no confirmation
 *   dialog (toy scale; the action is visual and instantly re-performable).
 * - REN-4 — THE LINK CHASE PULSE (src/render/pulse.ts + the render layer):
 *   on a LINKED cord a warm amber LED travels the tube red end → blue end
 *   and repeats, like signal flowing, like a chase light locked to a tempo
 *   clock — and the phase IS locked to the sim clock (a pure function of
 *   SimState.time, never wall time or frame deltas). This layer's whole job
 *   is the gate: per frame it hands the renderer the ids whose lifecycle
 *   state is exactly `linked` (the only pulsing state — awaiting-plug,
 *   popped, vanishing, carried cords carry no glow), plus the
 *   prefers-reduced-motion flag (the cadence slows by half; the live-state
 *   reading survives). The `window.cords.pulse()` seam exposes the clock
 *   for the e2e drives: time, phase, speeds, linked ids.
 * - REN-5 — STATE PAINT (src/render/states.ts + the render layer), the
 *   composition again only composes TRUTH: per frame it hands the renderer
 *   the grace list (each popped cord's failing end + its machine-read grace
 *   seconds; vanishing cords ride the list at 0 so the dim holds its floor
 *   through LIFE-2's fade with no flash at expiry). The renderer derives
 *   everything else: stretch ticks on taut carried/awaiting-plug cords
 *   (silkscreen furniture), the cord's countdown dimming, and the popped
 *   jack's low-battery band blink through the grace window's final half,
 *   quickening toward expiry (steady under reduced motion). The shatter
 *   event also names the failing end's POLARITY (index
 *   0 is the red input end for every production cord — INT-4's spawn law),
 *   so the burst carries a red or blue BAND shard: THAT end dying.
 * - A11Y-1 — THE ACCESSIBILITY FLOOR, composed here because the preference
 *   is the USER'S ENVIRONMENT, not the sim's: prefers-reduced-motion is
 *   read live every frame (a cached MediaQueryList) and dampens the
 *   page-INDUCED motion only — the chase pulse slows ×0.5 (REN-4's seam;
 *   the linked reading survives: the pulse IS the "linked" signal), the
 *   popped jack's band holds steady (REN-5's seam; the grace DIM stays —
 *   it is state, not motion), the shatter burst no-ops (LIFE-2's seam; the
 *   fall/pull/vanish sequence itself is unchanged — its timings are
 *   contracts), and the cursor-brush's impulse amplitude halves (the
 *   `strengthScale` input seam). THE DOCUMENTED BOUNDARY: the sim's own
 *   physics — SIM-3's settle/damping tunables, the leash, gravity, LIFE-2's
 *   choreography timings — is determinism/DoD-pinned and is NOT altered by
 *   a user preference; reduced motion dampens what the page INDUCES, never
 *   the physics' honest response. The floor's keyboard half lives in the
 *   HUD (real buttons, focus brackets) and the N/R keys below; the stage
 *   canvas carries an accessible name, and the scene summary (aria-live)
 *   speaks every lifecycle transition. Keyboard BOUNDARY, disclosed:
 *   plugging a jack needs pointer aiming — the keyboard floor covers
 *   SPAWN, RESET, and the summary, not seating.
 * - LIFE-3 — RESILIENCE, the composition's honest answer to the two
 *   environmental failures a GPU page must survive: the render layer's
 *   frame gate (see render/frameGate.ts) pauses the whole tick on
 *   `webglcontextlost` (preventDefault — the sim is pure plain data, so
 *   pausing loses NOTHING; resuming is exact) and on the hidden-tab
 *   `visibilitychange` path (explicit, on top of ARC-3's delta clamp, so
 *   the pause holds even where rAF still ticks); both resumes are CLEAN —
 *   one zero-delta frame, no backlog ever reaches the driver. On context
 *   RESTORE the gate re-bakes the one GPU-only resource (the PMREM env)
 *   before the first frame. The `window.cords.resilience()` read seam is
 *   the verification truth; the two `force*` seams exist ONLY for the e2e
 *   drive (they fire the REAL browser events via WEBGL_lose_context — no
 *   synthetic shortcut).
 */
import * as THREE from 'three';
import {
  DEFAULT_GRACE_SECONDS,
  DEFAULT_ROPE_CONFIG,
  DEFAULT_OVERSTRETCH_THRESHOLD,
  createCordWorldStep,
  createFixedTimestepDriver,
} from './sim';
import type {
  PinTargetInput,
  Ray3,
  ReleaseJackInput,
  SeatInput,
  SimState,
  SpawnCordInput,
  VanishEvent,
  Vec3,
} from './sim';
import { createRenderLayer, CUBE_SIZE } from './render/scene';
import type { CordGraceInfo, RenderFrameInfo, SeatPose } from './render/scene';
import {
  DEFAULT_PULSE_SPEED,
  pulsePhase,
  resolvePulseSpeed,
} from './render/pulse';
import { graceBlinkOn, graceDimming } from './render/states';
import { createPointerMapper } from './interaction/pointer';
import { createThreeRaycastProvider } from './interaction/threeRaycastProvider';
import type { PickableHandle } from './interaction/threeRaycastProvider';
import { createPicker } from './interaction/picking';
import { createCarryController } from './interaction/carry';
import type { CarryController } from './interaction/carry';
import { createCubeDragController } from './interaction/cubeDrag';
import { createSocketRegistry, pickSeatTarget, planSeat } from './interaction/socket';
import { createHudPanel } from './hud/panel';
import { createHudCounts, readHudCountsInto, vanishNotice } from './hud/model';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('#app mount point missing from index.html');
}

// Fixed-timestep tuning (ARC-3): the sim advances only in SIM_TIMESTEP
// slices, so behavior is frame-rate independent and deterministic. The cap
// bounds worst-case work per frame; anything beyond it (a backgrounded
// tab's multi-second gap) is discarded so the sim never detonates.
const SIM_TIMESTEP = 1 / 120;
const MAX_SUBSTEPS_PER_FRAME = 5;

// M1 world: ONE cord hanging in view from its seated anchor over the REN-1
// bench — now cord 0 of the INT-4 world; N spawns more beside it (same
// segment geometry, so one CORD_SEGMENTS constant serves every cord).
const CORD_SEGMENTS = 24;
const CORD_PIN: { x: number; y: number; z: number } = { x: 0, y: 1.6, z: 0 };
const FLOOR_Y = 0;
// The end rests a hair ABOVE the floor plane (the pin is exempt from the
// sim's floor clamp, so the interaction layer holds it just off the glass).
// Height = the plug's grip radius, so a released plug lies ON its grip like
// real hardware instead of slicing the bench.
const FLOOR_REST_Y = 0.055;
const FREE_END_INDEX = DEFAULT_ROPE_CONFIG.pinIndex === 0 ? CORD_SEGMENTS : 0;

// INT-4 world cap: the render jack pool holds 16 cords (32 end slots), the
// perf harness proved 12 — the honest ceiling is the pool. Spawning at the
// cap is a no-op.
const MAX_CORDS = 16;

// INT-4 spawn placement: the cursor ray meets the camera-facing plane
// through this reference point (a robust always-intersecting choice for the
// fixed camera); with no cursor or a degenerate ray the cord appears at the
// point itself — the default stage spot, above the bench mid-scene.
const SPAWN_REFERENCE: { x: number; y: number; z: number } = { x: 0, y: 0.9, z: 0 };

// INT-5 — the passive cursor-brush feel-tunables, stated explicitly (the
// values ARE the brush.ts defaults): the halo reaches 1.5 rest lengths
// (≈25 px of halo at the bench's depth — about a jack's visual width) and
// pushes at ≤1 u/s with the cosine falloff, an order below gravity-driven
// speeds: a swept cord sways visibly and calms in the ordinary settle window.
const BRUSH = { radiusRestLengths: 1.5, strength: 1.0 } as const;

/**
 * A11Y-1 — reduced motion DAMPENS THE PAGE-INDUCED DANGLE: the brush's
 * impulse amplitude halves (the same ×0.5 the chase pulse slows by). The
 * scale rides the per-frame brush INPUT (`BrushInput.strengthScale`), never
 * the world's config: the world was built once and the preference can flip
 * mid-session, and the sim stays a pure function of its inputs. DOCUMENTED
 * BOUNDARY: the sim's settle/damping physics is untouched — SIM-3's settle
 * window and jitter floor are DoD/determinism contracts, so reduced motion
 * softens what the page INDUCES (the brush nudge), not how a cord honestly
 * settles once moved.
 */
const BRUSH_REDUCED_STRENGTH_FACTOR = 0.5;

const render = createRenderLayer(app, {
  cords: [
    {
      id: 0,
      pointCount: CORD_SEGMENTS + 1,
      redEnd: 'first',
      // REN-5 — the tick ruler's unit (the sim's own rope default).
      segmentLength: DEFAULT_ROPE_CONFIG.segmentLength,
    },
  ],
});

// A11Y-1 — the stage canvas's ACCESSIBLE NAME. The scene is interactive,
// but only via the pointer (aiming); the canvas is therefore role="img"
// with a description of WHAT the scene is and HOW it is driven — the
// keyboard's actual powers (N/R) are named here AND in the live summary,
// and the dynamic state is the summary's job, not a static label's. The
// canvas itself stays out of the tab order (no tabindex): it holds nothing
// keyboard-operable, and a focus stop with no action is a trap in disguise.
render.domElement.setAttribute('role', 'img');
render.domElement.setAttribute(
  'aria-label',
  'Interactive cable patch bench: eight steel cubes on a dark studio stage. ' +
    'Cords spring from the cursor and their red and blue jacks plug into cube ' +
    'faces to link cubes; dragging linked cubes too far pops a jack. Keyboard: ' +
    'N spawns a cord, R resets the bench; plugging itself needs the mouse. ' +
    'The faceplate below the stage reports live cord and link counts.',
);

// INT-1 picking: real ray conversion injected; the REN-2 world registers its
// pickables here — cubes (grabbable since INT-3) and, since INT-4, BOTH end
// proxies of EVERY cord (each registered as pick class 'jack', seated ends
// included: grabbing a seated end is the un-seat).
interface CubePayload {
  kind: 'cube';
  id: number;
}
interface CordEndPayload {
  kind: 'cordEnd';
  cordId: number;
  index: number;
}

const picking = createThreeRaycastProvider({
  camera: render.camera,
  element: render.domElement,
});
render.pickables.cubes.forEach((cube, id) => {
  const payload: CubePayload = { kind: 'cube', id };
  picking.registerPickable({ class: 'cube', object: cube, payload });
});
const picker = createPicker(picking);

const pointer = createPointerMapper(picking.rayFromClient);

// M1/INT-2 — the socket placement rule: per-cube plug counts for the soft
// cap; self-links are legal and the cap counts PLUGS, never cords.
const sockets = createSocketRegistry();

// INT-3 — cube dragging (translate-only).
const cubeDrag = createCubeDragController({ cubeHalfSize: CUBE_SIZE / 2, floorY: FLOOR_Y });

// ---------------------------------------------------------------------------
// INT-4 — per-cord runtime: the composition-root side of each cord in the
// world (pick handles, per-end carry controllers, per-end seat records).
// Created eagerly for the anchor cord 0 and lazily for each cord the world
// spawns (after its first render, when its proxies exist and are positioned).
// ---------------------------------------------------------------------------

interface SeatRecord {
  readonly cordId: number;
  readonly index: number;
  readonly renderEnd: 'first' | 'last';
  readonly cubeId: number;
  /** The host cube's center at seat time (the seat rides its drag delta). */
  readonly baseCenter: Vec3;
  /** The seated pin at seat time. */
  readonly basePin: Vec3;
  /** The pose the renderer snaps the jack to — mutated in place by follow. */
  readonly pose: SeatPose;
  /** The per-frame seat latch entry (position aliases pose.position). */
  readonly seatInput: SeatInput;
}

interface CordRuntime {
  readonly id: number;
  readonly endIndex: readonly [0, number];
  readonly payloads: readonly [CordEndPayload, CordEndPayload];
  readonly handles: readonly [PickableHandle, PickableHandle];
  readonly carries: readonly [CarryController, CarryController];
  readonly seats: [SeatRecord | null, SeatRecord | null];
  /**
   * REN-5 — the FAILING end's slot once LIFE-2's sequence starts (the vanish
   * `start` event names it): the grace list keeps naming it through the
   * vanish so the band blink + dim hold the right end without re-deriving
   * it. Null when the cord is not vanishing.
   */
  failingSlot: 0 | 1 | null;
}

const cordRuntimes = new Map<number, CordRuntime>();

function registerCordRuntime(cordId: number): CordRuntime {
  const existing = cordRuntimes.get(cordId);
  if (existing !== undefined) return existing;
  const proxies = [
    render.pickables.jackProxy(cordId, 0),
    render.pickables.jackProxy(cordId, CORD_SEGMENTS),
  ];
  if (proxies[0] === undefined || proxies[1] === undefined) {
    throw new Error(`main: jack proxies missing for cord ${cordId}`);
  }
  const payloads: [CordEndPayload, CordEndPayload] = [
    { kind: 'cordEnd', cordId, index: 0 },
    { kind: 'cordEnd', cordId, index: CORD_SEGMENTS },
  ];
  const handles: [PickableHandle, PickableHandle] = [
    picking.registerPickable({ class: 'jack', object: proxies[0], payload: payloads[0] }),
    picking.registerPickable({ class: 'jack', object: proxies[1], payload: payloads[1] }),
  ];
  const runtime: CordRuntime = {
    id: cordId,
    endIndex: [0, CORD_SEGMENTS],
    payloads,
    handles,
    carries: [
      createCarryController({ freeEndIndex: 0, floorRestY: FLOOR_REST_Y, cordId }),
      createCarryController({ freeEndIndex: CORD_SEGMENTS, floorRestY: FLOOR_REST_Y, cordId }),
    ],
    seats: [null, null],
    failingSlot: null,
  };
  cordRuntimes.set(cordId, runtime);
  return runtime;
}

// The anchor cord is live from frame 0 (its render view is pre-staged).
registerCordRuntime(0);

// --- Carry / spawn state ----------------------------------------------------

interface ActiveCarry {
  cordId: number;
  slot: 0 | 1;
  payload: CordEndPayload;
}
/** The end currently in hand, or null. At most one drag, one pointer. */
let activeCarry: ActiveCarry | null = null;
/**
 * INT-4 — a spawn whose cord has not rendered yet (≤1 frame): its red-end
 * carry engages the moment the runtime registers. `released` covers the
 * corner where the pointer already went up again before registration — the
 * controller then begins and ends its drag in one step, so the cord drops
 * per the ordinary release instead of floating in hand.
 */
let pendingCarry: { cordId: number; at: Vec3; released: boolean } | null = null;
/** INT-4 — the spawn request consumed by the next frame's first substep. */
let pendingSpawn: SpawnCordInput | null = null;
/**
 * LIFE-1 — the one-shot release intent: the held jack was released NOT over
 * a cube while its cord was awaiting-plug/popped (the user-initiated failure
 * → vanishing). Consumed by the next frame's first substep, like the spawn.
 */
let pendingRelease: ReleaseJackInput | null = null;
/**
 * LIFE-3 (surfaced by QA-1's fuzz harness) — a failure release whose carry
 * intent has not FLOWED yet: the pointer went down AND back up inside one
 * frame, so no frame has composed the carry and the machine has not applied
 * the grab (#7/#8) — the end's mode is still 'seated'/'free', and a
 * releaseJack now would be rejected (production: a console warning and a
 * composition/sim seat-latch desync). The drag stays alive so the carry
 * flows, and the frame loop fires the release the first frame the machine
 * reports the end actually in hand (below, before pendingRelease).
 */
let stagedFailureRelease: { cordId: number; index: number; slot: 0 | 1 } | null = null;
let nextCordId = 1; // 0 is the anchor cord

// Reused per-frame intent arrays — composed fresh in place every frame, no
// steady-state allocation. Declared here (before the world's construction)
// because INT-6's pop hook splices the CURRENT frame's seat latch out of
// `seatTargets` mid-step: the driver replays one input object across a
// frame's substeps, and the popped end's latch entry must be gone from that
// shared array before the seats phase of the very substep that popped runs.
const carryTargets: PinTargetInput[] = [];
const seatTargets: SeatInput[] = [];

let simState: SimState = { time: 0, cords: [] };

// --- LIFE-2 — the vanish sequence's composition side --------------------------------
//
// The choreography is the SIM'S (src/sim/vanish.ts + the world step): the
// fall is gravity, the shatter is an observed floor contact, the pull-out is
// the machine's own un-seat, the completion report removes the cord. This
// layer only REACTS to the four events — each exactly once per sequence, in
// order — plus the per-frame fade read below. The one law with teeth: the
// PULL event must release the socket bookkeeping AND splice the pulled end's
// latch entry out of the CURRENT frame's `seatTargets` array (releaseSeat)
// BEFORE this step's seats phase re-sends it — the same-frame discipline
// INT-6 established for pops; without it every replayed latch would draw a
// lifecycle rejection (the machine's lock holds, but the warning channel
// would scream and the caller contract would be broken).

/**
 * A11Y-1 — the ONE environmental read the composition makes: a cached
 * prefers-reduced-motion query, sampled per frame (never mid-step), feeding
 * every seam — the REN-4 chase pulse (×0.5 slower), the REN-5 band blink
 * (steady), the LIFE-2 shatter burst (skipped), and the INT-5 brush
 * amplitude (halved, via the per-frame `strengthScale` below). What it never
 * touches: the sim's own physics (see BRUSH_REDUCED_STRENGTH_FACTOR).
 */
const reducedMotionQuery: MediaQueryList | null =
  typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

function prefersReducedMotion(): boolean {
  return reducedMotionQuery !== null && reducedMotionQuery.matches;
}

/**
 * REFINE-1 — vanish sequences that BEGAN inside the current frame's substeps
 * (the 'start' event, either entry path: grace expiry or the off-cube
 * release). Consumed by the frame loop's HUD update, which folds it into ONE
 * `vanishNotice` line — the failure is named once per death, never spammed.
 */
let vanishStartsSinceUpdate = 0;

/**
 * THE SHADOW-HAZARD FIX (LIFE-1 verifier's carry-forward): take one end's
 * jack proxy out of the pick set. Un-registering is what un-shadows the host
 * cube's face (the render layer also drops its proxies' raycast layers at
 * despawn — belt and braces). Idempotent per slot.
 */
function unregisterEndProxy(runtime: CordRuntime, slot: 0 | 1): void {
  runtime.handles[slot].unregister();
}

/** The despawn cleanup: no pick proxy, no carry controller, no seat record outlives the cord. */
function cleanupCordRuntime(cordId: number): void {
  const runtime = cordRuntimes.get(cordId);
  if (runtime === undefined) return;
  for (const slot of [0, 1] as const) {
    unregisterEndProxy(runtime, slot);
    runtime.carries[slot].cancel();
    releaseSeat(runtime, slot);
  }
  cordRuntimes.delete(cordId);
}

function handleVanishEvent(event: VanishEvent): void {
  const runtime = cordRuntimes.get(event.cordId);
  const slot: 0 | 1 | null = event.end === null ? null : event.end === 0 ? 0 : 1;
  switch (event.kind) {
    case 'start': {
      // REFINE-1 — the failure's one spoken line: the death counts here
      // (whatever the bookkeeping below finds), and the frame loop's HUD
      // update turns this frame's vanish starts into ONE notice riding the
      // next summary repaint — the screen reader's "why did it die".
      vanishStartsSinceUpdate += 1;
      // The failing end is a free rope end from here: nobody may hold or
      // target it (the world ignores carry intents on vanishing cords; this
      // side stops COMPOSING them), and its proxy stops shadowing whatever
      // its fall passes over — nothing on a vanishing cord is grabbable.
      if (runtime === undefined || slot === null) return;
      runtime.failingSlot = slot; // REN-5 — the grace list keeps naming it
      if (activeCarry !== null && activeCarry.cordId === event.cordId) activeCarry = null;
      for (const s of [0, 1] as const) runtime.carries[s].cancel();
      unregisterEndProxy(runtime, slot);
      return;
    }
    case 'shatter': {
      // Instant on first floor contact: the fragments burst at the impact
      // point and the end jack's mesh despawns with them. REN-5 — the burst
      // names the failing end's POLARITY (sim index 0 is the RED input end
      // for every production cord: INT-4's spawn law + the anchor's spec),
      // so the debris carries a red or blue BAND shard — THAT end dying.
      if (runtime === undefined || slot === null || event.at === null) return;
      render.shatter(event.at, {
        reduced: prefersReducedMotion(),
        band: event.end === 0 ? 'red' : 'blue',
      });
      render.hideJack(runtime.id, slot === 0 ? 'first' : 'last');
      return;
    }
    case 'pull': {
      // The cord pulls out of its seated cube: the socket lets go HERE (cap
      // count, render override, record + same-frame latch splice), and the
      // freed face stops being shadowed — releases onto it seat on the CUBE
      // again (the regression the LIFE-1 verifier flagged).
      if (runtime === undefined || slot === null) return;
      releaseSeat(runtime, slot);
      unregisterEndProxy(runtime, slot);
      return;
    }
    case 'complete': {
      // The world has removed the cord (the sequence's own completion
      // report); this layer leaks nothing: proxies, controllers, records gone.
      cleanupCordRuntime(event.cordId);
      return;
    }
  }
}

// T-LIFE-1 — the world step carries the lifecycle machine; this composition
// subscribes so the socket bookkeeping follows the SIM's truth: when the sim
// pops a jack (linked → popped, INT-6's transition), the socket record — cap
// count, seat override, latch — is released here in the same event. Rejections
// (illegal transitions, production's "no-op-with-warning") surface as console
// warnings; a strict world would throw instead (tests).
//
// T-REN-3 — the world is built by a FACTORY because RESET rebuilds it: the
// empty scene is the same world minus the anchor cord (the config's own
// spawn-only mode), so every subscription below is re-armed identically and
// the old machine's records die with the old world. `world`/`driver` are
// therefore `let` bindings every closure reads live.
function buildWorld(withAnchor: boolean) {
  return createCordWorldStep({
    ...(withAnchor
      ? { anchor: { pin: CORD_PIN, segmentCount: CORD_SEGMENTS, floorY: FLOOR_Y } }
      : {}),
    cord: { segmentCount: CORD_SEGMENTS, floorY: FLOOR_Y },
    maxCords: MAX_CORDS,
    // T-INT-6 — the over-stretch auto-unplug, ON in the production world: a
    // LINKED cord dragged past 104% of its total rest length pops its FAR jack
    // (the seat that moved less — the stationary socket; the dragged cube
    // keeps its plug). The pop fires INSIDE the world step (the sim owns the
    // detection; threshold tunable, approved ~2–5%).
    overStretch: { threshold: DEFAULT_OVERSTRETCH_THRESHOLD },
    // T-LIFE-2 — the vanish choreography, ON in the production world: fall →
    // shatter → pull-out → fade → despawn, per vanishing cord, with tunable
    // timings (pull window 0.35s; the fall is physics-speed). ABSENT config
    // keeps LIFE-1's locked-forever behavior — tests construct that world.
    vanish: { onEvent: handleVanishEvent },
    // T-INT-5 — the passive cursor-brush tunables (feel; see BRUSH above).
    brush: BRUSH,
    lifecycle: {
      onTransition: (event) => {
        if (event.to === 'popped' && event.end !== null) {
          const runtime = cordRuntimes.get(event.cordId);
          if (runtime !== undefined) releaseSeat(runtime, event.end === 0 ? 0 : 1);
        }
      },
      onRejected: (rejection) => {
        console.warn(
          `cords: lifecycle rejected ${rejection.action} on cord ${rejection.cordId} (${rejection.from}): ${rejection.detail}`,
        );
      },
    },
  });
}
let world = buildWorld(true);
let driver = createFixedTimestepDriver(world, {
  timestep: SIM_TIMESTEP,
  maxSubsteps: MAX_SUBSTEPS_PER_FRAME,
});

// --- Shared helpers ----------------------------------------------------------

const cordEndPoint = (cordId: number, index: number): Vec3 =>
  simState.cords.find((cord) => cord.id === cordId)?.points[index] ?? { x: 0, y: 0, z: 0 };

/**
 * INT-4 — the un-seat's bookkeeping half: the socket lets go (cap count
 * released, seat override cleared, seat record dropped) when its jack is
 * grabbed. The SIM-side un-seat rides the carry intent (the world step calls
 * `rope.unseat` the frame the grab's targets flow).
 *
 * INT-6 — SAME-FRAME LATCH DROP (the LIFE-1 verifier's carry-over, honored):
 * when the OVER-STRETCH POP fires inside a substep, the popped end's seat
 * record is dropped here in the pop's own onTransition event — and the
 * record's latch entry is ALSO spliced out of the CURRENT frame's
 * `seatTargets` array. The fixed-timestep driver replays one input object
 * across the frame's substeps, and the detector runs BEFORE the seats phase
 * of each substep: without the splice, the very substep that popped (or its
 * replay in the next) would re-send the stale latch and "re-plug" the popped
 * end through the legal #5 re-seat. With it, the popped jack is physically
 * free (rope end unpinned, danging from the other seated end under gravity)
 * in the SAME frame the pop fires, and the next frame's compose simply does
 * not re-add it. The grabbed-seated-end path (pointerdown) shares this
 * splice harmlessly — the next frame recomposes the array anyway.
 */
function releaseSeat(runtime: CordRuntime, slot: 0 | 1): void {
  const record = runtime.seats[slot];
  if (record === null) return;
  runtime.seats[slot] = null;
  const latchIndex = seatTargets.indexOf(record.seatInput);
  if (latchIndex >= 0) seatTargets.splice(latchIndex, 1);
  render.setSeatOverride(runtime.id, record.renderEnd, null);
  sockets.release(record.cubeId);
}

/**
 * LIFE-1 (coordinator amendment) — can this jack be grabbed RIGHT NOW? The
 * cursor affordance and the pointerdown handler agree through this one
 * predicate, so pixels and sim never diverge:
 *
 * - A SEATED end is grabbable: INT-4's hand-pulled plug stands (the machine
 *   applies linked→awaiting-plug / awaiting-plug→carried when the carry
 *   intent flows; releasing the pulled jack off-cube then vanishes the cord
 *   — the composed removal path).
 * - POPPED's surviving SOCKET is not: popped's exits are the re-seat and
 *   the grace, so the over-stretch pop must not be dodgeable by grabbing
 *   the socket that still holds.
 * - Anything while VANISHING is locked (LIFE-2 owns the exit), and a
 *   despawned cord ('gone'/undefined) has no live jack to hold.
 */
function jackGrabbable(cordId: number, index: number): boolean {
  const state = world.lifecycle.stateOf(cordId);
  if (state === undefined || state === 'vanishing') return false;
  if (state === 'popped' && world.lifecycle.endMode(cordId, index) === 'seated') return false;
  return true;
}

function seatCarriedJack(
  runtime: CordRuntime,
  slot: 0 | 1,
  cubeId: number,
  attempt: Extract<ReturnType<typeof planSeat>, { outcome: 'seated' }>,
): void {
  const pose: SeatPose = {
    position: { x: attempt.pose.position.x, y: attempt.pose.position.y, z: attempt.pose.position.z },
    axis: { x: attempt.pose.axis.x, y: attempt.pose.axis.y, z: attempt.pose.axis.z },
  };
  const mesh = render.pickables.cubes[cubeId];
  const record: SeatRecord = {
    cordId: runtime.id,
    index: runtime.endIndex[slot],
    renderEnd: slot === 0 ? 'first' : 'last',
    cubeId,
    baseCenter: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
    basePin: { x: pose.position.x, y: pose.position.y, z: pose.position.z },
    pose,
    seatInput: { cordId: runtime.id, index: runtime.endIndex[slot], position: pose.position },
  };
  runtime.seats[slot] = record;
  render.setSeatOverride(runtime.id, record.renderEnd, record.pose);
}

/** Ray ∩ the camera-facing plane through `point` (the spawn placement math). */
function rayPlanePoint(ray: Ray3, point: Vec3, normal: Vec3): Vec3 | null {
  const denom =
    ray.direction.x * normal.x + ray.direction.y * normal.y + ray.direction.z * normal.z;
  if (Math.abs(denom) < 1e-9) return null;
  const t =
    ((point.x - ray.origin.x) * normal.x +
      (point.y - ray.origin.y) * normal.y +
      (point.z - ray.origin.z) * normal.z) /
    denom;
  if (!(t > 0)) return null;
  return {
    x: ray.origin.x + ray.direction.x * t,
    y: ray.origin.y + ray.direction.y * t,
    z: ray.origin.z + ray.direction.z * t,
  };
}

// --- INT-4 spawn (N key + the HUD seam) ---------------------------------------

const scratchSpawnDir = new THREE.Vector3();

/** The world point a new cord appears at: cursor on the spawn plane, else the default stage spot. */
function spawnPoint(): Vec3 {
  const ray = pointer.readInput().pointerRay;
  render.camera.getWorldDirection(scratchSpawnDir);
  if (ray !== null) {
    const hit = rayPlanePoint(ray, SPAWN_REFERENCE, scratchSpawnDir);
    if (hit !== null) return hit;
  }
  return SPAWN_REFERENCE;
}

/**
 * Put a new cord in hand. The HUD-callable seam (exposed below as
 * `window.cords.spawnCord()` until REN-3 wires its button through it).
 */
function spawnCordRequest(): void {
  if (simState.cords.length >= MAX_CORDS) return; // honest cap: no-op
  const at = spawnPoint();
  // Whatever the pointer holds is released, per the SAME release policy as
  // pointer-up (LIFE-1): an awaiting-plug/popped cord's held jack dropped
  // off-cube reports the release intent (→ vanishing); a carried cord's end
  // takes the ordinary drop. A dragged cube stops (kinematic dropping is
  // stopping — dropping is stopping), and the cord lands in hand.
  if (activeCarry !== null) {
    const runtime = cordRuntimes.get(activeCarry.cordId);
    if (runtime !== undefined) {
      releaseHeldEnd(
        activeCarry.cordId,
        activeCarry.slot,
        cordEndPoint(activeCarry.cordId, runtime.endIndex[activeCarry.slot]),
      );
    }
    activeCarry = null;
  }
  if (cubeDrag.phase === 'dragging') cubeDrag.endDrag();
  pendingCarry = null; // an unspawned predecessor dies with its request
  const atCopy: Vec3 = { x: at.x, y: at.y, z: at.z };
  pendingSpawn = { cordId: nextCordId, at: { x: atCopy.x, y: atCopy.y, z: atCopy.z } };
  pendingCarry = { cordId: nextCordId, at: atCopy, released: false };
  nextCordId += 1;
}

window.addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.repeat) return; // one press, one cord / one reset
  // Modifier chords stay the browser's (Cmd+R must still reload, Cmd+N is
  // the browser's own) — the page's keys are bare N and R only. Shift is
  // deliberately NOT guarded: Shift+N is still the user typing N with caps
  // intent, and both cases are handled below. A11Y-1 pins this floor: the
  // keys work wherever focus sits (window-level listener — body or a HUD
  // button), and no focusable element on the page traps Tab.
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === 'n' || event.key === 'N') spawnCordRequest();
  else if (event.key === 'r' || event.key === 'R') resetScene();
});

// The future HUD's entry point (REN-3's NEW CORD button; also handy in dev),
// plus the T-LIFE-1 read-only lifecycle dump: `window.cords.lifecycle()`
// reports each cord's real state, grace, and — LIFE-2 — live vanish phase +
// progress (the seam REN-3's "labels name real state only" rule, REN-5's
// grace readout and shatter/fade timing, A11Y-1's scene summary, and the
// e2e/verifier drives all read; never write).
//
// T-INT-5 — plus the MOTION PROBE, the verification seam for the passive
// cursor-brush: `setMotionProbe(true)` starts a per-frame sampler that
// tracks, per cord, the MAX point speed (world units per second of SIM
// time — frame-rate independent) observed since the (re)enable; the e2e
// drive proves in numbers that a pointer sweep perturbs the cord and that
// an idle pointer never does (Thor's rule, in pixels). OFF by default and
// free when off — the same law as the brush itself.
let motionProbeEnabled = false;
const motionProbeMax = new Map<number, number>();
const motionProbePrev = new Map<number, number[]>();
let motionProbePrevTime = 0;

function setMotionProbe(enabled: boolean): void {
  motionProbeEnabled = enabled;
  motionProbeMax.clear();
  motionProbePrev.clear();
  motionProbePrevTime = simState.time;
}

function readMotionProbe(): Array<{ id: number; maxSpeed: number }> {
  return Array.from(simState.cords, (cord) => ({
    id: cord.id,
    maxSpeed: motionProbeMax.get(cord.id) ?? 0,
  }));
}

/** One probe sample: max |Δpoint| / Δ(sim time) per cord since the last. */
function sampleMotion(state: SimState): void {
  const dtSim = state.time - motionProbePrevTime;
  if (dtSim > 0 && Number.isFinite(dtSim)) {
    for (const cord of state.cords) {
      const prev = motionProbePrev.get(cord.id);
      if (prev === undefined || prev.length !== cord.points.length * 3) continue;
      let maxSpeed = motionProbeMax.get(cord.id) ?? 0;
      for (let i = 0; i < cord.points.length; i += 1) {
        const p = cord.points[i];
        const k = i * 3;
        const dx = p.x - prev[k];
        const dy = p.y - prev[k + 1];
        const dz = p.z - prev[k + 2];
        const speed = Math.sqrt(dx * dx + dy * dy + dz * dz) / dtSim;
        if (speed > maxSpeed) maxSpeed = speed;
      }
      motionProbeMax.set(cord.id, maxSpeed);
    }
  }
  // Refresh the baseline copies for the next sample (allocation only while
  // the probe is enabled — a debug mode, never the hot path).
  for (const cord of state.cords) {
    let prev = motionProbePrev.get(cord.id);
    if (prev === undefined || prev.length !== cord.points.length * 3) {
      prev = new Array<number>(cord.points.length * 3);
      motionProbePrev.set(cord.id, prev);
    }
    for (let i = 0; i < cord.points.length; i += 1) {
      const p = cord.points[i];
      const k = i * 3;
      prev[k] = p.x;
      prev[k + 1] = p.y;
      prev[k + 2] = p.z;
    }
  }
  motionProbePrevTime = state.time;
}

// T-REN-4 — the chase-pulse READ seam (the e2e/verifier drives' clock
// probe): `window.cords.pulse()` reports the last rendered frame's sim time,
// the phase the renderer computed for it (the same pure pulsePhase call —
// bitwise identical by construction), the base/effective speeds, the
// reduced-motion flag, and the linked ids the gate handed the renderer.
// Read-only, like lifecycle().
let lastLinkedIds: number[] = [];
let lastReducedMotion = false;

function readPulse(): {
  time: number;
  phase: number;
  baseSpeed: number;
  speed: number;
  reduced: boolean;
  linked: number[];
  /** The RENDER layer's own live read (verification seam — must agree). */
  renderPhase: number;
  renderGains: Array<{ id: number; gain: number }>;
} {
  const reduced = lastReducedMotion;
  const probe = render.pulseProbe();
  return {
    time: simState.time,
    phase: pulsePhase(simState.time, { reduced }),
    baseSpeed: DEFAULT_PULSE_SPEED,
    speed: resolvePulseSpeed({ reduced }),
    reduced,
    linked: lastLinkedIds.slice(),
    renderPhase: probe.phase,
    renderGains: probe.cords,
  };
}

// T-REN-5 — the STATE PAINT read seam (the e2e/verifier drives' probe):
// `window.cords.statePaint()` reports, per cord, the lifecycle state, the
// RENDER layer's own live paint (tautness, tick gain/spacing, grace dim,
// band blink — `render.stateProbe()`, not a re-computation of main's), and
// the composed grace entry driving it (null when not counting down), plus
// the reduced-motion flag. Read-only, like lifecycle().
let lastGraceCords: CordGraceInfo[] = [];

function readStatePaint(): {
  reduced: boolean;
  fragments: number;
  cords: Array<{
    id: number;
    state: string;
    stretch: number;
    tickGain: number;
    tickSpacing: number;
    graceFactor: number;
    bandOff: boolean;
    grace: { remaining: number; dim: number; bandLit: boolean } | null;
  }>;
} {
  const probe = render.stateProbe();
  const out = probe.cords.map((entry) => {
    const grace = lastGraceCords.find((g) => g.id === entry.id) ?? null;
    return {
      id: entry.id,
      state: world.lifecycle.stateOf(entry.id) ?? 'gone',
      stretch: entry.stretch,
      tickGain: entry.tickGain,
      tickSpacing: entry.tickSpacing,
      /** The RENDER's actually-applied dim factor (the tube's opacity law). */
      graceFactor: entry.graceFactor,
      /** True while the failing jack's band is in its blinked-OFF phase. */
      bandOff: entry.bandOff,
      grace:
        grace === null
          ? null
          : {
              remaining: grace.remaining,
              dim: graceDimming(grace.remaining, grace.window),
              bandLit: graceBlinkOn(grace.remaining, simState.time, {
                reduced: prefersReducedMotion(),
              }),
            },
    };
  });
  return { reduced: prefersReducedMotion(), fragments: probe.fragments, cords: out };
}

(window as unknown as {
  cords?: {
    spawnCord(): void;
    lifecycle(): Array<{
      id: number;
      state: string;
      grace: number | null;
      vanish: { phase: string; progress: number } | null;
    }>;
    setMotionProbe(enabled: boolean): void;
    readMotionProbe(): Array<{ id: number; maxSpeed: number }>;
    pulse(): {
      time: number;
      phase: number;
      baseSpeed: number;
      speed: number;
      reduced: boolean;
      linked: number[];
      renderPhase: number;
      renderGains: Array<{ id: number; gain: number }>;
    };
    statePaint(): ReturnType<typeof readStatePaint>;
    /**
     * LIFE-3 — the resilience gate's live probe (read-only truth): context
     * loss/restore counts, hidden/paused flags, frames drawn/skipped. The
     * e2e drive asserts against this after a REAL context kill.
     */
    resilience(): {
      contextLost: boolean;
      hidden: boolean;
      paused: boolean;
      framesDrawn: number;
      framesSkipped: number;
      contextLosses: number;
      contextRestores: number;
    };
    /**
     * E2E-ONLY SEAMS (LIFE-3): kill/revive the REAL WebGL context via the
     * browser's WEBGL_lose_context extension — the real `webglcontextlost`
     * / `webglcontextrestored` events fire and the gate handles them. Not
     * used by the app itself, ever.
     */
    forceContextLoss(): void;
    forceContextRestore(): void;
  };
}).cords = {
  spawnCord: spawnCordRequest,
  lifecycle: () =>
    Array.from(cordRuntimes.keys(), (id) => ({
      id,
      state: world.lifecycle.stateOf(id) ?? 'gone',
      grace: world.lifecycle.graceRemaining(id),
      vanish: world.lifecycle.vanishInfo(id),
    })),
  setMotionProbe,
  readMotionProbe,
  pulse: readPulse,
  statePaint: readStatePaint,
  resilience: () => render.frameGate.probe(),
  forceContextLoss: () => render.renderer.forceContextLoss(),
  forceContextRestore: () => render.renderer.forceContextRestore(),
};

// --- T-REN-3 — the faceplate HUD (Drum Machine Panel strip) -------------------

/**
 * RESET — clears every cord to the EMPTY SCENE. Cubes are deliberately
 * untouched: repositioning them is not approved scope, and the strip's
 * RESET names cords only. Semantics, documented:
 *
 * - The world is REBUILT without the anchor cord (the config's own
 *   spawn-only mode — "omit to start with an empty world"), so the
 *   lifecycle machine's records, grace clocks, and in-flight vanish runs
 *   die with the old world instead of being cherry-picked out of it. The
 *   despawnCords intent would not do: it is only accepted while `vanishing`
 *   (LIFE-1's exit contract), so it is not a general clear.
 * - Everything the composition holds for a cord is released through the
 *   one despawn cleanup (pick proxies, carry controllers, seat records —
 *   socket cap counts included, so post-reset seats get the registry back).
 * - Cord ids RESTART at 0: the render layer's views are keyed by id and
 *   REVIVED on reuse (its pool is finite), so ids must not grow forever.
 *   In a no-anchor world id 0 is an ordinary spawn id.
 * - The motion probe's per-id baselines are dropped with the world they
 *   measured (a reused id would otherwise read one bogus speed sample).
 * - No confirmation dialog — toy scale: the action is visible, total, and
 *   instantly re-performable (press N and the bench refills). Deliberate.
 */
function resetScene(): void {
  for (const id of Array.from(cordRuntimes.keys())) cleanupCordRuntime(id);
  pendingSpawn = null;
  pendingCarry = null;
  pendingRelease = null;
  stagedFailureRelease = null; // LIFE-3: the stage dies with the world it named
  activeCarry = null;
  if (cubeDrag.phase === 'dragging') cubeDrag.endDrag(); // dropping is stopping
  frameIndex = INTRO_FRAMES; // the intro pose belonged to the anchor cord
  setMotionProbe(motionProbeEnabled);
  nextCordId = 0;
  world = buildWorld(false);
  driver = createFixedTimestepDriver(world, {
    timestep: SIM_TIMESTEP,
    maxSubsteps: MAX_SUBSTEPS_PER_FRAME,
  });
  simState = { time: 0, cords: [] };
  hud.update(readHudCountsInto(simState.cords, world.lifecycle.stateOf, hudCounts));
}

/** The faceplate's own counts shell — reused every frame, never reallocated. */
const hudCounts = createHudCounts();

const hud = createHudPanel(
  // A11Y-1 — the faceplate mounts INSIDE the page's <main> landmark (the
  // strip is position:fixed, so DOM placement is cosmetic — the landmark
  // structure is not). Falls back to body if a future host drops <main>.
  (document.querySelector('main') ?? document.body),
  document,
  {
    // Both controls route through the SAME functions their keys use: one law
    // for pointer and keyboard, pixels and sim never diverge.
    onNewCord: spawnCordRequest,
    onReset: resetScene,
  },
);

/**
 * LIFE-1/LIFE-2 — the release policy shared by pointer-up and the
 * spawn-while-carrying swap. An awaiting-plug/popped cord's held jack
 * dropped anywhere but a cube is THE user-initiated failure: queue the
 * one-shot release intent (→ vanishing) and CANCEL the controller — LIFE-2's
 * fall is the sim's (the failing end becomes a free rope end inside the
 * world step and gravity brings it down; drop targets would be a scripted
 * descent). A plain `carried` cord (nothing seated) takes the ordinary M1
 * floor-rest drop.
 */
function releaseHeldEnd(cordId: number, slot: 0 | 1, endPoint: Vec3): void {
  const runtime = cordRuntimes.get(cordId);
  if (runtime === undefined) return;
  const cordState = world.lifecycle.stateOf(cordId);
  if (cordState === 'awaiting-plug' || cordState === 'popped') {
    const index = runtime.endIndex[slot];
    if (world.lifecycle.endMode(cordId, index) === 'carrying') {
      pendingRelease = { cordId, index };
      runtime.carries[slot].cancel(); // the FALL is the sim's — no scripted drop
      return;
    }
    // Same-frame grab+release: the machine has not seen the grab yet. Keep
    // the drag alive so the carry flows (the approved #7/#8 applies), and
    // let the frame loop fire the release the moment the end is in hand.
    stagedFailureRelease = { cordId, index, slot };
    return;
  }
  runtime.carries[slot].endDrag(endPoint);
}

// --- Pointer events (the grab loop, per cord) ----------------------------------

render.domElement.addEventListener('pointerdown', (event: PointerEvent) => {
  frameIndex = INTRO_FRAMES; // user input outranks the opening pose
  // One pointer, one drag: while an end or a cube is already held, a new
  // grab request is ignored (desktop mouse-only MVP, guarded for totality).
  // Drops are NOT drags: grabbing while another end finishes its drop is
  // allowed (and cancels that drop — see below).
  if (activeCarry !== null || cubeDrag.phase === 'dragging') return;
  const ray = picking.rayFromClient(event.clientX, event.clientY);
  if (ray === null) return;
  const hit = picker.pickGrabbable(ray);
  if (hit === null) return;
  if (hit.class === 'jack') {
    const payload = hit.payload as CordEndPayload;
    const runtime = cordRuntimes.get(payload.cordId);
    if (runtime === undefined) return;
    const slot: 0 | 1 = payload.index === 0 ? 0 : 1;
    // LIFE-1 — the grabability law (the cursor and this handler agree through
    // jackGrabbable): a SEATED end IS grabbable (the coordinator amendment:
    // INT-4's hand-pulled plug stands — the machine applies linked→
    // awaiting-plug / awaiting-plug→carried when the carry intent flows, and
    // the failure model composes: release the pulled jack off-cube and the
    // cord vanishes). NOT grabbable: POPPED's surviving socket (its exits are
    // the re-seat and the grace — the pop must not be dodgeable by grabbing
    // the socket that still holds) and any end while VANISHING (the lock;
    // LIFE-2 owns the exit). Despawned cords read 'gone' → not grabbable.
    if (!jackGrabbable(payload.cordId, payload.index)) return;
    // INT-4 — grabbing a seated jack pulls the plug: the socket lets go
    // here; the sim un-seats (with the lifecycle transition) when this
    // grab's carry targets flow.
    releaseSeat(runtime, slot);
    // One carried end per cord: silence the other end's controller. A
    // mid-drop other end stops dropping — the rope re-frees that end when
    // the carry switches, and it falls damped. Matches the rope exactly.
    runtime.carries[1 - slot].cancel();
    // LIFE-3 — re-grabbing the staged end keeps the plug in hand: the user
    // changed their mind inside the same-frame window; their NEXT release
    // routes again through releaseHeldEnd.
    if (
      stagedFailureRelease !== null &&
      stagedFailureRelease.cordId === payload.cordId &&
      stagedFailureRelease.slot === slot
    ) {
      stagedFailureRelease = null;
    }
    runtime.carries[slot].beginDrag(cordEndPoint(payload.cordId, payload.index));
    activeCarry = { cordId: payload.cordId, slot, payload };
  } else if (hit.class === 'cube') {
    // INT-3 — grab the cube at the hit point: the drag plane passes through
    // it and the center keeps its grab-time offset (no snap-to-cursor).
    const payload = hit.payload as CubePayload;
    const mesh = render.pickables.cubes[payload.id];
    const grabPoint =
      hit.point ?? { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z };
    cubeDrag.beginDrag(payload.id, grabPoint, mesh.position);
  }
});

window.addEventListener('pointerup', (event: PointerEvent) => {
  // INT-3 — cube release: dropping is stopping.
  if (cubeDrag.phase === 'dragging') {
    cubeDrag.endDrag();
    return;
  }
  // INT-4 — the pointer went up before the spawned cord's runtime registered
  // (a sub-frame corner): the cord drops the moment it exists.
  if (pendingCarry !== null) {
    pendingCarry.released = true;
    return;
  }
  if (activeCarry === null) return;
  const runtime = cordRuntimes.get(activeCarry.cordId);
  if (runtime === undefined) {
    activeCarry = null;
    return;
  }
  const slot = activeCarry.slot;
  const controller = runtime.carries[slot];
  // INT-2 — the release decision: over a cube face, the carried jack tries
  // to SEAT (the socket rule decides, cap included); anywhere else it drops.
  // pickSeatTarget skips the carried jack's own payload; every OTHER jack —
  // seated ends included, since INT-4 keeps them pickable — keeps priority.
  const ray = picking.rayFromClient(event.clientX, event.clientY);
  const target = ray !== null ? pickSeatTarget(picker.pick(ray), activeCarry.payload) : null;
  if (target !== null && target.class === 'cube' && target.point !== null && target.normal !== null) {
    const payload = target.payload as CubePayload;
    const attempt = planSeat(sockets, {
      cubeId: payload.id,
      hitPoint: target.point,
      faceNormal: target.normal,
    });
    if (attempt.outcome === 'seated') {
      // The plug event: the sim-side seat flows through the per-frame seat
      // latch below; the verified settle runs from the hardening frame.
      seatCarriedJack(runtime, slot, payload.id, attempt);
      controller.cancel(); // a seat is not a drop — no floor targets follow
      activeCarry = null;
      return;
    }
    // Cap deny: the visible cue, and the jack stays carried. The release
    // below then takes over — and for a half-plugged cord that means the
    // lifecycle failure (see below), not a free drop.
    render.flashDeny(payload.id, target.point, attempt.normal);
  }
  // LIFE-1/LIFE-2 — the release decision, lifecycle-owned. Over a cube the
  // jack SEATED (above, the INT-2 path). Anywhere else the FSM decides: a
  // held jack released off-cube from an AWAITING-PLUG or POPPED cord is THE
  // user-initiated failure (→ vanishing → LIFE-2's sequence: free fall,
  // shatter, pull-out, despawn — the controller cancels so the fall is the
  // sim's own); a plain `carried` cord takes the ordinary drop — the
  // approved spawn/drop churn.
  releaseHeldEnd(activeCarry.cordId, slot, cordEndPoint(runtime.id, runtime.endIndex[slot]));
  activeCarry = null;
});

// --- Frame loop -------------------------------------------------------------

const scratchCameraDir = new THREE.Vector3();
let lastCursor = '';
const setCursor = (cursor: string): void => {
  if (cursor !== lastCursor) {
    lastCursor = cursor;
    render.domElement.style.cursor = cursor;
  }
};

// REN-4 — the chase-pulse gate's reused id list (see the frame loop).
const linkedCordIds: number[] = [];
// REN-5 — the grace list's reused entries: one plain object per cord,
// preallocated and refilled in place every frame (the render layer reads
// them during render() only) — zero steady-state allocation.
const graceEntries: CordGraceInfo[] = Array.from({ length: MAX_CORDS }, () => ({
  id: -1,
  end: 'first' as 'first' | 'last',
  remaining: 0,
  window: DEFAULT_GRACE_SECONDS,
}));
const graceCords: CordGraceInfo[] = [];

// M1 opening pose: the sim spawns cord 0 hanging STRAIGHT down from its pin,
// which reads as a rigid pole. The composition poses the anchor cord's free
// end beside the anchor through the carry seam for ~2 s, then stops, so the
// scene opens on a readable cord at rest. A pointer-down during the intro
// hands control to the user.
const RESTING_SPOT: { x: number; y: number; z: number } = { x: -0.4, y: FLOOR_REST_Y, z: -0.15 };
const INTRO_FRAMES = 120; // ~2 s of 60 fps; convergence completes long before
const introTarget: PinTargetInput = { cordId: 0, index: FREE_END_INDEX, position: RESTING_SPOT };
let frameIndex = 0;

render.start((dtSeconds) => {
  const input = pointer.readInput();
  render.camera.getWorldDirection(scratchCameraDir);

  // A11Y-1 — the brush dampening seam: every frame that COMPOSES a brush
  // field states its scale honestly (never a stale value if the preference
  // flips mid-session — the pointer's shell is reused across frames, so the
  // scale must be rewritten each brush frame, not just set under reduce).
  // The world multiplies its tuned strength by this; absent = 1 = INT-5
  // bitwise.
  if (input.brush !== null && input.brush !== undefined) {
    input.brush.strengthScale = prefersReducedMotion()
      ? BRUSH_REDUCED_STRENGTH_FACTOR
      : 1;
  }

  // Per-cord carries: every non-idle end controller composes its target
  // (one dragging + any drops in flight — spawn-while-carrying overlaps).
  carryTargets.length = 0;
  for (const runtime of cordRuntimes.values()) {
    for (const slot of [0, 1] as const) {
      const controller = runtime.carries[slot];
      if (controller.phase === 'idle') continue;
      const target = controller.composeTarget({
        ray: input.pointerRay,
        planeNormal: scratchCameraDir,
        endPoint: cordEndPoint(runtime.id, runtime.endIndex[slot]),
        dtSeconds,
      });
      if (target !== null) carryTargets.push(target);
    }
  }
  if (frameIndex < INTRO_FRAMES && world.lifecycle.stateOf(0) !== 'vanishing') {
    // The opening pose outranks cord 0's free-end targets (a user grab ends
    // the intro by setting frameIndex; spawned cords are never overridden).
    // A vanishing anchor (LIFE-2) owns its own ends — no intro pin may fight
    // the choreography's free fall.
    carryTargets.push(introTarget);
  }
  if (carryTargets.length > 0) input.pinTargets = carryTargets;
  frameIndex += 1;

  // INT-3 — cube drag: compose the dragged cube's next center on the drag
  // plane and move the mesh. Every seated plug hosted by that cube (INT-4:
  // possibly several, across cords) rides the cube's delta (translate-only:
  // same face, same axis — the sim pin hard-follows through the seat latch
  // below; the renderer override re-fires per record so frozen frames snap).
  const cubeTarget = cubeDrag.composeTarget({
    ray: input.pointerRay,
    planeNormal: scratchCameraDir,
  });
  if (cubeTarget !== null) {
    const mesh = render.pickables.cubes[cubeTarget.cubeId];
    mesh.position.set(cubeTarget.position.x, cubeTarget.position.y, cubeTarget.position.z);
    for (const runtime of cordRuntimes.values()) {
      for (const slot of [0, 1] as const) {
        const record = runtime.seats[slot];
        if (record !== null && record.cubeId === cubeTarget.cubeId) {
          record.pose.position.x = record.basePin.x + (mesh.position.x - record.baseCenter.x);
          record.pose.position.y = record.basePin.y + (mesh.position.y - record.baseCenter.y);
          record.pose.position.z = record.basePin.z + (mesh.position.z - record.baseCenter.z);
        }
      }
    }
  }

  // INT-2/INT-4 — the seat latch, generalized: every seated end's transform
  // flows every frame (idempotent in the sim; a zero-substep frame can never
  // swallow a plug; a dragged cube's moved transform transports its plugs).
  seatTargets.length = 0;
  for (const runtime of cordRuntimes.values()) {
    for (const slot of [0, 1] as const) {
      const record = runtime.seats[slot];
      if (record !== null) seatTargets.push(record.seatInput);
    }
  }
  if (seatTargets.length > 0) input.seatTargets = seatTargets;

  // INT-4 — the queued spawn: consumed by the world step's first substep
  // this frame (idempotent on its cord id across the frame's substeps).
  if (pendingSpawn !== null) {
    input.spawnCord = pendingSpawn;
    pendingSpawn = null;
  }

  // LIFE-1 — the queued release: the held jack dropped off-cube from an
  // awaiting-plug/popped cord (the user-initiated failure). One pointer, one
  // release per frame.
  if (pendingRelease !== null) {
    input.releaseJack = pendingRelease;
    pendingRelease = null;
  }

  // LIFE-3 — the staged same-frame failure release (see its declaration):
  // fire it the first frame the machine reports the end actually in hand;
  // if the cord left the world another way (vanish, reset), drop the stage.
  if (stagedFailureRelease !== null) {
    const staged = stagedFailureRelease;
    const stagedRuntime = cordRuntimes.get(staged.cordId);
    const stagedState = world.lifecycle.stateOf(staged.cordId);
    if (stagedRuntime === undefined || stagedState === 'vanishing' || stagedState === undefined) {
      stagedFailureRelease = null;
    } else if (world.lifecycle.endMode(staged.cordId, staged.index) === 'carrying') {
      pendingRelease = { cordId: staged.cordId, index: staged.index };
      stagedRuntime.carries[staged.slot].cancel();
      stagedFailureRelease = null;
      input.releaseJack = pendingRelease;
      pendingRelease = null;
    }
  }

  const frame = driver.advance(simState, dtSeconds, input);
  simState = frame.state;
  if (motionProbeEnabled) sampleMotion(simState); // T-INT-5 e2e seam (off = free)

  // T-REN-3 — the faceplate reads the SIM's truth once per frame: the live
  // cord list plus each cord's lifecycle state. The panel gates on equality
  // (model.ts), so an unchanged scene touches no DOM. REFINE-1: any vanish
  // that began inside this frame's substeps rides ONE failure notice on this
  // repaint ("Cord shattered — unplugged." — the critique's "why did it
  // die"); popped→vanishing always moves the counts, so the notice is
  // consumed the same frame it fires, spoken exactly once.
  const vanishNoticeLine =
    vanishStartsSinceUpdate > 0 ? vanishNotice(vanishStartsSinceUpdate) : null;
  vanishStartsSinceUpdate = 0;
  hud.update(readHudCountsInto(simState.cords, world.lifecycle.stateOf, hudCounts), vanishNoticeLine);

  // LIFE-2 — the vanish fade: the choreography's pull-window progress drives
  // the render (tube opacity + riding-jack scale). One map probe per live
  // runtime; null for every non-vanishing cord.
  for (const runtime of cordRuntimes.values()) {
    const info = world.lifecycle.vanishInfo(runtime.id);
    if (info !== null) render.setCordFade(runtime.id, info.progress);
  }

  // REN-4 — the chase-pulse gate: the ids whose lifecycle state is EXACTLY
  // 'linked' (both ends seated, nothing popping, nothing vanishing). The
  // only state that pulses; everything else carries gain 0 (no decorative
  // glow). One reused array — the per-frame path allocates nothing.
  linkedCordIds.length = 0;
  // REN-5 — the state-paint gate: every cord mid-countdown (popped, plus
  // VANISHING cords riding at remaining 0 so the dim holds its floor through
  // LIFE-2's fade instead of flashing back to full at expiry). The popped
  // end is the machine's own read (the end whose mode is not 'seated' — the
  // survivor holds the socket); a vanishing cord's is the `start` event's
  // named failing end. Entries refill in place — no allocation.
  graceCords.length = 0;
  let graceCount = 0;
  for (const cord of simState.cords) {
    const state = world.lifecycle.stateOf(cord.id);
    if (state === 'linked') {
      linkedCordIds.push(cord.id);
      continue;
    }
    if (state !== 'popped' && state !== 'vanishing') continue;
    let end: 'first' | 'last';
    if (state === 'popped') {
      end = world.lifecycle.endMode(cord.id, 0) !== 'seated' ? 'first' : 'last';
    } else {
      const failing = cordRuntimes.get(cord.id)?.failingSlot;
      if (failing === null || failing === undefined) continue;
      end = failing === 0 ? 'first' : 'last';
    }
    const entry = graceEntries[graceCount];
    graceCount += 1;
    entry.id = cord.id;
    entry.end = end;
    entry.remaining =
      state === 'popped' ? (world.lifecycle.graceRemaining(cord.id) ?? 0) : 0;
    entry.window = DEFAULT_GRACE_SECONDS;
    graceCords.push(entry);
  }
  lastLinkedIds = linkedCordIds;
  lastGraceCords = graceCords;
  lastReducedMotion = prefersReducedMotion();
  const renderFrame: RenderFrameInfo = {
    linked: linkedCordIds,
    reducedMotion: lastReducedMotion,
    grace: graceCords,
  };
  render.render(simState, dtSeconds, renderFrame);

  // INT-4 — lazily register the runtime side of cords the world spawned
  // (after their first render, so the proxies exist and sit on the ends).
  for (const cord of simState.cords) {
    if (cordRuntimes.has(cord.id)) continue;
    const runtime = registerCordRuntime(cord.id);
    const carried = pendingCarry;
    if (carried !== null && carried.cordId === cord.id) {
      const controller = runtime.carries[0];
      controller.beginDrag(carried.at);
      if (carried.released) controller.endDrag(carried.at);
      else activeCarry = { cordId: cord.id, slot: 0, payload: runtime.payloads[0] };
      pendingCarry = null;
    }
  }

  // Cursor affordance: grabbable end or cube in reach → grab; a live drag
  // (jack or cube) → grabbing.
  if (activeCarry !== null || pendingCarry !== null || cubeDrag.phase === 'dragging') {
    setCursor('grabbing');
  } else if (input.pointerRay !== null) {
    const hover = picker.pickGrabbable(input.pointerRay);
    if (
      hover !== null &&
      hover.class === 'jack' &&
      !jackGrabbable(
        (hover.payload as CordEndPayload).cordId,
        (hover.payload as CordEndPayload).index,
      )
    ) {
      setCursor('default'); // a popped socket / vanishing cord is not grabbable (LIFE-1)
    } else {
      setCursor(hover !== null ? 'grab' : 'default');
    }
  } else {
    setCursor('default');
  }
});

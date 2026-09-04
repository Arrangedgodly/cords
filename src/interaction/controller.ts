/**
 * 2D-2 — THE INTERACTION CONTROLLER (Doctor Strange's lane: interaction
 * determinism). One object owns everything between the DOM's pointer events
 * and the sim's intent stream, mirroring the composition discipline the 2D-1
 * fuzz harness pinned (fuzzHarness.ts is the spec — the corpus is green
 * against exactly these laws):
 *
 * PICKING — priority corner handle > jack > rectangle > cord body (2D-6 put
 * the module's own furniture first; town-hall decision #4 is the rest). A
 * jack is a generous hit circle at its world position (the sim's own end
 * point, screen-exact through the shared view); a rectangle is point-in-rect
 * (topmost wins); the cord body is a distance-to-polyline read that is
 * NEVER grabbable — hover cursor only. Only jacks are grabbable, and only
 * when the machine allows it (v1's law: not vanishing, and not a popped
 * cord's surviving socket — the pop must not be dodgeable by hand).
 *
 * DRAG — 2D-5's LATCH LAW first: once a jack is grabbed, the grab is
 * LATCHED until pointerup/pointercancel — no re-picking mid-drag, no
 * "pointer still near jack" checks, no drop when the cursor outruns the
 * rendered jack (the SIM-2 pin chases with bounded velocity BY DESIGN;
 * the latch does not care where the jack is, only where the pointer
 * speaks). pointerleave NEVER releases (capture makes the canvas the sole
 * listener for the gesture; browsers that leak boundary events mid-capture
 * hit the no-op above). The composition sets pointer capture on
 * pointerdown (main.ts); pointerup/pointercancel are the ONLY release
 * signals. A rectangle translates (clamped above the panel floor by the
 * stage law) and every plug seated on it RIDES the delta through the seat
 * latch (INT-3 transport). 2D-6: a corner handle RESIZES through the stage
 * law (bounded, opposite-corner anchored) and its seated plugs ride the
 * EDGE-RELATIVE recompute — the stored (edge, fraction) against the live
 * geometry, the fraction kept verbatim (a seat slides inward on a
 * shrinking edge, never pops off); an over-stretched linked cord pops by
 * the sim's own law, unspecial-cased. A carried jack's pin target follows
 * the cursor EXACTLY (2D — no plane math); the SIM-2 leash and the
 * fixed-timestep driver own every ounce of feel after that. The jack PICK
 * is a capsule over the drawn body (tip → boot, `JACK_PICK_BODY` +
 * `JACK_PICK_RADIUS`) — the visible plastic is the grabbable thing.
 *
 * RELEASE — over a rectangle's edge region: SEAT through the stage law
 * (perpendicular to the nearest edge, insertion depth inside the perimeter,
 * deterministic corner resolution), unless the rectangle is at its soft cap
 * (32) — then the DENY RING (never seats, ordinary release routing, the
 * jack stays re-grabbable). Off-rectangle: the approved failure routing via
 * the sim's own seams (`releaseJack` — awaiting-plug/popped → vanishing,
 * carried → the ordinary floor drop with an in-flight converge target).
 * Same-frame grab+release stages the failure until the machine has seen
 * the grab (the harness's staged path, mirrored exactly).
 *
 * Every frame `composeInput()` fills ONE reused SimInput: the carry targets
 * (held / staged / in-flight drops), the seat latch (every seated end's
 * transform re-sent — the INT-2/INT-3 latch), one-shot spawn/release
 * intents, and the brush (ONE impulse per NEW pointer-move counter value —
 * Thor's zero-idle-cost rule; `strengthScale` 0.5 under reduced motion).
 * Latch discipline on events: pop → drop that seat the same frame; →
 * vanishing → clear held/staged and any not-yet-landed seat; vanish pull →
 * drop the pulled seat; complete → drop everything the cord owned.
 */
import type {
  BrushInput,
  CordWorldStep,
  LifecycleTransition,
  PinTargetInput,
  ReleaseJackInput,
  SeatInput,
  SimInput,
  SimState,
  SpawnCordInput,
  Vec2,
  VanishEvent,
} from '../sim';
import {
  EDGE_REGION_MARGIN,
  HANDLE_RADIUS,
  SEAT_DEPTH,
  applyRectResize,
  clampRectCenter,
  edgeFraction,
  oppositeCorner,
  pointInRect,
  rectAt,
  rectCornerInto,
  seatPoseFromFraction,
  seatPoseInto,
  spawnModuleInto,
} from '../world/stage';
import type { RectResizeGrab, SeatPose, StageRect } from '../world/stage';
import type { View } from '../world/view';

/**
 * Generous jack hit radius (world units) — v1's proxy halo, translated.
 * 2D-5: 0.19 — ≈33 px of halo at the drives' 1600×1000 default view
 * (scale ≈ 173.9 px/unit), the mid-band of the 28–40 px comfort target;
 * world-space by design so the halo scales with the drawn jack at any
 * window size (a smaller window shrinks the jack AND its halo together).
 */
export const JACK_PICK_RADIUS = 0.19;
/**
 * 2D-5 — the jack pick is a CAPSULE, not a tip halo: from the end point
 * (the tip — the renderer's anchor) along the jack's drawn axis for the
 * length of the VISIBLE body. The renderer draws JACK_LEN = 0.415 of
 * plastic (tip → boot tail) behind the anchor along exactly the axis
 * `jackAxis` derives; 0.42 covers it with a hair for the boot's tail
 * flare. The grabbable target is the jack the user SEES — a press on the
 * fat boot is as good as one on the tip (the original tip-only halo left
 * the rear two-thirds of the drawn jack unclickable).
 */
export const JACK_PICK_BODY = 0.42;
/** Cord-body hover distance (world units) — cursor feedback only. */
export const CORD_HOVER_RADIUS = 0.06;
/**
 * The soft plug cap per rectangle — a perf guard, not a rule (deny ring).
 * 2D-7 raised v1's 12 → 32 (town-hall Revision 3's dense-network ceiling);
 * the 33rd attempt on one module draws the deny ring.
 */
export const PLUG_CAP_PER_RECT = 32;
/** The floor-rest height a released coil converges to (FLOOR_REST_Y). */
export const FLOOR_REST_Y = 0.055;
/** In-flight drop budget: frames of converge targets before the stub freezes. */
const DROP_FRAMES = 90;
const DROP_CONVERGE_DIST = 0.03;

export type HoverKind = 'none' | 'jack' | 'rect' | 'cord' | 'handle';

/** One seated end — the composition's mirror of the sim's seat. */
interface SeatRecord {
  readonly cordId: number;
  readonly index: number;
  readonly rectId: number;
  /**
   * 2D-6 — THE EDGE-RELATIVE COORDINATE (the load-bearing law): which edge
   * the socket sits on + the fraction along it. Stored at seat time, NEVER
   * mutated by transport: a translation is fraction-invariant (both edges of
   * a rect move together), and a resize recomputes the absolute pin from
   * these (see transportSeatsOnRect) — the fraction rides the resize, so a
   * seat near the end of a shrinking edge slides inward, never pops off.
   */
  readonly edge: number;
  readonly fraction: number;
  /** Rect center at seat time (transports ride center deltas from here). */
  baseCX: number;
  baseCY: number;
  /** Pin at seat time (refreshed by resizes — the drag's absolute law). */
  basePX: number;
  basePY: number;
  /** LIVE pin — aliases `seatInput.position`; transports mutate in place. */
  readonly position: Vec2;
  /** Outward edge normal at seat time (the jack's drawn axis). */
  nx: number;
  ny: number;
  readonly seatInput: SeatInput;
}

export interface InteractionDeps {
  /** The live session's world (rebuilt on RESET). */
  readonly world: CordWorldStep;
  /** The live sim state (end-point reads). */
  readonly state: () => SimState;
  /** The live view (resize-safe — read per call). */
  readonly view: () => View;
  /**
   * The live stage (drag mutates rect centers in place; 2D-6's spawn APPENDS
   * — the array itself is the world's module roster).
   */
  readonly stage: StageRect[];
  /** prefers-reduced-motion (A11Y-1's brush seam — input, never config). */
  readonly reducedMotion: () => boolean;
}

export interface HeldEnd {
  readonly cordId: number;
  readonly index: number;
}

export interface InteractionController {
  // --- DOM event surface (screen px) ---------------------------------------
  pointerDown(px: number, py: number): void;
  pointerMove(px: number, py: number): void;
  pointerUp(px: number, py: number): void;
  /**
   * 2D-5 — the pointer system ended the gesture (pointercancel): the drag
   * ends here, routed exactly like a normal release at the last known
   * pointer position. Garbage coordinates route at the last VALID one.
   */
  pointerCancel(px: number, py: number): void;
  /** Passive leave (hover/brush only) — never releases a drag. */
  pointerLeave(): void;
  hoverCursor(): string;
  /** What the pointer is over (jack pick, rect pick, cord hover). */
  hover(): HoverKind;

  // --- composition ops ------------------------------------------------------
  /** Fills and returns THE reused SimInput for this frame. */
  composeInput(): SimInput;
  /** N / HUD NEW CORD: a coil springs into hand at `at`, red end held. */
  spawnAt(at: Vec2): number;
  /** A coil spawn without holding it (the opening stage, the perf probe). */
  spawnCoilAt(at: Vec2): number;
  /**
   * 2D-6 — B / HUD NEW MODULE: appends an ordinary module (deterministic
   * placement, palette cycling, silkscreen sequence; soft cap 32 → null).
   * `at` is the cursor point, or null for a free spot near stage center.
   */
  spawnModule(at: Vec2 | null): StageRect | null;
  /** Seats a cord end on a rectangle through the stage law. Cap-checked. */
  seatEndOn(cordId: number, index: number, rectId: number, at: Vec2): boolean;
  /** The release routing for a held end not landing on a rectangle. */
  releaseHeldOffRect(): void;
  /** The soft-cap rejection: deny ring + the ordinary release routing. */
  denySeat(rectId: number, at: Vec2): void;

  // --- event/latch discipline (world onTransition / vanish onEvent) ----------
  onLifecycleTransition(event: LifecycleTransition): void;
  onVanishEvent(event: VanishEvent): void;

  // --- reads for the composition/render -------------------------------------
  heldEnd(): HeldEnd | null;
  seatPoseOf(cordId: number, index: number): SeatPose | null;
  readonly deny: { readonly x: number; readonly y: number; readonly t: number } | null;
  noteSimTime(t: number): void;
  /** Live per-rect seat counts (cap + tests). */
  seatsOnRect(rectId: number): number;
  /**
   * 2D-6 — the rect whose 4 corner handles are shown RIGHT NOW: the resizing
   * one mid-drag, else the one under the pointer (hover furniture). −1/absent
   * = none. The renderer reads this once per frame.
   */
  handlesFor(): number;
  /**
   * 2D-6 — every live seat's edge-relative coordinate (drive/probe read:
   * the resize law's evidence). Allocates; never called per frame.
   */
  seatList(): Array<{ cordId: number; index: number; rectId: number; edge: number; fraction: number }>;
}

export function createInteractionController(deps: InteractionDeps): InteractionController {
  const { world, stage } = deps;
  const scratch: Vec2 = { x: 0, y: 0 };
  const dropScratch: Vec2 = { x: 0, y: 0 };
  const poseShell: SeatPose = { x: 0, y: 0, nx: 0, ny: 0, edge: 0, socketX: 0, socketY: 0 };
  const poseScratch: SeatPose = { x: 0, y: 0, nx: 0, ny: 0, edge: 0, socketX: 0, socketY: 0 };

  // --- composition state ------------------------------------------------------
  const seatRecords = new Map<string, SeatRecord>();
  const seatLatch: SeatInput[] = [];
  const carryShells: PinTargetInput[] = [];
  for (let i = 0; i < 4; i += 1) carryShells.push({ cordId: 0, index: 0, position: { x: 0, y: 0 } });
  let held: { cordId: number; index: number; target: Vec2 } | null = null;
  let stagedFailure: { cordId: number; index: number; target: Vec2 } | null = null;
  interface DropRecord {
    cordId: number;
    index: number;
    target: Vec2;
    framesLeft: number;
  }
  const drops: DropRecord[] = [];
  let pendingSpawn: SpawnCordInput | null = null;
  let pendingRelease: ReleaseJackInput | null = null;
  let nextCordId = 1;
  let brushCounter = 0;
  let brush: BrushInput | null = null;
  const brushShell: BrushInput = { move: 0, point: { x: 0, y: 0 }, strengthScale: 1 };
  let deny: { x: number; y: number; t: number } | null = null;
  let simTime = 0;
  let rectDrag: { rectId: number; dx: number; dy: number } | null = null;
  /**
   * 2D-6 — a live corner-handle resize: the rect, the corner grabbed, and
   * the frozen grab (anchor + side signs) the stage law resizes against.
   * Latched like every drag: pointerup/pointercancel end it, pointerleave is
   * a no-op mid-resize.
   */
  let resizeDrag: {
    rectId: number;
    corner: number;
    grab: RectResizeGrab;
  } | null = null;
  /** The corner under the pointer (hover reads: the resize cursor). */
  let hoverCorner = -1;
  let pointerWorld: Vec2 | null = null;
  let hover: HoverKind = 'none';
  const pointerWorldScratch: Vec2 = { x: 0, y: 0 };
  const cornerScratch: Vec2 = { x: 0, y: 0 };
  const input: SimInput = { pointerPoint: null };

  const seatKey = (cordId: number, index: number): string => `${cordId}:${index}`;

  const releaseSeat = (cordId: number, index: number): void => {
    const key = seatKey(cordId, index);
    const record = seatRecords.get(key);
    if (record === undefined) return;
    seatRecords.delete(key);
    const at = seatLatch.indexOf(record.seatInput);
    if (at >= 0) seatLatch.splice(at, 1);
  };

  const endPointOf = (cordId: number, index: number, out: Vec2): Vec2 => {
    const cord = deps.state().cords.find((c) => c.id === cordId);
    const p = cord?.points[index];
    if (p === undefined) {
      out.x = 0;
      out.y = 0;
      return out;
    }
    out.x = p.x;
    out.y = p.y;
    return out;
  };

  /** v1's grabability law: never vanishing, never a popped cord's socket. */
  const grabbable = (cordId: number, index: number): boolean => {
    const state = world.lifecycle.stateOf(cordId);
    if (state === undefined || state === 'vanishing') return false;
    if (state === 'popped' && world.lifecycle.endMode(cordId, index) === 'seated') return false;
    return true;
  };

  /**
   * The jack pick (2D-5: a CAPSULE over the drawn body).
   * - FREE end: the segment runs from the tip back along the cord (the
   *   renderer's own axis rule — previous point direction), so the whole
   *   visible plastic, tip to boot tail, is grabbable.
   * - SEATED end: the segment runs from the SOCKET (the edge line) OUT
   *   along the seat normal — the visible plug — and only the EDGE BAND
   *   (EDGE_REGION_MARGIN) inboard of the perimeter counts: deeper inside
   *   the face the RECT drag owns the press (the seat law's own band, so
   *   "grab the plug" and "drop onto the plug zone" read the same strip).
   * Nearest end wins (world order breaks ties).
   */
  const pickJack = (wx: number, wy: number): { cordId: number; index: number } | null => {
    const r2limit = JACK_PICK_RADIUS * JACK_PICK_RADIUS;
    let best: { cordId: number; index: number } | null = null;
    let bestD2 = Number.POSITIVE_INFINITY;
    const cords = deps.state().cords;
    for (let c = 0; c < cords.length; c += 1) {
      const cord = cords[c];
      const last = cord.points.length - 1;
      for (const index of [0, last] as const) {
        const p = cord.points[index];
        let ox = p.x;
        let oy = p.y;
        let ux = 0;
        let uy = -1; // degenerate dangle: tip-down, halo alone carries it
        const record = seatRecords.get(seatKey(cord.id, index));
        if (record !== undefined) {
          const rect = stage[record.rectId];
          if (rect !== undefined && pointInRect(wx, wy, rect, -EDGE_REGION_MARGIN)) {
            continue; // deep inside the face: the rectangle owns this press
          }
          ox = record.position.x + record.nx * SEAT_DEPTH; // the socket line
          oy = record.position.y + record.ny * SEAT_DEPTH;
          ux = record.nx;
          uy = record.ny;
        } else {
          const prevIndex = index === 0 ? 1 : last - 1;
          const prev = cord.points[prevIndex];
          if (prev !== undefined) {
            const dx = prev.x - p.x;
            const dy = prev.y - p.y;
            const len = Math.hypot(dx, dy);
            if (len >= 1e-6) {
              ux = dx / len;
              uy = dy / len;
            }
          }
        }
        // Distance² to the capsule's segment [origin, origin + axis × body].
        const abx = ux * JACK_PICK_BODY;
        const aby = uy * JACK_PICK_BODY;
        const len2 = abx * abx + aby * aby;
        let t = len2 > 0 ? ((wx - ox) * abx + (wy - oy) * aby) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = wx - (ox + abx * t);
        const dy = wy - (oy + aby * t);
        const d2 = dx * dx + dy * dy;
        if (d2 <= r2limit && d2 < bestD2 && grabbable(cord.id, index)) {
          best = { cordId: cord.id, index };
          bestD2 = d2;
        }
      }
    }
    return best;
  };

  /** Point-to-polyline distance² (the cord-body hover read). */
  const distToCord2 = (wx: number, wy: number): number => {
    let best = Number.POSITIVE_INFINITY;
    const cords = deps.state().cords;
    for (let c = 0; c < cords.length; c += 1) {
      const pts = cords[c].points;
      for (let i = 0; i < pts.length - 1; i += 1) {
        const ax = pts[i].x;
        const ay = pts[i].y;
        const bx = pts[i + 1].x;
        const by = pts[i + 1].y;
        const abx = bx - ax;
        const aby = by - ay;
        const len2 = abx * abx + aby * aby;
        let t = len2 > 0 ? ((wx - ax) * abx + (wy - ay) * aby) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = wx - (ax + abx * t);
        const dy = wy - (ay + aby * t);
        const d2 = dx * dx + dy * dy;
        if (d2 < best) best = d2;
      }
    }
    return best;
  };

  /**
   * 2D-6 — THE CORNER-HANDLE PICK: the topmost rect with a corner within
   * HANDLE_RADIUS of the point (reverse scan, first hit wins — the rectAt
   * discipline). Checked BEFORE the jack in every pick order: the priority
   * law is HANDLE > JACK > RECT BODY > CORD.
   */
  const pickHandle = (wx: number, wy: number): { rectId: number; corner: number } | null => {
    if (!Number.isFinite(wx) || !Number.isFinite(wy)) return null;
    const r2limit = HANDLE_RADIUS * HANDLE_RADIUS;
    for (let i = stage.length - 1; i >= 0; i -= 1) {
      const rect = stage[i];
      for (let corner = 0; corner < 4; corner += 1) {
        rectCornerInto(rect, corner, cornerScratch);
        const dx = wx - cornerScratch.x;
        const dy = wy - cornerScratch.y;
        if (dx * dx + dy * dy <= r2limit) return { rectId: rect.id, corner };
      }
    }
    return null;
  };

  /**
   * 2D-6 — THE RESIZE TRANSPORT: every seat on `rectId` recomputes its
   * absolute pin from the stored EDGE-RELATIVE coordinate and the rect's
   * CURRENT geometry (seatPoseFromFraction — the fraction kept verbatim, the
   * socket slides with the edge). The drag bases refresh so a subsequent
   * translate continues from the recomputed pose (the two transport laws
   * compose: translation is fraction-invariant). The seat latch aliases
   * `position`, so the next composeInput re-sends the new transform and the
   * sim's pins hard-follow bitwise — the same INT-3 discipline a drag uses.
   */
  const transportSeatsOnRect = (rectId: number): void => {
    const rect = stage[rectId];
    if (rect === undefined) return;
    for (const record of seatRecords.values()) {
      if (record.rectId !== rectId) continue;
      seatPoseFromFraction(rect, record.edge, record.fraction, poseScratch);
      record.position.x = poseScratch.x;
      record.position.y = poseScratch.y;
      record.nx = poseScratch.nx;
      record.ny = poseScratch.ny;
      record.baseCX = rect.x;
      record.baseCY = rect.y;
      record.basePX = poseScratch.x;
      record.basePY = poseScratch.y;
    }
  };

  const refreshHover = (): void => {
    hover = 'none';
    hoverCorner = -1;
    if (pointerWorld === null) return;
    const handle = pickHandle(pointerWorld.x, pointerWorld.y);
    if (handle !== null) {
      hover = 'handle';
      hoverCorner = handle.corner;
      return;
    }
    if (pickJack(pointerWorld.x, pointerWorld.y) !== null) {
      hover = 'jack';
      return;
    }
    if (rectAt(pointerWorld.x, pointerWorld.y, stage) >= 0) {
      hover = 'rect';
      return;
    }
    if (distToCord2(pointerWorld.x, pointerWorld.y) <= CORD_HOVER_RADIUS * CORD_HOVER_RADIUS) {
      hover = 'cord';
    }
  };

  // --- the release paths ------------------------------------------------------
  const seatHeldOn = (rectId: number, at: Vec2): boolean => {
    if (held === null) return false;
    const { cordId, index } = held;
    const rect = stage[rectId];
    if (rect === undefined) return false;
    seatPoseInto(at.x, at.y, rect, poseScratch);
    const position: Vec2 = { x: poseScratch.x, y: poseScratch.y };
    const record: SeatRecord = {
      cordId,
      index,
      rectId,
      edge: poseScratch.edge,
      // THE STORED RELATIVE COORDINATE — from the resolved SOCKET (already
      // clamped onto the edge by the seat law), so the fraction rides every
      // later transform of this rect.
      fraction: edgeFraction(poseScratch.socketX, poseScratch.socketY, rect, poseScratch.edge),
      baseCX: rect.x,
      baseCY: rect.y,
      basePX: position.x,
      basePY: position.y,
      position,
      nx: poseScratch.nx,
      ny: poseScratch.ny,
      seatInput: { cordId, index, position },
    };
    seatRecords.set(seatKey(cordId, index), record);
    seatLatch.push(record.seatInput);
    held = null; // a seat is not a drop — no floor targets follow
    return true;
  };

  const failureReleaseFrom = (
    cordId: number,
    index: number,
    target: Vec2,
  ): void => {
    const state = world.lifecycle.stateOf(cordId);
    if (state === 'awaiting-plug' || state === 'popped') {
      if (world.lifecycle.endMode(cordId, index) === 'carrying') {
        // The grab already flowed: the failure release fires now.
        pendingRelease = { cordId, index };
        return; // the FALL is the sim's — LIFE-2 owns the end from here
      }
      // SAME-FRAME grab+release: keep the carry composing until the machine
      // has seen the grab, then fire the release (the harness's staged path).
      stagedFailure = { cordId, index, target: { x: target.x, y: target.y } };
      return;
    }
    // The ordinary drop: converge to floor-rest height, then stop sending.
    const end = endPointOf(cordId, index, dropScratch);
    drops.push({
      cordId,
      index,
      target: { x: end.x, y: FLOOR_REST_Y },
      framesLeft: DROP_FRAMES,
    });
  };

  /**
   * 2D-5 — the ONE release routing (pointerUp and pointerCancel share it):
   * over a rectangle's edge region → seat (or deny at the soft cap);
   * otherwise the approved failure path. Honest by construction: the
   * shatter fires only when the release position is genuinely off-module.
   */
  const routeReleaseAt = (wx: number, wy: number): void => {
    if (held === null) return;
    const { cordId, index, target } = held;
    const rectId = rectAt(wx, wy, stage, EDGE_REGION_MARGIN);
    if (rectId >= 0) {
      if (controller.seatsOnRect(rectId) >= PLUG_CAP_PER_RECT) {
        held = null;
        controller.denySeat(rectId, { x: wx, y: wy });
        return;
      }
      if (seatHeldOn(rectId, { x: wx, y: wy })) return; // clears held itself
    }
    held = null;
    failureReleaseFrom(cordId, index, target);
    refreshHover();
  };

  const controller: InteractionController = {
    pointerDown(px, py) {
      const view = deps.view();
      view.toWorld(px, py, pointerWorldScratch);
      pointerWorld = pointerWorldScratch;
      const wx = pointerWorld.x;
      const wy = pointerWorld.y;
      // PRIORITY 0 — a corner handle (2D-6): the resize grip wins over the
      // jack, the body, and the cord (the panel's own furniture).
      const handle = pickHandle(wx, wy);
      if (handle !== null) {
        if (held !== null) return; // one pointer, one drag
        const rect = stage[handle.rectId];
        if (rect !== undefined) {
          rectCornerInto(rect, oppositeCorner(handle.corner), cornerScratch);
          resizeDrag = {
            rectId: handle.rectId,
            corner: handle.corner,
            grab: {
              anchorX: cornerScratch.x,
              anchorY: cornerScratch.y,
              // The grabbed corner's side of the anchor, FROZEN at the grab:
              // the rect stays on this side for the whole drag (crossing the
              // anchor clamps to the min edge, never inverts).
              signX: handle.corner === 0 || handle.corner === 3 ? -1 : 1,
              signY: handle.corner === 0 || handle.corner === 1 ? 1 : -1,
            },
          };
        }
        return;
      }
      // PRIORITY 1 — a jack (the only grabbable thing on the stage).
      const jack = pickJack(wx, wy);
      if (jack !== null) {
        if (held !== null) return; // one pointer, one drag
        // A seated end pulls its plug: drop the record + latch in the same
        // event, BEFORE the carry intent flows (the composition's law).
        releaseSeat(jack.cordId, jack.index);
        // ONE CONTROLLER PER CORD: grabbing an end cancels the other end's
        // in-flight drop — a mid-drop end simply falls.
        for (let i = drops.length - 1; i >= 0; i -= 1) {
          if (drops[i].cordId === jack.cordId) drops.splice(i, 1);
        }
        if (stagedFailure !== null && stagedFailure.cordId === jack.cordId) stagedFailure = null;
        const end = endPointOf(jack.cordId, jack.index, scratch);
        held = { cordId: jack.cordId, index: jack.index, target: { x: end.x, y: end.y } };
        return;
      }
      // PRIORITY 2 — a rectangle (translate drag).
      const rectId = rectAt(wx, wy, stage);
      if (rectId >= 0) {
        const rect = stage[rectId];
        if (rect !== undefined) {
          rectDrag = { rectId, dx: rect.x - wx, dy: rect.y - wy };
        }
      }
      // PRIORITY 3 — the cord body: hover feedback only, never a grab.
    },

    pointerMove(px, py) {
      const view = deps.view();
      view.toWorld(px, py, pointerWorldScratch);
      pointerWorld = pointerWorldScratch;
      // The passive brush: one impulse pass per NEW move value.
      brushCounter += 1;
      brushShell.move = brushCounter;
      brushShell.point.x = pointerWorldScratch.x;
      brushShell.point.y = pointerWorldScratch.y;
      brushShell.strengthScale = deps.reducedMotion() ? 0.5 : 1;
      brush = brushShell;
      // A carried jack follows the cursor EXACTLY (2D — no plane math).
      if (held !== null) {
        held.target.x = pointerWorldScratch.x;
        held.target.y = pointerWorldScratch.y;
      }
      // A dragged rectangle translates (clamped above the panel floor) and
      // its seated plugs ride the delta through the seat latch.
      if (rectDrag !== null) {
        const rect = stage[rectDrag.rectId];
        if (rect !== undefined) {
          rect.x = pointerWorldScratch.x + rectDrag.dx;
          rect.y = pointerWorldScratch.y + rectDrag.dy;
          clampRectCenter(rect, view.maxX, view.maxY);
          for (const record of seatRecords.values()) {
            if (record.rectId !== rectDrag.rectId) continue;
            record.position.x = record.basePX + (rect.x - record.baseCX);
            record.position.y = record.basePY + (rect.y - record.baseCY);
          }
        }
      }
      // 2D-6 — a live corner-handle RESIZE: the stage law's bounded,
      // opposite-corner-anchored rewrite, then every seated plug on the rect
      // rides it through the EDGE-RELATIVE recompute (the fraction kept, the
      // socket sliding with its edge; over-stretched cords pop by the sim's
      // own law — nothing here special-cases it).
      if (resizeDrag !== null) {
        const rect = stage[resizeDrag.rectId];
        if (rect !== undefined) {
          applyRectResize(rect, resizeDrag.grab, pointerWorldScratch.x, pointerWorldScratch.y, view.maxX, view.maxY);
          transportSeatsOnRect(resizeDrag.rectId);
        }
      }
      refreshHover();
    },

    pointerUp(px, py) {
      const view = deps.view();
      view.toWorld(px, py, pointerWorldScratch);
      pointerWorld = pointerWorldScratch;
      rectDrag = null;
      resizeDrag = null;
      routeReleaseAt(pointerWorldScratch.x, pointerWorldScratch.y);
    },

    /**
     * 2D-5 — pointercancel's honest semantic: the POINTER SYSTEM ended the
     * gesture (capture lost, OS takeover, element teardown) — the button's
     * physical state is unknowable from here. The drag ends NOW, judged at
     * the last known pointer position with the IDENTICAL routing a normal
     * release takes (seat over an edge region, deny at the cap, the approved
     * failure path off-module). The one alternative — leaving the latch
     * wedged — turns the NEXT click into an accidental off-module release
     * of a cord the user believes they are still holding (the reported
     * "spontaneous release then shatter"). A rect drag simply stops (the
     * rectangle stands where it was dropped).
     */
    pointerCancel(px, py) {
      if (Number.isFinite(px) && Number.isFinite(py)) {
        const view = deps.view();
        view.toWorld(px, py, pointerWorldScratch);
        pointerWorld = pointerWorldScratch;
      }
      // else: the last valid pointer world position stands (garbage
      // coordinates must not invent a release position).
      rectDrag = null;
      resizeDrag = null;
      if (pointerWorld === null) {
        held = null; // nothing was ever known about the pointer: drop the bookkeeping
        return;
      }
      routeReleaseAt(pointerWorld.x, pointerWorld.y);
    },

    /**
     * 2D-5 — THE LATCH LAW: a drag is latched from pointerDown until
     * pointerUp/pointercancel; pointerleave NEVER releases. Leave only
     * retires PASSIVE pointer state (hover, the brush, the pointer read)
     * and only when NO drag is live — during a captured drag some browsers
     * still dispatch boundary events, and a mid-drag leave must be a no-op
     * for the carry (the last valid target stands until the button speaks).
     */
    pointerLeave() {
      if (held === null && rectDrag === null && resizeDrag === null) {
        pointerWorld = null;
        brush = null;
      }
      refreshHover();
    },

    hoverCursor() {
      if (held !== null) return 'grabbing';
      if (resizeDrag !== null) return resizeDrag.corner === 0 || resizeDrag.corner === 2
        ? 'nwse-resize'
        : 'nesw-resize';
      if (rectDrag !== null) return 'grabbing';
      if (hover === 'handle') {
        return hoverCorner === 0 || hoverCorner === 2 ? 'nwse-resize' : 'nesw-resize';
      }
      if (hover === 'jack') return 'grab';
      if (hover === 'rect') return 'move';
      if (hover === 'cord') return 'crosshair';
      return 'default';
    },

    hover() {
      return held !== null ? 'jack' : hover;
    },

    composeInput() {
      input.pointerPoint = pointerWorld === null ? null : pointerWorldScratch;
      // A staged failure matures once the machine has SEEN the grab.
      if (stagedFailure !== null) {
        const { cordId, index } = stagedFailure;
        const mode = world.lifecycle.endMode(cordId, index);
        const state = world.lifecycle.stateOf(cordId);
        if (mode === 'carrying' || state === undefined || state === 'vanishing' || state === 'gone') {
          if (mode === 'carrying') pendingRelease = { cordId, index };
          stagedFailure = null;
        }
      }
      // Carries: the held end, a staged pull, and every in-flight drop.
      let n = 0;
      const pushCarry = (cordId: number, index: number, t: Vec2): void => {
        if (n >= carryShells.length) carryShells.push({ cordId: 0, index: 0, position: { x: 0, y: 0 } });
        const shell = carryShells[n];
        shell.cordId = cordId;
        shell.index = index;
        shell.position.x = t.x;
        shell.position.y = t.y;
        n += 1;
      };
      if (held !== null) pushCarry(held.cordId, held.index, held.target);
      if (stagedFailure !== null) {
        pushCarry(stagedFailure.cordId, stagedFailure.index, stagedFailure.target);
      }
      for (let i = drops.length - 1; i >= 0; i -= 1) {
        const drop = drops[i];
        const dropState = world.lifecycle.stateOf(drop.cordId);
        if (dropState === undefined || dropState === 'vanishing') {
          drops.splice(i, 1); // the choreography owns the end from here
          continue;
        }
        pushCarry(drop.cordId, drop.index, drop.target);
        drop.framesLeft -= 1;
        const end = endPointOf(drop.cordId, drop.index, dropScratch);
        const dx = end.x - drop.target.x;
        const dy = end.y - drop.target.y;
        if (drop.framesLeft <= 0 || dx * dx + dy * dy < DROP_CONVERGE_DIST * DROP_CONVERGE_DIST || dropState === 'gone') {
          drops.splice(i, 1); // targets stop → the release stub freezes
        }
      }
      if (n > 0) {
        input.pinTargets = carryShells;
        carryShells.length = n;
      } else {
        input.pinTargets = null;
      }
      // The seat latch: every seated end's transform re-sends every frame.
      input.seatTargets = seatLatch.length > 0 ? seatLatch : null;
      // One-shot intents, consumed by the first substep (driver replays).
      if (pendingSpawn !== null) {
        input.spawnCord = pendingSpawn;
        pendingSpawn = null;
      } else {
        input.spawnCord = null;
      }
      if (pendingRelease !== null) {
        input.releaseJack = pendingRelease;
        pendingRelease = null;
      } else {
        input.releaseJack = null;
      }
      input.brush = brush;
      brush = null; // one impulse pass per NEW move counter — the next move re-arms
      return input;
    },

    spawnAt(at) {
      const cordId = nextCordId;
      nextCordId += 1;
      pendingSpawn = { cordId, at: { x: at.x, y: at.y } };
      held = { cordId, index: 0, target: { x: at.x, y: at.y } };
      return cordId;
    },

    spawnCoilAt(at) {
      const cordId = nextCordId;
      nextCordId += 1;
      pendingSpawn = { cordId, at: { x: at.x, y: at.y } };
      return cordId;
    },

    spawnModule(at) {
      const view = deps.view();
      return spawnModuleInto(stage, at, view.maxX, view.maxY);
    },

    seatEndOn(cordId, index, rectId, at) {
      const rect = stage[rectId];
      if (rect === undefined) return false;
      if (controller.seatsOnRect(rectId) >= PLUG_CAP_PER_RECT) return false;
      held = { cordId, index, target: { x: at.x, y: at.y } };
      return seatHeldOn(rectId, at);
    },

    releaseHeldOffRect() {
      if (held === null) return;
      const { cordId, index, target } = held;
      held = null;
      failureReleaseFrom(cordId, index, target);
    },

    denySeat(rectId, at) {
      // Flat Plug Red paint on the denied face, fading on the sim clock; a
      // second denial replaces the first. Never seats — the release routing
      // proceeds (the jack stays re-grabbable).
      deny = { x: at.x, y: at.y, t: simTime };
      void rectId;
    },

    onLifecycleTransition(event) {
      if (event.to === 'popped' && event.end !== null) {
        releaseSeat(event.cordId, event.end); // INT-6's same-frame latch drop
      }
      if (event.to === 'vanishing') {
        if (held !== null && held.cordId === event.cordId) held = null;
        if (stagedFailure !== null && stagedFailure.cordId === event.cordId) stagedFailure = null;
        // A dying cord accepts no NEW seat: staged-but-unapplied seat records
        // die with the transition; a LANDED far-end seat stays (legal
        // transport until the choreography's pull-out drops it).
        for (const key of [...seatRecords.keys()]) {
          const [cordIdStr, indexStr] = key.split(':');
          if (Number(cordIdStr) !== event.cordId) continue;
          if (world.lifecycle.endMode(event.cordId, Number(indexStr)) !== 'seated') {
            releaseSeat(event.cordId, Number(indexStr));
          }
        }
      }
    },

    onVanishEvent(event) {
      if (event.kind === 'pull' && event.end !== null) {
        releaseSeat(event.cordId, event.end); // the same-frame latch drop
      }
      if (event.kind === 'complete') {
        for (const key of [...seatRecords.keys()]) {
          const [cordIdStr] = key.split(':');
          if (Number(cordIdStr) === event.cordId) releaseSeat(event.cordId, Number(key.split(':')[1]));
        }
      }
    },

    heldEnd() {
      return held === null ? null : { cordId: held.cordId, index: held.index };
    },

    seatPoseOf(cordId, index) {
      const record = seatRecords.get(seatKey(cordId, index));
      if (record === undefined) return null;
      poseShell.x = record.position.x;
      poseShell.y = record.position.y;
      poseShell.nx = record.nx;
      poseShell.ny = record.ny;
      return poseShell;
    },

    get deny() {
      return deny;
    },

    noteSimTime(t) {
      simTime = t;
    },

    seatsOnRect(rectId) {
      let count = 0;
      for (const record of seatRecords.values()) if (record.rectId === rectId) count += 1;
      return count;
    },

    handlesFor() {
      if (resizeDrag !== null) return resizeDrag.rectId;
      if (pointerWorld === null) return -1;
      // The hover generosity a release gets (EDGE_REGION_MARGIN): hovering
      // the module — or its immediate halo — shows the furniture; an exact
      // corner press round-trips to an epsilon outside the rect otherwise.
      return rectAt(pointerWorld.x, pointerWorld.y, stage, EDGE_REGION_MARGIN);
    },

    seatList() {
      const out: Array<{ cordId: number; index: number; rectId: number; edge: number; fraction: number }> = [];
      for (const record of seatRecords.values()) {
        out.push({
          cordId: record.cordId,
          index: record.index,
          rectId: record.rectId,
          edge: record.edge,
          fraction: record.fraction,
        });
      }
      return out;
    },
  };
  return controller;
}

/**
 * 2D-2 — THE INTERACTION CONTROLLER (Doctor Strange's lane: interaction
 * determinism). One object owns everything between the DOM's pointer events
 * and the sim's intent stream, mirroring the composition discipline the 2D-1
 * fuzz harness pinned (fuzzHarness.ts is the spec — the corpus is green
 * against exactly these laws):
 *
 * PICKING — priority jack > rectangle > cord body (town-hall decision #4).
 * A jack is a generous hit circle at its world position (the sim's own end
 * point, screen-exact through the shared view); a rectangle is point-in-rect
 * (topmost wins); the cord body is a distance-to-polyline read that is
 * NEVER grabbable — hover cursor only. Only jacks are grabbable, and only
 * when the machine allows it (v1's law: not vanishing, and not a popped
 * cord's surviving socket — the pop must not be dodgeable by hand).
 *
 * DRAG — a rectangle translates (clamped above the panel floor by the stage
 * law) and every plug seated on it RIDES the delta through the seat latch
 * (INT-3 transport). A carried jack's pin target follows the cursor EXACTLY
 * (2D — no plane math); the SIM-2 leash and the fixed-timestep driver own
 * every ounce of feel after that.
 *
 * RELEASE — over a rectangle's edge region: SEAT through the stage law
 * (perpendicular to the nearest edge, insertion depth inside the perimeter,
 * deterministic corner resolution), unless the rectangle is at its soft cap
 * (12) — then the DENY RING (never seats, ordinary release routing, the
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
  clampRectCenter,
  rectAt,
  seatPoseInto,
} from '../world/stage';
import type { SeatPose, StageRect } from '../world/stage';
import type { View } from '../world/view';

/** Generous jack hit radius (world units) — v1's proxy halo, translated. */
export const JACK_PICK_RADIUS = 0.16;
/** Cord-body hover distance (world units) — cursor feedback only. */
export const CORD_HOVER_RADIUS = 0.06;
/** v1's soft plug cap per rectangle — a perf guard, not a rule (deny ring). */
export const PLUG_CAP_PER_RECT = 12;
/** The floor-rest height a released coil converges to (FLOOR_REST_Y). */
export const FLOOR_REST_Y = 0.055;
/** In-flight drop budget: frames of converge targets before the stub freezes. */
const DROP_FRAMES = 90;
const DROP_CONVERGE_DIST = 0.03;

export type HoverKind = 'none' | 'jack' | 'rect' | 'cord';

/** One seated end — the composition's mirror of the sim's seat. */
interface SeatRecord {
  readonly cordId: number;
  readonly index: number;
  readonly rectId: number;
  /** Rect center at seat time (transports ride center deltas from here). */
  readonly baseCX: number;
  readonly baseCY: number;
  /** Pin at seat time. */
  readonly basePX: number;
  readonly basePY: number;
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
  /** The live stage (drag mutates rect centers in place). */
  readonly stage: readonly StageRect[];
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
  let pointerWorld: Vec2 | null = null;
  let hover: HoverKind = 'none';
  const pointerWorldScratch: Vec2 = { x: 0, y: 0 };
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

  /** The jack pick: nearest end within the halo (world order breaks ties). */
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
        const dx = p.x - wx;
        const dy = p.y - wy;
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

  const refreshHover = (): void => {
    hover = 'none';
    if (pointerWorld === null) return;
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

  const controller: InteractionController = {
    pointerDown(px, py) {
      const view = deps.view();
      view.toWorld(px, py, pointerWorldScratch);
      pointerWorld = pointerWorldScratch;
      const wx = pointerWorld.x;
      const wy = pointerWorld.y;
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
      refreshHover();
    },

    pointerUp(px, py) {
      const view = deps.view();
      view.toWorld(px, py, pointerWorldScratch);
      pointerWorld = pointerWorldScratch;
      rectDrag = null;
      if (held === null) return;
      const { cordId, index, target } = held;
      const wx = pointerWorldScratch.x;
      const wy = pointerWorldScratch.y;
      // Over a rectangle's edge region → seat (or deny at the soft cap).
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
    },

    pointerLeave() {
      pointerWorld = null;
      brush = null;
      rectDrag = null;
      refreshHover();
    },

    hoverCursor() {
      if (held !== null || rectDrag !== null) return 'grabbing';
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
  };
  return controller;
}

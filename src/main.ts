/**
 * Composition root — THE CANVAS WORLD (2D-2; town-hall Revision 2's flat
 * panel, replacing 2D-1's headless shell). One page, one loop, one law per
 * layer:
 *
 *   src/sim/          the liftable headless core (unchanged by this task)
 *   src/world/        the stage contract — 8 candy-zoned modules, the seat
 *                     law (edge-perpendicular, deterministic corners), the
 *                     world↔screen projection
 *   src/render/       the Canvas 2D painter — panel, modules, cords, jacks
 *                     + 2D-3's state furniture (ticks, grace dim/blink,
 *                     shatter debris, the chase pulse) from the pure laws
 *   src/interaction/  pointer → intents: pick jack>rect>cord, drag/carry,
 *                     seat/deny/release, the brush, N/R
 *   src/hud/          the surviving DOM faceplate (rewired here)
 *
 * The frame loop is ARC-3's fixed-timestep discipline (120 Hz slices, ≤5
 * substeps, backlog discarded): compose ONE SimInput from the interaction
 * layer, advance the driver, paint the renderer, update the HUD from the
 * sim's own lifecycle reads. Motion is sim-driven; a frozen sim paints a
 * frozen picture. 2D-3 restores v1 LIFE-3's FRAME GATE on top: a HIDDEN page
 * pauses sim + paint (a skipped frame advances nothing), and the first frame
 * back draws with delta ZERO — the pause consumes no wall-clock work, so
 * there is no backlog to burn (the driver's own clamp stays the second belt).
 *
 * THE OPENING (v1's REFINE-3 staging, translated): one patch cord is spawned
 * coiled on module 08 with its RED end SEATED on the module's top edge
 * through the same production seat path any release takes — the first frame
 * stages the toy's core verb already performed once (grab the blue end, one
 * module away from a completed link). No invisible anchors exist anywhere.
 *
 * Seams for drives and review (window.cords): lifecycle(), ends() (screen
 * px), rects() (screen px + silkscreen label), probe() (frame timing),
 * pulse() (the chase clock + the renderer's own gate read), statePaint()
 * (the state furniture's live numbers), motion() (the brush probe), gate()
 * (the frame-gate counters), seats() (2D-6's edge-relative seat evidence),
 * handlesFor() (2D-6's live handle furniture), spawn()/reset() and
 * spawnModule() (2D-6) mirror the HUD buttons exactly.
 */
import {
  DEFAULT_GRACE_SECONDS,
  DEFAULT_IDLE_SECONDS,
  DEFAULT_OVERSTRETCH_THRESHOLD,
  createCordWorldStep,
  createFixedTimestepDriver,
} from './sim';
import type { CordWorldStep, FixedTimestepDriver, SimInput, SimState, Vec2 } from './sim';
import { createStage, seatPose } from './world/stage';
import { FLOOR_MARGIN_PX, createView } from './world/view';
import type { View } from './world/view';
import { createRenderer } from './render/renderer';
import type { CordPaint, FrameInput } from './render/renderer';
import { DEFAULT_PULSE_SPEED, pulsePhase, resolvePulseSpeed } from './render/pulse';
import { createFrameGate } from './render/frameGate';
import { createInteractionController } from './interaction/controller';
import type { InteractionController } from './interaction/controller';
import { createHudPanel } from './hud/panel';
import { putAwayNotice, readHudCountsInto, vanishNotice } from './hud/model';
import type { HudCounts } from './hud/model';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('#app mount point missing from index.html');
}
const mainLandmark = document.querySelector<HTMLElement>('main');
if (!mainLandmark) {
  throw new Error('<main> landmark missing from index.html');
}

// --- the production world's numbers (2D-1's verified shape) -------------------
const SIM_TIMESTEP = 1 / 120;
const MAX_SUBSTEPS_PER_FRAME = 5;
const CORD_SEGMENTS = 24;
const FLOOR_Y = 0;
/** 2D-7 — the raised cord ceiling (v1's 16 was a 3D render-pool leftover). */
const MAX_CORDS = 48;
const BRUSH = { radiusRestLengths: 1.5, strength: 1.0 } as const;
const RED = 0;
const BLUE = CORD_SEGMENTS;

// --- the stage ----------------------------------------------------------------
const stage = createStage();

// --- the canvas ---------------------------------------------------------------
const canvas = document.createElement('canvas');
canvas.id = 'stage';
// The stage IS the page: fixed, full-viewport, top-left anchored (the HUD
// faceplate floats over its bottom edge, above the floor line's margin).
canvas.style.position = 'fixed';
canvas.style.left = '0';
canvas.style.top = '0';
canvas.style.display = 'block';
// 2D-8 — the canvas OWNS its gestures: no page scroll, no pinch-zoom, no
// double-tap fight while a finger drags a jack (index.html carries the same
// rule as CSS for #stage; this is the belt to that suspenders).
canvas.style.touchAction = 'none';
canvas.setAttribute('role', 'img');
canvas.setAttribute(
  'aria-label',
  'Cords — a 2D cable patch panel. Steel modules on a dark machined ' +
    'panel; grab a cord jack to plug it into any module edge. Press N for a ' +
    'new cord, B for a new module, R to reset.',
);
app.appendChild(canvas);

const renderer = createRenderer(canvas);

// --- the HUD (v1's DOM faceplate, rewired to this world) ----------------------
// 2D-8 — created BEFORE the first view fit: the faceplate's live height is
// the view's floor margin (a wrapped phone strip pushes the floor line —
// and the whole world — up above the buttons), so `fit` measures it.
const hud = createHudPanel(mainLandmark, document, {
  onNewCord: () => spawnNewCord(),
  onNewModule: () => spawnNewModule(),
  onReset: () => resetScene(),
});

// --- the responsive view (2D-8: contain on ANY viewport) -----------------------
let view: View = createView(window.innerWidth, window.innerHeight);
const fit = (): void => {
  // The floor line sits above whatever the faceplate occupies: the desktop
  // one-row strip stays under the classic 72-px margin; a wrapped phone
  // strip (44-px buttons) grows the margin so no module hides under it.
  // getBoundingClientRect forces the reflow first — the wrap answers for
  // THIS width before the view reads it.
  const hudHeight = Math.round(
    (hud.root as HTMLElement).getBoundingClientRect().height,
  );
  const margin = Math.max(FLOOR_MARGIN_PX, hudHeight);
  view = createView(window.innerWidth, window.innerHeight, margin);
  renderer.setView(view, window.devicePixelRatio || 1);
};
fit();
window.addEventListener('resize', fit);
// 2D-8 — rotation re-fits the contain law (portrait ↔ landscape); the resize
// event usually accompanies it, this is the belt for the ones that do not.
window.addEventListener('orientationchange', fit);
// 2D-8 — iOS Safari fires visualViewport resize (URL-bar collapse, keyboard)
// ahead of window resize; the same pure re-fit answers it, no-op when the
// window numbers have not moved.
window.visualViewport?.addEventListener('resize', fit);

const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const reducedMotion = (): boolean => reducedMotionQuery.matches;
// 2D-8 — the pointer class: touch halos + the last-touched handle law ride
// on matchMedia('(pointer: coarse)'); read live per event (never cached) so
// a hybrid device flipping input modes re-answers honestly.
const coarsePointerQuery = window.matchMedia('(pointer: coarse)');
const coarsePointer = (): boolean => coarsePointerQuery.matches;

// --- a session: one world + driver + controller, rebuilt by RESET --------------
interface Session {
  world: CordWorldStep;
  driver: FixedTimestepDriver;
  controller: InteractionController;
  state: SimState;
  /** Deaths begun since the last HUD update, by vocabulary (REFINE-1/4). */
  shattered: number;
  putAway: number;
  /** 2D-3: the latched failing end per cord (the blinking band / dim read). */
  readonly failingEnds: Map<number, number>;
  /** 2D-3: the end whose jack already shattered (shards replaced it). */
  readonly hiddenJacks: Map<number, number>;
}

let session: Session;

const createSession = (withOpening: boolean): Session => {
  const next: Session = {
    world: null as unknown as Session['world'],
    driver: null as unknown as Session['driver'],
    controller: null as unknown as Session['controller'],
    state: { time: 0, cords: [] },
    shattered: 0,
    putAway: 0,
    failingEnds: new Map(),
    hiddenJacks: new Map(),
  };
  next.world = createCordWorldStep({
    cord: { segmentCount: CORD_SEGMENTS, floorY: FLOOR_Y },
    maxCords: MAX_CORDS,
    overStretch: { threshold: DEFAULT_OVERSTRETCH_THRESHOLD },
    vanish: {
      onEvent: (event) => {
        next.controller.onVanishEvent(event);
        // 2D-3 — the shatter's render half: the failing jack despawns into
        // the debris burst (the polarity shard names WHICH end died; the red
        // end leads an abandoned decay by convention). Reduced motion skips
        // the burst (A11Y-1); the fade sequence itself runs unchanged.
        if (event.kind === 'shatter' && event.at !== null && event.end !== null) {
          next.hiddenJacks.set(event.cordId, event.end);
          if (!reducedMotion()) {
            renderer.burst(event.at, event.end === RED ? 'red' : 'blue', event.time);
          }
        }
      },
    },
    brush: BRUSH,
    lifecycle: {
      idleSeconds: DEFAULT_IDLE_SECONDS,
      onTransition: (event) => {
        next.controller.onLifecycleTransition(event);
        if (event.to === 'vanishing') {
          if (event.reason === 'abandoned') next.putAway += 1;
          else next.shattered += 1;
          // Latch the failing end: the pop names it; an abandoned decay's
          // red end leads by convention (the machine's own derivation).
          if (event.end !== null) next.failingEnds.set(event.cordId, event.end);
          else if (!next.failingEnds.has(event.cordId)) next.failingEnds.set(event.cordId, RED);
        }
        if (event.to === 'popped' && event.end !== null) {
          next.failingEnds.set(event.cordId, event.end);
        }
        if (event.to === 'linked') next.failingEnds.delete(event.cordId); // the re-seat rescue
        if (event.to === 'gone') {
          next.failingEnds.delete(event.cordId);
          next.hiddenJacks.delete(event.cordId);
        }
      },
      onRejected: (rejection) => {
        console.warn(
          `cords: lifecycle rejected ${rejection.action} on cord ${rejection.cordId} (${rejection.from}): ${rejection.detail}`,
        );
      },
    },
  });
  void DEFAULT_GRACE_SECONDS; // the machine's default grace (~3 s) stands
  next.driver = createFixedTimestepDriver(next.world, {
    timestep: SIM_TIMESTEP,
    maxSubsteps: MAX_SUBSTEPS_PER_FRAME,
  });
  next.controller = createInteractionController({
    world: next.world,
    state: () => next.state,
    view: () => view,
    stage,
    reducedMotion,
    coarsePointer, // 2D-8 — touch halos + the last-touched handle law
  });
  if (withOpening) {
    stageOpening(next);
  }
  return next;
};

/**
 * THE OPENING — v1's REFINE-3 staging through the production seams only:
 * cord 0 spawns COILED on module 08's top edge and its red end seats there
 * in ONE explicit deterministic step before the first frame (exactly the
 * 2D-1 fuzz harness's composition-faithful anchor). The blue end trails
 * down to the bench — one grab away from a completed link.
 */
function stageOpening(next: Session): void {
  const m08 = stage[7];
  if (m08 === undefined) return;
  const seat = seatPose(m08.x + m08.w * 0.18, m08.y + m08.h / 2, m08); // top edge
  const cordId = next.controller.spawnCoilAt({ x: seat.x, y: m08.y + m08.h / 2 + 0.03 });
  next.controller.seatEndOn(cordId, RED, 7, { x: seat.x, y: m08.y + m08.h / 2 });
  const input: SimInput = next.controller.composeInput();
  next.state = next.world(next.state, SIM_TIMESTEP, input);
  next.controller.noteSimTime(next.state.time);
}

session = createSession(true);

const hudCounts: HudCounts = { cords: 0, awaitingPlug: 0, linked: 0, popped: 0, vanishing: 0 };
/** N / HUD NEW CORD — a coil springs into hand at the cursor. */
function spawnNewCord(): void {
  const pointer = lastPointerWorld();
  const at: Vec2 = pointer ?? { x: 0, y: 1.6 };
  session.controller.spawnAt({ x: at.x, y: at.y });
}

/**
 * 2D-6 — B / HUD NEW MODULE: an ordinary module at the cursor (deterministic
 * placement with honest overlap avoidance), or a free spot near stage center
 * when the pointer is unknown. At the soft cap (32) the spawn is a no-op —
 * the cord-cap discipline.
 */
function spawnNewModule(): void {
  session.controller.spawnModule(lastPointerWorld());
}

/**
 * R / HUD RESET — the reset-cords-only law: a fresh empty bench, MODULES
 * STAND AS LEFT (positions AND sizes persist; spawned modules survive —
 * the arrangement is the user's bench, not the cords').
 */
function resetScene(): void {
  renderer.clearFragments();
  session = createSession(false);
}

// --- 2D-3: the per-frame paint composition + the chase clock -------------------
/** One cord's rest total (world units) — the tautness denominator. */
const REST_TOTAL = CORD_SEGMENTS * 0.1;
/** The per-cord lifecycle paint reads, parallel to state.cords (pooled). */
const paints: CordPaint[] = [];
for (let i = 0; i < MAX_CORDS; i += 1) {
  paints.push({
    state: 'none',
    tautness: 0,
    graceRemaining: null,
    failingEnd: null,
    fade: null,
    jackHiddenEnd: null,
  });
}

/** Fills the paint pool from the machine's own reads (zero allocation). */
function fillPaints(): void {
  const cords = session.state.cords;
  for (let k = 0; k < cords.length && k < paints.length; k += 1) {
    const cord = cords[k];
    const p = paints[k];
    const st = session.world.lifecycle.stateOf(cord.id) ?? 'none';
    p.state = st;
    const a = cord.points[0];
    const b = cord.points[cord.points.length - 1];
    p.tautness =
      a !== undefined && b !== undefined
        ? Math.hypot(b.x - a.x, b.y - a.y) / REST_TOTAL
        : 0;
    if (st === 'popped') p.graceRemaining = session.world.lifecycle.graceRemaining(cord.id) ?? 0;
    else if (st === 'vanishing') p.graceRemaining = 0; // the dim holds its floor through the fade
    else p.graceRemaining = null;
    p.failingEnd = session.failingEnds.get(cord.id) ?? null;
    const info = st === 'vanishing' ? session.world.lifecycle.vanishInfo(cord.id) : null;
    p.fade = info !== null ? info.progress : null;
    p.jackHiddenEnd = session.hiddenJacks.get(cord.id) ?? null;
  }
}

// --- 2D-3: the frame gate (v1 LIFE-3's visibility law, restored) ----------------
const gate = createFrameGate();
document.addEventListener('visibilitychange', () => {
  gate.setHidden(document.hidden);
});

// --- pointer wiring -------------------------------------------------------------
// 2D-5 — THE GRAB CONTRACT: the canvas takes POINTER CAPTURE on pointerdown,
// so the canvas is the sole listener for the whole gesture (HUD crossings,
// window-edge excursions, fast flings — every move/up lands here, never on
// the faceplate). pointerup and pointercancel are the ONLY release signals;
// pointerleave is passive (the controller's latch law ignores it mid-drag).
//
// 2D-8 — THE MULTI-TOUCH LAW: the FIRST pointer owns the interaction. While
// an owning pointer is down (mouse button held, or a finger on the glass),
// every event from every OTHER pointer is dropped at this door — a second
// finger resting on the canvas can neither start a second drag, hijack the
// live one's moves, nor "release" it with its own pointerup. When the owner
// lifts, a finger that came down meanwhile is still refused: its down was
// never routed, so its moves must not speak either (a stranger's finger
// does not inherit the page). Two honest exceptions keep the law total: an
// up/cancel with NO live owner routes (2D-5's spawn-is-the-grab corpus —
// N holds a jack, moves steer it, the release seats it without a canvas
// press; a real mouse cannot make an up without a down, but totality is
// the discipline), and the next FRESH press — whatever pointer makes it —
// starts the next interaction. One sandbox, one hand's story at a time.
const lastPointerScratch: Vec2 = { x: 0, y: 0 };
const pointerOut: Vec2 = { x: 0, y: 0 };
let pointerOnStage = false;
let ownerPointerId: number | null = null;
/** Pointers currently down whose down-event was NOT routed (non-owners). */
const bystanderPointers = new Set<number>();

function lastPointerWorld(): Vec2 | null {
  if (!pointerOnStage) return null;
  return view.toWorld(lastPointerScratch.x, lastPointerScratch.y, pointerOut);
}

canvas.addEventListener('pointerdown', (e) => {
  if (ownerPointerId !== null) {
    bystanderPointers.add(e.pointerId);
    return; // the owner's drag is sacred
  }
  ownerPointerId = e.pointerId;
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    // A failed capture (stale/unknown pointer id) must not kill the grab:
    // the controller's latch owns the drag either way.
  }
  pointerOnStage = true;
  lastPointerScratch.x = e.clientX;
  lastPointerScratch.y = e.clientY;
  session.controller.pointerDown(e.clientX, e.clientY);
  canvas.style.cursor = session.controller.hoverCursor();
});
canvas.addEventListener('pointermove', (e) => {
  if (ownerPointerId !== null && e.pointerId !== ownerPointerId) return;
  if (ownerPointerId === null && bystanderPointers.has(e.pointerId)) return;
  pointerOnStage = true;
  lastPointerScratch.x = e.clientX;
  lastPointerScratch.y = e.clientY;
  session.controller.pointerMove(e.clientX, e.clientY);
  canvas.style.cursor = session.controller.hoverCursor();
});
canvas.addEventListener('pointerup', (e) => {
  // Only a BYSTANDER's up is refused — and only while its owner still owns
  // the gesture. An up with no live owner ROUTES (the 2D-5 corpus's
  // spawn-is-the-grab pattern: N holds a jack, moves steer it, the release
  // seats it with no canvas press in between; a real mouse cannot produce
  // an up without a down, but the law stays total anyway).
  if (ownerPointerId !== null && e.pointerId !== ownerPointerId) {
    bystanderPointers.delete(e.pointerId);
    return;
  }
  ownerPointerId = null;
  lastPointerScratch.x = e.clientX;
  lastPointerScratch.y = e.clientY;
  session.controller.pointerUp(e.clientX, e.clientY);
  canvas.style.cursor = session.controller.hoverCursor();
});
canvas.addEventListener('pointercancel', (e) => {
  // 2D-5 — the pointer system ended the gesture: release honestly, at the
  // last known position, exactly like a pointerup (a wedged latch would
  // turn the next click into an accidental off-module shatter). Same
  // ownership read as up: bystanders only, and only while an owner lives.
  if (ownerPointerId !== null && e.pointerId !== ownerPointerId) {
    bystanderPointers.delete(e.pointerId);
    return;
  }
  ownerPointerId = null;
  lastPointerScratch.x = e.clientX;
  lastPointerScratch.y = e.clientY;
  session.controller.pointerCancel(e.clientX, e.clientY);
  canvas.style.cursor = session.controller.hoverCursor();
});
canvas.addEventListener('pointerleave', () => {
  pointerOnStage = false;
  session.controller.pointerLeave();
  canvas.style.cursor = 'default';
});

// --- keyboard (the HUD buttons' own seams; modifier/repeat guarded) ------------
window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.repeat) return;
  const key = e.key.toLowerCase();
  if (key === 'n') spawnNewCord();
  else if (key === 'r') resetScene();
  else if (key === 'b') spawnNewModule();
});

// --- perf probe (?probe=1): frame-time log at the 2D-7 ceilings -----------------
const probeOn = new URLSearchParams(window.location.search).has('probe');
const probe = {
  frames: 0,
  totalMs: 0,
  maxMs: 0,
  lastLog: 0,
  samples: [] as number[],
};
const probeLog = (): void => {
  const avg = probe.totalMs / Math.max(1, probe.frames);
  const sorted = [...probe.samples].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? avg;
  console.log(
    `[cords probe] ${probe.frames} frames · avg ${avg.toFixed(3)} ms · p95 ${p95.toFixed(3)} ms · max ${probe.maxMs.toFixed(3)} ms · cords ${session.state.cords.length}/48 · modules ${stage.length} — 16.7 ms budget`,
  );
};
if (probeOn) {
  // 2D-7 — THE CEILING STAGE: 16 modules + 48 live cords (12 linked cords —
  // the chase pulse's twelve amber segments — plus 35 awaiting-plug singles,
  // the opening cord among them), staged through the production seams the
  // way the composition actually composes — one explicit step between one
  // -shot intents (a spawn's slot must FLOW before the next spawn
  // overwrites it, exactly as frames interleave in the harness). Seated
  // cords never idle, so the stage stands for the whole probe run.
  const stepOnce = (): void => {
    const input = session.controller.composeInput();
    session.state = session.driver.advance(session.state, 1 / 60, input).state;
    session.controller.noteSimTime(session.state.time);
  };
  // Eight spawned modules on a lower row (ids 8..15): a 16-module bench.
  for (const x of [-2.8, -1.9, -1.0, -0.1, 0.8, 1.7, 2.6, 3.4]) {
    session.controller.spawnModule({ x, y: 0.55 });
    stepOnce();
  }
  // Twelve linked pairs: authored neighbors above, spawned neighbors below.
  const pairs: ReadonlyArray<readonly [number, number]> = [
    [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7],
    [8, 9], [9, 10], [10, 11], [12, 13], [14, 15],
  ];
  for (const [a, b] of pairs) {
    const ra = stage[a];
    const rb = stage[b];
    if (ra === undefined || rb === undefined) break;
    const id = session.controller.spawnCoilAt({ x: ra.x, y: ra.y + ra.h / 2 + 0.03 });
    stepOnce();
    session.controller.seatEndOn(id, RED, a, { x: ra.x, y: ra.y + ra.h / 2 });
    session.controller.seatEndOn(id, BLUE, b, { x: rb.x, y: rb.y + rb.h / 2 });
    stepOnce();
  }
  // 35 awaiting-plug singles (the opening cord is the 48th live cord), one
  // seated end each, spread along every module's top edge.
  for (let i = 0; i < 35; i += 1) {
    const r = stage[i % stage.length];
    if (r === undefined) break;
    const x = r.x + (((i % 4) - 1.5) / 4) * r.w;
    const id = session.controller.spawnCoilAt({ x, y: r.y + r.h / 2 + 0.03 });
    stepOnce();
    session.controller.seatEndOn(id, RED, r.id, { x, y: r.y + r.h / 2 });
    stepOnce();
  }
}

// --- the frame loop --------------------------------------------------------------
const frameInput: FrameInput = {
  state: session.state,
  modules: stage,
  seatPoseOf: (cordId, index) => session.controller.seatPoseOf(cordId, index),
  deny: null,
  simTime: 0,
  paint: paints,
  pulsePhase: null,
  reducedMotion: false,
  handlesFor: -1,
};

let prevNow = 0;
const tick = (now: number): void => {
  // The frame gate: a hidden page pauses sim + paint; the first frame back
  // draws with delta ZERO (no backlog — the pause consumed no sim work).
  const verdict = gate.beginFrame();
  if (verdict === 'skip') {
    requestAnimationFrame(tick);
    return;
  }
  const dt =
    prevNow === 0 ? 1 / 60 : verdict === 'draw-zero-delta' ? 0 : (now - prevNow) / 1000;
  prevNow = now;
  const frameStart = probeOn ? performance.now() : 0;

  const input = session.controller.composeInput();
  const advanced = session.driver.advance(session.state, dt, input);
  session.state = advanced.state;
  session.controller.noteSimTime(session.state.time);

  const reduced = reducedMotion();
  fillPaints();
  frameInput.state = session.state;
  frameInput.deny = session.controller.deny;
  frameInput.simTime = session.state.time;
  frameInput.pulsePhase = pulsePhase(session.state.time, { reduced });
  frameInput.reducedMotion = reduced;
  frameInput.handlesFor = session.controller.handlesFor();
  renderer.draw(frameInput);

  // HUD: honest counts + the deaths' one spoken lines (consumed here).
  readHudCountsInto(session.state.cords, session.world.lifecycle.stateOf, hudCounts);
  hudCounts.modules = stage.length; // 2D-7 — the roster is world state; B moves it
  let notice: string | null = null;
  if (session.shattered > 0 || session.putAway > 0) {
    const parts: string[] = [];
    if (session.shattered > 0) parts.push(vanishNotice(session.shattered));
    if (session.putAway > 0) parts.push(putAwayNotice(session.putAway));
    notice = parts.join(' ');
    session.shattered = 0;
    session.putAway = 0;
  }
  hud.update(hudCounts, notice);

  if (probeOn) {
    const ms = performance.now() - frameStart;
    probe.frames += 1;
    probe.totalMs += ms;
    if (ms > probe.maxMs) probe.maxMs = ms;
    probe.samples.push(ms);
    if (probe.samples.length > 600) probe.samples.shift();
    if (now - probe.lastLog > 4000) {
      probe.lastLog = now;
      probeLog();
      probe.frames = 0;
      probe.totalMs = 0;
      probe.maxMs = 0;
    }
  }
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);

// --- window.cords — read seams for drives + review ------------------------------
interface CordsEnd {
  cordId: number;
  index: number;
  x: number; // screen px (CSS)
  y: number;
  seated: boolean;
}
declare global {
  interface Window {
    cords?: {
      lifecycle(): Array<{
        id: number;
        state: string;
        grace: number | null;
        idle: number | null;
        vanish: { phase: string; progress: number } | null;
      }>;
      /** Every jack's screen position + seatedness (drive targeting). */
      ends(): CordsEnd[];
      /**
       * 2D-3 — every cord's full polyline in screen px (drive targeting:
       * the brush corridors and capture crops read REAL cord geometry, not
       * endpoint extrapolation).
       */
      points(): Array<{ cordId: number; pts: Array<{ x: number; y: number }> }>;
      /** The modules' screen quads (drive targeting). */
      rects(): Array<{ id: number; x: number; y: number; w: number; h: number; label: string }>;
      /** The live view's numbers (scale, floor line — for drive math). */
      view(): { scale: number; floorScreenY: number; width: number; height: number };
      /** N / HUD NEW CORD (the same seam the keyboard uses). */
      spawn(): void;
      /**
       * 2D-6 — B / HUD NEW MODULE (the same seam the keyboard uses; an
       * honest no-op at the 32-module soft cap).
       */
      spawnModule(): void;
      /**
       * 2D-6 — every live seat's edge-relative coordinate + world pin (the
       * resize law's evidence: the fraction is preserved through resizes,
       * the pin sits at the recomputed edge point).
       */
      seats(): Array<{
        cordId: number;
        index: number;
        rectId: number;
        edge: number;
        fraction: number;
        x: number;
        y: number;
      }>;
      /** 2D-6 — the module whose corner handles are shown right now (−1 = none). */
      handlesFor(): number;
      /** R / HUD RESET. */
      reset(): void;
      /** The held end (drive-side verification of a grab), or null. */
      held(): { cordId: number; index: number } | null;
      /** Perf probe snapshot (or null when ?probe=1 is absent). */
      probe(): { frames: number; avgMs: number; maxMs: number; cords: number } | null;
      /**
       * 2D-3 — the chase pulse: the pure clock math AND the renderer's own
       * live read (the phase drawn + per-cord gate gain + the LED segment's
       * screen center, the red→blue road).
       */
      pulse(): {
        time: number;
        phase: number;
        baseSpeed: number;
        speed: number;
        reduced: boolean;
        linked: number[];
        renderPhase: number;
        renderCords: Array<{ id: number; gain: number; cx: number; cy: number }>;
      };
      /**
       * 2D-3 — the state furniture's live numbers: per cord the renderer's
       * own paint reads (tickGain / dim / fade / jackHidden / bandLit) plus
       * the machine's grace read; globally the live shard count + reduced.
       */
      statePaint(): {
        reduced: boolean;
        shards: number;
        cords: Array<{
          id: number;
          state: string;
          grace: number | null;
          paint: {
            tickGain: number;
            dim: number;
            fade: number | null;
            jackHidden: boolean;
            bandLit: [boolean, boolean];
          } | null;
        }>;
      };
      /**
       * 2D-3 — the motion probe: the max per-point speed across every cord
       * since the previous call (u/s of sim space) — the brush DoD's read.
       */
      motion(): { maxSpeed: number };
      /** 2D-3 — the frame gate's counters (the resilience probe). */
      gate(): {
        framesDrawn: number;
        framesSkipped: number;
        pauses: number;
        resumes: number;
        paused: boolean;
      };
    };
  }
}
const endsScratch: Vec2 = { x: 0, y: 0 };
/** The motion probe's previous snapshot (drive-only state). */
let motionPrev: { t: number; pts: Float64Array } | null = null;
window.cords = {
  lifecycle: () =>
    session.state.cords.map((cord) => ({
      id: cord.id,
      state: session.world.lifecycle.stateOf(cord.id) ?? 'gone',
      grace: session.world.lifecycle.graceRemaining(cord.id),
      idle: session.world.lifecycle.idleRemaining(cord.id),
      vanish: session.world.lifecycle.vanishInfo(cord.id),
    })),
  ends: () => {
    const out: CordsEnd[] = [];
    for (const cord of session.state.cords) {
      const last = cord.points.length - 1;
      for (const index of [0, last] as const) {
        const p = cord.points[index];
        view.toScreen(p.x, p.y, endsScratch);
        out.push({
          cordId: cord.id,
          index,
          x: endsScratch.x,
          y: endsScratch.y,
          seated: session.world.lifecycle.endMode(cord.id, index) === 'seated',
        });
      }
    }
    return out;
  },
  points: () =>
    session.state.cords.map((cord) => ({
      cordId: cord.id,
      pts: cord.points.map((p) => {
        view.toScreen(p.x, p.y, endsScratch);
        return { x: endsScratch.x, y: endsScratch.y };
      }),
    })),
  rects: () =>
    stage.map((r) => {
      view.toScreen(r.x, r.y, endsScratch);
      return {
        id: r.id,
        x: endsScratch.x - (r.w * view.scale) / 2,
        y: endsScratch.y - (r.h * view.scale) / 2,
        w: r.w * view.scale,
        h: r.h * view.scale,
        label: r.label,
      };
    }),
  view: () => ({ scale: view.scale, floorScreenY: view.floorScreenY, width: view.width, height: view.height }),
  spawn: () => spawnNewCord(),
  spawnModule: () => spawnNewModule(),
  seats: () => {
    const out: Array<{
      cordId: number;
      index: number;
      rectId: number;
      edge: number;
      fraction: number;
      x: number;
      y: number;
    }> = [];
    for (const seat of session.controller.seatList()) {
      const pose = session.controller.seatPoseOf(seat.cordId, seat.index);
      out.push({
        ...seat,
        x: pose?.x ?? 0,
        y: pose?.y ?? 0,
      });
    }
    return out;
  },
  handlesFor: () => session.controller.handlesFor(),
  reset: () => resetScene(),
  held: () => session.controller.heldEnd(),
  probe: () =>
    probeOn
      ? {
          frames: probe.frames,
          avgMs: probe.totalMs / Math.max(1, probe.frames),
          maxMs: probe.maxMs,
          cords: session.state.cords.length,
        }
      : null,
  pulse: () => {
    const reduced = reducedMotion();
    const probePulse = renderer.pulseProbe();
    return {
      time: session.state.time,
      phase: pulsePhase(session.state.time, { reduced }),
      baseSpeed: DEFAULT_PULSE_SPEED,
      speed: resolvePulseSpeed({ reduced }),
      reduced,
      linked: session.state.cords
        .filter((cord) => session.world.lifecycle.stateOf(cord.id) === 'linked')
        .map((cord) => cord.id),
      renderPhase: probePulse.phase,
      renderCords: probePulse.cords,
    };
  },
  statePaint: () => {
    const probeState = renderer.stateProbe();
    return {
      reduced: reducedMotion(),
      shards: probeState.shards,
      cords: session.state.cords.map((cord, k) => ({
        id: cord.id,
        state: session.world.lifecycle.stateOf(cord.id) ?? 'gone',
        grace: session.world.lifecycle.graceRemaining(cord.id),
        paint: probeState.cords[k] ?? null,
      })),
    };
  },
  motion: () => {
    const flat: number[] = [];
    for (const cord of session.state.cords) {
      for (const p of cord.points) flat.push(p.x, p.y);
    }
    const now = performance.now();
    if (motionPrev === null || motionPrev.pts.length !== flat.length) {
      motionPrev = { t: now, pts: Float64Array.from(flat) };
      return { maxSpeed: 0 };
    }
    let maxD2 = 0;
    for (let i = 0; i < flat.length; i += 2) {
      const dx = flat[i] - motionPrev.pts[i];
      const dy = flat[i + 1] - motionPrev.pts[i + 1];
      const d2 = dx * dx + dy * dy;
      if (d2 > maxD2) maxD2 = d2;
    }
    const dt = Math.max(1e-3, (now - motionPrev.t) / 1000);
    motionPrev = { t: now, pts: Float64Array.from(flat) };
    return { maxSpeed: Math.sqrt(maxD2) / dt };
  },
  gate: () => ({ ...gate.counters(), paused: gate.paused() }),
};

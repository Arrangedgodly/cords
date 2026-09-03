/**
 * 2D-2 — INTERACTION TESTS through the REAL world (Doctor Strange's lane:
 * determinism). The controller is driven exactly as main.ts drives it —
 * screen-px pointer events in, composeInput() per frame, the production
 * fixed-timestep driver advancing the production-shaped world — and every
 * assertion reads the sim's own seams (lifecycle states, machine end modes,
 * cord points). The 2D-1 fuzz corpus pinned this composition discipline; 
 * these tests pin the pieces the corpus cannot see: picking priority, the
 * stage's seat law, the cap + deny ring, rect-drag transport, brush
 * composition, and the HUD-facing release paths.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OVERSTRETCH_THRESHOLD,
  createCordWorldStep,
  createFixedTimestepDriver,
} from '../sim';
import type { CordWorldStep, FixedTimestepDriver, SimInput, SimState } from '../sim';
import { createStage, seatPose } from '../world/stage';
import { createView } from '../world/view';
import type { View } from '../world/view';
import { createInteractionController } from './controller';
import type { InteractionController } from './controller';

const DT = 1 / 120;
const FRAME = 1 / 60;
const SEGMENTS = 24;
const END = SEGMENTS;
const RED = 0;
const BLUE = END;

/** The production composition, rebuilt per test (main.ts's session shape). */
interface App {
  world: CordWorldStep;
  driver: FixedTimestepDriver;
  controller: InteractionController;
  stage: ReturnType<typeof createStage>;
  view: View;
  state(): SimState;
  frame(frames?: number): SimState;
  /** Screen px for a world point (the drive side of the shared view). */
  sx(x: number, y: number): { x: number; y: number };
  /** The world point of a cord end, fresh. */
  end(cordId: number, index: number): { x: number; y: number };
}

function makeApp(options: { opening?: boolean; reduced?: boolean } = {}): App {
  const stage = createStage();
  const view = createView(1440, 838);
  let world: CordWorldStep;
  let controller: InteractionController;
  let state: SimState = { time: 0, cords: [] };
  world = createCordWorldStep({
    cord: { segmentCount: SEGMENTS, floorY: 0 },
    maxCords: 16,
    overStretch: { threshold: DEFAULT_OVERSTRETCH_THRESHOLD },
    vanish: {
      onEvent: (event) => {
        controller.onVanishEvent(event);
      },
    },
    brush: { radiusRestLengths: 1.5, strength: 1.0 },
    lifecycle: {
      onTransition: (event) => {
        controller.onLifecycleTransition(event);
      },
    },
  });
  const driver = createFixedTimestepDriver(world, { timestep: DT, maxSubsteps: 5 });
  controller = createInteractionController({
    world,
    state: () => state,
    view: () => view,
    stage,
    reducedMotion: () => options.reduced ?? false,
  });
  const frameOne = (): SimState => {
    const input: SimInput = controller.composeInput();
    state = driver.advance(state, FRAME, input).state;
    controller.noteSimTime(state.time);
    return state;
  };
  const app: App = {
    world,
    driver,
    controller,
    stage,
    view,
    state: () => state,
    frame(frames = 1): SimState {
      for (let i = 0; i < frames; i += 1) frameOne();
      return state;
    },
    sx(x, y) {
      return view.toScreen(x, y, { x: 0, y: 0 });
    },
    end(cordId, index) {
      const cord = state.cords.find((c) => c.id === cordId);
      const p = cord?.points[index];
      return p === undefined ? { x: 0, y: 0 } : { x: p.x, y: p.y };
    },
  };
  if (options.opening) {
    // main.ts's staging, mirrored: coil on module 08, red seated on its top.
    const m08 = stage[7];
    const pose = seatPose(m08.x + m08.w * 0.18, m08.y + m08.h / 2, m08);
    const id = controller.spawnCoilAt({ x: pose.x, y: m08.y + m08.h / 2 + 0.03 });
    controller.seatEndOn(id, RED, 7, { x: pose.x, y: m08.y + m08.h / 2 });
    const input = controller.composeInput();
    state = world(state, DT, input);
    controller.noteSimTime(state.time);
  }
  return app;
}

/** Drive a pointer path through the controller (screen px, like CDP would). */
function drag(app: App, from: { x: number; y: number }, to: { x: number; y: number }, frames = 12): void {
  app.controller.pointerDown(from.x, from.y);
  const steps = Math.max(1, frames);
  for (let i = 1; i <= steps; i += 1) {
    const px = from.x + ((to.x - from.x) * i) / steps;
    const py = from.y + ((to.y - from.y) * i) / steps;
    app.controller.pointerMove(px, py);
    app.frame(1);
  }
}

describe('2D-2 interaction — picking priority (jack > rectangle > cord body)', () => {
  it('a jack is grabbable through a generous hit circle; hover reads jack', () => {
    const app = makeApp();
    app.controller.spawnCoilAt({ x: 0, y: 1.5 }); // no hold — free-floating coil
    app.frame(2);
    const end = app.end(1, RED);
    const p = app.sx(end.x + 0.1, end.y); // 0.1 u off the tip — inside 0.16
    app.controller.pointerMove(p.x, p.y);
    expect(app.controller.hover()).toBe('jack');
    expect(app.controller.hoverCursor()).toBe('grab');
    app.controller.pointerDown(p.x, p.y);
    expect(app.controller.heldEnd()).toEqual({ cordId: 1, index: RED });
    // A spawn that lands IN HAND (N key) reads as carrying from frame one.
    const app2 = makeApp();
    app2.controller.spawnAt({ x: 0, y: 1.5 });
    app2.frame(2);
    expect(app2.controller.heldEnd()).toEqual({ cordId: 1, index: RED });
    expect(app2.controller.hoverCursor()).toBe('grabbing');
  });

  it('a jack ON a rectangle wins over the rectangle', () => {
    const app = makeApp();
    const m = app.stage[4];
    app.controller.spawnCoilAt({ x: m.x, y: m.y + 1.0 });
    app.frame(2);
    // Seat blue on the module top, then pick it back up THROUGH the rect.
    const pose = seatPose(m.x, m.y + m.h / 2, m);
    app.controller.seatEndOn(1, BLUE, m.id, { x: pose.socketX, y: pose.socketY });
    app.frame(2);
    expect(app.world.lifecycle.endMode(1, BLUE)).toBe('seated');
    const p = app.sx(pose.x, pose.y);
    app.controller.pointerMove(p.x, p.y);
    expect(app.controller.hover()).toBe('jack');
    app.controller.pointerDown(p.x, p.y);
    expect(app.controller.heldEnd()).toEqual({ cordId: 1, index: BLUE }); // jack, not rect
    // The grab of a seated end is the hand-pull (#7/#8): un-seat + carry.
    app.frame(2);
    expect(app.world.lifecycle.stateOf(1)).toBe('carried');
    expect(app.world.lifecycle.endMode(1, BLUE)).not.toBe('seated');
  });

  it('a rectangle point (no jack near) starts a rect drag, not a grab', () => {
    const app = makeApp();
    const m = app.stage[2];
    const p = app.sx(m.x, m.y);
    app.controller.pointerMove(p.x, p.y);
    expect(app.controller.hover()).toBe('rect');
    expect(app.controller.hoverCursor()).toBe('move');
    app.controller.pointerDown(p.x, p.y);
    expect(app.controller.heldEnd()).toBeNull();
  });

  it('the cord body is hover-only: cursor feedback, never a grab', () => {
    const app = makeApp();
    app.controller.spawnCoilAt({ x: 0, y: 1.2 });
    app.frame(200); // the coil relaxes outward on the floor — body well clear of the jacks
    const cord = app.state().cords.find((c) => c.id === 1);
    expect(cord).toBeDefined();
    const pts = cord!.points;
    const e0 = pts[0];
    const eN = pts[pts.length - 1];
    // The mid-body segment farthest from BOTH jacks — unambiguously body.
    let bestMid = { x: 0, y: 0 };
    let bestClear = -1;
    for (let i = 4; i < pts.length - 4; i += 1) {
      const mid = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 };
      const clear = Math.min(Math.hypot(mid.x - e0.x, mid.y - e0.y), Math.hypot(mid.x - eN.x, mid.y - eN.y));
      if (clear > bestClear) {
        bestClear = clear;
        bestMid = mid;
      }
    }
    expect(bestClear).toBeGreaterThan(0.2); // genuinely body, not near a jack
    const p = app.sx(bestMid.x, bestMid.y);
    app.controller.pointerMove(p.x, p.y);
    expect(app.controller.hover()).toBe('cord');
    expect(app.controller.hoverCursor()).toBe('crosshair');
    app.controller.pointerDown(p.x, p.y);
    expect(app.controller.heldEnd()).toBeNull(); // never grabbable
  });

  it('a vanishing cord has no grabbable jacks', () => {
    const app = makeApp();
    app.controller.spawnAt({ x: 0, y: 1.5 });
    app.frame(4);
    const a = app.stage[4];
    const seatAt = app.sx(a.x, a.y + a.h / 2 + 0.04);
    drag(app, app.sx(app.end(1, RED).x, app.end(1, RED).y), seatAt, 6);
    app.controller.pointerUp(seatAt.x, seatAt.y);
    app.frame(3);
    expect(app.world.lifecycle.stateOf(1)).toBe('awaiting-plug');
    // Release the blue end off-rectangle: awaiting-plug → vanishing.
    const off = app.sx(3.9, 0.2);
    drag(app, app.sx(app.end(1, BLUE).x, app.end(1, BLUE).y), off, 8);
    app.controller.pointerUp(off.x, off.y);
    app.frame(6);
    expect(app.world.lifecycle.stateOf(1)).toBe('vanishing');
    const end = app.end(1, BLUE);
    const p = app.sx(end.x, end.y);
    app.controller.pointerMove(p.x, p.y);
    expect(app.controller.hover()).not.toBe('jack');
    app.controller.pointerDown(p.x, p.y);
    expect(app.controller.heldEnd()).toBeNull();
  });
});

describe('2D-2 interaction — carry follows the cursor exactly; seating through the stage law', () => {
  it('a held jack\'s pin target IS the cursor point (no plane math)', () => {
    const app = makeApp();
    app.controller.spawnAt({ x: 0, y: 1.5 });
    app.frame(2);
    const end = app.end(1, RED);
    const p = app.sx(end.x, end.y);
    app.controller.pointerDown(p.x, p.y);
    const target = app.sx(0.8, 1.9);
    app.controller.pointerMove(target.x, target.y);
    const input = app.controller.composeInput();
    expect(input.pinTargets).toBeDefined();
    const t = input.pinTargets?.[0];
    expect(t?.cordId).toBe(1);
    const w = app.view.toWorld(target.x, target.y, { x: 0, y: 0 });
    expect(t?.position.x).toBeCloseTo(w.x, 12);
    expect(t?.position.y).toBeCloseTo(w.y, 12);
  });

  it('release over a rectangle edge region seats: awaiting-plug, perpendicular, depth-buried', () => {
    const app = makeApp();
    app.controller.spawnAt({ x: 0, y: 1.5 });
    app.frame(4);
    const end = app.end(1, RED);
    let p = app.sx(end.x, end.y);
    app.controller.pointerDown(p.x, p.y);
    // Drop it a hair above module 05's top edge (inside the edge region).
    const m = app.stage[4];
    const drop = app.sx(m.x, m.y + m.h / 2 + 0.04);
    for (let i = 1; i <= 8; i += 1) {
      const px = p.x + ((drop.x - p.x) * i) / 8;
      const py = p.y + ((drop.y - p.y) * i) / 8;
      app.controller.pointerMove(px, py);
      app.frame(1);
    }
    app.controller.pointerUp(drop.x, drop.y);
    app.frame(3);
    expect(app.world.lifecycle.stateOf(1)).toBe('awaiting-plug');
    expect(app.world.lifecycle.endMode(1, RED)).toBe('seated');
    // The pin sits SEAT_DEPTH inside the top edge, at the dropped x.
    const pose = app.controller.seatPoseOf(1, RED);
    expect(pose).not.toBeNull();
    expect(pose?.nx).toBe(0);
    expect(pose?.ny).toBe(1);
    expect(pose?.x).toBeCloseTo(m.x, 12);
    expect(pose?.y).toBeCloseTo(m.y + m.h / 2 - 0.082, 12);
    // And the sim's own end point is bitwise the seat (rope + machine agree).
    const seated = app.end(1, RED);
    expect(seated.x).toBeCloseTo(m.x, 6);
    expect(seated.y).toBeCloseTo(m.y + m.h / 2 - 0.082, 6);
  });

  it('second seat on another rectangle links; a seat on the SAME rectangle self-links', () => {
    const app = makeApp();
    app.controller.spawnAt({ x: 0, y: 1.5 });
    app.frame(4);
    const a = app.stage[4];
    const b = app.stage[5];
    // Red → module 05 top.
    drag(app, app.sx(app.end(1, RED).x, app.end(1, RED).y), app.sx(a.x, a.y + a.h / 2 + 0.04), 8);
    app.controller.pointerUp(app.sx(a.x, a.y + a.h / 2 + 0.04).x, app.sx(a.x, a.y + a.h / 2 + 0.04).y);
    app.frame(3);
    expect(app.world.lifecycle.stateOf(1)).toBe('awaiting-plug');
    // Blue → module 06 top: linked.
    const blue = app.end(1, BLUE);
    drag(app, app.sx(blue.x, blue.y), app.sx(b.x, b.y + b.h / 2 + 0.04), 8);
    app.controller.pointerUp(app.sx(b.x, b.y + b.h / 2 + 0.04).x, app.sx(b.x, b.y + b.h / 2 + 0.04).y);
    app.frame(3);
    expect(app.world.lifecycle.stateOf(1)).toBe('linked');
    // Self-link on one module's own edges (04: top + left, both legal).
    const app2 = makeApp();
    app2.controller.spawnAt({ x: 0, y: 1.5 });
    app2.frame(4);
    const m = app2.stage[3];
    const drop1 = app2.sx(m.x + 0.1, m.y + m.h / 2 + 0.04);
    drag(app2, app2.sx(app2.end(1, RED).x, app2.end(1, RED).y), drop1, 8);
    app2.controller.pointerUp(drop1.x, drop1.y);
    app2.frame(3);
    const drop2 = app2.sx(m.x - m.w / 2 - 0.04, m.y + 0.05); // left edge band
    drag(app2, app2.sx(app2.end(1, BLUE).x, app2.end(1, BLUE).y), drop2, 8);
    app2.controller.pointerUp(drop2.x, drop2.y);
    app2.frame(3);
    expect(app2.world.lifecycle.stateOf(1)).toBe('linked');
    expect(app2.controller.seatPoseOf(1, BLUE)?.nx).toBe(-1); // perpendicular, leftward
  });
});

describe('2D-2 interaction — release paths (the approved failure routing)', () => {
  it('release off-rectangle on an awaiting-plug cord → vanishing (via the sim seam)', () => {
    const app = makeApp();
    app.controller.spawnAt({ x: 0, y: 1.5 });
    app.frame(4);
    const a = app.stage[4];
    const seatAt = app.sx(a.x, a.y + a.h / 2 + 0.04);
    drag(app, app.sx(app.end(1, RED).x, app.end(1, RED).y), seatAt, 8);
    app.controller.pointerUp(seatAt.x, seatAt.y);
    app.frame(3);
    expect(app.world.lifecycle.stateOf(1)).toBe('awaiting-plug');
    // Grab the blue end and release over open floor.
    const blue = app.end(1, BLUE);
    drag(app, app.sx(blue.x, blue.y), app.sx(3.9, 0.2), 10);
    app.controller.pointerUp(app.sx(3.9, 0.2).x, app.sx(3.9, 0.2).y);
    app.frame(4);
    expect(app.world.lifecycle.stateOf(1)).toBe('vanishing');
    // The choreography completes and the cord leaves the world entirely.
    app.frame(240);
    expect(app.world.lifecycle.stateOf(1)).toBeUndefined();
    expect(app.state().cords.find((c) => c.id === 1)).toBeUndefined();
  });

  it('release off-rectangle on a carried cord → the ordinary drop (idle window opens)', () => {
    const app = makeApp();
    app.controller.spawnAt({ x: 0, y: 1.5 });
    app.frame(2);
    // In hand the window is PINNED full (every carry target resets it) — a
    // held coil can never count down.
    const idle0 = app.world.lifecycle.idleRemaining(1);
    expect(idle0).toBe(10);
    const end = app.end(1, RED);
    app.controller.pointerDown(app.sx(end.x, end.y).x, app.sx(end.x, end.y).y);
    app.controller.pointerUp(app.sx(0.3, 1.0).x, app.sx(0.3, 1.0).y);
    expect(app.world.lifecycle.stateOf(1)).toBe('carried');
    app.frame(30); // the in-flight drop converges, then the sweep retires
    const idle = app.world.lifecycle.idleRemaining(1);
    expect(idle).not.toBeNull();
    // Counting DOWN past full width proves the drop actually opened it.
    expect(idle as number).toBeLessThan(9.9);
    expect(app.world.lifecycle.stateOf(1)).toBe('carried'); // no transition — a drop
  });

  it('same-frame grab + release still routes to vanishing (the staged path)', () => {
    const app = makeApp();
    app.controller.spawnAt({ x: 0, y: 1.5 });
    app.frame(4);
    const a = app.stage[4];
    const seatAt = app.sx(a.x, a.y + a.h / 2 + 0.04);
    drag(app, app.sx(app.end(1, RED).x, app.end(1, RED).y), seatAt, 8);
    app.controller.pointerUp(seatAt.x, seatAt.y);
    app.frame(3);
    // Grab blue and release in the SAME frame, off-rectangle.
    const blue = app.end(1, BLUE);
    const p = app.sx(blue.x, blue.y);
    app.controller.pointerDown(p.x, p.y);
    const off = app.sx(-3.5, 0.3);
    app.controller.pointerMove(off.x, off.y);
    app.controller.pointerUp(off.x, off.y);
    app.frame(6);
    expect(app.world.lifecycle.stateOf(1)).toBe('vanishing');
  });
});

describe('2D-2 interaction — rectangle drag transports seated plugs (INT-3)', () => {
  it('dragging a rectangle moves its seated pins by the exact delta; the cord stays linked', () => {
    const app = makeApp();
    app.controller.spawnAt({ x: 0, y: 1.5 });
    app.frame(4);
    const a = app.stage[4];
    const b = app.stage[5];
    const ax = a.x; // snapshot the home center — `a` is the LIVE rect
    const ay = a.y;
    const seatA = app.sx(ax, ay + a.h / 2 + 0.04);
    drag(app, app.sx(app.end(1, RED).x, app.end(1, RED).y), seatA, 8);
    app.controller.pointerUp(seatA.x, seatA.y);
    const seatB = app.sx(b.x, b.y + b.h / 2 + 0.04);
    drag(app, app.sx(app.end(1, BLUE).x, app.end(1, BLUE).y), seatB, 8);
    app.controller.pointerUp(seatB.x, seatB.y);
    app.frame(3);
    expect(app.world.lifecycle.stateOf(1)).toBe('linked');
    // Drag module 05 by (0.3, −0.2): its passenger follows bitwise. (The
    // pose read fills a shared shell — snapshot scalars first.)
    const before = app.controller.seatPoseOf(1, RED);
    expect(before).not.toBeNull();
    const bx = before!.x;
    const by = before!.y;
    const grab = app.sx(ax, ay);
    app.controller.pointerDown(grab.x, grab.y);
    const to = app.sx(ax + 0.3, ay - 0.2);
    for (let i = 1; i <= 6; i += 1) {
      app.controller.pointerMove(grab.x + ((to.x - grab.x) * i) / 6, grab.y + ((to.y - grab.y) * i) / 6);
      app.frame(1);
    }
    app.controller.pointerUp(to.x, to.y);
    app.frame(3);
    const after = app.controller.seatPoseOf(1, RED);
    expect(after).not.toBeNull();
    expect(after!.x).toBeCloseTo(bx + 0.3, 9);
    expect(after!.y).toBeCloseTo(by - 0.2, 9);
    expect(app.world.lifecycle.stateOf(1)).toBe('linked'); // still linked
    expect(app.stage[4].x).toBeCloseTo(ax + 0.3, 9);
    expect(app.stage[4].y).toBeCloseTo(ay - 0.2, 9);
  });

  it('a rectangle cannot be dragged below the panel floor', () => {
    const app = makeApp();
    const m = app.stage[6];
    const grab = app.sx(m.x, m.y);
    app.controller.pointerDown(grab.x, grab.y);
    const to = app.sx(m.x, -5);
    for (let i = 1; i <= 6; i += 1) {
      app.controller.pointerMove(grab.x + ((to.x - grab.x) * i) / 6, grab.y + ((to.y - grab.y) * i) / 6);
      app.frame(1);
    }
    app.controller.pointerUp(to.x, to.y);
    expect(app.stage[6].y).toBeCloseTo(m.h / 2, 9); // bottom edge exactly on the floor
  });
});

describe('2D-2 interaction — the soft cap + deny ring', () => {
  it('the 13th plug on one rectangle is denied: no seat, deny ring set, ordinary release', () => {
    const app = makeApp();
    const m = app.stage[3];
    // Fill the module to the cap through the production seat op.
    for (let i = 0; i < 12; i += 1) {
      const id = app.controller.spawnCoilAt({ x: m.x, y: m.y + m.h / 2 + 0.03 });
      const pose = seatPose(m.x, m.y + m.h / 2, m);
      expect(app.controller.seatEndOn(id, RED, m.id, { x: pose.socketX, y: pose.socketY })).toBe(true);
      app.frame(1);
    }
    expect(app.controller.seatsOnRect(m.id)).toBe(12);
    // The 13th: hold a fresh cord's blue end over the module and release.
    const id = app.controller.spawnAt({ x: m.x - 1.0, y: m.y + 1.2 });
    app.frame(4);
    expect(app.world.lifecycle.stateOf(id)).toBe('carried');
    const end = app.end(id, RED);
    drag(app, app.sx(end.x, end.y), app.sx(m.x, m.y + m.h / 2 + 0.04), 8);
    const at = app.sx(m.x, m.y + m.h / 2 + 0.04);
    app.controller.pointerUp(at.x, at.y);
    // Denied: never seated, ring recorded, the jack never entered the machine.
    expect(app.controller.seatsOnRect(m.id)).toBe(12);
    expect(app.world.lifecycle.endMode(id, RED)).not.toBe('seated');
    expect(app.controller.deny).not.toBeNull();
    expect(app.controller.deny?.t).toBeGreaterThanOrEqual(0);
    // A second denial replaces the first (one ring at a time).
    app.frame(2);
    expect(app.controller.seatPoseOf(id, RED)).toBeNull();
  });

  it('the cap is per-rectangle: a neighboring module still accepts', () => {
    const app = makeApp();
    const m = app.stage[3];
    const n = app.stage[4];
    for (let i = 0; i < 12; i += 1) {
      const id = app.controller.spawnCoilAt({ x: m.x, y: m.y + m.h / 2 + 0.03 });
      const pose = seatPose(m.x, m.y + m.h / 2, m);
      app.controller.seatEndOn(id, RED, m.id, { x: pose.socketX, y: pose.socketY });
      app.frame(1);
    }
    const id = app.controller.spawnAt({ x: n.x - 1.0, y: n.y + 1.2 });
    app.frame(4);
    const end = app.end(id, RED);
    drag(app, app.sx(end.x, end.y), app.sx(n.x, n.y + n.h / 2 + 0.04), 8);
    const at = app.sx(n.x, n.y + n.h / 2 + 0.04);
    app.controller.pointerUp(at.x, at.y);
    app.frame(3);
    expect(app.controller.seatsOnRect(n.id)).toBe(1);
    expect(app.world.lifecycle.endMode(id, RED)).toBe('seated');
  });
});

describe('2D-2 interaction — the brush (T-INT-5 seam) + reduced motion', () => {
  it('a pointer move composes ONE brush per move; quiet frames compose none', () => {
    const app = makeApp();
    app.controller.pointerMove(700, 400);
    const a = app.controller.composeInput();
    expect(a.brush).not.toBeNull();
    expect(a.brush?.move).toBe(1);
    app.controller.pointerMove(701, 400);
    const b = app.controller.composeInput();
    expect(b.brush?.move).toBe(2);
    const c = app.controller.composeInput(); // no move since: no brush
    expect(c.brush).toBeNull();
    expect(c.pointerPoint).not.toBeNull();
  });

  it('the brush point is the pointer world point; reduced motion halves the strength', () => {
    const app = makeApp();
    app.controller.pointerMove(720, 380);
    const input = app.controller.composeInput();
    const w = app.view.toWorld(720, 380, { x: 0, y: 0 });
    expect(input.brush?.point.x).toBeCloseTo(w.x, 12);
    expect(input.brush?.point.y).toBeCloseTo(w.y, 12);
    expect(input.brush?.strengthScale).toBe(1);
    // The A11Y-1 seam is INPUT (never config): a reduced-motion reader
    // composes strengthScale 0.5 on its move frames.
    const reduced = makeApp({ reduced: true });
    reduced.controller.pointerMove(720, 380);
    expect(reduced.controller.composeInput().brush?.strengthScale).toBe(0.5);
  });

  it('pointerLeave clears the pointer point (off-stage honesty)', () => {
    const app = makeApp();
    app.controller.pointerMove(700, 400);
    app.controller.pointerLeave();
    const input = app.controller.composeInput();
    expect(input.pointerPoint).toBeNull();
    expect(input.brush).toBeNull();
  });
});

describe('2D-2 interaction — the opening staging (v1 refine-3 translated)', () => {
  it('at load: one cord, red seated on module 08, awaiting-plug, no invisible anchor', () => {
    const app = makeApp({ opening: true });
    expect(app.state().cords).toHaveLength(1);
    expect(app.world.lifecycle.stateOf(1)).toBe('awaiting-plug');
    expect(app.world.lifecycle.endMode(1, RED)).toBe('seated');
    const pose = app.controller.seatPoseOf(1, RED);
    expect(pose?.ny).toBe(1); // perpendicular to the top edge
    const m = app.stage[7];
    expect(pose?.x).toBeLessThan(m.x + m.w / 2);
    expect(pose?.x).toBeGreaterThan(m.x - m.w / 2);
    // Settles and STAYS awaiting-plug (no idle decay on a seated cord).
    app.frame(1500); // 25 s
    expect(app.world.lifecycle.stateOf(1)).toBe('awaiting-plug');
    // The blue end is a real, grabbable cord end one grab from a link.
    expect(app.world.lifecycle.endMode(1, BLUE)).not.toBe('seated');
  });
});

describe('2D-2 interaction — spawn seams (N / HUD)', () => {
  it('spawnAt lands a carried coil held by its red end at the point', () => {
    const app = makeApp();
    app.controller.spawnAt({ x: -1.0, y: 1.8 });
    app.frame(3);
    expect(app.controller.heldEnd()).toEqual({ cordId: 1, index: RED });
    expect(app.world.lifecycle.stateOf(1)).toBe('carried');
    // The pin converges toward the spawn point (bounded pin speed).
    const end = app.end(1, RED);
    expect(Math.hypot(end.x + 1.0, end.y - 1.8)).toBeLessThan(0.2);
  });

  it('ids are unique across the session; the world cap ignores spawn 17', () => {
    const app = makeApp();
    const ids: number[] = [];
    for (let i = 0; i < 18; i += 1) {
      ids.push(app.controller.spawnCoilAt({ x: -1.5 + i * 0.15, y: 2.6 }));
      app.frame(1);
    }
    expect(new Set(ids).size).toBe(18);
    expect(app.state().cords.length).toBeLessThanOrEqual(16);
  });
});

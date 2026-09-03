/**
 * Composition root — MINIMAL 2D-1 SHELL (town-hall Revision 2: the 3D
 * build was replaced by the 2D pivot; this is the interim headless host).
 *
 * The sim core (src/sim/) is now fully 2D (vec2, Canvas-ready) and this
 * shell keeps the app BUILDABLE and the sim ALIVE between 2D-1 (this port)
 * and 2D-2 (the Canvas world + interaction rewrite that lands next):
 *
 *   src/sim/   pure TS core → SimState   (stepped HERE, per frame)
 *   <canvas>   a stub element — NO rendering yet (2D-2 draws the panel
 *              world: candy-zoned rectangles, stroked cords, 1/4" jacks)
 *
 * What runs today: the production-shaped world (24-segment cords, floor
 * clamp y ≥ 0, over-stretch auto-unplug, the vanish choreography, the
 * passive cursor-brush, the ~3s grace / ~10s idle windows) stepped through
 * the fixed-timestep driver (ARC-3: 120 Hz slices, ≤5 substeps per frame,
 * backgrounded-tab spikes clamped by discarding backlog) on the browser's
 * animation loop. One read seam for smoke checks: window.cords.lifecycle().
 *
 * 2D-2 replaces this file's loop with the real Canvas 2D composition
 * (render layer + jack/rectangle/cord-body picking + HUD rewiring); the
 * world construction below is the seam it grows from.
 */
import {
  DEFAULT_GRACE_SECONDS,
  DEFAULT_IDLE_SECONDS,
  DEFAULT_OVERSTRETCH_THRESHOLD,
  createCordWorldStep,
  createFixedTimestepDriver,
} from './sim';
import type { SimInput, SimState } from './sim';

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

// The world's cords: every spawn shares the same segment geometry.
const CORD_SEGMENTS = 24;
const FLOOR_Y = 0;
const MAX_CORDS = 16;

// T-INT-5 — the passive cursor-brush feel-tunables (the brush.ts defaults).
const BRUSH = { radiusRestLengths: 1.5, strength: 1.0 } as const;

// The stub stage: a real canvas element in the DOM, never drawn to (2D-2
// becomes the painter). It exists so the page's structure is already the
// final one — a labeled canvas inside the #app mount.
const canvas = document.createElement('canvas');
canvas.id = 'stage';
canvas.setAttribute('role', 'img');
canvas.setAttribute(
  'aria-label',
  'Cords — a 2D cable patch panel sandbox. Rendering arrives with the next build; ' +
    'the physics is already running.',
);
app.appendChild(canvas);

// The production-shaped world (2D-2's seam): identical config discipline to
// the v1 composition — over-stretch ON, vanish choreography ON, brush ON,
// grace ~3s, idle-abandon ~10s. Lifecycle rejections surface as console
// warnings (a strict world would throw — tests construct that world).
const world = createCordWorldStep({
  cord: { segmentCount: CORD_SEGMENTS, floorY: FLOOR_Y },
  maxCords: MAX_CORDS,
  overStretch: { threshold: DEFAULT_OVERSTRETCH_THRESHOLD },
  vanish: {}, // choreography ON with default timings (fall → shatter → pull → despawn)
  brush: BRUSH,
  lifecycle: {
    idleSeconds: DEFAULT_IDLE_SECONDS,
    onRejected: (rejection) => {
      console.warn(
        `cords: lifecycle rejected ${rejection.action} on cord ${rejection.cordId} (${rejection.from}): ${rejection.detail}`,
      );
    },
  },
});
void DEFAULT_GRACE_SECONDS; // (documented alongside the config; the machine defaults it)

const driver = createFixedTimestepDriver(world, {
  timestep: SIM_TIMESTEP,
  maxSubsteps: MAX_SUBSTEPS_PER_FRAME,
});

let simState: SimState = { time: 0, cords: [] };
const emptyInput: SimInput = { pointerPoint: null };

// The frame loop: real frame deltas in, fixed sim slices out. No rendering —
// the sim state advances for its own sake until 2D-2 paints it.
const tick = (now: number): void => {
  const dt = tick.prev === 0 ? 1 / 60 : (now - tick.prev) / 1000;
  tick.prev = now;
  simState = driver.advance(simState, dt, emptyInput).state;
  requestAnimationFrame(tick);
};
tick.prev = 0;
requestAnimationFrame(tick);

// Read-only smoke seam (the shape 2D-2's full composition exposes grows from).
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
    };
  }
}
window.cords = {
  lifecycle: () =>
    simState.cords.map((cord) => ({
      id: cord.id,
      state: world.lifecycle.stateOf(cord.id) ?? 'gone',
      grace: world.lifecycle.graceRemaining(cord.id),
      idle: world.lifecycle.idleRemaining(cord.id),
      vanish: world.lifecycle.vanishInfo(cord.id),
    })),
};

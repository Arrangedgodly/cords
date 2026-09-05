/**
 * 2D-2 — the world↔screen projection (pure math, no canvas). ONE law shared
 * by the renderer and the interaction layer, so a pixel picked is always the
 * pixel painted: world x right / y UP, the panel floor (y = 0) anchored a
 * fixed margin above the HUD faceplate, scale fitted to the wider axis of
 * the stage (the v1 letterbox resize discipline, translated).
 *
 * 2D-8 — the SAME contain law is the mobile fit: `scale = min(width / 9.2,
 * floorScreenY / 4.4)` keeps the whole authored stage visible on ANY aspect
 * (a 390-px portrait letterboxes vertically into the fog's void; an 844-px
 * phone-landscape letterboxes horizontally into the bench's side bands —
 * the panel grammar owns both margins, no module ever crops, the bench
 * floor stays the floor). The floor margin is now a PARAMETER: the desktop
 * default (72 px) reserves the one-row faceplate strip, and the composition
 * passes the live HUD height when the faceplate wraps taller on narrow
 * screens — the floor line always sits above the buttons.
 *
 * The view is resize-safe by reconstruction: `createView` is cheap and pure;
 * the composition rebuilds it on resize (and orientation change) and
 * everything downstream (background cache, picking, drawing) reads the same
 * numbers.
 */
import type { Vec2 } from '../sim';

/** The world width the stage must always show (modules + drag headroom). */
export const VIEW_WORLD_WIDTH = 9.2;
/** The world height the stage must always show above the floor line. */
export const VIEW_WORLD_HEIGHT = 4.4;
/** Screen pixels between the floor line (y = 0) and the canvas bottom. */
export const FLOOR_MARGIN_PX = 72;

export interface View {
  /** Canvas CSS width/height in px. */
  readonly width: number;
  readonly height: number;
  /** Device scale (world units → CSS px). */
  readonly scale: number;
  /** Screen y of world y = 0 (the floor line). */
  readonly floorScreenY: number;
  /** World half-width reachable at this size (the drag clamp's x bound). */
  readonly maxX: number;
  /** World top reachable at this size (the drag clamp's y bound). */
  readonly maxY: number;
  /** world → screen, into `out` (reused — no allocation). */
  toScreen(x: number, y: number, out: Vec2): Vec2;
  /** screen → world, into `out` (reused — no allocation). */
  toWorld(px: number, py: number, out: Vec2): Vec2;
}

export function createView(
  width: number,
  height: number,
  floorMarginPx: number = FLOOR_MARGIN_PX,
): View {
  const w = Number.isFinite(width) && width > 0 ? width : 1;
  const h = Number.isFinite(height) && height > 0 ? height : 1;
  const margin =
    Number.isFinite(floorMarginPx) && floorMarginPx >= 0 ? floorMarginPx : FLOOR_MARGIN_PX;
  const floorScreenY = Math.max(1, h - margin);
  const scale = Math.min(w / VIEW_WORLD_WIDTH, floorScreenY / VIEW_WORLD_HEIGHT);
  return {
    width: w,
    height: h,
    scale,
    floorScreenY,
    maxX: w / 2 / scale,
    maxY: floorScreenY / scale,
    toScreen(x, y, out) {
      out.x = w / 2 + x * scale;
      out.y = floorScreenY - y * scale;
      return out;
    },
    toWorld(px, py, out) {
      out.x = (px - w / 2) / scale;
      out.y = (floorScreenY - py) / scale;
      return out;
    },
  };
}

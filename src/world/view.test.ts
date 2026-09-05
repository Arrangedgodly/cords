/**
 * 2D-8 — THE RESPONSIVE VIEW LAW (portrait/landscape/orientation swap).
 * `createView` is the contain fit: the whole 9.2 × 4.4 world must be
 * visible on ANY viewport — a phone portrait letterboxes into the fog's
 * vertical void, a phone landscape into the bench's horizontal side bands —
 * with the floor line anchored above the (possibly wrapped) faceplate's
 * live height. These tests pin the arithmetic, the contain invariants, the
 * round-trip, and the orientation swap, at real device metrics and absurd
 * extremes.
 */
import { describe, expect, it } from 'vitest';
import { FLOOR_MARGIN_PX, VIEW_WORLD_HEIGHT, VIEW_WORLD_WIDTH, createView } from './view';

/** iPhone-class portrait (390 × 844 CSS px, a wrapped ~136-px faceplate). */
const PORTRAIT = { width: 390, height: 844, margin: 136 };
/** Pixel-class landscape (844 × 390 CSS px, a wrapped ~111-px faceplate). */
const LANDSCAPE = { width: 844, height: 390, margin: 111 };
/** The desktop drive default (one-row strip under the 72-px margin). */
const DESKTOP = { width: 1600, height: 1000, margin: 72 };

describe('2D-8 view fit — the contain law on real device metrics', () => {
  it('portrait: the width binds — the whole 9.2-unit stage spans the phone width', () => {
    const v = createView(PORTRAIT.width, PORTRAIT.height, PORTRAIT.margin);
    const expectedScale = Math.min(
      PORTRAIT.width / VIEW_WORLD_WIDTH,
      (PORTRAIT.height - PORTRAIT.margin) / VIEW_WORLD_HEIGHT,
    );
    expect(v.scale).toBeCloseTo(PORTRAIT.width / VIEW_WORLD_WIDTH, 12);
    expect(v.scale).toBeCloseTo(expectedScale, 12);
    // Contain: the full world fits inside the viewport, neither axis cropped.
    expect(VIEW_WORLD_WIDTH * v.scale).toBeLessThanOrEqual(PORTRAIT.width + 1e-9);
    expect(VIEW_WORLD_HEIGHT * v.scale).toBeLessThanOrEqual(
      PORTRAIT.height - PORTRAIT.margin + 1e-9,
    );
    // The vertical letterbox is honest margin, not stretch: the world's top
    // sits far below the screen top (the fog's void owns it).
    const voidPx = v.floorScreenY - VIEW_WORLD_HEIGHT * v.scale;
    expect(voidPx).toBeGreaterThan(500);
    // The bench floor stays the floor: exactly the margin above the bottom.
    expect(v.floorScreenY).toBe(PORTRAIT.height - PORTRAIT.margin);
  });

  it('landscape: the height binds — horizontal side bands, floor above the strip', () => {
    const v = createView(LANDSCAPE.width, LANDSCAPE.height, LANDSCAPE.margin);
    expect(v.scale).toBeCloseTo(
      (LANDSCAPE.height - LANDSCAPE.margin) / VIEW_WORLD_HEIGHT,
      12,
    );
    expect(VIEW_WORLD_WIDTH * v.scale).toBeLessThanOrEqual(LANDSCAPE.width + 1e-9);
    expect(VIEW_WORLD_HEIGHT * v.scale).toBeLessThanOrEqual(
      LANDSCAPE.height - LANDSCAPE.margin + 1e-9,
    );
    // The side bands are reachable bench (the drag clamp extends past the
    // authored 4.6 half-width) — letterboxed, never cropped.
    expect(v.maxX).toBeGreaterThan(VIEW_WORLD_WIDTH / 2);
    expect(v.floorScreenY).toBe(LANDSCAPE.height - LANDSCAPE.margin);
  });

  it('desktop: the pre-2D-8 numbers stand byte-identical (default margin 72)', () => {
    const v = createView(DESKTOP.width, DESKTOP.height);
    const explicit = createView(DESKTOP.width, DESKTOP.height, FLOOR_MARGIN_PX);
    expect(v.scale).toBe(explicit.scale);
    expect(v.floorScreenY).toBe(DESKTOP.height - FLOOR_MARGIN_PX);
    expect(v.scale).toBeCloseTo(DESKTOP.width / VIEW_WORLD_WIDTH, 12); // width binds here too
    expect(v.maxX).toBeCloseTo(VIEW_WORLD_WIDTH / 2, 12);
  });

  it('every margin is honest: a taller faceplate lifts the floor line and shrinks the world', () => {
    const thin = createView(PORTRAIT.width, PORTRAIT.height, 72);
    const wrapped = createView(PORTRAIT.width, PORTRAIT.height, 136);
    expect(wrapped.floorScreenY).toBe(thin.floorScreenY - 64);
    // Portrait is width-bound, so the scale survives the taller strip —
    // the honest consequence: no change where none is needed.
    expect(wrapped.scale).toBe(thin.scale);
    const landscapeThin = createView(LANDSCAPE.width, LANDSCAPE.height, 72);
    const landscapeWrapped = createView(LANDSCAPE.width, LANDSCAPE.height, 136);
    // Landscape is height-bound: the wrapped strip honestly shrinks it.
    expect(landscapeWrapped.scale).toBeLessThan(landscapeThin.scale);
    expect(landscapeWrapped.scale).toBeCloseTo(
      (LANDSCAPE.height - 136) / VIEW_WORLD_HEIGHT,
      12,
    );
  });

  it('the orientation swap re-fits (rotate the same phone 90°)', () => {
    const portrait = createView(PORTRAIT.width, PORTRAIT.height, PORTRAIT.margin);
    const rotated = createView(PORTRAIT.height, PORTRAIT.width, LANDSCAPE.margin);
    // Portrait bound on width; rotated binds on height — different laws,
    // same contain: both show the whole stage.
    expect(portrait.scale).toBeCloseTo(390 / VIEW_WORLD_WIDTH, 12);
    expect(rotated.scale).toBeCloseTo((390 - LANDSCAPE.margin) / VIEW_WORLD_HEIGHT, 12);
    for (const v of [portrait, rotated]) {
      expect(VIEW_WORLD_WIDTH * v.scale).toBeLessThanOrEqual(v.width + 1e-9);
      expect(VIEW_WORLD_HEIGHT * v.scale).toBeLessThanOrEqual(v.floorScreenY + 1e-9);
    }
    // A module at the far stage edge stays on-screen through the swap.
    for (const v of [portrait, rotated]) {
      const edge = v.toScreen(-VIEW_WORLD_WIDTH / 2 + 0.33, 0.25, { x: 0, y: 0 });
      expect(edge.x).toBeGreaterThanOrEqual(0);
      expect(edge.x).toBeLessThanOrEqual(v.width);
      expect(edge.y).toBeLessThanOrEqual(v.floorScreenY);
    }
  });

  it('extreme aspects stay contained and finite', () => {
    // A 240 × 320 kiosk-tier portrait.
    const slim = createView(240, 320, 100);
    expect(slim.scale).toBeCloseTo(240 / VIEW_WORLD_WIDTH, 12);
    // A 1920 × 40 ultrawide letterbox bar.
    const bar = createView(1920, 40, 20);
    expect(bar.scale).toBeCloseTo(20 / VIEW_WORLD_HEIGHT, 12);
    expect(bar.floorScreenY).toBe(20);
    expect(VIEW_WORLD_WIDTH * bar.scale).toBeLessThanOrEqual(1920);
    // Degenerate sizes degrade to the safe 1×1 floor, never NaN.
    const zero = createView(0, 0, 0);
    expect(Number.isFinite(zero.scale)).toBe(true);
    expect(Number.isFinite(zero.maxX)).toBe(true);
    const nan = createView(Number.NaN, Number.POSITIVE_INFINITY, -5);
    expect(Number.isFinite(nan.scale)).toBe(true);
    expect(nan.floorScreenY).toBeGreaterThan(0);
    // A garbage margin falls back to the default, never above the canvas.
    const badMargin = createView(800, 600, Number.NaN);
    expect(badMargin.floorScreenY).toBe(600 - FLOOR_MARGIN_PX);
    const hugeMargin = createView(400, 300, 5000); // taller than the screen
    expect(hugeMargin.floorScreenY).toBe(1); // clamped: the floor keeps 1 px of stage
    expect(Number.isFinite(hugeMargin.scale)).toBe(true);
  });

  it('toScreen/toWorld round-trip bit-honestly at phone scale', () => {
    const v = createView(PORTRAIT.width, PORTRAIT.height, PORTRAIT.margin);
    for (const [x, y] of [
      [0, 0],
      [-4.6, 0.05],
      [4.6, 4.35],
      [1.32, 2.04], // module 06's home
    ] as const) {
      const s = v.toScreen(x, y, { x: 0, y: 0 });
      const w = v.toWorld(s.x, s.y, { x: 0, y: 0 });
      expect(w.x).toBeCloseTo(x, 9);
      expect(w.y).toBeCloseTo(y, 9);
    }
    // The world center is the screen's horizontal center (the letterbox is
    // symmetric); y grows UP in world and DOWN in screen.
    const origin = v.toScreen(0, 0, { x: 0, y: 0 });
    expect(origin.x).toBeCloseTo(PORTRAIT.width / 2, 9);
    const above = v.toScreen(0, 1, { x: 0, y: 0 });
    expect(above.y).toBe(origin.y - v.scale);
  });

  it('maxY reads the floor-bounded sky (the drag clamp bounds)', () => {
    const v = createView(PORTRAIT.width, PORTRAIT.height, PORTRAIT.margin);
    expect(v.maxY).toBeCloseTo(v.floorScreenY / v.scale, 12);
    expect(v.maxX).toBeCloseTo(v.width / 2 / v.scale, 12);
  });
});

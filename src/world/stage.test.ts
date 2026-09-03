/**
 * 2D-2 — the STAGE CONTRACT's laws (Doctor Strange: deterministic seating).
 * Pure geometry, exact expectations: edge selection by max normal component,
 * the stable TOP > RIGHT > BOTTOM > LEFT tie-break (v1's INT-2 corner law),
 * insertion depth inside the perimeter, edge-region containment, drag clamp.
 */
import { describe, expect, it } from 'vitest';
import {
  EDGE_BOTTOM,
  EDGE_LEFT,
  EDGE_RIGHT,
  EDGE_TOP,
  SEAT_DEPTH,
  createStage,
  distToRectPerimeter2,
  nearestEdge,
  pointInRect,
  rectAt,
  seatPose,
  clampRectCenter,
} from './stage';
import { createView } from './view';

const R = { id: 0, x: 0, y: 0, w: 2, h: 1, zone: '#000000', label: '00', homeX: 0, homeY: 0 };
/** A SQUARE rect — the only shape whose corners are exact normal ties. */
const S = { ...R, w: 2, h: 2 };

describe('2D-2 stage — the authored layout', () => {
  it('eight candy modules over the span, ids 0..7, homes recorded', () => {
    const stage = createStage();
    expect(stage).toHaveLength(8);
    stage.forEach((r, i) => {
      expect(r.id).toBe(i);
      expect(r.label).toBe(String(i + 1).padStart(2, '0'));
      expect(r.homeX).toBe(r.x);
      expect(r.homeY).toBe(r.y);
    });
    // The zone roster is DESIGN.md's candy order (red → bone).
    expect(stage.map((r) => r.zone)).toEqual([
      '#e8433f', '#f2903a', '#f2d43a', '#2fbd72', '#3ec8d8', '#4a7df2', '#d857c8', '#e8e3d5',
    ]);
    // Every module sits fully above the floor line.
    for (const r of stage) expect(r.y - r.h / 2).toBeGreaterThanOrEqual(0);
    // Neighboring tops stay within one cord's reach (2.4 × 1.04 = 2.496)…
    let near = 0;
    for (const a of stage) {
      for (const b of stage) {
        const d = Math.hypot(a.x - b.x, a.y + a.h / 2 - (b.y + b.h / 2));
        if (d > 0 && d < 2.496) near += 1;
      }
    }
    expect(near).toBeGreaterThan(0);
    // …while the farthest pair cannot link (the reach profile).
    let far = 0;
    for (const a of stage) {
      for (const b of stage) {
        const d = Math.hypot(a.x - b.x, a.y + a.h / 2 - (b.y + b.h / 2));
        if (d > far) far = d;
      }
    }
    expect(far).toBeGreaterThan(2.5);
  });
});

describe('2D-2 stage — point-in-rect + topmost pick', () => {
  it('containment honors the margin and is total over garbage', () => {
    expect(pointInRect(0, 0, R)).toBe(true);
    expect(pointInRect(1.0, 0.5, R)).toBe(true); // the corner itself
    expect(pointInRect(1.001, 0, R)).toBe(false);
    expect(pointInRect(1.05, 0, R, 0.1)).toBe(true); // the edge-region halo
    expect(pointInRect(Number.NaN, 0, R)).toBe(false);
    expect(pointInRect(0, Number.POSITIVE_INFINITY, R)).toBe(false);
  });

  it('rectAt returns the LAST containing rect (topmost drawn) or −1', () => {
    const over = createStage();
    const bottom = { ...over[0], id: 99, x: over[0].x, y: over[0].y };
    over.push(bottom);
    expect(rectAt(bottom.x, bottom.y, over)).toBe(99);
    expect(rectAt(9999, 9999, over)).toBe(-1);
  });
});

describe('2D-2 stage — nearest edge by MAX NORMAL COMPONENT (INT-2 translated)', () => {
  it('a point above picks TOP, below BOTTOM, right RIGHT, left LEFT', () => {
    expect(nearestEdge(0, 10, R)).toBe(EDGE_TOP);
    expect(nearestEdge(0, -10, R)).toBe(EDGE_BOTTOM);
    expect(nearestEdge(10, 0, R)).toBe(EDGE_RIGHT);
    expect(nearestEdge(-10, 0, R)).toBe(EDGE_LEFT);
  });

  it('interior points pick the side they lean toward', () => {
    expect(nearestEdge(0, 0.3, R)).toBe(EDGE_TOP);
    expect(nearestEdge(0, -0.3, R)).toBe(EDGE_BOTTOM);
    expect(nearestEdge(0.9, 0, R)).toBe(EDGE_RIGHT);
    expect(nearestEdge(-0.9, 0, R)).toBe(EDGE_LEFT);
  });

  it('EXACT corner ties resolve by max normal component, then fixed order', () => {
    // A SQUARE's exact corners are true normal ties → fixed order
    // TOP > RIGHT > BOTTOM > LEFT.
    expect(nearestEdge(1, 1, S)).toBe(EDGE_TOP); // top-left diag: top first
    expect(nearestEdge(1, -1, S)).toBe(EDGE_RIGHT); // right/bottom tie → right
    expect(nearestEdge(-1, -1, S)).toBe(EDGE_BOTTOM); // bottom/left tie → bottom
    expect(nearestEdge(-1, 1, S)).toBe(EDGE_TOP);
    // The center: every distance ties and every dot is 0 → the first edge.
    expect(nearestEdge(0, 0, S)).toBe(EDGE_TOP);
    // A WIDE rect's exact corner: the axis with the larger offset wins (the
    // max-normal rule — the corner resolution v1 used for its face blend).
    expect(nearestEdge(1, 0.5, R)).toBe(EDGE_RIGHT); // right dot 1.0 > top dot 0.5
    expect(nearestEdge(-1, 0.5, R)).toBe(EDGE_LEFT); // left dot 1.0 > top dot 0.5
  });

  it('the corner REGION (both edges clamp to the corner) resolves by max normal', () => {
    // Beyond the square's top-right corner: both segments' closest point IS
    // the corner (exact distance tie) — the larger offset axis wins.
    expect(nearestEdge(2, 1.9, S)).toBe(EDGE_RIGHT);
    expect(nearestEdge(1.9, 2, S)).toBe(EDGE_TOP);
    expect(nearestEdge(2, 2, S)).toBe(EDGE_TOP); // the exact diagonal → order
  });

  it('an interior point takes the CLOSEST edge (distance, not lean)', () => {
    expect(nearestEdge(0.4, 0.2, R)).toBe(EDGE_TOP); // 0.3 to top, 0.6 to right
    expect(nearestEdge(0.8, 0.4, R)).toBe(EDGE_TOP); // 0.1 top vs 0.2 right
    expect(nearestEdge(0.9, 0, R)).toBe(EDGE_RIGHT);
  });

  it('total over garbage: non-finite reads as the center (top)', () => {
    expect(nearestEdge(Number.NaN, Number.NaN, R)).toBe(EDGE_TOP);
  });
});

describe('2D-2 stage — the seat pose (perpendicular + insertion depth)', () => {
  it('a top-edge release seats perpendicular, tip SEAT_DEPTH inside the edge', () => {
    const pose = seatPose(0.3, 0.6, R); // above the rect, over its top edge
    expect(pose.edge).toBe(EDGE_TOP);
    expect(pose.nx).toBe(0);
    expect(pose.ny).toBe(1);
    expect(pose.socketX).toBe(0.3);
    expect(pose.socketY).toBe(0.5);
    expect(pose.x).toBeCloseTo(0.3, 12);
    expect(pose.y).toBeCloseTo(0.5 - SEAT_DEPTH, 12);
  });

  it('an interior release projects onto the chosen edge (the closest point on it)', () => {
    const pose = seatPose(0.4, 0.2, R); // inside, leaning top
    expect(pose.edge).toBe(EDGE_TOP);
    expect(pose.socketX).toBe(0.4);
    expect(pose.socketY).toBe(0.5);
    // A left-close interior point seats on the left edge, projected onto it.
    const left = seatPose(-0.98, 0.1, R);
    expect(left.edge).toBe(EDGE_LEFT);
    expect(left.socketX).toBe(-1);
    expect(left.socketY).toBeCloseTo(0.1, 12);
    expect(left.nx).toBe(-1);
    expect(left.ny).toBe(0);
  });

  it('an outside-corner release clamps onto the chosen edge (deterministic corner)', () => {
    // Beyond the top-right corner, more-right-than-top: the RIGHT edge, the
    // projection clamped to the corner.
    const pose = seatPose(1.4, 0.55, R);
    expect(pose.edge).toBe(EDGE_RIGHT);
    expect(pose.socketX).toBe(1);
    expect(pose.socketY).toBeCloseTo(0.5, 12);
    expect(pose.x).toBeCloseTo(1 - SEAT_DEPTH, 12);
    expect(pose.y).toBeCloseTo(0.5, 12);
  });

  it("SEAT_DEPTH is v1's 0.082 (the harness composition agreement)", () => {
    expect(SEAT_DEPTH).toBe(0.082);
  });
});

describe('2D-2 stage — perimeter distance + drag clamp', () => {
  it('distToRectPerimeter2 is 0 inside and exact outside', () => {
    expect(distToRectPerimeter2(0, 0, R)).toBe(0);
    expect(distToRectPerimeter2(1.5, 0, R)).toBeCloseTo(0.25, 12);
    expect(distToRectPerimeter2(0, 0.8, R)).toBeCloseTo(0.09, 12);
  });

  it('clampRectCenter keeps the module above the floor and inside the view', () => {
    const stage = createStage();
    const r = stage[0];
    const view = createView(1440, 838);
    r.x = 999;
    r.y = -5;
    clampRectCenter(r, view.maxX, view.maxY);
    expect(r.x).toBeCloseTo(view.maxX - r.w / 2, 12);
    expect(r.y).toBeCloseTo(r.h / 2, 12); // bottom edge exactly on the floor
    r.y = 999;
    clampRectCenter(r, view.maxX, view.maxY);
    expect(r.y).toBe(view.maxY);
  });
});

describe('2D-2 view — the shared projection', () => {
  it('round-trips world ↔ screen exactly and anchors the floor line', () => {
    const view = createView(1440, 838);
    const p = { x: 0, y: 0 };
    view.toScreen(1.234, 2.5, p);
    expect(p.y).toBe(view.floorScreenY - 2.5 * view.scale);
    const w = { x: 0, y: 0 };
    view.toWorld(p.x, p.y, w);
    expect(w.x).toBeCloseTo(1.234, 9);
    expect(w.y).toBeCloseTo(2.5, 9);
    // World y = 0 IS the floor line, and y grows UP the screen.
    view.toScreen(0, 0, p);
    expect(p.y).toBe(view.floorScreenY);
    view.toScreen(0, 1, p);
    expect(p.y).toBeLessThan(view.floorScreenY);
  });

  it('the stage width always fits: module 08 plus half-width stays on-canvas', () => {
    const view = createView(1440, 838);
    const stage = createStage();
    const last = stage[7];
    expect(last.x + last.w).toBeLessThan(view.maxX);
  });
});

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
  HANDLE_RADIUS,
  MODULE_CAP,
  MODULE_MAX_EDGE,
  MODULE_MIN_EDGE,
  MODULE_ZONES,
  SEAT_DEPTH,
  applyRectResize,
  createStage,
  distToRectPerimeter2,
  edgeFraction,
  moduleLabel,
  nearestEdge,
  oppositeCorner,
  pointInRect,
  rectAt,
  rectCornerInto,
  seatPose,
  seatPoseFromFraction,
  spawnModuleInto,
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

describe('2D-6 stage — moduleLabel (the silkscreen sequence)', () => {
  it('zero-pads through 99, then continues numerically — never rolls over', () => {
    expect(moduleLabel(1)).toBe('01');
    expect(moduleLabel(9)).toBe('09');
    expect(moduleLabel(10)).toBe('10');
    expect(moduleLabel(99)).toBe('99');
    expect(moduleLabel(100)).toBe('100');
    expect(moduleLabel(101)).toBe('101');
    expect(moduleLabel(0)).toBe('00'); // garbage: total, never throws
    expect(moduleLabel(Number.NaN)).toBe('00');
  });
});

describe('2D-6 stage — spawnModuleInto (deterministic placement)', () => {
  const view = createView(1440, 838);

  it('continues the id/label/palette sequence with authored extents', () => {
    const stage = createStage();
    const a = spawnModuleInto(stage, { x: 0, y: 0.5 }, view.maxX, view.maxY);
    const b = spawnModuleInto(stage, { x: 0, y: 0.5 }, view.maxX, view.maxY);
    const c = spawnModuleInto(stage, { x: 0, y: 0.5 }, view.maxX, view.maxY);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(c).not.toBeNull();
    expect(stage).toHaveLength(11);
    expect([a!.id, b!.id, c!.id]).toEqual([8, 9, 10]);
    expect([a!.label, b!.label, c!.label]).toEqual(['09', '10', '11']);
    // The palette CYCLES the candy-zone roster from the top.
    expect([a!.zone, b!.zone, c!.zone]).toEqual([
      MODULE_ZONES[0], MODULE_ZONES[1], MODULE_ZONES[2],
    ]);
    for (const r of [a!, b!, c!]) {
      expect(r.w).toBe(0.66);
      expect(r.h).toBe(0.5);
      expect(r.y - r.h / 2).toBeGreaterThanOrEqual(0); // above the floor
    }
  });

  it('an honest overlap-avoidance attempt: a spawn inside an occupied spot lands clear', () => {
    const stage = createStage();
    const occupied = stage[3];
    const spawned = spawnModuleInto(
      stage,
      { x: occupied.x, y: occupied.y },
      view.maxX,
      view.maxY,
    );
    expect(spawned).not.toBeNull();
    const GAP = 0.001; // the ring clears by SPAWN_GAP; assert real clearance
    for (const r of stage.slice(0, 8)) {
      const dx = Math.abs(spawned!.x - r.x);
      const dy = Math.abs(spawned!.y - r.y);
      const needX = (spawned!.w + r.w) / 2;
      const needY = (spawned!.h + r.h) / 2;
      const overlaps = dx < needX + GAP && dy < needY + GAP;
      expect(overlaps).toBe(false);
    }
  });

  it('deterministic: identical inputs on fresh stages place bitwise-identically', () => {
    const run = () => {
      const stage = createStage();
      const spots = [
        { x: stage[2].x, y: stage[2].y },
        { x: 0, y: 0.5 },
        null,
        { x: 2.5, y: 0.6 },
      ];
      return spots.map((at) => spawnModuleInto(stage, at, view.maxX, view.maxY))
        .map((r) => (r === null ? 'null' : `${r.x},${r.y},${r.label}`));
    };
    expect(run()).toEqual(run());
  });

  it('no cursor: a free spot near stage center, above the floor, inside the view', () => {
    const stage = createStage();
    const spawned = spawnModuleInto(stage, null, view.maxX, view.maxY);
    expect(spawned).not.toBeNull();
    expect(Math.abs(spawned!.x)).toBeLessThan(2.6); // near the stage's center span
    expect(spawned!.y - spawned!.h / 2).toBeGreaterThanOrEqual(0);
    expect(Math.abs(spawned!.x) + spawned!.w / 2).toBeLessThanOrEqual(view.maxX + 1e-9);
    // Clear of the authored eight (the ring search earned it).
    for (const r of stage.slice(0, 8)) {
      const overlaps =
        Math.abs(spawned!.x - r.x) < (spawned!.w + r.w) / 2 + 0.001 &&
        Math.abs(spawned!.y - r.y) < (spawned!.h + r.h) / 2 + 0.001;
      expect(overlaps).toBe(false);
    }
  });

  it('clamped like a drag: garbage-extreme spawn points land inside the view, above the floor', () => {
    const stage = createStage();
    const spawned = spawnModuleInto(stage, { x: 999, y: -5 }, view.maxX, view.maxY);
    expect(spawned).not.toBeNull();
    expect(spawned!.x).toBeLessThanOrEqual(view.maxX - spawned!.w / 2 + 1e-9);
    expect(spawned!.y).toBeCloseTo(spawned!.h / 2, 12); // bottom edge on the floor
  });

  it('the soft cap: exactly 32 modules, the 33rd spawn is an honest no-op', () => {
    const stage = createStage();
    let last: ReturnType<typeof spawnModuleInto> = null;
    for (let i = 0; i < MODULE_CAP - 8; i += 1) {
      last = spawnModuleInto(stage, { x: 0, y: 0.5 }, view.maxX, view.maxY);
      expect(last).not.toBeNull();
    }
    expect(stage).toHaveLength(MODULE_CAP);
    expect(last!.label).toBe(moduleLabel(MODULE_CAP));
    expect(spawnModuleInto(stage, { x: 0, y: 0.5 }, view.maxX, view.maxY)).toBeNull();
    expect(stage).toHaveLength(MODULE_CAP); // untouched — the no-op changed nothing
  });
});

describe('2D-6 stage — the resize law (bounded, opposite-corner anchored)', () => {
  const view = createView(1440, 838);
  /** A rect on open bench, with the corner/anchor conveniences. */
  const bench = (w = 0.66, h = 0.5, x = 0, y = 1.0) =>
    ({ id: 0, x, y, w, h, zone: '#000000', label: '00', homeX: x, homeY: y });

  it('grows to the pointer, anchored bitwise at the opposite corner', () => {
    const r = bench();
    // Grab the BOTTOM-RIGHT corner: anchor = top-left.
    const anchor = rectCornerInto(r, oppositeCorner(2), { x: 0, y: 0 });
    expect(anchor.x).toBeCloseTo(r.x - r.w / 2, 12);
    expect(anchor.y).toBeCloseTo(r.y + r.h / 2, 12);
    applyRectResize(r, { anchorX: anchor.x, anchorY: anchor.y, signX: 1, signY: -1 },
      anchor.x + 1.0, anchor.y - 0.9, view.maxX, view.maxY);
    expect(r.w).toBeCloseTo(1.0, 12);
    expect(r.h).toBeCloseTo(0.9, 12);
    // The anchor stays a bitwise corner (the standard resize feel).
    expect(r.x - r.w / 2).toBe(anchor.x);
    expect(r.y + r.h / 2).toBe(anchor.y);
  });

  it('bounds: min 0.35 / max 1.6 per edge, on both axes independently', () => {
    const r = bench();
    const anchor = { x: r.x - r.w / 2, y: r.y + r.h / 2 };
    // Pointer AT the anchor: both axes clamp to the minimum.
    applyRectResize(r, { anchorX: anchor.x, anchorY: anchor.y, signX: 1, signY: -1 }, anchor.x, anchor.y, view.maxX, view.maxY);
    expect(r.w).toBe(MODULE_MIN_EDGE);
    expect(r.h).toBe(MODULE_MIN_EDGE);
    // A huge drag clamps to the maximum (width; height stays min).
    applyRectResize(r, { anchorX: anchor.x, anchorY: anchor.y, signX: 1, signY: -1 }, anchor.x + 99, anchor.y - 0.1, view.maxX, view.maxY);
    expect(r.w).toBe(MODULE_MAX_EDGE);
    expect(r.h).toBe(MODULE_MIN_EDGE);
  });

  it('crossing OVER the anchor clamps to the minimum — the corner never inverts', () => {
    const r = bench();
    const anchor = { x: r.x - r.w / 2, y: r.y + r.h / 2 };
    // A slight cross past the anchor: both extents clamp to the minimum…
    applyRectResize(r, { anchorX: anchor.x, anchorY: anchor.y, signX: 1, signY: -1 },
      anchor.x - 0.05, anchor.y + 0.05, view.maxX, view.maxY);
    expect(r.w).toBe(MODULE_MIN_EDGE);
    expect(r.h).toBe(MODULE_MIN_EDGE);
    // …still on the SAME side of the anchor (the signs froze at the grab).
    expect(r.x).toBeCloseTo(anchor.x + MODULE_MIN_EDGE / 2, 12);
    expect(r.y).toBeCloseTo(anchor.y - MODULE_MIN_EDGE / 2, 12);
    // Even a FAR crossing keeps the side — the extent grows, never flips.
    // (The tall result hits the floor law, which lifts the module — pinned
    // in its own test below; here the horizontal side is the point.)
    applyRectResize(r, { anchorX: anchor.x, anchorY: anchor.y, signX: 1, signY: -1 },
      anchor.x - 5, anchor.y + 5, view.maxX, view.maxY);
    expect(r.w).toBe(MODULE_MAX_EDGE);
    expect(r.x).toBeCloseTo(anchor.x + MODULE_MAX_EDGE / 2, 12); // right of the anchor still
    expect(r.y - r.h / 2).toBeGreaterThanOrEqual(-1e-12); // above the floor
  });

  it('the floor law wins over the anchor: growing down onto the floor lifts the module', () => {
    const r = bench(0.66, 0.5, 0, 0.4); // bottom edge 0.15 above the floor
    const anchor = { x: r.x - r.w / 2, y: r.y + r.h / 2 };
    applyRectResize(r, { anchorX: anchor.x, anchorY: anchor.y, signX: 1, signY: -1 }, anchor.x + 0.5, anchor.y - 1.4, view.maxX, view.maxY);
    expect(r.h).toBeGreaterThan(0.5); // it grew…
    expect(r.y - r.h / 2).toBeGreaterThanOrEqual(-1e-12); // …but the bottom never crossed the floor
  });

  it('deterministic: the same grab + pointer sequence gives bitwise-identical geometry', () => {
    const run = () => {
      const r = bench();
      const anchor = { x: r.x - r.w / 2, y: r.y + r.h / 2 };
      const grab = { anchorX: anchor.x, anchorY: anchor.y, signX: 1, signY: -1 };
      const out: number[] = [];
      for (const [px, py] of [[0.3, 0.6], [1.2, 0.2], [-0.5, 1.4], [0.9, 0.55]] as const) {
        applyRectResize(r, grab, px, py, view.maxX, view.maxY);
        out.push(r.x, r.y, r.w, r.h);
      }
      return out;
    };
    expect(run()).toEqual(run());
  });
});

describe('2D-6 stage — the EDGE-RELATIVE seat law (resize transport)', () => {
  it('edgeFraction ↔ seatPoseFromFraction round-trip on every edge', () => {
    const r = { id: 0, x: 0.3, y: 1.1, w: 1.2, h: 0.8, zone: '#000000', label: '00', homeX: 0, homeY: 0 };
    for (const edge of [EDGE_TOP, EDGE_RIGHT, EDGE_BOTTOM, EDGE_LEFT]) {
      for (const f of [0, 0.13, 0.5, 0.87, 1]) {
        const pose = seatPoseFromFraction(r, edge, f, {
          x: 0, y: 0, nx: 0, ny: 0, edge: 0, socketX: 0, socketY: 0,
        });
        expect(pose.edge).toBe(edge);
        expect(edgeFraction(pose.socketX, pose.socketY, r, edge)).toBeCloseTo(f, 12);
        // The pin sits SEAT_DEPTH inside the socket, along the edge normal.
        expect(pose.x).toBeCloseTo(pose.socketX - pose.nx * SEAT_DEPTH, 12);
        expect(pose.y).toBeCloseTo(pose.socketY - pose.ny * SEAT_DEPTH, 12);
      }
    }
  });

  it('THE SHRINK LAW: a near-end seat slides inward with its edge — never off', () => {
    // Top-edge socket at fraction 0.9 of a 2.0-wide rect.
    const wide = { id: 0, x: 1.0, y: 1.0, w: 2.0, h: 0.5, zone: '#000000', label: '00', homeX: 0, homeY: 0 };
    const f = edgeFraction(1.8, 1.25, wide, EDGE_TOP);
    expect(f).toBeCloseTo(0.9, 12);
    // The rect's LEFT edge stays (an anchored shrink): w 2.0 → 0.5.
    const shrunk = { ...wide, w: 0.5, x: 0.5 + 0.0 };
    const pose = seatPoseFromFraction(shrunk, EDGE_TOP, f, {
      x: 0, y: 0, nx: 0, ny: 0, edge: 0, socketX: 0, socketY: 0,
    });
    expect(pose.socketX).toBeCloseTo(0.25 + 0.45, 12); // left edge + 0.9 × the NEW width
    expect(pose.socketY).toBeCloseTo(shrunk.y + shrunk.h / 2, 12); // still ON the edge
    // The fraction survives verbatim.
    expect(edgeFraction(pose.socketX, pose.socketY, shrunk, EDGE_TOP)).toBeCloseTo(0.9, 12);
  });

  it('fraction 1 rides the endpoint; garbage fractions clamp into [0, 1]', () => {
    const r = { id: 0, x: 0, y: 1, w: 1.0, h: 1.0, zone: '#000000', label: '00', homeX: 0, homeY: 0 };
    const corner = seatPoseFromFraction(r, EDGE_TOP, 1, { x: 0, y: 0, nx: 0, ny: 0, edge: 0, socketX: 0, socketY: 0 });
    expect(corner.socketX).toBeCloseTo(0.5, 12); // the right endpoint
    const over = seatPoseFromFraction(r, EDGE_TOP, 1.4, { x: 0, y: 0, nx: 0, ny: 0, edge: 0, socketX: 0, socketY: 0 });
    expect(over.socketX).toBeCloseTo(0.5, 12); // clamped, total over garbage
    const under = seatPoseFromFraction(r, EDGE_TOP, -3, { x: 0, y: 0, nx: 0, ny: 0, edge: 0, socketX: 0, socketY: 0 });
    expect(under.socketX).toBeCloseTo(-0.5, 12);
  });

  it('translation is fraction-INVARIANT: the stored coordinate survives a drag untouched', () => {
    const a = { id: 0, x: 0, y: 1, w: 1.0, h: 0.8, zone: '#000000', label: '00', homeX: 0, homeY: 0 };
    const pose0 = seatPose(0.2, 1.5, a); // a top-edge seat
    const f0 = edgeFraction(pose0.socketX, pose0.socketY, a, pose0.edge);
    const b = { ...a, x: a.x + 0.7, y: a.y - 0.3 }; // the same rect, translated
    const pose1 = seatPoseFromFraction(b, pose0.edge, f0, { x: 0, y: 0, nx: 0, ny: 0, edge: 0, socketX: 0, socketY: 0 });
    // The recomputed pin rides the exact translation delta.
    expect(pose1.x).toBeCloseTo(pose0.x + 0.7, 12);
    expect(pose1.y).toBeCloseTo(pose0.y - 0.3, 12);
  });

  it('HANDLE_RADIUS: a small disc (~14 px at the drive view), inside the edge region', () => {
    expect(HANDLE_RADIUS).toBe(0.08);
    expect(HANDLE_RADIUS).toBeLessThan(0.1); // the seat law's EDGE_REGION_MARGIN
  });
});

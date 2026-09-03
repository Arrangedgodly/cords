/**
 * 2D-2 — THE WORLD CONTRACT (Doctor Strange's lane: interaction determinism;
 * Professor X's: visual truth). The flat panel's eight candy-zoned steel
 * modules and the geometry laws everything else agrees on.
 *
 * DESIGN.md's Drum Machine Panel translated to the plane: the modules are the
 * v1 cubes' faceplates, floated as bolted-on steel rectangles over the
 * machined charcoal bench (a stage, not a grid — v1's authored scatter kept);
 * the candy zone roster is the token table's own order (01 signal-red …
 * 08 bone); the silkscreen ID is the painted module number. Everything here
 * is PURE DATA + PURE MATH — no canvas, no DOM, no sim imports — so the
 * render layer and the interaction layer share ONE law (the same discipline
 * that kept v1's socket rule and its renderer from forking).
 *
 * THE SEAT LAW (v1's INT-2 law, translated verbatim): a jack released over a
 * rectangle seats PERPENDICULAR TO THE NEAREST EDGE at the closest point on
 * that edge, with deterministic corner resolution — nearest-edge by MAX
 * NORMAL COMPONENT (the 2D form of v1's face-under-cursor rule: the edge
 * whose outward normal has the largest dot with the release point's offset
 * from the rectangle's center) and a stable tie-break in fixed edge order
 * TOP > RIGHT > BOTTOM > LEFT. The seat pin sits SEAT_DEPTH inside the
 * perimeter, so the jack's tapered tip is drawn buried in the module's face
 * (the insertion-depth overlap; 0.082 is v1's PLUG_SEATED_DEPTH, carried).
 */
import type { Vec2 } from '../sim';

/** Edge ids in tie-break order (an exact tie keeps the EARLIER edge). */
export const EDGE_TOP = 0;
export const EDGE_RIGHT = 1;
export const EDGE_BOTTOM = 2;
export const EDGE_LEFT = 3;

/** Outward unit normal per edge id (index === edge id). */
export const EDGE_NORMALS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], // top    (+y)
  [1, 0], // right  (+x)
  [0, -1], // bottom (−y)
  [-1, 0], // left   (−x)
];

/**
 * How deep a seated jack's tip sits INSIDE the perimeter (world units).
 * v1's socket insertion depth, byte-carried — the harness's opening seat and
 * this law must agree bitwise.
 */
export const SEAT_DEPTH = 0.082;

/**
 * The halo around a rectangle that still counts as "over" it for a RELEASE
 * (seating) — about a jack's width, so dropping a jack a few pixels outside
 * an edge still plugs it into that edge (v1's ray hit the face; the 2D point
 * needs the equivalent generosity).
 */
export const EDGE_REGION_MARGIN = 0.1;

/** One steel module: center + extents in world units (x right, y UP). */
export interface StageRect {
  readonly id: number;
  /** Center x (world). */
  x: number;
  /** Center y (world); the floor line is y = 0. */
  y: number;
  readonly w: number;
  readonly h: number;
  /** Candy-zone fill (#rrggbb, DESIGN.md's roster in module order). */
  readonly zone: string;
  /** Silkscreen module id ("01"…"08"). */
  readonly label: string;
  /** Authored home center — RESET's target (dragging mutates x/y). */
  readonly homeX: number;
  readonly homeY: number;
}

/**
 * The bench: eight modules over a ~7-unit span, hung at varied heights so
 * NEIGHBORING tops sit inside one cord's reach (total rest 2.4 × threshold
 * 1.04 ≈ 2.496 world units) while the farthest pairs do not — the same
 * reach profile the 2D-1 fuzz corpus staged its own panel with (FUZZ_CUBES),
 * authored here as the production stage.
 */
export const MODULE_W = 0.66;
export const MODULE_H = 0.5;

/** The authored stage (a fresh deep copy per world; dragging mutates x/y). */
export function createStage(): StageRect[] {
  // x centered on the stage's own span (view center = world x 0).
  const home: ReadonlyArray<readonly [number, number, string, string]> = [
    [-3.1, 1.46, '#e8433f', '01'], // signal red
    [-2.22, 2.02, '#f2903a', '02'], // tangerine
    [-1.34, 1.44, '#f2d43a', '03'], // sulfur yellow
    [-0.46, 1.98, '#2fbd72', '04'], // jade
    [0.42, 1.42, '#3ec8d8', '05'], // reef cyan
    [1.32, 2.04, '#4a7df2', '06'], // cobalt
    [2.22, 1.46, '#d857c8', '07'], // magenta
    [3.08, 1.96, '#e8e3d5', '08'], // bone
  ];
  return home.map(([x, y, zone, label], id) => ({
    id,
    x,
    y,
    w: MODULE_W,
    h: MODULE_H,
    zone,
    label,
    homeX: x,
    homeY: y,
  }));
}

/** Total (garbage-proof) clamp of `v` into [lo, hi]. */
function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}

/** Point-in-rect (with optional margin), total over non-finite points. */
export function pointInRect(px: number, py: number, r: StageRect, margin = 0): boolean {
  if (!Number.isFinite(px) || !Number.isFinite(py)) return false;
  const mx = r.w / 2 + margin;
  const my = r.h / 2 + margin;
  return px >= r.x - mx && px <= r.x + mx && py >= r.y - my && py <= r.y + my;
}

/**
 * The topmost module containing the point (later list entries draw on top):
 * reverse-order scan, first hit wins — deterministic under overlap. −1 when
 * nothing contains the point.
 */
export function rectAt(px: number, py: number, rects: readonly StageRect[], margin = 0): number {
  for (let i = rects.length - 1; i >= 0; i -= 1) {
    if (pointInRect(px, py, rects[i], margin)) return rects[i].id;
  }
  return -1;
}

/** The closest point ON edge `edge` to (px, py) — the projection, clamped. */
export function closestPointOnEdge(
  px: number,
  py: number,
  r: StageRect,
  edge: number,
  out: Vec2,
): Vec2 {
  const x0 = r.x - r.w / 2;
  const x1 = r.x + r.w / 2;
  const y0 = r.y - r.h / 2;
  const y1 = r.y + r.h / 2;
  if (edge === EDGE_TOP) {
    out.x = clamp(px, x0, x1);
    out.y = y1;
  } else if (edge === EDGE_BOTTOM) {
    out.x = clamp(px, x0, x1);
    out.y = y0;
  } else if (edge === EDGE_RIGHT) {
    out.x = x1;
    out.y = clamp(py, y0, y1);
  } else {
    out.x = x0;
    out.y = clamp(py, y0, y1);
  }
  return out;
}

/**
 * THE NEAREST-EDGE RULE (v1's INT-2 law, translated): the edge whose SEGMENT
 * is closest to the point — the honest "nearest edge" for interior points
 * and points beyond a face — with deterministic CORNER resolution: in the
 * corner region both edges clamp to the same corner point (exact distance
 * tie), and the tie breaks by MAX NORMAL COMPONENT (the edge whose outward
 * normal has the larger dot with the point's offset from the rectangle's
 * center — the axis the point is more beyond, v1's face-under-cursor rule),
 * then in fixed edge order TOP > RIGHT > BOTTOM > LEFT (the exact diagonal).
 * Total over garbage (non-finite reads as the center → EDGE_TOP).
 */
export function nearestEdge(px: number, py: number, r: StageRect): number {
  const x = Number.isFinite(px) ? px : r.x;
  const y = Number.isFinite(py) ? py : r.y;
  const x0 = r.x - r.w / 2;
  const x1 = r.x + r.w / 2;
  const y0 = r.y - r.h / 2;
  const y1 = r.y + r.h / 2;
  const dx = x - r.x;
  const dy = y - r.y;
  let best = EDGE_TOP;
  let bestD2 = Number.POSITIVE_INFINITY;
  let bestDot = -Number.POSITIVE_INFINITY;
  for (let edge = EDGE_TOP; edge <= EDGE_LEFT; edge += 1) {
    // Distance² to the edge SEGMENT (the projection, clamped).
    let d2: number;
    if (edge === EDGE_TOP || edge === EDGE_BOTTOM) {
      const ex = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
      const ey = edge === EDGE_TOP ? y1 - y : y - y0;
      d2 = ex * ex + ey * ey;
    } else {
      const ey = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
      const ex = edge === EDGE_RIGHT ? x1 - x : x - x0;
      d2 = ex * ex + ey * ey;
    }
    if (d2 > bestD2) continue;
    const dot = dx * EDGE_NORMALS[edge][0] + dy * EDGE_NORMALS[edge][1];
    if (d2 < bestD2 || dot > bestDot) {
      best = edge;
      bestD2 = d2;
      bestDot = dot;
    }
  }
  return best;
}

/** A resolved seat: the pin (tip) position + the outward edge normal. */
export interface SeatPose {
  /** The sim pin — SEAT_DEPTH inside the perimeter on the chosen edge. */
  x: number;
  y: number;
  /** Outward unit normal (the jack's axis; the plug points OUT along it). */
  nx: number;
  ny: number;
  /** The chosen edge id. */
  edge: number;
  /** The closest point on the edge itself (the socket line). */
  socketX: number;
  socketY: number;
}

/**
 * Resolves the seat for a release at (px, py) over rectangle `r`: nearest
 * edge (max normal component, stable tie-break), closest point on that
 * edge, then the pin SEAT_DEPTH inward. `out` is filled and returned — the
 * per-frame path allocates nothing.
 */
export function seatPoseInto(px: number, py: number, r: StageRect, out: SeatPose): SeatPose {
  const edge = nearestEdge(px, py, r);
  closestPointOnEdge(px, py, r, edge, out);
  const n = EDGE_NORMALS[edge];
  const socketX = out.x;
  const socketY = out.y;
  out.x = socketX - n[0] * SEAT_DEPTH;
  out.y = socketY - n[1] * SEAT_DEPTH;
  out.nx = n[0];
  out.ny = n[1];
  out.edge = edge;
  out.socketX = socketX;
  out.socketY = socketY;
  return out;
}

/** Fresh-pose convenience for one-shot callers (tests, the opening stage). */
export function seatPose(px: number, py: number, r: StageRect): SeatPose {
  return seatPoseInto(px, py, r, {
    x: 0, y: 0, nx: 0, ny: 0, edge: 0, socketX: 0, socketY: 0,
  });
}

/**
 * Squared distance from a point to a rectangle's perimeter (the cord-body
 * hover test's module cousin; also the honest "how close to an edge" read).
 * Inside counts as 0 — the perimeter of the containing region.
 */
export function distToRectPerimeter2(px: number, py: number, r: StageRect): number {
  const cx = clamp(px, r.x - r.w / 2, r.x + r.w / 2);
  const cy = clamp(py, r.y - r.h / 2, r.y + r.h / 2);
  const inside = px >= r.x - r.w / 2 && px <= r.x + r.w / 2 && py >= r.y - r.h / 2 && py <= r.y + r.h / 2;
  if (inside) return 0;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy;
}

/**
 * Drag clamp: a module stays fully ABOVE the panel floor (bottom edge at or
 * above y = 0) and inside the view's horizontal reach. Mutates and returns
 * `r`'s center. `maxY` is the view's top reach (world units); `maxX` the
 * half-width the composition allows (both from the live view metrics).
 */
export function clampRectCenter(r: StageRect, maxX: number, maxY: number): void {
  r.x = clamp(r.x, -maxX + r.w / 2, maxX - r.w / 2);
  r.y = clamp(r.y, r.h / 2, Math.max(maxY, r.h / 2 + 0.001));
}

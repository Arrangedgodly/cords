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
 *
 * 2D-6 adds the module's own geometry laws: SPAWN (deterministic placement,
 * palette cycling, silkscreen sequence, soft cap 32), RESIZE (corner handles,
 * axis-aligned, bounded, opposite-corner anchored), and the EDGE-RELATIVE
 * seat coordinate a resize transports through (the seat law's fraction along
 * its edge — see seatPoseFromFraction).
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
 * 2D-6 — the module roster's candy-zone palette, in DESIGN.md's own order.
 * Spawned modules CYCLE it from the top (spawn 1 is signal red again — the
 * roster is a palette, not a one-per-module allocation).
 */
export const MODULE_ZONES: readonly string[] = [
  '#e8433f', '#f2903a', '#f2d43a', '#2fbd72', '#3ec8d8', '#4a7df2', '#d857c8', '#e8e3d5',
];

/**
 * 2D-6 — the module soft cap (town-hall Revision 3's perf guard): the 33rd
 * spawn is an honest no-op, exactly the cord-cap discipline.
 */
export const MODULE_CAP = 32;

/**
 * 2D-6 — resize bounds (world units per edge). CHOICE, logged: the authored
 * module is 0.66 × 0.5; MIN 0.35 keeps a smallest module comfortably wider
 * than a jack's drawn body (0.415 tip-to-boot at the EDGE, plus the 0.1 edge
 * region) so seats and the silkscreen id still read on it — ≈61 px at the
 * drives' 1600×1000 view (scale ≈ 173.9 px/unit); MAX 1.6 (≈278 px) is ~2.4×
 * the authored width: the largest module still reads as one module on the
 * 9.2-unit stage, not a bench surface. Past 1.6 a "module" would swallow the
 * reach profile the authored stage authored (neighbor tops within one cord).
 */
export const MODULE_MIN_EDGE = 0.35;
export const MODULE_MAX_EDGE = 1.6;

/**
 * 2D-6 — the corner-handle pick radius (world units). ≈14 px of halo at the
 * drives' default view: a machined notch you can actually land a press on,
 * while staying clear of a mid-edge seated plug's capsule (seats near a
 * corner still win the jack pick outside this disc — the priority law is
 * handle > jack by GEOMETRY, not by grabbing the whole corner region).
 */
export const HANDLE_RADIUS = 0.08;

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
  /**
   * Extents (world units). 2D-6: MUTABLE — a corner-handle resize rewrites
   * them in place (the same liveness dragging already has on x/y; RESET keeps
   * positions AND sizes per the reset-cords-only law).
   */
  w: number;
  h: number;
  /** Candy-zone fill (#rrggbb, DESIGN.md's roster in module order). */
  readonly zone: string;
  /** Silkscreen module id ("01"…"08", then spawned "09", "10", … "100"+). */
  readonly label: string;
  /** Authored home center — the birth position (dragging mutates x/y). */
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

/**
 * 2D-6 — the silkscreen id for module ordinal `n` (1-based): zero-padded to
 * two digits through 99, then plain numerals (100, 101, …) — the sequence
 * continues numerically, it never rolls over.
 */
export function moduleLabel(n: number): string {
  if (!Number.isFinite(n) || n < 1) return '00';
  return String(Math.floor(n)).padStart(2, '0');
}

/**
 * 2D-6 — SPAWN (Doctor Strange's lane: deterministic placement). Appends one
 * ordinary module to `stage` (id === new length — the controller's
 * stage[rectId] indexing law), cycling the candy-zone palette and continuing
 * the silkscreen sequence. Placement: the desired center (`at`, or a free
 * spot near stage center when the pointer is unknown), then an HONEST
 * overlap-avoidance attempt — a deterministic ring search (12 directions ×
 * radii 0.95/1.9/2.85 world) for the first candidate whose footprint clears
 * every existing module by `SPAWN_GAP`; if all 37 candidates overlap, the
 * desired point stands (honest, not perfect). The winner is clamped above
 * the floor and inside the view exactly like a drag. At `MODULE_CAP` the
 * spawn is a NO-OP returning null (the cord-cap discipline).
 */
export const SPAWN_GAP = 0.14;
const SPAWN_RING_RADII: readonly number[] = [0.95, 1.9, 2.85];

export function spawnModuleInto(
  stage: StageRect[],
  at: Vec2 | null,
  maxX: number,
  maxY: number,
): StageRect | null {
  if (stage.length >= MODULE_CAP) return null; // soft cap: honest no-op
  const desiredX = at !== null && Number.isFinite(at.x) ? at.x : 0;
  const desiredY = at !== null && Number.isFinite(at.y) ? at.y : 1.5;
  const free = (cx: number, cy: number): boolean => {
    for (let i = 0; i < stage.length; i += 1) {
      const r = stage[i];
      if (
        Math.abs(cx - r.x) < (MODULE_W + r.w) / 2 + SPAWN_GAP &&
        Math.abs(cy - r.y) < (MODULE_H + r.h) / 2 + SPAWN_GAP
      ) {
        return false;
      }
    }
    return true;
  };
  let cx = desiredX;
  let cy = desiredY;
  if (!free(cx, cy)) {
    let placed = false;
    for (let ring = 0; !placed && ring < SPAWN_RING_RADII.length; ring += 1) {
      const radius = SPAWN_RING_RADII[ring];
      for (let k = 0; k < 12; k += 1) {
        const ang = (k * Math.PI) / 6;
        const ox = desiredX + Math.cos(ang) * radius;
        const oy = desiredY + Math.sin(ang) * radius;
        if (free(ox, oy)) {
          cx = ox;
          cy = oy;
          placed = true;
          break;
        }
      }
    }
    // No free candidate: the desired point stands (the honest failure).
  }
  const rect: StageRect = {
    id: stage.length,
    x: cx,
    y: cy,
    w: MODULE_W,
    h: MODULE_H,
    zone: MODULE_ZONES[stage.length % MODULE_ZONES.length],
    label: moduleLabel(stage.length + 1),
    homeX: cx,
    homeY: cy,
  };
  clampRectCenter(rect, maxX, maxY);
  stage.push(rect);
  return rect;
}

// --- 2D-6: the corner handles + the resize law ---------------------------------

/** Corner ids in clockwise order from top-left. */
export const CORNER_TL = 0;
export const CORNER_TR = 1;
export const CORNER_BR = 2;
export const CORNER_BL = 3;

/** The corner point (world) of rect `r`, into `out`. */
export function rectCornerInto(r: StageRect, corner: number, out: Vec2): Vec2 {
  const hw = r.w / 2;
  const hh = r.h / 2;
  const sx = corner === CORNER_TL || corner === CORNER_BL ? -1 : 1;
  const sy = corner === CORNER_TL || corner === CORNER_TR ? 1 : -1;
  out.x = r.x + sx * hw;
  out.y = r.y + sy * hh;
  return out;
}

/** The corner a resize of `corner` anchors at (the opposite one). */
export function oppositeCorner(corner: number): number {
  return (corner + 2) % 4;
}

/**
 * A frozen resize grab: the anchor (opposite corner, world) and the SIGNS of
 * the grabbed corner's side of it — fixed at pointerdown so the module stays
 * put at its opposite corner for the whole drag (the standard resize feel;
 * the pointer crossing OVER the anchor clamps to the minimum edge, it never
 * inverts the corner — deterministic and predictable mid-drag).
 */
export interface RectResizeGrab {
  readonly anchorX: number;
  readonly anchorY: number;
  /** Grabbed corner's side of the anchor: +1 grows right/up, −1 left/down. */
  readonly signX: number;
  readonly signY: number;
}

/**
 * 2D-6 — THE RESIZE LAW: axis-aligned, bounded (MODULE_MIN_EDGE…
 * MODULE_MAX_EDGE per edge), anchored at the opposite corner, then clamped
 * above the floor and inside the view exactly like a drag (the floor law
 * wins over the anchor when they conflict). Mutates `r` in place. Total
 * over garbage pointers (non-finite reads as no change of that axis).
 */
export function applyRectResize(
  r: StageRect,
  grab: RectResizeGrab,
  px: number,
  py: number,
  maxX: number,
  maxY: number,
): void {
  const ex = Number.isFinite(px) ? px : grab.anchorX + grab.signX * r.w;
  const ey = Number.isFinite(py) ? py : grab.anchorY + grab.signY * r.h;
  r.w = clamp(Math.abs(ex - grab.anchorX), MODULE_MIN_EDGE, MODULE_MAX_EDGE);
  r.h = clamp(Math.abs(ey - grab.anchorY), MODULE_MIN_EDGE, MODULE_MAX_EDGE);
  r.x = grab.anchorX + (grab.signX * r.w) / 2;
  r.y = grab.anchorY + (grab.signY * r.h) / 2;
  clampRectCenter(r, maxX, maxY);
}

// --- 2D-6: the EDGE-RELATIVE seat law (the load-bearing transport) --------------

/**
 * The fraction along `edge` of a socket point ON that edge (0 = the edge's
 * first endpoint — left for horizontal edges, bottom for vertical ones —
 * 1 = the far endpoint). Clamped garbage-proof into [0, 1].
 */
export function edgeFraction(socketX: number, socketY: number, r: StageRect, edge: number): number {
  if (edge === EDGE_TOP || edge === EDGE_BOTTOM) {
    return clamp((socketX - (r.x - r.w / 2)) / r.w, 0, 1);
  }
  return clamp((socketY - (r.y - r.h / 2)) / r.h, 0, 1);
}

/**
 * 2D-6 — THE SEAT TRANSPORT LAW's other half: the absolute seat pose for a
 * stored EDGE-RELATIVE coordinate on the rect's CURRENT geometry. The
 * fraction is kept VERBATIM through resizes (clamped into [0, 1] — the
 * garbage-proof form of the shrink law; a fraction stored from a clamped
 * socket is already inside, so on a shrinking edge the socket slides inward
 * with the endpoint, never pops off). Pure: same rect + same fraction,
 * bitwise same pose — this is what makes a resize transport deterministic.
 */
export function seatPoseFromFraction(
  r: StageRect,
  edge: number,
  fraction: number,
  out: SeatPose,
): SeatPose {
  const f = clamp(fraction, 0, 1);
  const x0 = r.x - r.w / 2;
  const x1 = r.x + r.w / 2;
  const y0 = r.y - r.h / 2;
  const y1 = r.y + r.h / 2;
  if (edge === EDGE_TOP) {
    out.socketX = x0 + f * r.w;
    out.socketY = y1;
  } else if (edge === EDGE_BOTTOM) {
    out.socketX = x0 + f * r.w;
    out.socketY = y0;
  } else if (edge === EDGE_RIGHT) {
    out.socketX = x1;
    out.socketY = y0 + f * r.h;
  } else {
    out.socketX = x0;
    out.socketY = y0 + f * r.h;
  }
  const n = EDGE_NORMALS[edge];
  out.x = out.socketX - n[0] * SEAT_DEPTH;
  out.y = out.socketY - n[1] * SEAT_DEPTH;
  out.nx = n[0];
  out.ny = n[1];
  out.edge = edge;
  return out;
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

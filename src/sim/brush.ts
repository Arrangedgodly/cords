import type { Ray3 } from './types';
import type { Rope } from './rope';

/**
 * T-INT-5 — the PASSIVE CURSOR-BRUSH (plan.md INT-5; the approved user
 * intent, verbatim: "running your mouse against the cord triggers a little
 * bit of physics collision animation so you see the dangle"). Hovering the
 * cursor — NO button held — sweeps an invisible halo through the scene, and
 * every cord segment inside it gets a small velocity impulse pushed AWAY
 * from the cursor ray. The scene feels touchable; the dangle becomes
 * visible. Radius, falloff, and intensity are feel-tunables (options below).
 *
 * THE CONTRACT THIS MODULE IMPLEMENTS (the split the task fixes):
 * - PURE IMPULSE MATH, three-free and unit-testable right here: distance
 *   from a point to the cursor RAY, a smooth monotonic falloff inside the
 *   radius, and a deterministic push direction. No DOM, no wall-clock, no
 *   RNG — the same (point, ray, radius) always produces the same impulse.
 * - MOVE-ONLY SEMANTICS live one layer up: the interaction layer composes
 *   `SimInput.brush` ONLY on frames a pointer-move event arrived (Thor's
 *   zero-idle-cost rule — an idle cursor sends nothing, so an idle cursor
 *   can never inject energy, even when a swinging cord passes through the
 *   ray). The world step applies ONE impulse pass per NEW move-counter
 *   value, which also makes the fixed-timestep driver's substep replays of
 *   one input idempotent (one impulse per pointer-move frame, never one per
 *   substep).
 * - PINS WIN: seated ends, the carried end, and the still-pinned anchor are
 *   hard pins — the brush pass skips them and touches FREE points only.
 * - VANISHING CORDS ARE STILL BRUSHABLE (the documented call): the vanish
 *   sequence is contact/time-driven (shatter on first floor contact, the
 *   pull window on the sim clock, completion guaranteed by the fall-timeout
 *   totality guard), so body impulses cannot derail it — a failing cord
 *   that is swept on its way out keeps dying on schedule while its body
 *   reacts. It feels alive to the last frame; nothing breaks.
 *
 * Zero per-frame allocation: the impulse pass is scalar math over reused
 * module-scratch (single-threaded, no re-entrancy — `Rope` mutators never
 * call back into this module).
 */

/**
 * Brush halo reach, expressed in REST LENGTHS of the cord being brushed
 * (each rope resolves its own world-unit radius: `radiusRestLengths ×
 * rope.segmentLength`), so a scene of mixed cord scales brushes coherently.
 * Default 1.5 rest lengths ≈ a ~25 px halo at the bench's viewing depth —
 * about the visual width of the jack, wide enough to catch a deliberate
 * sweep, tight enough that the cord does not twitch from distant passes.
 */
export const DEFAULT_BRUSH_RADIUS_REST_LENGTHS = 1.5;

/**
 * Maximum impulse speed at the ray itself (world units per second), before
 * the distance falloff. 1.0 u/s is an order below gravity-driven speeds and
 * about ten rest-lengths per second: a swept cord sways visibly and calms
 * inside the ordinary settle window — a nudge, never a whip.
 */
export const DEFAULT_BRUSH_STRENGTH = 1.0;

/** Feel-tunables for the passive brush (see the constants above). */
export interface BrushOptions {
  /**
   * Halo radius in rest lengths of each cord (default
   * DEFAULT_BRUSH_RADIUS_REST_LENGTHS). Must be finite and > 0.
   */
  radiusRestLengths?: number;
  /**
   * Peak impulse speed in world units per second (default
   * DEFAULT_BRUSH_STRENGTH). Must be finite and >= 0 (0 disables the
   * impulses while keeping the zero-cost idle contract).
   */
  strength?: number;
}

/** Fail-fast-resolved tunables (programmer error throws at construction). */
export interface ResolvedBrushOptions {
  readonly radiusRestLengths: number;
  readonly strength: number;
}

export function resolveBrushOptions(options?: BrushOptions): ResolvedBrushOptions {
  const radiusRestLengths = options?.radiusRestLengths ?? DEFAULT_BRUSH_RADIUS_REST_LENGTHS;
  const strength = options?.strength ?? DEFAULT_BRUSH_STRENGTH;
  if (!Number.isFinite(radiusRestLengths) || radiusRestLengths <= 0) {
    throw new Error(
      `brush: radiusRestLengths must be a positive finite number, got ${radiusRestLengths}`,
    );
  }
  if (!Number.isFinite(strength) || strength < 0) {
    throw new Error(`brush: strength must be a finite number >= 0, got ${strength}`);
  }
  return { radiusRestLengths, strength };
}

/**
 * Below this distance (world units) the point sits ON the ray and the push
 * direction (a 0/0 quotient) is resolved by the deterministic perpendicular
 * below — never skipped: the cursor sitting exactly on the cord is the most
 * brush-like moment there is.
 */
const ON_RAY_DISTANCE = 1e-6;

/**
 * The smooth falloff weight for a point at `distance` from the ray inside
 * `radius`: a raised cosine — 1 at the ray, 0 at (and beyond) the radius,
 * strictly decreasing in between, C1-smooth at both ends so a sweep never
 * produces a velocity kink at the halo's edge. Pure and total: any
 * non-finite or out-of-halo distance reads 0.
 */
export function brushWeight(distance: number, radius: number): number {
  if (!(distance < radius)) return 0; // NaN-safe: garbage reads "outside"
  const t = distance / radius;
  return 0.5 * (1 + Math.cos(Math.PI * t));
}

/** Caller-owned output shell for `brushImpulse` (no allocation inside). */
export interface BrushImpulseOut {
  x: number;
  y: number;
  z: number;
}

/**
 * A deterministic unit vector perpendicular to `direction` (normalized
 * caller-supplied components; any finite non-zero direction) — the push
 * direction for a point sitting exactly on the ray. Crosses the direction
 * with the coordinate axis of its SMALLEST magnitude (the largest cross
 * product), a pure function of the direction, so every run pushes the same
 * way.
 */
function perpendicularTo(
  dx: number,
  dy: number,
  dz: number,
  out: BrushImpulseOut,
): void {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const az = Math.abs(dz);
  let ux = 0;
  let uy = 0;
  let uz = 0;
  if (ax <= ay && ax <= az) ux = 1;
  else if (ay <= az) uy = 1;
  else uz = 1;
  const cx = dy * uz - dz * uy;
  const cy = dz * ux - dx * uz;
  const cz = dx * uy - dy * ux;
  const len = Math.sqrt(cx * cx + cy * cy + cz * cz);
  out.x = cx / len;
  out.y = cy / len;
  out.z = cz / len;
}

/**
 * The pure per-point impulse: for point (px,py,pz) against `ray`, write the
 * unit push-away direction SCALED BY THE FALLOFF WEIGHT into `out` and
 * return the weight (0..1). The caller multiplies by the strength. A return
 * of 0 means "outside the halo / degenerate ray" and leaves `out` UNTOUCHED
 * (the bitwise-untouched contract).
 *
 * Geometry: closest point on the ray (clamped to t >= 0 — behind the camera
 * origin the origin itself is the closest ray point), distance from the
 * point to it, cosine falloff, push along (point − closest) normalized. The
 * direction does not need to be unit-length: the projection divides by
 * |D|², so any finite non-zero direction is exact.
 */
export function brushImpulse(
  px: number,
  py: number,
  pz: number,
  ray: Ray3,
  radius: number,
  out: BrushImpulseOut,
): number {
  const ox = ray.origin.x;
  const oy = ray.origin.y;
  const oz = ray.origin.z;
  const dx = ray.direction.x;
  const dy = ray.direction.y;
  const dz = ray.direction.z;
  const len2 = dx * dx + dy * dy + dz * dz;
  if (!(len2 > 0)) return 0; // zero/NaN direction: no brush (totality)
  let t = ((px - ox) * dx + (py - oy) * dy + (pz - oz) * dz) / len2;
  if (t < 0) t = 0; // behind the origin: the origin is the closest ray point
  const cx = ox + dx * t;
  const cy = oy + dy * t;
  const cz = oz + dz * t;
  let nx = px - cx;
  let ny = py - cy;
  let nz = pz - cz;
  const d2 = nx * nx + ny * ny + nz * nz;
  if (!(d2 < radius * radius)) return 0;
  const d = Math.sqrt(d2);
  const weight = brushWeight(d, radius);
  if (weight <= 0) return 0;
  if (d < ON_RAY_DISTANCE) {
    perpendicularTo(dx, dy, dz, out);
  } else {
    nx /= d;
    ny /= d;
    nz /= d;
    out.x = nx;
    out.y = ny;
    out.z = nz;
  }
  out.x *= weight;
  out.y *= weight;
  out.z *= weight;
  return weight;
}

// Module scratch for the rope pass — reused every call, never allocated in
// steady state. Single-threaded, no re-entrancy (see the header).
const scratchPoint: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
const scratchImpulse: BrushImpulseOut = { x: 0, y: 0, z: 0 };

/**
 * One brush pass over a rope: every FREE point inside the halo around `ray`
 * takes an additive velocity impulse (direction away from the ray × falloff
 * × strength). PINS WIN — the seated ends, the carried end, and the
 * still-pinned anchor are skipped, exactly the rope's own pin set. Waking is
 * `addImpulse`'s business: an impulse must move a settled cord (it
 * re-settles through the ordinary SIM-3 window). Returns how many points
 * were perturbed (diagnostics/tests); zero cost-side allocation.
 *
 * This is the pass the WORLD STEP runs per cord, and the one the perf
 * harness measures — one distance check per live point.
 */
export function applyBrushToRope(
  rope: Rope,
  ray: Ray3,
  options: ResolvedBrushOptions,
  dt: number,
): number {
  if (!(dt > 0) || !Number.isFinite(dt)) return 0; // clock garbage: no brush
  const r = ray;
  if (
    !Number.isFinite(r.origin.x) || !Number.isFinite(r.origin.y) || !Number.isFinite(r.origin.z) ||
    !Number.isFinite(r.direction.x) || !Number.isFinite(r.direction.y) || !Number.isFinite(r.direction.z)
  ) {
    return 0; // garbage ray: nothing is brushed, nothing is poisoned
  }
  const strength = options.strength;
  if (strength <= 0) return 0; // tuned off
  const radius = options.radiusRestLengths * rope.segmentLength;
  const N = rope.segmentCount;
  let perturbed = 0;
  for (let i = 0; i < rope.pointCount; i += 1) {
    // PINS WIN (the exact set `Rope.step` re-exacts every pass): the anchor
    // while it still pins, the carried end, either end's plug seat.
    if (i === rope.pinnedIndex && !rope.anchorReleased) continue;
    if (i === rope.carriedIndex) continue;
    if (i === 0 ? rope.isEndSeated(0) : i === N && rope.isEndSeated(N)) continue;
    rope.readPoint(i, scratchPoint);
    const weight = brushImpulse(
      scratchPoint.x,
      scratchPoint.y,
      scratchPoint.z,
      r,
      radius,
      scratchImpulse,
    );
    if (weight <= 0) continue; // outside the halo: bitwise untouched
    rope.addImpulse(
      i,
      scratchImpulse.x * strength,
      scratchImpulse.y * strength,
      scratchImpulse.z * strength,
      dt,
    );
    perturbed += 1;
  }
  return perturbed;
}

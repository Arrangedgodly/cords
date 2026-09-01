/**
 * INT-1 — Raycast picking core: cursor event → NDC → ray → hits, ordered by
 * the approved priority jack > cube > cord body. Renderer-free and DOM-free
 * except for the pure pixel→NDC mapping, so the whole file unit-tests
 * headless against fake hit-test providers (see picking.test.ts); the thin
 * three.js Raycaster adapter lives in threeRaycastProvider.ts.
 *
 * Priority contract (approved scoping brief, deterministic — ambiguity here
 * is what makes picking "feel broken"):
 *   1. Priority class first: jack (0) beats cube (1) beats cord body (2),
 *      regardless of ray distance.
 *   2. Ray distance within a class: nearer hit wins.
 *   3. Exact distance ties inside one class: provider order wins (stable
 *      sort) — providers return hits in registration order, so the result
 *      is deterministic for a given registration sequence.
 *
 * GRAB RULE: the cord body is NEVER grabbable — `pickGrabbable` excludes
 * cord-body hits entirely (they can neither win nor shadow a grab). They
 * remain visible through `pick`, which is the distinct query INT-5's cursor
 * brush consumes later. Desktop mouse only for MVP.
 */
import type { Ray3, Vec3 } from '../sim';

/**
 * Priority classes, lower number = higher priority. `cordBody` exists as a
 * query-result class only — it is excluded from every grab query.
 */
export const PICK_CLASS_PRIORITY = { jack: 0, cube: 1, cordBody: 2 } as const;
export type PickClass = keyof typeof PICK_CLASS_PRIORITY;

/** One raycast hit, already tagged with its priority class by the provider. */
export interface PickHit<TPayload = unknown> {
  readonly class: PickClass;
  /** Distance along the ray in world units (>= 0, finite). */
  readonly distance: number;
  /** Provider-meaningful identity: the picked object, segment, id, ... */
  readonly payload: TPayload;
  /** World-space hit point when the provider supplies one, else null. */
  readonly point: Vec3 | null;
  /**
   * INT-2 — world-space OUTWARD surface normal at the hit when the provider
   * supplies one (a mesh face), else null. The raw geometric normal: at
   * edges/corners it may be a blend of two faces — the socket rule's
   * deterministic nearest-face resolution (`resolveFaceNormal`) owns the
   * snap to a single axis.
   */
  readonly normal: Vec3 | null;
}

/**
 * The abstract hit-test seam: ray → hits with class + distance + payload.
 * Unit tests inject fake providers; the real one wraps THREE.Raycaster.
 */
export interface HitTestProvider<TPayload = unknown> {
  hitTest(ray: Ray3): PickHit<TPayload>[];
}

export interface Picker<TPayload = unknown> {
  /**
   * All hits against the ray, priority-sorted (class, then distance, then
   * provider order). Includes cord-body hits — INT-5's brush reads those.
   */
  pick(ray: Ray3): PickHit<TPayload>[];
  /**
   * The single grabbable hit under the ray, or null when nothing grabbable
   * is under it. Cord-body hits are excluded entirely — a cord under the
   * cursor never blocks grabbing a cube behind it and is never itself
   * returned (only jacks are grabbable on a cord; brushing is INT-5).
   */
  pickGrabbable(ray: Ray3): PickHit<TPayload> | null;
}

/** Drop hits a broken provider produced with garbage distances — they would otherwise sort nondeterministically. */
function isSortableDistance(distance: number): boolean {
  return Number.isFinite(distance) && distance >= 0;
}

export function createPicker<TPayload = unknown>(
  provider: HitTestProvider<TPayload>,
): Picker<TPayload> {
  const byPriority = (
    a: PickHit<TPayload>,
    b: PickHit<TPayload>,
  ): number => {
    const classDiff = PICK_CLASS_PRIORITY[a.class] - PICK_CLASS_PRIORITY[b.class];
    if (classDiff !== 0) return classDiff;
    return a.distance - b.distance;
  };

  const pick = (ray: Ray3): PickHit<TPayload>[] => {
    // Stable sort (spec ≥ ES2019): exact (class, distance) ties keep
    // provider order, which is registration order — deterministic.
    return provider
      .hitTest(ray)
      .filter((hit) => isSortableDistance(hit.distance))
      .sort(byPriority);
  };

  return {
    pick,

    pickGrabbable(ray) {
      const grabbable = pick(ray).find((hit) => hit.class !== 'cordBody');
      return grabbable ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// Cursor event → NDC (pure mapping math, no DOM dependency — callers supply
// the element rect so this tests without a real canvas).
// ---------------------------------------------------------------------------

/** Element viewport rect, the subset of DOMRect the mapping needs. */
export interface ClientRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Normalized device coordinates: (-1,-1) bottom-left … (1,1) top-right. */
export interface Ndc {
  x: number;
  y: number;
}

/**
 * Client pixels → NDC. Not clamped: coordinates outside the rect map beyond
 * ±1, which simply rays into empty space and misses — clamping would fake
 * picks at the screen edge. Returns null for a degenerate (zero/negative or
 * non-finite sized) rect, where no NDC exists; callers treat that as an
 * off-stage pointer, same as a null ray.
 */
export function clientToNdc(
  clientX: number,
  clientY: number,
  rect: ClientRect,
): Ndc | null {
  const { left, top, width, height } = rect;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  const x = ((clientX - left) / width) * 2 - 1;
  // Written as 1 - 2t (not -(2t - 1)) so the exact center maps to +0, never
  // -0 — deterministic output all the way down to the sign of zero.
  const y = 1 - ((clientY - top) / height) * 2;
  return { x, y };
}

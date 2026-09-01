/**
 * INT-4 — the coiled spawn geometry. A cord grabbed from midair appears as a
 * COILED coil at the grab point, not as a straight line: point 0 (the RED
 * end, which becomes the carried pin) sits exactly at the spawn point, and
 * the remaining points wind outward along a flat Archimedean spiral in the
 * horizontal plane through it. No scripted uncoil animation exists — this is
 * only the START STATE; gravity + the constraint solve produce the springy
 * uncoil (the spiral chords are deliberately COMPRESSED below the rope's
 * natural segment rest, so the solve pushes the coil open as it falls —
 * stored spring, released by the sim).
 *
 * Pure math: deterministic (identical inputs → bitwise-identical points),
 * allocation-light (writes into caller-owned shells), no three.js, no DOM,
 * no wall-clock, no RNG — the liftable-core house rule holds.
 */

import type { Vec3 } from './types';

/** Tuning of the spawn coil (world units; INT-lane feel knobs). */
export interface CoilParams {
  /**
   * Arc length of the spiral as a fraction of the rope's natural total
   * length. < 1 COMPRESSES the coil (every chord sits below its segment's
   * rest length): the constraint solve then pushes the coil open as it
   * uncoils — the spring. Tuned 0.9: reads springy but settles fast under
   * the free-swing damping (measured in cordWorld.test.ts).
   */
  compression: number;
  /** Radius where the spiral starts, just off the carried red end. */
  radiusInner: number;
  /** Radius where the spiral ends (the coil's visible size ~ 2× this). */
  radiusOuter: number;
}

export const DEFAULT_COIL: Readonly<CoilParams> = {
  compression: 0.9,
  radiusInner: 0.05,
  radiusOuter: 0.2,
};

/**
 * Fills `out[0..segmentCount]` (the rope's point shells) with the coil
 * around `at`. `out` must have room for `segmentCount + 1` points; slots
 * that are undefined are created (the same shell-filling contract as
 * Rope.writePointsTo). Point 0 lands EXACTLY on `at` — the carried red end
 * is in hand on the spawn frame. Every later point lies in the horizontal
 * plane through `at`, at radius `radiusInner..radiusOuter`, spaced by an
 * arc-length-uniform walk so every chord ≈ `compression × segmentLength`
 * (all chords stay ≤ the natural rest: the coil is never born overstretched).
 * Deterministic: no RNG, no clock — the same (at, geometry, params) give
 * bitwise-identical points every run.
 */
export function coilPoints(
  at: Vec3,
  segmentCount: number,
  segmentLength: number,
  params: CoilParams,
  out: Vec3[],
): void {
  const arc = params.compression * segmentCount * segmentLength;
  // Archimedean spiral r(θ) = r0 + (r1 − r0)·θ/θmax: its arc length is
  // θmax·(r0+r1)/2, so the winding count follows from the arc we want.
  const thetaMax = (2 * arc) / (params.radiusInner + params.radiusOuter);
  const ds = arc / segmentCount; // arc length between consecutive points
  const radiusAt = (theta: number): number =>
    params.radiusInner + ((params.radiusOuter - params.radiusInner) * theta) / thetaMax;
  let theta = 0;
  for (let i = 0; i <= segmentCount; i += 1) {
    const shell = out[i] ?? (out[i] = { x: 0, y: 0, z: 0 });
    let radius: number;
    if (i === 0) {
      // The carried red end: exactly at the grab point.
      radius = 0;
    } else if (i === 1) {
      // The spiral's start, one inner radius off the carried end — placed
      // directly (not walked), so the first chord is radiusInner regardless
      // of segment count.
      radius = params.radiusInner;
    } else {
      // Arc-length-uniform walk, midpoint-refined: dθ = ds / r(θ + dθ/2)
      // keeps the arc actually traveled ≈ ds even where the radius grows
      // fast, so every chord stays at or below the natural rest for any
      // segment count (a chord never exceeds its arc).
      let step = ds / radiusAt(theta);
      step = ds / radiusAt(theta + step / 2);
      theta += step;
      radius = radiusAt(theta);
    }
    shell.x = at.x + radius * Math.cos(theta);
    shell.y = at.y; // flat coil in the horizontal plane through the grab point
    shell.z = at.z + radius * Math.sin(theta);
  }
}

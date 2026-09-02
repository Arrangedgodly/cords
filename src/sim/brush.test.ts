import { describe, expect, it } from 'vitest';
import {
  applyBrushToRope,
  brushImpulse,
  brushWeight,
  resolveBrushOptions,
  DEFAULT_BRUSH_RADIUS_REST_LENGTHS,
  DEFAULT_BRUSH_STRENGTH,
} from './brush';
import type { BrushImpulseOut } from './brush';
import { createVerletRope } from './rope';
import type { Ray3, Vec3 } from './types';

/**
 * T-INT-5 — the PURE half of the passive cursor-brush: the falloff weight,
 * the per-point impulse (distance to the ray, push-away direction, the
 * bitwise-untouched-outside contract, the deterministic on-ray
 * perpendicular), the options' fail-fast resolution, `Rope.addImpulse`'s
 * additive semantics, and `applyBrushToRope`'s PINS-WIN skip. The world-step
 * semantics (move-only, idempotence across substeps, determinism,
 * multi-cord) live in cordWorldBrush.test.ts.
 */

const R = 0.15; // 1.5 rest lengths × the default 0.1 segment length
const DT = 1 / 120;
const out: BrushImpulseOut = { x: 0, y: 0, z: 0 };

/** A ray parallel to -Z passing `offset` in +x of (px, py). */
function rayNear(px: number, py: number, offset: number): Ray3 {
  return {
    origin: { x: px + offset, y: py, z: 5 },
    direction: { x: 0, y: 0, z: -1 },
  };
}

/** Distance from a point to a ray's line, t clamped at 0 (mirrors brushImpulse). */
function distanceToRay(p: Vec3, ray: Ray3): number {
  const { origin: o, direction: d } = ray;
  const len2 = d.x * d.x + d.y * d.y + d.z * d.z;
  let t = ((p.x - o.x) * d.x + (p.y - o.y) * d.y + (p.z - o.z) * d.z) / len2;
  if (t < 0) t = 0;
  const cx = o.x + d.x * t;
  const cy = o.y + d.y * t;
  const cz = o.z + d.z * t;
  return Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2 + (p.z - cz) ** 2);
}

describe('brushWeight — the smooth falloff', () => {
  it('is 1 at the ray, 0 at and beyond the radius, exactly 0.5 at half', () => {
    expect(brushWeight(0, R)).toBe(1);
    expect(brushWeight(R, R)).toBe(0);
    expect(brushWeight(R * 2, R)).toBe(0);
    expect(brushWeight(R / 2, R)).toBeCloseTo(0.5, 15);
  });

  it('is monotone non-increasing with distance (sampled)', () => {
    let prev = brushWeight(0, R);
    for (let k = 1; k <= 120; k += 1) {
      const w = brushWeight((R * k) / 120, R);
      expect(w).toBeLessThanOrEqual(prev + 1e-15);
      prev = w;
    }
    expect(prev).toBe(0);
  });

  it('reads garbage as outside (totality)', () => {
    expect(brushWeight(Number.NaN, R)).toBe(0);
    expect(brushWeight(Number.POSITIVE_INFINITY, R)).toBe(0);
  });
});

describe('brushImpulse — the pure per-point push', () => {
  it('pushes perpendicular away from the ray with the falloff weight', () => {
    const ray = rayNear(0, 0, 0); // the line x=0, y=0 (pointing -z from z=5)
    const w = brushImpulse(0.075, 0, 0, ray, R, out); // half a radius off the line
    expect(w).toBeCloseTo(0.5, 15);
    expect(out.x).toBeCloseTo(0.5, 15); // unit +x scaled by the weight
    expect(out.y).toBe(0);
    expect(out.z).toBe(0);
  });

  it('leaves the output BITWISE UNTOUCHED outside the radius', () => {
    const ray = rayNear(0, 0, 0);
    const sx = 1.234567;
    const sy = -98.5;
    const sz = 4e-11;
    out.x = sx;
    out.y = sy;
    out.z = sz;
    expect(brushImpulse(1, 1, 0, ray, R, out)).toBe(0); // distance ≈ 1.41 » R
    expect(Object.is(out.x, sx)).toBe(true);
    expect(Object.is(out.y, sy)).toBe(true);
    expect(Object.is(out.z, sz)).toBe(true);
  });

  it('clamps behind the origin: the origin is the closest ray point', () => {
    const ray = rayNear(0, 0, 0); // origin (0,0,5)
    // 0.075 off the line's x, but BEHIND the origin (z = 5.02 > 5): the push
    // runs away from the ORIGIN, magnitude = the weight at that distance.
    const p = { x: 0.075, y: 0, z: 5.02 };
    const d = distanceToRay(p, ray);
    expect(d).toBeGreaterThan(0);
    const w = brushImpulse(p.x, p.y, p.z, ray, R, out);
    expect(w).toBeCloseTo(brushWeight(d, R), 15);
    const mag = Math.sqrt(out.x ** 2 + out.y ** 2 + out.z ** 2);
    expect(mag).toBeCloseTo(w, 15);
    // direction = unit(p − origin)
    const ux = p.x / Math.hypot(p.x, p.y, p.z - 5);
    expect(out.x / w).toBeCloseTo(ux, 12);
  });

  it('resolves a point ON the ray with a deterministic perpendicular (never skipped)', () => {
    const ray = rayNear(0, 0, 0);
    const a = brushImpulse(0, 0, 1, ray, R, out); // exactly on the line
    expect(a).toBe(1); // full weight: the cursor is ON the cord
    // The documented rule: cross D with D's smallest-magnitude axis — D is
    // (0,0,-1) → smallest axis x → cross gives (0,-1,0).
    expect(out.x).toBe(0);
    expect(out.y).toBe(-1);
    expect(out.z).toBe(0);
    // Deterministic: the same inputs push the same way, bitwise.
    const second: BrushImpulseOut = { x: 7, y: 7, z: 7 };
    brushImpulse(0, 0, 1, ray, R, second);
    expect(Object.is(second.x, out.x)).toBe(true);
    expect(Object.is(second.y, out.y)).toBe(true);
    expect(Object.is(second.z, out.z)).toBe(true);
    // Perpendicular to the ray direction: dot((0,-1,0), (0,0,-1)) = 0.
    expect(out.z).toBe(0);
  });

  it('is exact for a non-unit ray direction (same line, same impulse)', () => {
    const unit = rayNear(0, 0, 0);
    const scaled: Ray3 = {
      origin: unit.origin,
      direction: { x: 0, y: 0, z: -7.25 },
    };
    const a: BrushImpulseOut = { x: 0, y: 0, z: 0 };
    const b: BrushImpulseOut = { x: 0, y: 0, z: 0 };
    const wa = brushImpulse(0.06, 0.02, 0.5, unit, R, a);
    const wb = brushImpulse(0.06, 0.02, 0.5, scaled, R, b);
    expect(wb).toBe(wa);
    expect(Object.is(a.x, b.x)).toBe(true);
    expect(Object.is(a.y, b.y)).toBe(true);
    expect(Object.is(a.z, b.z)).toBe(true);
  });

  it('brushes nothing against a degenerate (zero/NaN) ray', () => {
    const zero: Ray3 = { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 0 } };
    const nan: Ray3 = {
      origin: { x: Number.NaN, y: 0, z: 0 },
      direction: { x: 0, y: 0, z: -1 },
    };
    out.x = 3;
    out.y = 3;
    out.z = 3;
    expect(brushImpulse(0, 0, 0, zero, R, out)).toBe(0);
    expect(brushImpulse(0, 0, 0, nan, R, out)).toBe(0);
    expect(Object.is(out.x, 3)).toBe(true);
  });
});

describe('resolveBrushOptions — fail-fast tunables', () => {
  it('defaults to the documented feel values', () => {
    expect(resolveBrushOptions()).toEqual({
      radiusRestLengths: DEFAULT_BRUSH_RADIUS_REST_LENGTHS,
      strength: DEFAULT_BRUSH_STRENGTH,
    });
    expect(DEFAULT_BRUSH_RADIUS_REST_LENGTHS).toBe(1.5); // ~1.5 rest lengths
    expect(DEFAULT_BRUSH_STRENGTH).toBe(1.0);
  });

  it('honors overrides and throws on garbage', () => {
    expect(resolveBrushOptions({ radiusRestLengths: 2, strength: 0.4 })).toEqual({
      radiusRestLengths: 2,
      strength: 0.4,
    });
    expect(resolveBrushOptions({ strength: 0 })).toEqual({
      radiusRestLengths: 1.5,
      strength: 0,
    }); // 0 = tuned off, legal
    expect(() => resolveBrushOptions({ radiusRestLengths: 0 })).toThrow();
    expect(() => resolveBrushOptions({ radiusRestLengths: -1 })).toThrow();
    expect(() => resolveBrushOptions({ radiusRestLengths: Number.NaN })).toThrow();
    expect(() => resolveBrushOptions({ strength: -0.1 })).toThrow();
    expect(() => resolveBrushOptions({ strength: Number.POSITIVE_INFINITY })).toThrow();
  });
});

describe('Rope.addImpulse — additive velocity, wake semantics', () => {
  const quiet = { gravity: 0, damping: 1, floorY: null, segmentCount: 4 } as const;

  it('equals setVelocity on a resting rope (bitwise trajectory)', () => {
    const a = createVerletRope({ ...quiet, pin: { x: 0, y: 1, z: 0 } });
    const b = createVerletRope({ ...quiet, pin: { x: 0, y: 1, z: 0 } });
    a.addImpulse(2, 0.5, 0, 0, DT);
    b.setVelocity(2, 0.5, 0, 0, DT);
    for (let k = 0; k < 30; k += 1) {
      a.step(DT);
      b.step(DT);
    }
    const pa: Vec3 = { x: 0, y: 0, z: 0 };
    const pb: Vec3 = { x: 0, y: 0, z: 0 };
    a.readPoint(2, pa);
    b.readPoint(2, pb);
    expect(Object.is(pa.x, pb.x)).toBe(true);
    expect(Object.is(pa.y, pb.y)).toBe(true);
    expect(Object.is(pa.z, pb.z)).toBe(true);
  });

  it('ADDS on top of an existing velocity (a swaying cord keeps its sway)', () => {
    const a = createVerletRope({ ...quiet, pin: { x: 0, y: 1, z: 0 } });
    const b = createVerletRope({ ...quiet, pin: { x: 0, y: 1, z: 0 } });
    a.setVelocity(2, 0.3, 0, 0, DT);
    a.addImpulse(2, 0.2, 0, 0, DT); // total 0.5
    b.setVelocity(2, 0.5, 0, 0, DT);
    a.step(DT);
    b.step(DT);
    const pa: Vec3 = { x: 0, y: 0, z: 0 };
    const pb: Vec3 = { x: 0, y: 0, z: 0 };
    a.readPoint(2, pa);
    b.readPoint(2, pb);
    expect(pa.x).toBeCloseTo(pb.x, 12);
    expect(pa.y).toBe(pb.y);
  });

  it('wakes a sleeping seated rope; a zero impulse changes nothing', () => {
    const rope = createVerletRope({
      segmentCount: 4,
      pin: { x: 0, y: 1.2, z: 0 },
      floorY: 0,
    });
    rope.seat({ index: 4, position: { x: 0.3, y: 1.0, z: 0 } });
    for (let k = 0; k < 600 && !rope.isSettled(); k += 1) rope.step(DT);
    expect(rope.isSettled()).toBe(true);
    rope.addImpulse(2, 0, 0, 0, DT); // zero: nothing added, nothing woken
    expect(rope.isSettled()).toBe(true);
    rope.addImpulse(2, 0.4, 0, 0, DT);
    expect(rope.isSettled()).toBe(false); // an impulse must move the cord
    expect(rope.isFiniteState()).toBe(true);
  });

  it('throws loud on garbage (bad dt, non-finite velocity, bad index)', () => {
    const rope = createVerletRope({ segmentCount: 2, pin: { x: 0, y: 1, z: 0 } });
    expect(() => rope.addImpulse(1, 1, 0, 0, 0)).toThrow();
    expect(() => rope.addImpulse(1, Number.NaN, 0, 0, DT)).toThrow();
    expect(() => rope.addImpulse(9, 1, 0, 0, DT)).toThrow();
  });
});

describe('applyBrushToRope — the per-cord pass (PINS WIN)', () => {
  const options = resolveBrushOptions();

  /** Count rope points inside the halo, optionally including pins. */
  function insideCount(
    rope: ReturnType<typeof createVerletRope>,
    ray: Ray3,
    includePins: boolean,
  ): number {
    const p: Vec3 = { x: 0, y: 0, z: 0 };
    let n = 0;
    for (let i = 0; i < rope.pointCount; i += 1) {
      const isPin =
        (i === rope.pinnedIndex && !rope.anchorReleased) ||
        i === rope.carriedIndex ||
        rope.isEndSeated(i);
      if (!includePins && isPin) continue;
      rope.readPoint(i, p);
      if (distanceToRay(p, ray) < options.radiusRestLengths * rope.segmentLength) n += 1;
    }
    return n;
  }

  it('skips the anchored pin even with the ray EXACTLY on it', () => {
    const rope = createVerletRope({
      segmentCount: 6,
      pin: { x: 0, y: 1.6, z: 0 },
      floorY: null,
    }); // hangs straight down from the pin
    const ray = rayNear(0, 1.6, 0); // the line passes exactly through the pin
    const naive = insideCount(rope, ray, true); // includes the pin
    const freeOnly = insideCount(rope, ray, false);
    expect(naive).toBe(freeOnly + 1); // the pin IS in the halo…
    expect(applyBrushToRope(rope, ray, options, DT)).toBe(freeOnly); // …and is skipped
    expect(rope.isFiniteState()).toBe(true);
  });

  it('skips a seated end and a carried end (pins never impulse)', () => {
    const rope = createVerletRope({
      segmentCount: 6,
      pin: { x: 0, y: 1.6, z: 0 },
      floorY: null,
    });
    const seat = { x: 0.3, y: 1.45, z: 0 };
    rope.seat({ index: 6, position: seat });
    const seatRay = rayNear(seat.x, seat.y, 0); // exactly through the seated end
    expect(insideCount(rope, seatRay, true)).toBe(insideCount(rope, seatRay, false) + 1);
    expect(applyBrushToRope(rope, seatRay, options, DT)).toBe(insideCount(rope, seatRay, false));
    // The carried end: pull the plug and hold it in the hand, brush its spot.
    rope.unseat(6);
    rope.carryEnd(6);
    rope.setPinTarget(6, seat);
    expect(applyBrushToRope(rope, seatRay, options, DT)).toBe(insideCount(rope, seatRay, false));
  });

  it('brushes free points and keeps the pins bitwise fixed', () => {
    const rope = createVerletRope({
      segmentCount: 6,
      pin: { x: 0, y: 1.6, z: 0 },
      floorY: null,
    });
    const seat = { x: 0.3, y: 1.45, z: 0 };
    rope.seat({ index: 6, position: seat });
    // Ray through the sagging middle of the body (between pin and seat).
    const mid: Vec3 = { x: 0, y: 0, z: 0 };
    rope.readPoint(3, mid);
    const count = applyBrushToRope(rope, rayNear(mid.x, mid.y, 0.02), options, DT);
    expect(count).toBeGreaterThan(0);
    rope.step(DT);
    const pinRead: Vec3 = { x: 0, y: 0, z: 0 };
    const endRead: Vec3 = { x: 0, y: 0, z: 0 };
    rope.readPoint(0, pinRead);
    rope.readPoint(6, endRead);
    expect(Object.is(pinRead.x, 0) && Object.is(pinRead.y, 1.6) && Object.is(pinRead.z, 0)).toBe(true);
    expect(Object.is(endRead.x, seat.x) && Object.is(endRead.y, seat.y) && Object.is(endRead.z, seat.z)).toBe(true);
  });

  it('is deterministic and touches nothing for garbage rays / dt', () => {
    const make = () =>
      createVerletRope({ segmentCount: 8, pin: { x: 0, y: 1.6, z: 0 }, floorY: null });
    const a = make();
    const b = make();
    const mid: Vec3 = { x: 0, y: 0, z: 0 };
    a.readPoint(4, mid);
    const ray = rayNear(mid.x, mid.y, 0.03);
    const ca = applyBrushToRope(a, ray, options, DT);
    const cb = applyBrushToRope(b, ray, options, DT);
    expect(ca).toBe(cb);
    expect(ca).toBeGreaterThan(0);
    a.step(DT);
    b.step(DT);
    const pa: Vec3 = { x: 0, y: 0, z: 0 };
    const pb: Vec3 = { x: 0, y: 0, z: 0 };
    for (let i = 0; i <= 8; i += 1) {
      a.readPoint(i, pa);
      b.readPoint(i, pb);
      expect(Object.is(pa.x, pb.x)).toBe(true);
      expect(Object.is(pa.y, pb.y)).toBe(true);
      expect(Object.is(pa.z, pb.z)).toBe(true);
    }
    const nan: Ray3 = {
      origin: { x: Number.NaN, y: 0, z: 5 },
      direction: { x: 0, y: 0, z: -1 },
    };
    expect(applyBrushToRope(make(), nan, options, DT)).toBe(0);
    expect(applyBrushToRope(make(), ray, options, Number.NaN)).toBe(0);
  });
});

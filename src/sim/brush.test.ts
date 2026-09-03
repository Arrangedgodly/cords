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
import type { Vec2 } from './types';

/**
 * T-INT-5 — the PURE half of the passive cursor-brush (2D pivot: the cursor
 * is a POINT in the world plane): the falloff weight, the per-point impulse
 * (distance to the cursor, push-away direction, the bitwise-untouched-outside
 * contract, the deterministic on-cursor fixed-axis push), the options'
 * fail-fast resolution, `Rope.addImpulse`'s additive semantics, and
 * `applyBrushToRope`'s PINS-WIN skip. The world-step semantics (move-only,
 * idempotence across substeps, determinism, multi-cord) live in
 * cordWorldBrush.test.ts.
 */

const R = 0.15; // 1.5 rest lengths × the default 0.1 segment length
const DT = 1 / 120;
const out: BrushImpulseOut = { x: 0, y: 0 };

/** A cursor point `offset` away in +x of (px, py). */
function pointNear(px: number, py: number, offset: number): Vec2 {
  return { x: px + offset, y: py };
}

/** Distance from a point to the cursor (mirrors brushImpulse's geometry). */
function distanceToCursor(p: Vec2, cursor: Vec2): number {
  return Math.hypot(p.x - cursor.x, p.y - cursor.y);
}

describe('brushWeight — the smooth falloff', () => {
  it('is 1 at the cursor, 0 at and beyond the radius, exactly 0.5 at half', () => {
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
  it('pushes away from the cursor with the falloff weight', () => {
    const cursor = pointNear(0, 0, 0); // the cursor AT the origin
    const w = brushImpulse(0.075, 0, cursor, R, out); // half a radius off in +x
    expect(w).toBeCloseTo(0.5, 15);
    expect(out.x).toBeCloseTo(0.5, 15); // unit +x scaled by the weight
    expect(out.y).toBe(0);
  });

  it('leaves the output BITWISE UNTOUCHED outside the radius', () => {
    const cursor = pointNear(0, 0, 0);
    const sx = 1.234567;
    const sy = -98.5;
    out.x = sx;
    out.y = sy;
    expect(brushImpulse(1, 1, cursor, R, out)).toBe(0); // distance ≈ 1.41 » R
    expect(Object.is(out.x, sx)).toBe(true);
    expect(Object.is(out.y, sy)).toBe(true);
  });

  it('magnitude is exactly the weight at the sampled distance, direction unit', () => {
    // A point off diagonally: |out| must equal the weight, and out/|out| must
    // be the unit (p − cursor).
    const p = { x: 0.09, y: -0.06 };
    const cursor = pointNear(0, 0, 0);
    const w = brushImpulse(p.x, p.y, cursor, R, out);
    const d = distanceToCursor(p, cursor);
    expect(w).toBeCloseTo(brushWeight(d, R), 15);
    const mag = Math.hypot(out.x, out.y);
    expect(mag).toBeCloseTo(w, 15);
    const dUnit = Math.hypot(p.x, p.y);
    expect(out.x / w).toBeCloseTo(p.x / dUnit, 12);
    expect(out.y / w).toBeCloseTo(p.y / dUnit, 12);
  });

  it('resolves a point ON the cursor with a deterministic fixed-axis push (never skipped)', () => {
    const cursor = pointNear(0, 0, 0);
    const a = brushImpulse(0, 0, cursor, R, out); // exactly on the cursor
    expect(a).toBe(1); // full weight: the cursor is ON the cord
    // The documented rule: the 0/0 direction resolves to the FIXED +X axis.
    expect(out.x).toBe(1);
    expect(out.y).toBe(0);
    // Deterministic: the same inputs push the same way, bitwise.
    const second: BrushImpulseOut = { x: 7, y: 7 };
    brushImpulse(0, 0, cursor, R, second);
    expect(Object.is(second.x, out.x)).toBe(true);
    expect(Object.is(second.y, out.y)).toBe(true);
  });

  it('is a pure function of (point, cursor): identical inputs, bitwise outputs', () => {
    const cursor = pointNear(0.3, -0.2, 0.05);
    const a: BrushImpulseOut = { x: 0, y: 0 };
    const b: BrushImpulseOut = { x: 0, y: 0 };
    const wa = brushImpulse(0.36, -0.14, cursor, R, a);
    const wb = brushImpulse(0.36, -0.14, cursor, R, b);
    expect(wb).toBe(wa);
    expect(Object.is(a.x, b.x)).toBe(true);
    expect(Object.is(a.y, b.y)).toBe(true);
    expect(wa).toBeGreaterThan(0);
  });

  it('brushes nothing against a degenerate (NaN) cursor', () => {
    const nan: Vec2 = { x: Number.NaN, y: 0 };
    out.x = 3;
    out.y = 3;
    expect(brushImpulse(0, 0, nan, R, out)).toBe(0);
    expect(Object.is(out.x, 3)).toBe(true);
    expect(Object.is(out.y, 3)).toBe(true);
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
    const a = createVerletRope({ ...quiet, pin: { x: 0, y: 1 } });
    const b = createVerletRope({ ...quiet, pin: { x: 0, y: 1 } });
    a.addImpulse(2, 0.5, 0, DT);
    b.setVelocity(2, 0.5, 0, DT);
    for (let k = 0; k < 30; k += 1) {
      a.step(DT);
      b.step(DT);
    }
    const pa: Vec2 = { x: 0, y: 0 };
    const pb: Vec2 = { x: 0, y: 0 };
    a.readPoint(2, pa);
    b.readPoint(2, pb);
    expect(Object.is(pa.x, pb.x)).toBe(true);
    expect(Object.is(pa.y, pb.y)).toBe(true);
  });

  it('ADDS on top of an existing velocity (a swaying cord keeps its sway)', () => {
    const a = createVerletRope({ ...quiet, pin: { x: 0, y: 1 } });
    const b = createVerletRope({ ...quiet, pin: { x: 0, y: 1 } });
    a.setVelocity(2, 0.3, 0, DT);
    a.addImpulse(2, 0.2, 0, DT); // total 0.5
    b.setVelocity(2, 0.5, 0, DT);
    a.step(DT);
    b.step(DT);
    const pa: Vec2 = { x: 0, y: 0 };
    const pb: Vec2 = { x: 0, y: 0 };
    a.readPoint(2, pa);
    b.readPoint(2, pb);
    expect(pa.x).toBeCloseTo(pb.x, 12);
    expect(pa.y).toBe(pb.y);
  });

  it('wakes a sleeping seated rope; a zero impulse changes nothing', () => {
    const rope = createVerletRope({
      segmentCount: 4,
      pin: { x: 0, y: 1.2 },
      floorY: 0,
    });
    rope.seat({ index: 4, position: { x: 0.3, y: 1.0 } });
    for (let k = 0; k < 600 && !rope.isSettled(); k += 1) rope.step(DT);
    expect(rope.isSettled()).toBe(true);
    rope.addImpulse(2, 0, 0, DT); // zero: nothing added, nothing woken
    expect(rope.isSettled()).toBe(true);
    rope.addImpulse(2, 0.4, 0, DT);
    expect(rope.isSettled()).toBe(false); // an impulse must move the cord
    expect(rope.isFiniteState()).toBe(true);
  });

  it('throws loud on garbage (bad dt, non-finite velocity, bad index)', () => {
    const rope = createVerletRope({ segmentCount: 2, pin: { x: 0, y: 1 } });
    expect(() => rope.addImpulse(1, 1, 0, 0)).toThrow();
    expect(() => rope.addImpulse(1, Number.NaN, 0, DT)).toThrow();
    expect(() => rope.addImpulse(9, 1, 0, DT)).toThrow();
  });
});

describe('applyBrushToRope — the per-cord pass (PINS WIN)', () => {
  const options = resolveBrushOptions();

  /** Count rope points inside the halo, optionally including pins. */
  function insideCount(
    rope: ReturnType<typeof createVerletRope>,
    cursor: Vec2,
    includePins: boolean,
  ): number {
    const p: Vec2 = { x: 0, y: 0 };
    let n = 0;
    for (let i = 0; i < rope.pointCount; i += 1) {
      const isPin =
        (i === rope.pinnedIndex && !rope.anchorReleased) ||
        i === rope.carriedIndex ||
        rope.isEndSeated(i);
      if (!includePins && isPin) continue;
      rope.readPoint(i, p);
      if (distanceToCursor(p, cursor) < options.radiusRestLengths * rope.segmentLength) n += 1;
    }
    return n;
  }

  it('skips the anchored pin even with the cursor EXACTLY on it', () => {
    const rope = createVerletRope({
      segmentCount: 6,
      pin: { x: 0, y: 1.6 },
      floorY: null,
    }); // hangs straight down from the pin
    const cursor = pointNear(0, 1.6, 0); // exactly at the pin
    const naive = insideCount(rope, cursor, true); // includes the pin
    const freeOnly = insideCount(rope, cursor, false);
    expect(naive).toBe(freeOnly + 1); // the pin IS in the halo…
    expect(applyBrushToRope(rope, cursor, options, DT)).toBe(freeOnly); // …and is skipped
    expect(rope.isFiniteState()).toBe(true);
  });

  it('skips a seated end and a carried end (pins never impulse)', () => {
    const rope = createVerletRope({
      segmentCount: 6,
      pin: { x: 0, y: 1.6 },
      floorY: null,
    });
    const seat = { x: 0.3, y: 1.45 };
    rope.seat({ index: 6, position: seat });
    const seatCursor = pointNear(seat.x, seat.y, 0); // exactly at the seated end
    expect(insideCount(rope, seatCursor, true)).toBe(insideCount(rope, seatCursor, false) + 1);
    expect(applyBrushToRope(rope, seatCursor, options, DT)).toBe(insideCount(rope, seatCursor, false));
    // The carried end: pull the plug and hold it in the hand, brush its spot.
    rope.unseat(6);
    rope.carryEnd(6);
    rope.setPinTarget(6, seat);
    expect(applyBrushToRope(rope, seatCursor, options, DT)).toBe(insideCount(rope, seatCursor, false));
  });

  it('brushes free points and keeps the pins bitwise fixed', () => {
    const rope = createVerletRope({
      segmentCount: 6,
      pin: { x: 0, y: 1.6 },
      floorY: null,
    });
    const seat = { x: 0.3, y: 1.45 };
    rope.seat({ index: 6, position: seat });
    // Cursor through the sagging middle of the body (between pin and seat).
    const mid: Vec2 = { x: 0, y: 0 };
    rope.readPoint(3, mid);
    const count = applyBrushToRope(rope, pointNear(mid.x, mid.y, 0.02), options, DT);
    expect(count).toBeGreaterThan(0);
    rope.step(DT);
    const pinRead: Vec2 = { x: 0, y: 0 };
    const endRead: Vec2 = { x: 0, y: 0 };
    rope.readPoint(0, pinRead);
    rope.readPoint(6, endRead);
    expect(Object.is(pinRead.x, 0) && Object.is(pinRead.y, 1.6)).toBe(true);
    expect(Object.is(endRead.x, seat.x) && Object.is(endRead.y, seat.y)).toBe(true);
  });

  it('is deterministic and touches nothing for garbage cursors / dt', () => {
    const make = () =>
      createVerletRope({ segmentCount: 8, pin: { x: 0, y: 1.6 }, floorY: null });
    const a = make();
    const b = make();
    const mid: Vec2 = { x: 0, y: 0 };
    a.readPoint(4, mid);
    const cursor = pointNear(mid.x, mid.y, 0.03);
    const ca = applyBrushToRope(a, cursor, options, DT);
    const cb = applyBrushToRope(b, cursor, options, DT);
    expect(ca).toBe(cb);
    expect(ca).toBeGreaterThan(0);
    a.step(DT);
    b.step(DT);
    const pa: Vec2 = { x: 0, y: 0 };
    const pb: Vec2 = { x: 0, y: 0 };
    for (let i = 0; i <= 8; i += 1) {
      a.readPoint(i, pa);
      b.readPoint(i, pb);
      expect(Object.is(pa.x, pb.x)).toBe(true);
      expect(Object.is(pa.y, pb.y)).toBe(true);
    }
    const nan: Vec2 = { x: Number.NaN, y: 0 };
    expect(applyBrushToRope(make(), nan, options, DT)).toBe(0);
    expect(applyBrushToRope(make(), cursor, options, Number.NaN)).toBe(0);
  });
});

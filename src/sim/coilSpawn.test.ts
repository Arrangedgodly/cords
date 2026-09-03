import { describe, expect, it } from 'vitest';
import { coilPoints, DEFAULT_COIL } from './coilSpawn';
import type { Vec2 } from './types';

/**
 * INT-4 — the coiled spawn geometry (2D pivot: the spiral lives in the
 * WORLD PLANE — the v1 horizontal-plane coil became the planar coil the
 * player actually sees). The coil is the START STATE of a
 * grabbed-from-midair cord (the uncoil itself is the sim's), so the tests
 * pin the start state's validity: point 0 exactly at the spawn point (the
 * carried red end is in hand on the spawn frame), every point in a sane
 * neighborhood of it, every chord at or below the natural segment rest (the
 * coil is never born overstretched — its compression IS the spring), all
 * points finite, and bitwise determinism. The production 24×0.1 rope is the
 * main subject; a sweep of segment counts proves the geometry scales.
 */

const SEGMENTS = 24;
const SEG_LEN = 0.1;
const AT: Vec2 = { x: 0.35, y: 1.05 };

function makeShells(n: number): Vec2[] {
  return Array.from({ length: n }, () => ({ x: 0, y: 0 }));
}

function chord(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

describe('INT-4 — coiled spawn geometry', () => {
  it('point 0 is exactly the spawn point; the coil stays within sane bounds of it', () => {
    const pts = makeShells(SEGMENTS + 1);
    coilPoints(AT, SEGMENTS, SEG_LEN, DEFAULT_COIL, pts);
    expect(pts[0].x).toBe(AT.x);
    expect(pts[0].y).toBe(AT.y);
    // Sane bounds: every point within one arc-step of the spiral's outer
    // radius (the arc-length walk may land the last point a step past it) —
    // a coil, not a mess.
    const ds = (DEFAULT_COIL.compression * SEGMENTS * SEG_LEN) / SEGMENTS;
    const bound = DEFAULT_COIL.radiusOuter + ds + 1e-9;
    for (const p of pts) {
      expect(Math.hypot(p.x - AT.x, p.y - AT.y)).toBeLessThanOrEqual(bound);
    }
  });

  it('no NaN anywhere, every chord at or below the natural rest (compressed, never overstretched)', () => {
    const pts = makeShells(SEGMENTS + 1);
    coilPoints(AT, SEGMENTS, SEG_LEN, DEFAULT_COIL, pts);
    for (const p of pts) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    let maxChord = 0;
    for (let i = 0; i < SEGMENTS; i += 1) {
      const c = chord(pts[i], pts[i + 1]);
      expect(c).toBeGreaterThan(0); // no coincident points: no degenerate solve at birth
      maxChord = Math.max(maxChord, c);
    }
    expect(maxChord).toBeLessThanOrEqual(SEG_LEN + 1e-12);
  });

  it('scales across segment counts (4..64): bounds and chord contract hold for every rope size', () => {
    for (const segments of [4, 8, 16, 24, 32, 64]) {
      const pts = makeShells(segments + 1);
      coilPoints(AT, segments, SEG_LEN, DEFAULT_COIL, pts);
      const bound = DEFAULT_COIL.radiusOuter + DEFAULT_COIL.compression * SEG_LEN + 1e-9;
      for (const p of pts) {
        expect(Math.hypot(p.x - AT.x, p.y - AT.y)).toBeLessThanOrEqual(bound);
      }
      for (let i = 0; i < segments; i += 1) {
        expect(chord(pts[i], pts[i + 1])).toBeLessThanOrEqual(SEG_LEN + 1e-12);
      }
    }
  });

  it('deterministic: identical inputs give bitwise-identical points; the cord is not stretched by placement', () => {
    const a = makeShells(SEGMENTS + 1);
    const b = makeShells(SEGMENTS + 1);
    coilPoints(AT, SEGMENTS, SEG_LEN, DEFAULT_COIL, a);
    coilPoints(AT, SEGMENTS, SEG_LEN, DEFAULT_COIL, b);
    for (let i = 0; i <= SEGMENTS; i += 1) {
      expect(a[i].x).toBe(b[i].x);
      expect(a[i].y).toBe(b[i].y);
    }
    // Shell reuse: refilling the same shells overwrites in place (same objects).
    const sameShells = a;
    coilPoints({ x: 1, y: 1 }, SEGMENTS, SEG_LEN, DEFAULT_COIL, sameShells);
    expect(sameShells[0]).toBe(a[0]);
    expect(sameShells[0].x).toBe(1);
  });
});

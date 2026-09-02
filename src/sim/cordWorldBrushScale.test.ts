import { describe, expect, it } from 'vitest';
import { createCordWorldStep } from './cordWorld';
import { createFixedTimestepDriver } from './fixedTimestep';
import type { Ray3, SimInput, SimState, Vec3 } from './types';

/**
 * A11Y-1 — the reduced-motion BRUSH DAMPENING at the world boundary: the
 * per-frame `BrushInput.strengthScale` (composed by main.ts from
 * prefers-reduced-motion) multiplies the configured brush strength, and
 * NOTHING ELSE changes. Pinned here through the production driver:
 *
 * - ABSENT = 1 = the pre-A11Y-1 pass BITWISE (the determinism contract: old
 *   inputs replay byte-for-byte; the seam is purely additive).
 * - Garbage (NaN / -1 / +∞) reads as identity; 0 tunes the frame's brush off
 *   (the strength-0 law) — bitwise untouched.
 * - 0.5 halves the impulse amplitude (roughly — the constraint solve
 *   redistributes, so the pin is ordering + a tolerance band, exactly like
 *   cordWorldBrush's locality pins).
 * - The scale FLIPS honestly frame to frame (the preference can toggle
 *   mid-session): a scale-1 frame after a 0.5 frame brushes at FULL strength
 *   again — the scratch never sticks.
 * - Full determinism with scale changes in the stream.
 */

const DT = 1 / 120;
const FRAME = 1 / 60; // two substeps per frame, like the production driver
const SEGMENTS = 24;
const PIN: Vec3 = { x: 0, y: 1.6, z: 0 };

interface World {
  frame: (extra?: Partial<SimInput>) => SimState;
  state: () => SimState;
}

function makeWorld(): World {
  const step = createCordWorldStep({
    anchor: { pin: PIN, segmentCount: SEGMENTS, floorY: 0 },
    cord: { segmentCount: SEGMENTS, floorY: 0 },
  });
  const driver = createFixedTimestepDriver(step, { timestep: DT, maxSubsteps: 2 });
  let state: SimState = { time: 0, cords: [] };
  return {
    frame: (extra) => {
      state = driver.advance(state, FRAME, { pointerRay: null, ...(extra ?? {}) }).state;
      return state;
    },
    state: () => state,
  };
}

/** A ray parallel to -Z through the drape's mid-hang (same shape as the brush suite). */
const RAY: Ray3 = {
  origin: { x: 0.02, y: 0.8, z: 5 },
  direction: { x: 0, y: 0, z: -1 },
};

function settle(w: World, frames = 600): void {
  for (let i = 0; i < frames; i += 1) w.frame();
}

/** Max |Δ| between two states' cord-0 points (the amplitude probe). */
function maxDisplacement(a: SimState, b: SimState): number {
  const ca = a.cords[0];
  const cb = b.cords[0];
  let max = 0;
  for (let i = 0; i < ca.points.length; i += 1) {
    const dx = ca.points[i].x - cb.points[i].x;
    const dy = ca.points[i].y - cb.points[i].y;
    const dz = ca.points[i].z - cb.points[i].z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > max) max = d;
  }
  return max;
}

function bitwiseEqual(a: SimState, b: SimState): boolean {
  if (a.cords.length !== b.cords.length) return false;
  for (let c = 0; c < a.cords.length; c += 1) {
    const pa = a.cords[c].points;
    const pb = b.cords[c].points;
    if (pa.length !== pb.length) return false;
    for (let i = 0; i < pa.length; i += 1) {
      if (
        !Object.is(pa[i].x, pb[i].x) || !Object.is(pa[i].y, pb[i].y) || !Object.is(pa[i].z, pb[i].z)
      ) {
        return false;
      }
    }
  }
  return true;
}

/**
 * The world's state is MUTATED IN PLACE (`step` returns the same live
 * object), so a before/after comparison inside ONE world needs a deep copy.
 */
function snapshot(state: SimState): SimState {
  return {
    time: state.time,
    cords: state.cords.map((cord) => ({
      id: cord.id,
      points: cord.points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
    })),
  };
}

/** One brush frame at `scale` (undefined = the field absent, the pre-A11Y-1 shape). */
function brushFrame(w: World, move: number, scale?: number): SimState {
  return w.frame({
    brush: {
      move,
      ray: { origin: { ...RAY.origin }, direction: { ...RAY.direction } },
      ...(scale === undefined ? {} : { strengthScale: scale }),
    },
  });
}

describe('A11Y-1 — brush strengthScale at the world boundary', () => {
  it('ABSENT strengthScale is the pre-A11Y-1 pass BITWISE (the determinism contract)', () => {
    const absent = makeWorld();
    const explicitOne = makeWorld();
    settle(absent);
    settle(explicitOne);
    brushFrame(absent, 1);
    brushFrame(explicitOne, 1, 1);
    expect(bitwiseEqual(absent.state(), explicitOne.state())).toBe(true);
    // And neither differs from an INT-5-shaped input in any way: the seam
    // only ever multiplies by 1 on this path.
  });

  it('0.5 halves the impulse amplitude (ordering + band, like the brush suite)', () => {
    const full = makeWorld();
    const half = makeWorld();
    const control = makeWorld();
    settle(full);
    settle(half);
    settle(control);
    const controlSnap = control.state();
    const fullAfter = brushFrame(full, 1, 1);
    const halfAfter = brushFrame(half, 1, 0.5);
    const dFull = maxDisplacement(fullAfter, controlSnap);
    const dHalf = maxDisplacement(halfAfter, controlSnap);
    expect(dFull).toBeGreaterThan(0); // the brush really brushed
    expect(dHalf).toBeGreaterThan(0); // dampened, not removed
    expect(dHalf).toBeLessThan(dFull); // THE DAMPENING
    const ratio = dHalf / dFull;
    expect(ratio).toBeGreaterThan(0.3);
    expect(ratio).toBeLessThan(0.7);
  });

  it('garbage scale (NaN / -1 / +∞) reads as identity, bitwise', () => {
    const absent = makeWorld();
    const nan = makeWorld();
    const negative = makeWorld();
    const infinite = makeWorld();
    for (const w of [absent, nan, negative, infinite]) settle(w);
    brushFrame(absent, 1);
    brushFrame(nan, 1, Number.NaN);
    brushFrame(negative, 1, -1);
    brushFrame(infinite, 1, Number.POSITIVE_INFINITY);
    expect(bitwiseEqual(nan.state(), absent.state())).toBe(true);
    expect(bitwiseEqual(negative.state(), absent.state())).toBe(true);
    expect(bitwiseEqual(infinite.state(), absent.state())).toBe(true);
  });

  it('scale 0 tunes the frame\'s brush off — bitwise untouched (the strength-0 law)', () => {
    const off = makeWorld();
    const control = makeWorld();
    settle(off);
    settle(control);
    const snap = off.state();
    brushFrame(off, 1, 0);
    expect(bitwiseEqual(off.state(), snap)).toBe(true);
    expect(bitwiseEqual(off.state(), control.state())).toBe(true);
  });

  it('the scale FLIPS honestly frame to frame — a later absent/1 frame brushes FULL again', () => {
    // The preference can toggle mid-session, so the effective strength must
    // track the CURRENT frame's field, never stick at an earlier value.
    const later = makeWorld(); // 0.5 first, then absent (back to full)
    const stuck = makeWorld(); // 0.5 first, then 0.5 again
    settle(later);
    settle(stuck);
    brushFrame(later, 1, 0.5);
    brushFrame(stuck, 1, 0.5);
    // Second brush frame, same ray, new counter: `later` sends NO field
    // (main.ts writes 1 when the preference is off), `stuck` stays at 0.5.
    const laterBefore = snapshot(later.state());
    const stuckBefore = snapshot(stuck.state());
    brushFrame(later, 2);
    brushFrame(stuck, 2, 0.5);
    const dLater = maxDisplacement(later.state(), laterBefore);
    const dStuck = maxDisplacement(stuck.state(), stuckBefore);
    expect(dLater).toBeGreaterThan(dStuck); // full strength came back
    const ratio = dStuck / dLater;
    expect(ratio).toBeGreaterThan(0.3);
    expect(ratio).toBeLessThan(0.7);
  });

  it('full determinism with scale changes in the stream (bitwise replay)', () => {
    const run = (): SimState => {
      const w = makeWorld();
      settle(w, 60);
      brushFrame(w, 1, 1);
      w.frame();
      brushFrame(w, 2, 0.5);
      w.frame();
      brushFrame(w, 3); // absent (the preference turned off)
      w.frame();
      brushFrame(w, 4, 0);
      for (let i = 0; i < 30; i += 1) w.frame();
      return w.state();
    };
    const a = run();
    const b = run();
    expect(bitwiseEqual(a, b)).toBe(true);
  });
});

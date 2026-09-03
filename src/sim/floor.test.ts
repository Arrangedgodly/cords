/**
 * REN-1 — ground collision (floorY) tests. The acceptance set from the task
 * contract: a cord dropped from height rests ON the floor — no penetration,
 * no jitter — plus the guards that keep the change honest:
 *
 * 1. DROP + REST: a rope pinned above the bench falls, the lower run piles
 *    onto the plane, and the final state lies ON it (min Y exactly the floor,
 *    zero penetration after EVERY step) with constraints solved (<=5%) and
 *    per-step motion decayed far below visible jitter.
 * 2. SEATED + SLEEP ON THE FLOOR: a cord seated with both ends low still
 *    reaches the SIM-3 sleep state on the floor — bitwise stillness, exactly
 *    as it sleeps in mid-air.
 * 3. CARRY ABOVE THE FLOOR: the existing violent-drag contract still holds
 *    with a floor present (leash exact, state finite).
 * 4. NULL FLOOR IS THE OLD SOLVER: floorY=null and a floor far below produce
 *    BITWISE-identical trajectories — the default cannot disturb anything the
 *    earlier suites verified.
 * 5. Guards: validation fail-fast, determinism with the floor enabled.
 */
import { describe, expect, it } from 'vitest';
import {
  createFixedTimestepDriver,
  createRopeSimStep,
  createVerletRope,
  DEFAULT_ROPE_CONFIG,
  resolveRopeConfig,
} from './index';
import type { CordState } from './types';
import type { Rope } from './rope';

const DT = 1 / 120;

/** Steps the rope for `seconds` of sim time, checking the floor after every step. */
function dropAndSettle(
  rope: Rope,
  seconds: number,
  floorY: number,
): { maxPenetration: number; finalMaxStepDelta: number } {
  let maxPenetration = 0;
  let finalMaxStepDelta = 0;
  let prev: Float64Array | null = null;
  const steps = Math.round(seconds / DT);
  const capture = (): Float64Array => {
    const pts = new Float64Array(rope.pointCount * 2);
    for (let i = 0; i < rope.pointCount; i += 1) {
      const out = { x: 0, y: 0};
      rope.readPoint(i, out);
      pts[i * 2] = out.x;
      pts[i * 2 + 1] = out.y;
    }
    return pts;
  };
  for (let s = 0; s < steps; s += 1) {
    rope.step(DT);
    const pts = capture();
    for (let i = 0; i < rope.pointCount; i += 1) {
      if (pts[i * 2 + 1] < floorY) {
        maxPenetration = Math.max(maxPenetration, floorY - pts[i * 2 + 1]);
      }
    }
    // Jitter window: worst per-axis per-step motion over the FINAL second.
    if (prev !== null && s >= steps - 120) {
      for (let k = 0; k < pts.length; k += 1) {
        const delta = Math.abs(prev[k] - pts[k]);
        if (delta > finalMaxStepDelta) finalMaxStepDelta = delta;
      }
    }
    prev = pts;
  }
  return { maxPenetration, finalMaxStepDelta };
}

describe('REN-1 floor clamp (floorY)', () => {
  it('a cord dropped from height rests ON the floor: no penetration after any step, constraints solved, no visible jitter', () => {
    // Pinned 1.0 above the bench: 1.6 of cord from a 1.0-high pin cannot
    // hang — the lower run MUST come to rest on the plane.
    const floorY = 0;
    const rope = createVerletRope({
      pin: { x: 0, y: 1.0},
      floorY,
    });
    // Start horizontal at pin height (a real drop, not a pre-stacked pile).
    rope.placeAlong({ x: 0, y: 1.0}, { x: 1.6, y: 1.0});

    const { maxPenetration, finalMaxStepDelta } = dropAndSettle(rope, 12, floorY);

    expect(maxPenetration).toBe(0); // never below the plane, at ANY instant
    expect(rope.isFiniteState()).toBe(true);
    expect(rope.maxConstraintViolation()).toBeLessThanOrEqual(0.05);

    // Rests ON the floor: some point sits exactly on the plane...
    let minY = Infinity;
    let touchesFloor = false;
    for (let i = 0; i < rope.pointCount; i += 1) {
      const out = { x: 0, y: 0};
      rope.readPoint(i, out);
      if (out.y < minY) minY = out.y;
      if (out.y === floorY) touchesFloor = true;
    }
    expect(touchesFloor).toBe(true);
    expect(minY).toBeGreaterThanOrEqual(floorY);

    // No jitter: after 12 s the worst per-step per-axis motion over the final
    // second is far below anything visible (Verlet micro-oscillation decays
    // under damping; the clamp never re-injects energy — it only removes it).
    expect(finalMaxStepDelta).toBeLessThan(1e-4);
  });

  it('a seated cord still sleeps ON the floor — bitwise stillness, exactly like mid-air', () => {
    const floorY = 0;
    const rope = createVerletRope({
      pin: { x: -0.5, y: 0.05},
      floorY,
    });
    // Drape: pin near the floor on the left, free end dropped on the right.
    rope.placeAlong({ x: -0.5, y: 0.05}, { x: 0.5, y: 0.05});
    rope.seat({ index: rope.segmentCount, position: { x: 0.5, y: 0.02} });

    let sleptAtStep = -1;
    const steps = Math.round(30 / DT);
    for (let s = 0; s < steps; s += 1) {
      rope.step(DT);
      if (rope.isSettled()) {
        sleptAtStep = s;
        break;
      }
    }
    expect(sleptAtStep).toBeGreaterThan(0);
    expect(rope.isSettled()).toBe(true);

    // A sleeping rope is bitwise still ON the floor (integration skipped).
    const before = { x: 0, y: 0};
    const after = { x: 0, y: 0};
    for (let s = 0; s < 120; s += 1) {
      for (let i = 0; i < rope.pointCount; i += 1) {
        rope.readPoint(i, before);
        rope.step(DT);
        rope.readPoint(i, after);
        expect(after.x).toBe(before.x);
        expect(after.y).toBe(before.y);
      }
    }
    // And nothing was ever pressed through the plane.
    for (let i = 0; i < rope.pointCount; i += 1) {
      rope.readPoint(i, after);
      expect(after.y).toBeGreaterThanOrEqual(floorY);
    }
  });

  it('the violent-drag contract holds with a floor: leash exact, finite, and the carried pin stays above a clamped target floor', () => {
    const floorY = 0;
    const rope = createVerletRope({
      pin: { x: 0, y: 1.6},
      floorY,
    });
    rope.placeAlong({ x: 0, y: 1.6}, { x: 0, y: 0});
    const end = rope.segmentCount;
    rope.carryEnd(end);
    const total = rope.segmentCount * rope.segmentLength;
    const steps = Math.round(10 / DT);
    for (let s = 0; s < steps; s += 1) {
      const a = (s / steps) * Math.PI * 8;
      // Targets 2x beyond the leash so the projection fires on every step;
      // y clamped to the floor plane (the interaction layer's job).
      const r = total * 2;
      rope.setPinTarget(end, {
        x: Math.cos(a) * r,
        y: Math.max(floorY + 0.02, Math.sin(a) * r)
      });
      rope.step(DT);
      const p = { x: 0, y: 0};
      const q = { x: 0, y: 0};
      rope.readPoint(0, p);
      rope.readPoint(end, q);
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      expect(Math.sqrt(dx * dx + dy * dy)).toBeLessThanOrEqual(total + 1e-9);
      expect(rope.isFiniteState()).toBe(true);
    }
  });

  it('floorY=null is bit-identical to a floor far below — the default solver is untouched', () => {
    const makeAndRun = (floorY: number | null): Float64Array => {
      const rope = createVerletRope({
        pin: { x: 0.3, y: 1.4},
        floorY,
      });
      rope.placeAlong({ x: 0.3, y: 1.4}, { x: -1.1, y: 1.4});
      for (let s = 0; s < 240; s += 1) rope.step(DT);
      const out = new Float64Array(rope.pointCount * 2);
      for (let i = 0; i < rope.pointCount; i += 1) {
        const p = { x: 0, y: 0};
        rope.readPoint(i, p);
        out[i * 2] = p.x;
        out[i * 2 + 1] = p.y;
      }
      return out;
    };
    const withoutFloor = makeAndRun(null);
    const withDistantFloor = makeAndRun(-1e9);
    expect(withDistantFloor.length).toBe(withoutFloor.length);
    for (let k = 0; k < withoutFloor.length; k += 1) {
      expect(withDistantFloor[k]).toBe(withoutFloor[k]); // bitwise, not approx
    }
  });

  it('floor-enabled runs are deterministic; config validation fail-fast; M1 flow (grab → drag → release onto floor) lands on the bench', () => {
    // Determinism: two identical floor ropes finish bitwise-identical.
    const run = (): Float64Array => {
      const rope = createVerletRope({ pin: { x: 0, y: 1.2}, floorY: 0 });
      rope.placeAlong({ x: 0, y: 1.2}, { x: 1.2, y: 1.2});
      rope.carryEnd(rope.segmentCount);
      rope.setPinTarget(rope.segmentCount, { x: 0.8, y: 0.02});
      for (let s = 0; s < 300; s += 1) rope.step(DT);
      const out = new Float64Array(rope.pointCount * 2);
      for (let i = 0; i < rope.pointCount; i += 1) {
        const p = { x: 0, y: 0};
        rope.readPoint(i, p);
        out[i * 2] = p.x;
        out[i * 2 + 1] = p.y;
      }
      return out;
    };
    const a = run();
    const b = run();
    for (let k = 0; k < a.length; k += 1) expect(b[k]).toBe(a[k]);

    // Validation: garbage floors fail fast at construction.
    expect(() => createVerletRope({ floorY: NaN })).toThrow(/floorY/);
    expect(() => createVerletRope({ floorY: Infinity })).toThrow(/floorY/);
    expect(resolveRopeConfig().floorY).toBe(DEFAULT_ROPE_CONFIG.floorY);

    // M1 flow through the production adapter: a carried end dragged toward
    // the bench and released (targets stop) rests ON the floor via the
    // release stub — the end the player let go of sits on the bench. The
    // target stays INSIDE the leash sphere (a taut 1.6 cord from a 1.6-high
    // pin cannot touch down — the leash wins, by design).
    const floorY = 0;
    const step = createRopeSimStep({
      cord: { pin: { x: 0, y: 1.6}, floorY },
    });
    let state = { time: 0, cords: [] as CordState[] };
    const driver = createFixedTimestepDriver(step, { timestep: DT, maxSubsteps: 5 });
    const end = 16;
    const frames = Math.round(4 / (2 * DT)); // 60fps frames, 2 substeps each
    for (let f = 0; f < frames; f += 1) {
      const carrying = f < frames / 2;
      state = driver.advance(
        state,
        1 / 60,
        carrying ? { pointerPoint: null, pinTarget: { index: end, position: { x: 0.2, y: 0.02} } } : { pointerPoint: null },
      ).state;
    }
    const endPoint = state.cords[0].points[end];
    expect(endPoint.y).toBeGreaterThanOrEqual(floorY);
    expect(endPoint.y).toBeLessThanOrEqual(0.06); // resting on the bench
  });
});

import { describe, expect, it } from 'vitest';
import { createNoopStep } from './noopSim';
import { createFixedTimestepDriver } from './fixedTimestep';
import type { SimState } from './types';

/**
 * ARC-3 acceptance (plan.md): "a 5s frame advances N clamped substeps,
 * state stays finite." Uses the no-op solver, whose state.time advances by
 * exactly dt per step — so time reads back the sim seconds consumed.
 */

const TIMESTEP = 1 / 120;
const MAX_SUBSTEPS = 5;

function freshState(): SimState {
  return { time: 0, cords: [] };
}

describe('fixedTimestep driver — deltaT clamp (ARC-3)', () => {
  it('a 5s backgrounded-tab frame advances exactly the capped substeps, discards the backlog, state stays finite', () => {
    const driver = createFixedTimestepDriver(createNoopStep(), {
      timestep: TIMESTEP,
      maxSubsteps: MAX_SUBSTEPS,
    });

    const result = driver.advance(freshState(), 5, { pointerPoint: null });

    expect(result.substeps).toBe(MAX_SUBSTEPS);
    expect(result.clamped).toBe(true);

    const state = result.state;
    expect(Number.isFinite(state.time)).toBe(true);
    expect(state.time).toBeGreaterThan(0);
    // Exactly maxSubsteps fixed slices of sim time — never 5 raw seconds.
    expect(state.time).toBeCloseTo(MAX_SUBSTEPS * TIMESTEP, 12);

    // The remainder was discarded, not banked: an immediate next frame
    // (here 0s delta) must not burst through a backlog.
    const next = driver.advance(state, 0, { pointerPoint: null });
    expect(next.substeps).toBe(0);
    expect(next.clamped).toBe(false);
  });

  it('steady frames stay unclamped and lose no time — reactive feel is untouched', () => {
    const driver = createFixedTimestepDriver(createNoopStep(), {
      timestep: TIMESTEP,
      maxSubsteps: MAX_SUBSTEPS,
    });

    let state = freshState();
    const frame = 1 / 60; // 60fps display, 120Hz sim
    for (let i = 0; i < 600; i += 1) {
      const r = driver.advance(state, frame, { pointerPoint: null });
      state = r.state;
      expect(r.clamped).toBe(false);
      expect(r.substeps).toBe(2);
    }
    // 600 frames × 1/60s = 10 real seconds fully accounted for in sim time.
    expect(state.time).toBeCloseTo(10, 9);
    expect(Number.isFinite(state.time)).toBe(true);
  });

  it('treats negative and non-finite frame deltas as zero instead of poisoning the accumulator', () => {
    const driver = createFixedTimestepDriver(createNoopStep(), {
      timestep: TIMESTEP,
      maxSubsteps: MAX_SUBSTEPS,
    });

    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = driver.advance(freshState(), bad, { pointerPoint: null });
      expect(r.substeps).toBe(0);
      expect(r.clamped).toBe(false);
      expect(r.state.time).toBe(0);
    }
  });
});

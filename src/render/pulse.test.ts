/**
 * REN-4 — the chase-pulse clock (pure math, headless). What is pinned here:
 * the phase is LOCKED TO THE SIM CLOCK (a pure function of SimState.time —
 * deterministic, monotone inside a traverse, wrapping at the period), the
 * cadence is tunable, the reduced-motion seam slows it by a fixed factor,
 * and garbage input can never put a NaN in a shader uniform.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PULSE_SPEED,
  REDUCED_PULSE_SPEED_FACTOR,
  pulsePhase,
  resolvePulseSpeed,
} from './pulse';

describe('REN-4 — pulsePhase (the chase light, locked to the sim clock)', () => {
  it('phase 0 at time 0 (the LED parks at its red source)', () => {
    expect(pulsePhase(0)).toBe(0);
  });

  it('advances monotonically with sim time inside a traverse (no backward slips)', () => {
    const dt = 1 / 120; // one production substep
    let prev = pulsePhase(0);
    for (let i = 1; i <= 100; i += 1) {
      const phase = pulsePhase(i * dt);
      expect(phase).toBeGreaterThan(prev);
      expect(phase).toBeLessThan(1);
      prev = phase;
    }
  });

  it('wraps exactly at the period: phase(T) === 0 and the wrap is continuous', () => {
    const period = 1 / DEFAULT_PULSE_SPEED;
    expect(pulsePhase(period)).toBe(0);
    // No hard pop across the wrap: one substep straddling it moves the phase
    // by exactly one substep's worth (≈ dt · speed), not a jump.
    const dt = 1 / 120;
    const justBefore = pulsePhase(period - dt);
    const justAfter = pulsePhase(period + dt);
    const step = dt * DEFAULT_PULSE_SPEED;
    expect(justBefore).toBeCloseTo(1 - step, 12);
    expect(justAfter).toBeCloseTo(step, 12);
  });

  it('deterministic: the same sim instant produces the bitwise-identical phase', () => {
    const t = 12.3456;
    const a = pulsePhase(t);
    const b = pulsePhase(t);
    expect(Object.is(a, b)).toBe(true);
    // Independent option objects with equal contents agree bitwise too.
    expect(Object.is(pulsePhase(t, { speed: 0.6 }), pulsePhase(t))).toBe(true);
    // And across a long adversarial sweep: two identical timelines never drift.
    let x = 0;
    let y = 0;
    for (let i = 0; i < 5000; i += 1) {
      x = pulsePhase(i * (1 / 120) + Math.sin(i) * 1e-9);
      y = pulsePhase(i * (1 / 120) + Math.sin(i) * 1e-9);
      if (!Object.is(x, y)) throw new Error(`phase drift at sample ${i}`);
    }
  });

  it('speed is tunable and exact: double speed ≡ double sim time', () => {
    // 0.25 doubles exactly in binary, so the equality is exact, not close.
    expect(pulsePhase(0.25, { speed: DEFAULT_PULSE_SPEED * 2 })).toBe(
      pulsePhase(0.5, { speed: DEFAULT_PULSE_SPEED }),
    );
    expect(pulsePhase(1, { speed: 1 })).toBe(0); // one traverse per second
    expect(pulsePhase(0.5, { speed: 1 })).toBe(0.5); // mid-cord at half a second
  });

  it('the A11Y-1 seam: reduced motion slows the cadence by the fixed factor', () => {
    const t = 1; // any t not an exact multiple of both periods
    const full = pulsePhase(t);
    const reduced = pulsePhase(t, { reduced: true });
    expect(reduced).toBeCloseTo(full * REDUCED_PULSE_SPEED_FACTOR, 12);
    expect(reduced).toBeLessThan(full);
    // The pulse NEVER disappears under reduced motion — the link's live-state
    // reading survives (A11Y-1 owns the final policy).
    expect(reduced).toBeGreaterThan(0);
  });

  it('total: garbage time and garbage speed can never reach a shader uniform', () => {
    expect(pulsePhase(Number.NaN)).toBe(0);
    expect(pulsePhase(Number.POSITIVE_INFINITY)).toBe(0);
    expect(pulsePhase(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(pulsePhase(-3)).toBeGreaterThanOrEqual(0); // still [0, 1), finite
    expect(pulsePhase(-3)).toBeLessThan(1);
    expect(resolvePulseSpeed({ speed: Number.NaN })).toBe(DEFAULT_PULSE_SPEED);
    expect(resolvePulseSpeed({ speed: 0 })).toBe(DEFAULT_PULSE_SPEED);
    expect(resolvePulseSpeed({ speed: -1 })).toBe(DEFAULT_PULSE_SPEED);
    expect(resolvePulseSpeed(undefined)).toBe(DEFAULT_PULSE_SPEED);
    expect(resolvePulseSpeed({ speed: 2, reduced: true })).toBeCloseTo(
      2 * REDUCED_PULSE_SPEED_FACTOR,
      15,
    );
    // The phase stays finite through it all.
    expect(Number.isFinite(pulsePhase(10, { speed: Number.NaN }))).toBe(true);
  });
});

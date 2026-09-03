/**
 * 2D-3 — THE CHASE CLOCK's own laws (v1 REN-4's pulse suite, translated).
 * Pinned: monotone advance at the production substep, exact wrap with
 * continuity across it (no pop), BITWISE determinism over an adversarial
 * sweep, speed exactness, the reduced-motion ×0.5 factor (incl. through
 * resolvePulseSpeed on a custom speed), and garbage totality — nothing can
 * push a NaN into a paint decision.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PULSE_SPEED,
  REDUCED_PULSE_SPEED_FACTOR,
  pulsePhase,
  resolvePulseSpeed,
} from './pulse';

const SUBSTEP = 1 / 120;

describe('2D-3 pulse clock — the phase law', () => {
  it('is monotone across a production-substep sweep (no backward flicker)', () => {
    let prev = pulsePhase(0);
    let monotoneSpan = 0;
    for (let i = 1; i <= 600; i += 1) {
      const t = i * SUBSTEP;
      const phase = pulsePhase(t);
      if (phase >= prev) monotoneSpan += 1;
      prev = phase;
    }
    // 600 steps × 0.6/s ≈ 3 full traverses — only the wraps may step back.
    expect(monotoneSpan).toBeGreaterThanOrEqual(600 - 3);
  });

  it('wraps exactly at the period with continuity (no pop at the seam)', () => {
    const speed = 0.6;
    const period = 1 / speed;
    const before = pulsePhase(period - SUBSTEP, { speed });
    const at = pulsePhase(period, { speed });
    const after = pulsePhase(period + SUBSTEP, { speed });
    expect(at).toBe(0);
    // The phase leaving the wrap continues the pre-wrap advance, within the
    // wrap's own resolution (one substep of phase).
    expect(after - (before + speed * 2 * SUBSTEP - 1)).toBeLessThan(1e-12);
    expect(Math.abs(before - (1 - speed * SUBSTEP))).toBeLessThan(1e-12);
  });

  it('is BITWISE deterministic over a 5,000-sample adversarial sweep', () => {
    const a: number[] = [];
    const b: number[] = [];
    for (let i = 0; i < 5000; i += 1) {
      const t = i * 0.017 + Math.sin(i * 0.7) * 0.4;
      a.push(pulsePhase(t));
      b.push(pulsePhase(t));
    }
    expect(a).toEqual(b);
  });

  it('speed exactness: double speed ≡ double sim time (phase identity)', () => {
    for (let i = 1; i <= 50; i += 1) {
      const t = i * 0.031;
      expect(pulsePhase(t, { speed: 1.2 })).toBe(pulsePhase(t * 2));
    }
  });

  it('the default cadence is 0.6 traverses/s', () => {
    expect(DEFAULT_PULSE_SPEED).toBe(0.6);
    expect(pulsePhase(1 / 0.6)).toBe(0); // exactly one traverse at 1/0.6 s
  });
});

describe('2D-3 pulse clock — the reduced-motion seam', () => {
  it('slows the cadence ×0.5 exactly (the pulse never stops)', () => {
    expect(REDUCED_PULSE_SPEED_FACTOR).toBe(0.5);
    expect(resolvePulseSpeed({ reduced: true })).toBe(0.3);
    // Phase identity under the factor: half speed at double time ≡ full speed.
    for (let i = 1; i <= 40; i += 1) {
      const t = i * 0.041;
      expect(pulsePhase(t, { reduced: true })).toBe(pulsePhase(t * 0.5));
    }
  });

  it('the ×0.5 factor is real on CUSTOM speeds too (resolvePulseSpeed)', () => {
    expect(resolvePulseSpeed({ speed: 1, reduced: true })).toBe(0.5);
    expect(resolvePulseSpeed({ speed: 2.4 })).toBe(2.4);
    expect(pulsePhase(1, { speed: 1, reduced: true })).toBeCloseTo(0.5, 12);
  });
});

describe('2D-3 pulse clock — garbage totality', () => {
  it('NaN/±∞ time parks the light at the red end (phase 0, never NaN)', () => {
    expect(pulsePhase(Number.NaN)).toBe(0);
    expect(pulsePhase(Number.POSITIVE_INFINITY)).toBe(0);
    expect(pulsePhase(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it('non-finite or ≤0 speed falls back to the default', () => {
    expect(pulsePhase(1, { speed: Number.NaN })).toBe(pulsePhase(1));
    expect(pulsePhase(1, { speed: 0 })).toBe(pulsePhase(1));
    expect(pulsePhase(1, { speed: -3 })).toBe(pulsePhase(1));
    expect(pulsePhase(1, { speed: Number.POSITIVE_INFINITY })).toBe(pulsePhase(1));
  });
});

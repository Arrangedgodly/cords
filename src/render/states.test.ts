/**
 * 2D-3 — THE STATE-PAINT LAWS' own suite (v1 REN-5 + REFINE-1, translated).
 * Pinned to the letter of the world contract: the ticks' tautness window
 * (0.90 appear → 0.985 full, monotone, garbage paints nothing), the grace
 * dim (linear to the 0.22 floor, never brighter, garbage fails visible), and
 * the REFINE-1 blink (steady outside the final 1.5 s, both phases inside,
 * the stepped 3→5 Hz ramp at ~65 % duty, purity, reduced steady, tunables,
 * garbage fails lit).
 */
import { describe, expect, it } from 'vitest';
import {
  GRACE_BLINK_DUTY,
  GRACE_BLINK_FINAL_SECONDS,
  GRACE_BLINK_HZ_END,
  GRACE_BLINK_HZ_START,
  GRACE_DIM_FLOOR,
  TICK_APPEAR_AT,
  TICK_FULL_AT,
  graceBlinkOn,
  graceDimming,
  stretchTickGain,
} from './states';

describe('2D-3 laws — stretchTickGain (the tautness window)', () => {
  it('is 0 at/below the 0.90 appear threshold (rest paints nothing)', () => {
    expect(TICK_APPEAR_AT).toBe(0.9);
    expect(stretchTickGain(0)).toBe(0);
    expect(stretchTickGain(0.2)).toBe(0);
    expect(stretchTickGain(0.6)).toBe(0);
    expect(stretchTickGain(0.9)).toBe(0);
  });

  it('fades in just past the threshold (≤0.01 one percent in)', () => {
    expect(stretchTickGain(0.91)).toBeGreaterThan(0);
    expect(stretchTickGain(0.91)).toBeLessThanOrEqual(0.01);
  });

  it('is monotone across a 501-sample slack→taut sweep, full at ≥0.985', () => {
    expect(TICK_FULL_AT).toBe(0.985);
    let prev = -1;
    for (let i = 0; i <= 500; i += 1) {
      const g = stretchTickGain(0.85 + (i / 500) * 0.15);
      expect(g).toBeGreaterThanOrEqual(prev);
      expect(g).toBeLessThanOrEqual(1);
      prev = g;
    }
    expect(stretchTickGain(0.985)).toBe(1);
    expect(stretchTickGain(1)).toBe(1);
  });

  it('garbage paints nothing', () => {
    expect(stretchTickGain(Number.NaN)).toBe(0);
    expect(stretchTickGain(Number.POSITIVE_INFINITY)).toBe(0);
    expect(stretchTickGain(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe('2D-3 laws — graceDimming (the visible countdown)', () => {
  it('is full at/above the window, linear to the 0.22 floor at expiry', () => {
    expect(GRACE_DIM_FLOOR).toBe(0.22);
    expect(graceDimming(3)).toBe(1);
    expect(graceDimming(5)).toBe(1);
    expect(graceDimming(0)).toBe(GRACE_DIM_FLOOR);
    // Linear at the half-window: floor + (1−floor)·0.5 = 0.61 exactly.
    expect(graceDimming(1.5, 3)).toBeCloseTo(0.61, 12);
    expect(graceDimming(2.0, 3)).toBeCloseTo(1 - (1 - GRACE_DIM_FLOOR) / 3, 12);
  });

  it('is monotone and never brighter than full nor below the floor', () => {
    let prev = 1.001;
    for (let i = 0; i <= 300; i += 1) {
      const f = graceDimming(3 - (i / 300) * 3); // the full window down to expiry
      expect(f).toBeLessThanOrEqual(prev);
      expect(f).toBeGreaterThanOrEqual(GRACE_DIM_FLOOR);
      expect(f).toBeLessThanOrEqual(1);
      prev = f;
    }
  });

  it('garbage fails VISIBLE (factor 1)', () => {
    expect(graceDimming(Number.NaN)).toBe(1);
    expect(graceDimming(Number.POSITIVE_INFINITY)).toBe(1);
    expect(graceDimming(-1)).toBe(1);
    expect(graceDimming(1, Number.NaN)).toBe(1);
    expect(graceDimming(1, 0)).toBe(1);
  });
});

describe('2D-3 laws — graceBlinkOn (REFINE-1: final 1.5s, 3→5Hz stepped)', () => {
  it('is steady LIT outside the final window (incl. the boundary)', () => {
    expect(GRACE_BLINK_FINAL_SECONDS).toBe(1.5);
    expect(graceBlinkOn(3)).toBe(true);
    expect(graceBlinkOn(2)).toBe(true);
    expect(graceBlinkOn(1.5)).toBe(true);
  });

  it('shows BOTH phases inside the window (the flicker is real)', () => {
    let lit = 0;
    let off = 0;
    for (let i = 0; i < 600; i += 1) {
      const remaining = 1.5 - (i / 600) * 1.5;
      if (graceBlinkOn(remaining)) lit += 1;
      else off += 1;
    }
    expect(lit).toBeGreaterThan(0);
    expect(off).toBeGreaterThan(0);
  });

  it('measures ~65% duty over the whole window (the law\'s duty constant)', () => {
    expect(GRACE_BLINK_DUTY).toBe(0.65);
    let lit = 0;
    const N = 3000;
    for (let i = 0; i < N; i += 1) {
      const remaining = 1.5 - (i / N) * 1.5;
      if (graceBlinkOn(remaining)) lit += 1;
    }
    const duty = lit / N;
    expect(duty).toBeGreaterThan(0.6);
    expect(duty).toBeLessThan(0.7);
  });

  it('quickens toward expiry: the late window flickers faster than the early', () => {
    const transitions = (from: number, to: number): number => {
      let flips = 0;
      let prev = graceBlinkOn(from);
      const N = 2400;
      for (let i = 1; i <= N; i += 1) {
        const remaining = from + ((to - from) * i) / N;
        const now = graceBlinkOn(remaining);
        if (now !== prev) flips += 1;
        prev = now;
      }
      return flips;
    };
    // Early window band (1.5→1.0 s remaining ≈ 3 Hz) vs late (0.5→0 ≈ 5 Hz).
    const earlyFlips = transitions(1.5, 1.0);
    const lateFlips = transitions(0.5, 0);
    expect(earlyFlips).toBeGreaterThan(0);
    expect(lateFlips).toBeGreaterThan(earlyFlips * 1.2);
  });

  it('the ramp endpoints are 3 Hz → 5 Hz (the world contract\'s numbers)', () => {
    expect(GRACE_BLINK_HZ_START).toBe(3);
    expect(GRACE_BLINK_HZ_END).toBe(5);
  });

  it('is PURE (same remaining → same answer, forever)', () => {
    for (let i = 0; i < 500; i += 1) {
      const remaining = 1.5 - (i / 500) * 1.5;
      const a = graceBlinkOn(remaining);
      expect(graceBlinkOn(remaining)).toBe(a);
      expect(graceBlinkOn(remaining, { reduced: false })).toBe(a);
    }
  });

  it('reduced motion holds the band STEADY through the whole window', () => {
    for (let i = 0; i <= 240; i += 1) {
      const remaining = 1.5 - (i / 240) * 1.5;
      expect(graceBlinkOn(remaining, { reduced: true })).toBe(true);
    }
  });

  it('the tunables are real (a widened window, custom hz and duty)', () => {
    // A 1 Hz clean-phase window with duty 0.5: the band is lit while the
    // window's elapsed phase is in [0, 0.5) of each second.
    const opts = { finalSeconds: 2, hzStart: 1, hzEnd: 1, duty: 0.5 } as const;
    expect(graceBlinkOn(1.55, opts)).toBe(true); // elapsed 0.45 → phase 0.45 < 0.5
    expect(graceBlinkOn(1.3, opts)).toBe(false); // elapsed 0.7 → phase 0.7 ≥ 0.5
    expect(graceBlinkOn(0.8, opts)).toBe(true); // elapsed 1.2 → phase 0.2
    expect(graceBlinkOn(0.2, opts)).toBe(false); // elapsed 1.8 → phase 0.8
  });

  it('garbage fails LIT (a failing band never reads dead by accident)', () => {
    expect(graceBlinkOn(Number.NaN)).toBe(true);
    expect(graceBlinkOn(Number.POSITIVE_INFINITY)).toBe(true);
    expect(graceBlinkOn(-1)).toBe(true);
  });
});

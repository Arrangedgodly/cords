/**
 * T-REN-5 — STATE PAINT, the pure laws (src/render/states.ts): stretch-tick
 * appearance keyed on tautness (appear past the threshold, vanish at rest),
 * the grace dimming's monotone countdown, and the final-half band blink
 * (sim-clock-deterministic, quickening toward expiry; steady under reduced
 * motion). Pure math — no three.js, no DOM, no clock.
 */
import { describe, expect, it } from 'vitest';
import {
  GRACE_BLINK_DUTY,
  GRACE_BLINK_FINAL_SECONDS,
  GRACE_BLINK_HZ,
  GRACE_BLINK_HZ_URGENT,
  GRACE_DIM_FLOOR,
  TICK_APPEAR_AT,
  TICK_FULL_AT,
  graceBlinkOn,
  graceDimming,
  stretchTickGain,
} from './states';

describe('T-REN-5 — stretchTickGain (the tick appearance law)', () => {
  it('is 0 at and below the appear threshold — rest, pooled, ordinary dangles show no furniture', () => {
    for (const tautness of [0, 0.2, 0.5, 0.75, 0.89, TICK_APPEAR_AT]) {
      expect(stretchTickGain(tautness)).toBe(0);
    }
  });

  it('ramps on past the threshold and reaches full ink at the taut bound (a leash-taut cord)', () => {
    const justPast = stretchTickGain(TICK_APPEAR_AT + 1e-6);
    expect(justPast).toBeGreaterThan(0);
    expect(justPast).toBeLessThan(0.01); // furniture fades in, it does not pop
    const mid = stretchTickGain((TICK_APPEAR_AT + TICK_FULL_AT) / 2);
    expect(mid).toBeGreaterThan(justPast);
    expect(mid).toBeLessThan(1);
    for (const tautness of [TICK_FULL_AT, 0.999, 1.0, 1.2]) {
      expect(stretchTickGain(tautness)).toBe(1);
    }
  });

  it('is monotone in tautness (more stretch, never less ink) across a dense sweep', () => {
    let prev = -1;
    for (let i = 0; i <= 500; i += 1) {
      const tautness = 0.5 + (i / 500) * 0.6;
      const gain = stretchTickGain(tautness);
      expect(gain).toBeGreaterThanOrEqual(prev);
      expect(gain).toBeLessThanOrEqual(1);
      prev = gain;
    }
  });

  it('garbage tautness paints nothing (no NaN can reach a shader uniform)', () => {
    expect(stretchTickGain(Number.NaN)).toBe(0);
    expect(stretchTickGain(Number.POSITIVE_INFINITY)).toBe(0);
    expect(stretchTickGain(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(stretchTickGain(-1)).toBe(0);
  });
});

describe('T-REN-5 — graceDimming (the visible countdown)', () => {
  const WINDOW = 3; // the production grace window

  it('full at the pop, monotone down to the floor at expiry, exactly the floor at 0', () => {
    expect(graceDimming(WINDOW, WINDOW)).toBe(1);
    expect(graceDimming(WINDOW * 2, WINDOW)).toBe(1); // clamped, not brighter
    let prev = 2;
    for (let i = 60; i >= 0; i -= 1) {
      const remaining = (i / 60) * WINDOW; // burns WINDOW → 0
      const dim = graceDimming(remaining, WINDOW);
      expect(dim).toBeGreaterThanOrEqual(GRACE_DIM_FLOOR);
      expect(dim).toBeLessThanOrEqual(1);
      expect(dim).toBeLessThanOrEqual(prev); // monotone toward expiry
      prev = dim;
    }
    expect(graceDimming(0, WINDOW)).toBeCloseTo(GRACE_DIM_FLOOR, 12);
  });

  it('never reaches zero — the popped jack must stay findable to re-plug', () => {
    for (let i = 0; i <= 30; i += 1) {
      expect(graceDimming(i / 30, WINDOW)).toBeGreaterThan(0.2);
    }
  });

  it('linear: the countdown IS the clock (half the window = half the dim range)', () => {
    const half = graceDimming(WINDOW / 2, WINDOW);
    expect(half).toBeCloseTo(GRACE_DIM_FLOOR + (1 - GRACE_DIM_FLOOR) * 0.5, 12);
  });

  it('garbage fails VISIBLE (a broken clock must not dim the scene)', () => {
    expect(graceDimming(Number.NaN, WINDOW)).toBe(1);
    expect(graceDimming(Number.POSITIVE_INFINITY, 0)).toBe(1);
    expect(graceDimming(1, Number.NaN)).toBe(1);
    expect(graceDimming(1, -1)).toBe(1);
    expect(graceDimming(1)).toBeCloseTo( // default window = 3s
      GRACE_DIM_FLOOR + (1 - GRACE_DIM_FLOOR) / 3, 12,
    );
  });
});

describe('T-REN-5 — graceBlinkOn (the low-battery LED law)', () => {
  const WINDOW = 3;

  it('steady LIT through the window until the final half begins', () => {
    for (let t = 0; t < 40; t += 1) {
      const remaining = GRACE_BLINK_FINAL_SECONDS + (t / 40) * (WINDOW - GRACE_BLINK_FINAL_SECONDS);
      expect(graceBlinkOn(remaining, t * 0.137)).toBe(true);
    }
    expect(graceBlinkOn(GRACE_BLINK_FINAL_SECONDS, 1.234)).toBe(true); // at the boundary
  });

  it('blinks inside the final second: deterministic in the sim clock, both phases observed', () => {
    const DT = 1 / 120;
    let lit = 0;
    let total = 0;
    // One full second at sim cadence, remaining held at 0.5.
    for (let i = 0; i < 120; i += 1) {
      const a = graceBlinkOn(0.5, i * DT);
      const b = graceBlinkOn(0.5, i * DT);
      expect(a).toBe(b); // pure: same inputs, same answer
      if (a) lit += 1;
      total += 1;
    }
    expect(lit).toBeGreaterThan(0);
    expect(lit).toBeLessThan(total); // it BLINKS, not glows steady
    // Duty is honest: the lit fraction sits at GRACE_BLINK_DUTY.
    const duty = lit / total;
    expect(Math.abs(duty - GRACE_BLINK_DUTY)).toBeLessThan(0.05);
  });

  it('REFINE-1: the blink already speaks at 1.2s remaining — half the window, not its last second', () => {
    // The critique's ruling: the old law blinked only under 1.0s, so the
    // countdown was invisible at the decision moment. 1.2s remaining sits
    // inside the new 1.5s window (and inside its FIRST half — the base
    // tempo band) and must flicker: both phases over one sim second.
    const DT = 1 / 120;
    let lit = 0;
    for (let i = 0; i < 120; i += 1) {
      if (graceBlinkOn(1.2, i * DT)) lit += 1;
    }
    expect(lit).toBeGreaterThan(0);
    expect(lit).toBeLessThan(120); // blinking, not steady
    expect(graceBlinkOn(1.2 + 1e-9, 0)).toBe(true); // and 1.2s+ is past-free
    expect(graceBlinkOn(GRACE_BLINK_FINAL_SECONDS + 0.01, 7.7)).toBe(true); // steady above the window
  });

  it('REFINE-1: the tempo RAMPS — the window’s last half flickers faster than its first', () => {
    // Falling (lit→off) edges over one sim second at sim cadence: the base
    // band (remaining 1.2, inside the first half of the 1.5s window) blinks
    // at GRACE_BLINK_HZ; the urgent band (remaining 0.4, inside the last
    // half) at GRACE_BLINK_HZ_URGENT. Deterministic pins with one edge of
    // sampling slack.
    const DT = 1 / 120;
    const fallingEdges = (remaining: number): number => {
      let edges = 0;
      let prev = graceBlinkOn(remaining, 0);
      for (let i = 1; i < 120; i += 1) {
        const now = graceBlinkOn(remaining, i * DT);
        if (prev && !now) edges += 1;
        prev = now;
      }
      return edges;
    };
    const base = fallingEdges(1.2);
    const urgent = fallingEdges(0.4);
    expect(base).toBeGreaterThanOrEqual(GRACE_BLINK_HZ - 1);
    expect(base).toBeLessThanOrEqual(GRACE_BLINK_HZ + 1);
    expect(urgent).toBeGreaterThanOrEqual(GRACE_BLINK_HZ_URGENT - 1);
    expect(urgent).toBeLessThanOrEqual(GRACE_BLINK_HZ_URGENT + 1);
    expect(urgent).toBeGreaterThan(base); // dying quickens — the ramp is real
  });

  it('reduced motion NEVER blinks — the band stays steady (the A11Y-1 seam)', () => {
    for (let i = 0; i < 240; i += 1) {
      expect(graceBlinkOn(0.01, i * (1 / 120), { reduced: true })).toBe(true);
    }
    // REFINE-1: the widened window keeps the same seam — every remaining
    // inside it (early band included) holds steady under reduced motion.
    for (const remaining of [1.49, 1.2, 0.75, 0.4, 0.01]) {
      for (let i = 0; i < 120; i += 1) {
        expect(graceBlinkOn(remaining, i * (1 / 120), { reduced: true })).toBe(true);
      }
    }
  });

  it('the blink window and tempo are the tunables they claim to be', () => {
    // A wider window: 1.5s remaining stays steady under finalSeconds 2...
    expect(graceBlinkOn(1.5, 0.0, { finalSeconds: 2 })).toBe(true);
    // ...and 0.5s remaining now blinks — at hz 4, t 0.3 → phase 0.2 (lit),
    // t 0.5 → phase 0.0? No: (0.5·4)%1 = 0.0 (lit); t 0.75 → phase 0.0.
    // Pick clean phases instead: hz 1 → t 0.2 → phase 0.2 < duty (lit);
    // t 0.8 → phase 0.8 ≥ duty 0.65 (off).
    expect(graceBlinkOn(0.5, 0.2, { finalSeconds: 2, hz: 1 })).toBe(true);
    expect(graceBlinkOn(0.5, 0.8, { finalSeconds: 2, hz: 1 })).toBe(false);
  });

  it('garbage fails LIT (no flicker from a broken clock)', () => {
    expect(graceBlinkOn(Number.NaN, 1)).toBe(true);
    expect(graceBlinkOn(0.5, Number.NaN)).toBe(true);
  });
});

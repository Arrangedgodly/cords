/**
 * 2D-3 — THE STATE-PAINT LAWS (v1 REN-5 + REFINE-1, translated to the flat
 * world). Three deterministic functions of the sim's own clock and reads —
 * zero imports, zero wall-clock, zero RNG — so every animated read is a pure
 * function of (sim state, sim time): the same sim instant always paints the
 * same picture, a frozen sim holds its furniture still, and the drives can
 * assert the numbers headless.
 *
 *   stretchTickGain(tautness) — the silkscreen graduation marks fade in above
 *     0.90 tautness (full at 0.985): a leashed carried/awaiting-plug cord
 *     cannot exceed its rest length in arc, so TAUT — the end-to-end span
 *     over the rest total — is the honest reading of "stretched". State-gated
 *     by the composition (linked is the pulse's state; popped/vanishing are
 *     the grace dim's). Neutral ink, never red, never a glow.
 *
 *   graceDimming(remaining, window) — the popped cord's visible countdown:
 *     LINEAR from full at the pop to the 0.22 floor at expiry. The floor
 *     keeps the failing jack findable for the re-plug rescue; the vanish fade
 *     composes MULTIPLICATIVELY on top (the caller's law) so expiry never
 *     flashes back to full. Garbage fails VISIBLE (factor 1).
 *
 *   graceBlinkOn(remaining, …) — the failing jack's band blinks like a dying
 *     battery through the window's FINAL 1.5 s: a 65 %-duty flicker whose
 *     frequency ramps 3 Hz → 5 Hz in STEPS toward expiry (REFINE-1's law:
 *     the countdown signals through half its window and quickens as it dies).
 *     A pure function of the window's own elapsed time (the machine's grace
 *     clock IS the sim clock — `remaining` decreases on it); reduced motion
 *     holds the band STEADY (the dim stays — it is state, not motion).
 */
import { DEFAULT_GRACE_SECONDS } from '../sim';

/** Tautness where the ticks begin to appear. */
export const TICK_APPEAR_AT = 0.9;
/** Tautness where the ticks reach full ink. */
export const TICK_FULL_AT = 0.985;

/** The grace dim's opacity floor (the jack stays re-grabbable). */
export const GRACE_DIM_FLOOR = 0.22;

/** The blink window: the final this-many seconds of the grace. */
export const GRACE_BLINK_FINAL_SECONDS = 1.5;
/** Blink frequency at the window's start (Hz). */
export const GRACE_BLINK_HZ_START = 3;
/** Blink frequency at expiry (Hz) — the ramp's end. */
export const GRACE_BLINK_HZ_END = 5;
/** Fraction of each blink cycle the band stays lit. */
export const GRACE_BLINK_DUTY = 0.65;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * The ticks' ink gain for a tautness read: 0 at/below TICK_APPEAR_AT,
 * smoothstep to 1 at TICK_FULL_AT, monotone between. Garbage paints nothing.
 */
export function stretchTickGain(tautness: number): number {
  if (!Number.isFinite(tautness)) return 0;
  const t = clamp01((tautness - TICK_APPEAR_AT) / (TICK_FULL_AT - TICK_APPEAR_AT));
  return t * t * t; // a gentle ease-in: barely-there at the threshold, full at 0.985
}

/**
 * The popped cord's dim factor: 1 at/above the full window, LINEAR down to
 * GRACE_DIM_FLOOR at expiry, never below, never brighter than 1. Garbage
 * (non-finite or negative window/remaining) fails VISIBLE.
 */
export function graceDimming(remaining: number, window: number = DEFAULT_GRACE_SECONDS): number {
  if (!Number.isFinite(remaining) || remaining < 0 || !Number.isFinite(window) || window <= 0) {
    return 1; // garbage / not-in-a-countdown fails VISIBLE
  }
  if (remaining <= 0) return GRACE_DIM_FLOOR;
  const f = clamp01(remaining / window);
  return GRACE_DIM_FLOOR + (1 - GRACE_DIM_FLOOR) * f;
}

export interface GraceBlinkOptions {
  /** The blink window's width in seconds. Default GRACE_BLINK_FINAL_SECONDS. */
  finalSeconds?: number;
  /** Ramp start Hz. Default GRACE_BLINK_HZ_START. */
  hzStart?: number;
  /** Ramp end Hz. Default GRACE_BLINK_HZ_END. */
  hzEnd?: number;
  /** Duty cycle (lit fraction). Default GRACE_BLINK_DUTY. */
  duty?: number;
  /** prefers-reduced-motion: the band holds STEADY (always lit). */
  reduced?: boolean;
}

/**
 * Whether the failing jack's color band is LIT this instant. Steady (lit)
 * outside the final window; inside it, a stepped 3→5 Hz / 65 %-duty flicker:
 * the window divides into three equal bands of hold-frequency (3, 4, 5 Hz at
 * the defaults), each band's phase accumulated from the previous ones so the
 * flicker is continuous in elapsed time. Purity: the same `remaining` always
 * yields the same answer. Reduced motion or garbage → LIT (the safe read: a
 * failing band must never read dead by accident).
 */
export function graceBlinkOn(remaining: number, options: GraceBlinkOptions = {}): boolean {
  if (options.reduced === true) return true;
  const finalSeconds =
    typeof options.finalSeconds === 'number' && Number.isFinite(options.finalSeconds)
      ? options.finalSeconds
      : GRACE_BLINK_FINAL_SECONDS;
  const hzStart =
    typeof options.hzStart === 'number' && Number.isFinite(options.hzStart) && options.hzStart > 0
      ? options.hzStart
      : GRACE_BLINK_HZ_START;
  const hzEnd =
    typeof options.hzEnd === 'number' && Number.isFinite(options.hzEnd) && options.hzEnd > 0
      ? options.hzEnd
      : GRACE_BLINK_HZ_END;
  const duty =
    typeof options.duty === 'number' && Number.isFinite(options.duty)
      ? clamp01(options.duty)
      : GRACE_BLINK_DUTY;
  if (!Number.isFinite(remaining) || finalSeconds <= 0) return true;
  if (remaining >= finalSeconds) return true; // steady outside the window
  // Elapsed time inside the blink window (0 → finalSeconds toward expiry).
  const elapsed = finalSeconds - Math.max(0, remaining);
  const bands = 3;
  const bandW = finalSeconds / bands;
  const band = Math.min(bands - 1, Math.floor(elapsed / bandW));
  let cyclesBefore = 0;
  for (let j = 0; j < band; j += 1) {
    const hz = hzStart + ((hzEnd - hzStart) * j) / (bands - 1);
    cyclesBefore += bandW * hz;
  }
  const hz = hzStart + ((hzEnd - hzStart) * band) / (bands - 1);
  const phase = cyclesBefore + (elapsed - band * bandW) * hz;
  return phase - Math.floor(phase) < duty;
}

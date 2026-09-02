/**
 * REN-5 — STATE PAINT, the pure math half (Professor X + Thor, REN lane).
 * Three laws, all deterministic functions of (sim state, sim clock) — never
 * wall time, never frame deltas — so the same sim instant always paints the
 * bitwise-identical picture (the pulse.ts discipline, extended):
 *
 * - STRETCH TICKS (`stretchTickGain`): silkscreen REGISTRATION FURNITURE on a
 *   cord being pulled taut — the surface brief's "measurement ticks on a
 *   stretching cord are silkscreen furniture, not decoration." The driver is
 *   the cord's TAUTNESS: the end-to-end span over the cord's total rest
 *   length. A leashed carried/awaiting-plug cord CANNOT exceed its rest
 *   length in arc (the distance constraints relax segments to ≤ rest), so
 *   "stretched" for those states reads as TAUT — the leash moment, "the cord
 *   learning its length." Rest/pooled (≈0.2–0.6): gain 0. Taut (≈1.0): full.
 *   Neutral ink, never red — measurement, not damage.
 * - GRACE DIMMING (`graceDimming`): the popped cord's visible countdown. A
 *   linear ramp of tube opacity from full at the pop to GRACE_DIM_FLOOR at
 *   expiry — linear because the countdown IS the clock; the floor (not zero)
 *   because the popped jack must stay findable to re-plug while it lives,
 *   and the moment the window closes LIFE-2's fade owns the tube from there
 *   (the two compose multiplicatively — no flash back to full at expiry).
 * - GRACE BLINK (`graceBlinkOn`): the popped jack's color band as a
 *   low-battery LED — steady through the window's first half, then flickering
 *   through the FINAL half (duty < 1 so it reads as dying, not strobing), the
 *   tempo stepping up as expiry nears (REFINE-1: the critique ruled the old
 *   final-1s blink illegible at decision time — the countdown now signals
 *   through half its window). Pure in the sim clock: deterministic,
 *   testable. REDUCED MOTION = steady (no blink) — the A11Y-1 seam; the
 *   dimming stays (it is state, not motion).
 *
 * Headless-testable: zero imports, zero DOM, zero three.js.
 */

/**
 * Tautness at which the ticks first appear. 0.90: well clear of every
 * resting drape (a settled cord spans ≈0.2–0.6 of its length), squarely
 * inside a deliberate pull toward the leash.
 */
export const TICK_APPEAR_AT = 0.9;

/** Tautness at which the ticks read at full ink (a leash-taut cord ≈ 0.99+). */
export const TICK_FULL_AT = 0.985;

/**
 * Tube opacity at grace expiry. The cord dims to (not through) this floor:
 * the popped jack has to stay grabbable for the re-plug rescue, and LIFE-2's
 * fade multiplies in from the expiry frame.
 */
export const GRACE_DIM_FLOOR = 0.22;

/**
 * The blink window: the jack's band flickers through the final this-many
 * seconds of the grace — HALF the production ~3s window (REFINE-1: a
 * low-battery LED that only flickers in its last second is illegible at the
 * decision moment; half the window reads as a countdown, not a surprise).
 */
export const GRACE_BLINK_FINAL_SECONDS = 1.5;

/** Blink tempo (Hz) in the blink window's FIRST half (the flicker waking up). */
export const GRACE_BLINK_HZ = 3;

/**
 * Blink tempo (Hz) in the blink window's LAST half — REFINE-1's stepped
 * urgency ramp: the flicker quickens as expiry nears. Stepped, not
 * continuous, on purpose: the phase stays keyed on the absolute sim clock,
 * and a continuously varying rate would swing the phase's time derivative
 * with the (unbounded) sim time itself — aliasing the blink into noise. A
 * two-step band keeps every half a clean pure frequency.
 */
export const GRACE_BLINK_HZ_URGENT = 5;

/** Fraction of each blink period the band stays LIT (dying flicker, not strobe). */
export const GRACE_BLINK_DUTY = 0.65;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * The tick ink gain for a cord's tautness (`span / restTotal`): 0 at/below
 * TICK_APPEAR_AT (rest, pooled, ordinary dangles — no furniture), 1 at/above
 * TICK_FULL_AT, a smoothstep ramp between (appear with stretch, vanish at
 * rest). Garbage tautness (NaN/±∞/negative) paints nothing.
 */
export function stretchTickGain(tautness: number): number {
  if (!Number.isFinite(tautness) || tautness <= TICK_APPEAR_AT) return 0;
  if (tautness >= TICK_FULL_AT) return 1;
  const t = (tautness - TICK_APPEAR_AT) / (TICK_FULL_AT - TICK_APPEAR_AT);
  // smoothstep — the marks fade in as furniture, they do not pop.
  return t * t * (3 - 2 * t);
}

/**
 * The popped cord's tube opacity `graceRemaining` seconds from expiry
 * (`windowSeconds` = the cord's grace window, default 3): full at the pop,
 * GRACE_DIM_FLOOR at expiry, linear (the visible clock) and monotone.
 * Garbage inputs fail VISIBLE (opacity 1): a broken clock must not dim the
 * scene, and the composition only passes the machine's own reads anyway.
 */
export function graceDimming(graceRemaining: number, windowSeconds = 3): number {
  if (!Number.isFinite(graceRemaining) || !Number.isFinite(windowSeconds) || windowSeconds <= 0) {
    return 1;
  }
  return GRACE_DIM_FLOOR + (1 - GRACE_DIM_FLOOR) * clamp01(graceRemaining / windowSeconds);
}

/**
 * Is the popped jack's color band LIT this frame? True (steady) through the
 * window until GRACE_BLINK_FINAL_SECONDS remain, then a deterministic
 * sim-clock flicker — base tempo in the window's first half, the faster
 * GRACE_BLINK_HZ_URGENT in its last (REFINE-1's stepped urgency ramp), at
 * GRACE_BLINK_DUTY. `reduced` (the A11Y-1 seam, wired from
 * prefers-reduced-motion) holds the band STEADY — reduced motion means no
 * blink; the cord's dimming stays (it is state). Garbage inputs fail LIT.
 */
export function graceBlinkOn(
  graceRemaining: number,
  simTime: number,
  options: { reduced?: boolean; hz?: number; finalSeconds?: number; duty?: number } = {},
): boolean {
  if (!Number.isFinite(graceRemaining) || !Number.isFinite(simTime)) return true;
  if (options.reduced === true) return true; // A11Y-1: steady, never blink
  const finalSeconds = Number.isFinite(options.finalSeconds)
    ? (options.finalSeconds as number)
    : GRACE_BLINK_FINAL_SECONDS;
  if (graceRemaining >= finalSeconds) return true; // steady outside the window
  const duty = clamp01(Number.isFinite(options.duty) ? (options.duty as number) : GRACE_BLINK_DUTY);
  // An explicit `hz` is the tuner's FLAT law; the default is the stepped
  // ramp (base through the window's first half, urgent through its last).
  const hz = Number.isFinite(options.hz) && (options.hz as number) > 0
    ? (options.hz as number)
    : graceRemaining > finalSeconds / 2
      ? GRACE_BLINK_HZ
      : GRACE_BLINK_HZ_URGENT;
  const phase = (simTime * hz) % 1;
  return phase < duty;
}

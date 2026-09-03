/**
 * 2D-3 — THE CHASE-PULSE CLOCK (v1 REN-4's law, translated to the flat world).
 * A pure function of the SIM clock — never wall time, never frame deltas —
 * so the same sim instant always produces the bitwise-identical phase, a
 * frozen/sleeping sim holds the light where it is, and a backgrounded tab's
 * discarded substep backlog cannot make the pulse skip ahead (the driver's
 * clamp owns that; this module never sees a wall clock at all).
 *
 * The renderer travels the phase along the DRAWN curve red end → blue end;
 * the gate (exactly `linked`) is the composition's, keyed on the lifecycle's
 * own read per frame — a state change kills the light the same frame.
 *
 * A11Y-1 seam: `reduced` slows the cadence ×0.5 instead of removing the
 * pulse — the chase light IS the "linked" signal, so the live-state reading
 * must survive reduced motion. Zero imports, headless-testable, total over
 * garbage (nothing can put a NaN into a paint decision).
 */

/**
 * Traverses per second of sim time (v1's tunable, carried): ≈1.67 s red→blue,
 * chase-light tempo at bench scale.
 */
export const DEFAULT_PULSE_SPEED = 0.6;

/** Reduced-motion cadence factor (A11Y-1): half speed, never off. */
export const REDUCED_PULSE_SPEED_FACTOR = 0.5;

export interface PulseOptions {
  /** Traverses/s; non-finite or ≤ 0 falls back to the default. */
  speed?: number;
  /** prefers-reduced-motion — halves the resolved speed. */
  reduced?: boolean;
}

/** The resolved cadence after option validation (garbage → defaults). */
export function resolvePulseSpeed(options: PulseOptions = {}): number {
  const base =
    typeof options.speed === 'number' && Number.isFinite(options.speed) && options.speed > 0
      ? options.speed
      : DEFAULT_PULSE_SPEED;
  return options.reduced === true ? base * REDUCED_PULSE_SPEED_FACTOR : base;
}

/**
 * The chase phase in [0, 1): `(t · speed) − floor(t · speed)` — 0 leaving the
 * red jack, wrapping as it sinks into the blue one. Bitwise deterministic in
 * `simTime` for a fixed speed; NaN/±∞ time reads 0 (the light parks at the
 * red end, never NaN).
 */
export function pulsePhase(simTime: number, options: PulseOptions = {}): number {
  if (!Number.isFinite(simTime)) return 0;
  const t = simTime * resolvePulseSpeed(options);
  if (!Number.isFinite(t)) return 0;
  return t - Math.floor(t);
}

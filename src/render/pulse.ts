/**
 * REN-4 — the LINK CHASE PULSE's clock math (pure: no three, no DOM, no
 * wall-clock). The surface brief's memorable moment, restated: "a completed
 * link's pulse sweeping the cord red-to-blue like a chase light LOCKED TO THE
 * SIM CLOCK" — so the phase is a pure function of SimState.time, never of
 * frame deltas or wall time: the same sim instant always produces the same
 * phase (deterministic, headless-testable), a backgrounded tab's discarded
 * backlog cannot make the pulse skip, and a frozen sim holds the pulse still
 * (the chase light is the CLOCK's, not the browser's).
 *
 * Grammar (the drum-machine chase light): ONE LED, one period — the pulse
 * leaves the RED input end, travels the tube, sinks into the BLUE output
 * end, and repeats. Glow exists ONLY on this live state (the REN lane's one
 * sanctioned glow): awaiting-plug / popped / vanishing / carried cords never
 * pulse — the render layer gates on the lifecycle's `linked` state, this
 * module only answers "where is the light at sim time t".
 */

/** Traverses of the cord per second of SIM time (red end → blue end). */
export const DEFAULT_PULSE_SPEED = 0.6;
/**
 * A11Y-1 seam (documented, wired, formalized by A11Y-1): prefers-reduced-
 * motion SLOWS the chase cadence by this factor instead of removing it — the
 * link's live-state reading must survive reduced motion (the pulse IS the
 * "linked" signal); A11Y-1 owns the final policy.
 */
export const REDUCED_PULSE_SPEED_FACTOR = 0.5;

export interface ChasePulseOptions {
  /** Traverses per second of sim time; non-finite or ≤ 0 falls back to the default. */
  speed?: number;
  /** The reduced-motion seam: slows the cadence by REDUCED_PULSE_SPEED_FACTOR. */
  reduced?: boolean;
}

/** Resolves the effective speed (total: garbage can never crash a frame). */
export function resolvePulseSpeed(options?: ChasePulseOptions): number {
  const speed = options?.speed;
  const base =
    typeof speed === 'number' && Number.isFinite(speed) && speed > 0
      ? speed
      : DEFAULT_PULSE_SPEED;
  return base * (options?.reduced === true ? REDUCED_PULSE_SPEED_FACTOR : 1);
}

/**
 * The chase light's position along the cord at sim time `simTimeSeconds`, as
 * a fraction of the red→blue arc: 0 = at the red input jack, 1 = arrived at
 * the blue output jack, wrapping (the light repeats). Deterministic and
 * bitwise-stable: a pure multiply + floor on IEEE-754 doubles. Total: a
 * non-finite time reads as phase 0 (the LED parked at its source), never
 * NaN into a shader uniform.
 */
export function pulsePhase(simTimeSeconds: number, options?: ChasePulseOptions): number {
  const t = simTimeSeconds * resolvePulseSpeed(options);
  if (!Number.isFinite(t)) return 0;
  return t - Math.floor(t); // [0, 1)
}

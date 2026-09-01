import type { SimInput, SimState, SimStep } from './types';

/**
 * ARC-3 — the fixed-timestep driver (accumulator pattern).
 *
 * Thor's lane, carried: deterministic stepping is what keeps reactive feel
 * alive. The sim only ever advances in exact `timestep` slices — never the
 * raw frame delta — so physics behavior is identical whether a frame took
 * 4ms or 40ms, and replayable headless (QA-1 feeds the same driver frames).
 * A backgrounded tab that hands back a 5-second frame must never detonate
 * the sim: the driver runs at most `maxSubsteps` slices and DISCARDS the
 * leftover backlog (no debt burst on the next frame). LIFE-3's
 * visibility-change handling builds directly on this clamp.
 *
 * Pure: no three.js, no DOM, no wall-clock reads (house rule — see
 * types.ts). Time enters only as the `frameDeltaSeconds` argument supplied
 * by the caller (main.ts's rAF loop, or a test).
 */

/** Default sim slice: 120 Hz — tuning knob for SIM-3's settle work. */
export const DEFAULT_TIMESTEP = 1 / 120;

/**
 * Default per-frame slice cap. 5 × (1/120) ≈ 41.7ms of sim time per frame:
 * enough headroom for sustained ~24fps without ever clamping, while a
 * stall/background gap of any size still advances exactly 5 slices.
 */
export const DEFAULT_MAX_SUBSTEPS = 5;

export interface FixedTimestepConfig {
  /** Fixed sim slice in seconds. Every step call gets exactly this dt. */
  timestep: number;
  /** Max substeps executed per `advance` call — the deltaT clamp ceiling. */
  maxSubsteps: number;
}

/** Plain-data telemetry for one frame advance (future HUD/debug/LIFE-3). */
export interface FrameAdvanceResult {
  /** The state after this frame's substeps (same object the step returned). */
  state: SimState;
  /** How many fixed slices this frame actually executed. */
  substeps: number;
  /** True when leftover backlog was discarded at the substep cap. */
  clamped: boolean;
}

export interface FixedTimestepDriver {
  /**
   * Advances `state` through 0..maxSubsteps fixed slices for one frame.
   * Every substep receives the SAME `input` snapshot and exactly
   * `config.timestep` as dt — never the raw frame delta. Fractional
   * remainder (< one slice) is carried into the next call so no time is
   * systematically lost; on clamp, the entire backlog is discarded.
   */
  advance(state: SimState, frameDeltaSeconds: number, input: SimInput): FrameAdvanceResult;
}

/** Validates config at construction — programmer error fails fast, purely. */
function resolveConfig(config: Partial<FixedTimestepConfig> = {}): FixedTimestepConfig {
  const timestep = config.timestep ?? DEFAULT_TIMESTEP;
  const maxSubsteps = config.maxSubsteps ?? DEFAULT_MAX_SUBSTEPS;
  if (!Number.isFinite(timestep) || timestep <= 0) {
    throw new Error(`fixedTimestep: timestep must be a positive finite number, got ${timestep}`);
  }
  if (!Number.isInteger(maxSubsteps) || maxSubsteps < 1) {
    throw new Error(`fixedTimestep: maxSubsteps must be an integer >= 1, got ${maxSubsteps}`);
  }
  return { timestep, maxSubsteps };
}

/**
 * Treated as zero: negative or non-finite frame deltas (clock glitches,
 * first-frame noise) must never poison the accumulator or rewind the sim.
 */
function saneDelta(frameDeltaSeconds: number): number {
  return Number.isFinite(frameDeltaSeconds) && frameDeltaSeconds > 0 ? frameDeltaSeconds : 0;
}

export function createFixedTimestepDriver(
  step: SimStep,
  config: Partial<FixedTimestepConfig> = {},
): FixedTimestepDriver {
  const { timestep, maxSubsteps } = resolveConfig(config);
  let accumulator = 0;

  return {
    advance(state, frameDeltaSeconds, input) {
      accumulator += saneDelta(frameDeltaSeconds);

      let substeps = 0;
      let clamped = false;
      while (accumulator >= timestep) {
        if (substeps === maxSubsteps) {
          // The clamp: a huge frame gap (backgrounded tab) advances at most
          // the capped slices; the remainder is DISCARDED, not banked —
          // otherwise the next frame pays the backlog as another burst.
          clamped = true;
          accumulator = 0;
          break;
        }
        state = step(state, timestep, input);
        accumulator -= timestep;
        substeps += 1;
      }

      return { state, substeps, clamped };
    },
  };
}

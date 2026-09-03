/**
 * 2D-3 — THE FRAME GATE (v1 LIFE-3's visibility law, restored for the Canvas
 * world). Canvas 2D has no context-loss event — a killed context is simply a
 * dead page object the composition rebuilds at `setView` — but the OTHER
 * environmental failure the v1 gate owned still applies verbatim: a HIDDEN
 * page must PAUSE (sim + paint, not just the draw call), because rAF may
 * still tick in an occluded window or under automation while the user sees
 * nothing, and letting the sim run blind drifts the scene's truth away from
 * the last thing the user saw.
 *
 * THE LAW (pure, unit-pinned; the composition only wires events):
 *   hidden  → every beginFrame() reads 'skip' (the sim advances nothing, the
 *             canvas keeps its last painted frame);
 *   visible → EXACTLY ONE 'draw-zero-delta' verdict on the first frame back
 *             (the pause consumed no wall-clock work — there is no backlog to
 *             burn, not even the clamped one; the driver's own 5-substep
 *             clamp remains the second belt), then ordinary 'draw' frames.
 * Causes are idempotent: hiding an already-hidden page is nothing; a resume
 * always yields exactly one zero-delta draw. Counters are the probe the e2e
 * asserts against.
 */

export interface FrameGateCounters {
  framesDrawn: number;
  framesSkipped: number;
  pauses: number;
  resumes: number;
}

/** One frame's verdict from `beginFrame()`. */
export type FrameVerdict =
  /** Ordinary frame: advance with the real frame delta. */
  | 'draw'
  /** The FIRST frame after a resume: advance with delta ZERO (no backlog). */
  | 'draw-zero-delta'
  /** The page is hidden: advance and paint nothing this frame. */
  | 'skip';

export interface FrameGate {
  /** A visibilitychange transition. Returns its own verdict for logging. */
  setHidden(hidden: boolean): 'paused' | 'resumed' | 'none';
  /** The verdict for the rAF frame being composed. */
  beginFrame(): FrameVerdict;
  /** Live counters (the resilience probe). */
  counters(): FrameGateCounters;
  /** Whether the gate currently holds the page paused. */
  paused(): boolean;
}

export function createFrameGate(): FrameGate {
  let hidden = false;
  let resumePending = false;
  const counters: FrameGateCounters = { framesDrawn: 0, framesSkipped: 0, pauses: 0, resumes: 0 };

  return {
    setHidden(next) {
      if (next === hidden) return 'none';
      if (next) {
        hidden = true;
        counters.pauses += 1;
        return 'paused';
      }
      hidden = false;
      resumePending = true;
      counters.resumes += 1;
      return 'resumed';
    },

    beginFrame() {
      if (hidden) {
        counters.framesSkipped += 1;
        return 'skip';
      }
      counters.framesDrawn += 1;
      if (resumePending) {
        resumePending = false;
        return 'draw-zero-delta';
      }
      return 'draw';
    },

    counters() {
      return { ...counters };
    },

    paused() {
      return hidden;
    },
  };
}

/**
 * LIFE-3 — the frame gate: the resilience state machine that decides, every
 * animation tick, whether the loop does work. Two environmental failures own
 * the pauses:
 *
 * - WEBGL CONTEXT LOSS (`webglcontextlost`): the GPU driver dropped the
 *   canvas's context (driver reset, memory pressure, OS sleep). The event
 *   MUST be `preventDefault()`-ed or the browser will never try to restore
 *   it. While lost, rendering is impossible — the gate pauses the whole
 *   tick (the sim too: its state is pure plain data, entirely off the GPU,
 *   so pausing loses nothing and resuming is exact; letting it run blind
 *   would drift the scene's truth away from the last thing the user saw).
 * - HIDDEN TAB (`visibilitychange`): real browsers stop firing rAF while
 *   hidden, and the ARC-3 fixed-timestep driver already clamps the huge
 *   resume delta to `maxSubsteps` — the gate adds the explicit path so the
 *   pause holds even where rAF still ticks (occluded windows, automation),
 *   and so the resume is CLEAN: the first frame after any pause runs with
 *   a ZERO frame delta (the pause consumed no wall-clock work; there is no
 *   backlog to burn, not even the clamped one).
 *
 * Pure decision logic, no DOM: the composition wires the real DOM events in
 * (scene.ts `start()`), and the unit tests (frameGate.test.ts) drive the
 * transitions directly. Every pause→run transition yields exactly ONE
 * `'resume'` verdict — the caller's cue to advance with dt 0 — and then
 * normal `'run'`s. The probe is the verification seam (main.ts exposes it
 * read-only as `window.cords.resilience()`; the e2e drives assert against
 * it after a REAL context kill via WEBGL_lose_context).
 */

/** What the loop should do with this tick. */
export type FrameVerdict =
  /** Paused (context lost or tab hidden): do no work; refresh the delta baseline. */
  'skip'
  /** Normal frame: advance with the real frame delta. */
  | 'run'
  /** The FIRST frame after a pause ended: advance with frame delta 0. */
  | 'resume';

/** Plain-data live status (a fresh snapshot per call; debug/verification seam). */
export interface FrameGateProbe {
  /** True between `webglcontextlost` and `webglcontextrestored`. */
  readonly contextLost: boolean;
  /** True while the document is hidden (`document.hidden`). */
  readonly hidden: boolean;
  /** True when either pause cause holds — the loop skips ticks. */
  readonly paused: boolean;
  /** Ticks that ran (run + resume) since construction. */
  readonly framesDrawn: number;
  /** Ticks skipped while paused since construction. */
  readonly framesSkipped: number;
  /** Real context-loss events observed (transitions into lost). */
  readonly contextLosses: number;
  /** Real context-restore events observed (transitions out of lost). */
  readonly contextRestores: number;
}

/**
 * The restore hook's job is the one thing three.js cannot do itself: re-init
 * APP-level GPU resources. three's own `webglcontextrestored` handler
 * rebuilds its GL state caches, so CPU-backed resources (geometries, canvas
 * textures, programs) re-upload automatically — but anything whose pixels
 * exist ONLY on the GPU (the PMREM environment bake) is gone for good and
 * must be re-baked. scene.ts's hook does exactly that.
 */
export interface FrameGateHooks {
  /** Called once per real context RESTORE (before the loop resumes). */
  onContextRestored?: () => void;
  /** Called once per real context LOSS (after the pause begins). */
  onContextLost?: () => void;
}

export interface FrameGate {
  /**
   * The `webglcontextlost` handler. Always preventDefaults the event (per
   * spec, that is what allows restoration); the loss is counted once per
   * transition (duplicate events are idempotent).
   */
  handleContextLost(event?: { preventDefault?: () => void }): void;
  /**
   * The `webglcontextrestored` handler: ends the loss pause (running the
   * restore hook) and arms one zero-delta resume frame. A restore without a
   * loss is ignored.
   */
  handleContextRestored(): void;
  /** The `visibilitychange` handler's payload: the new `document.hidden`. */
  setVisibility(hidden: boolean): void;
  /**
   * Per-tick verdict (call exactly once per animation tick, in tick order).
   * Maintains the drawn/skipped counters.
   */
  beforeFrame(): FrameVerdict;
  /** A fresh plain snapshot (allocates — a debug seam, never the hot path). */
  probe(): FrameGateProbe;
}

export function createFrameGate(hooks: FrameGateHooks = {}): FrameGate {
  let contextLost = false;
  let hidden = false;
  let resumePending = false;
  let framesDrawn = 0;
  let framesSkipped = 0;
  let contextLosses = 0;
  let contextRestores = 0;

  return {
    handleContextLost(event) {
      // Per the WebGL spec: canceling the loss event is what signals the
      // page will handle restoration — without it the context never comes
      // back. Always done, even for duplicate events.
      event?.preventDefault?.();
      if (contextLost) return; // idempotent: one loss transition, one count
      contextLost = true;
      contextLosses += 1;
      hooks.onContextLost?.();
    },
    handleContextRestored() {
      if (!contextLost) return; // stray restore (or an already-restored race)
      contextLost = false;
      contextRestores += 1;
      hooks.onContextRestored?.(); // re-init app-level GPU resources first…
      resumePending = true; // …then resume with one clean zero-delta frame
    },
    setVisibility(isHidden) {
      if (isHidden === hidden) return;
      hidden = isHidden;
      if (!hidden) resumePending = true; // visible again: one clean resume
    },
    beforeFrame() {
      if (contextLost || hidden) {
        framesSkipped += 1;
        return 'skip';
      }
      framesDrawn += 1;
      if (resumePending) {
        resumePending = false;
        return 'resume';
      }
      return 'run';
    },
    probe() {
      return {
        contextLost,
        hidden,
        paused: contextLost || hidden,
        framesDrawn,
        framesSkipped,
        contextLosses,
        contextRestores,
      };
    },
  };
}

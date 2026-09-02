/**
 * LIFE-3 — the frame gate's resilience law, headless (the gate is pure
 * decision logic; the DOM wiring is scene.ts `start()` and the REAL context
 * kill is the e2e drive). What is pinned here:
 *
 * - context loss pauses every tick; the loss event is ALWAYS preventDefault-ed
 *   (per spec that is what allows restoration), once per event, idempotently
 *   counted;
 * - context restore runs the restore hook (the app-level GPU re-init — the
 *   PMREM re-bake in scene.ts) BEFORE resuming, and the first frame after
 *   the pause is a `resume` (advance with frame delta 0 — no backlog, not
 *   even the clamped one);
 * - the hidden-tab path pauses identically and resumes identically; the two
 *   causes COMPOSE (restore while hidden stays paused; visible again = one
 *   resume, never two);
 * - the drawn/skipped counters are exact tick bookkeeping (the e2e probe).
 */
import { describe, expect, it, vi } from 'vitest';
import { createFrameGate } from './frameGate';

const cancelable = (): { preventDefault: () => void; defaultPrevented: boolean } => {
  const event = { defaultPrevented: false, preventDefault() { event.defaultPrevented = true; } };
  return event;
};

describe('LIFE-3 frameGate — WebGL context loss', () => {
  it('prevents the default on the loss event (the spec contract for restoration)', () => {
    const gate = createFrameGate();
    const event = cancelable();
    gate.handleContextLost(event);
    expect(event.defaultPrevented).toBe(true);
    expect(gate.probe().contextLost).toBe(true);
    expect(gate.probe().contextLosses).toBe(1);
  });

  it('skips every tick while the context is lost and counts them', () => {
    const gate = createFrameGate();
    expect(gate.beforeFrame()).toBe('run'); // alive before the loss
    gate.handleContextLost(cancelable());
    for (let i = 0; i < 5; i += 1) expect(gate.beforeFrame()).toBe('skip');
    const probe = gate.probe();
    expect(probe.paused).toBe(true);
    expect(probe.framesSkipped).toBe(5);
    expect(probe.framesDrawn).toBe(1);
  });

  it('treats duplicate loss events idempotently (one loss transition, still canceled)', () => {
    const gate = createFrameGate();
    gate.handleContextLost(cancelable());
    const again = cancelable();
    gate.handleContextLost(again);
    expect(again.defaultPrevented).toBe(true);
    expect(gate.probe().contextLosses).toBe(1);
  });

  it('restores: runs the restore hook once, then ONE zero-delta resume frame', () => {
    const onContextRestored = vi.fn();
    const gate = createFrameGate({ onContextRestored });
    gate.handleContextLost(cancelable());
    gate.handleContextRestored();
    expect(onContextRestored).toHaveBeenCalledTimes(1);
    expect(gate.probe().contextRestores).toBe(1);
    expect(gate.beforeFrame()).toBe('resume'); // dt 0 — clean resume
    expect(gate.beforeFrame()).toBe('run'); // then normal frames
    expect(gate.probe().paused).toBe(false);
  });

  it('ignores a stray restore without a loss', () => {
    const onContextRestored = vi.fn();
    const gate = createFrameGate({ onContextRestored });
    gate.handleContextRestored();
    expect(onContextRestored).not.toHaveBeenCalled();
    expect(gate.probe().contextRestores).toBe(0);
    expect(gate.beforeFrame()).toBe('run'); // never armed a resume
  });

  it('fires the loss hook once per loss transition', () => {
    const onContextLost = vi.fn();
    const gate = createFrameGate({ onContextLost });
    gate.handleContextLost(cancelable());
    gate.handleContextLost(cancelable());
    expect(onContextLost).toHaveBeenCalledTimes(1);
  });
});

describe('LIFE-3 frameGate — hidden tab (visibilitychange path)', () => {
  it('pauses while hidden and resumes with one zero-delta frame on visible', () => {
    const gate = createFrameGate();
    gate.setVisibility(true);
    expect(gate.beforeFrame()).toBe('skip');
    expect(gate.beforeFrame()).toBe('skip');
    gate.setVisibility(false);
    expect(gate.beforeFrame()).toBe('resume');
    expect(gate.beforeFrame()).toBe('run');
    const probe = gate.probe();
    expect(probe.paused).toBe(false);
    expect(probe.framesSkipped).toBe(2);
  });

  it('ignores redundant visibility reports', () => {
    const gate = createFrameGate();
    gate.setVisibility(true);
    gate.setVisibility(true);
    gate.setVisibility(false);
    expect(gate.beforeFrame()).toBe('resume'); // exactly one, not two
    expect(gate.beforeFrame()).toBe('run');
  });

  it('composes: a context restored while STILL HIDDEN stays paused (one resume at visible)', () => {
    const gate = createFrameGate();
    gate.setVisibility(true);
    gate.handleContextLost(cancelable());
    gate.handleContextRestored(); // GPU is back, the page is not visible
    expect(gate.probe().paused).toBe(true);
    expect(gate.beforeFrame()).toBe('skip');
    gate.setVisibility(false);
    expect(gate.beforeFrame()).toBe('resume'); // ONE clean resume for both
    expect(gate.beforeFrame()).toBe('run');
  });

  it('a loss while hidden does not double-count on the later restore', () => {
    const gate = createFrameGate();
    gate.setVisibility(true);
    gate.handleContextLost(cancelable());
    gate.handleContextRestored();
    gate.setVisibility(false);
    gate.beforeFrame(); // the resume
    gate.handleContextLost(cancelable()); // a SECOND, later loss
    expect(gate.probe().contextLosses).toBe(2);
    expect(gate.probe().paused).toBe(true);
    gate.handleContextRestored();
    expect(gate.beforeFrame()).toBe('resume');
    expect(gate.probe().contextRestores).toBe(2);
  });
});

describe('LIFE-3 frameGate — counters are the probe the e2e asserts against', () => {
  it('bookkeeps drawn/skipped exactly across a full loss+hidden chronology', () => {
    const gate = createFrameGate();
    gate.beforeFrame(); // run (1)
    gate.handleContextLost(cancelable());
    gate.beforeFrame(); // skip
    gate.beforeFrame(); // skip
    gate.handleContextRestored();
    gate.beforeFrame(); // resume (2)
    gate.beforeFrame(); // run (3)
    gate.setVisibility(true);
    gate.beforeFrame(); // skip
    gate.setVisibility(false);
    gate.beforeFrame(); // resume (4)
    const probe = gate.probe();
    expect(probe.framesDrawn).toBe(4);
    expect(probe.framesSkipped).toBe(3);
    expect(probe.contextLosses).toBe(1);
    expect(probe.contextRestores).toBe(1);
    expect(probe.paused).toBe(false);
  });
});

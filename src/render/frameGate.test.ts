/**
 * 2D-3 — THE FRAME GATE's own laws (v1 LIFE-3's visibility discipline,
 * restored for the Canvas world). Pinned: hidden pauses (every frame skips,
 * the sim advances nothing by contract of the composition), a resume yields
 * EXACTLY ONE zero-delta draw frame then ordinary draws, causes are
 * idempotent, and the counters are the honest probe.
 */
import { describe, expect, it } from 'vitest';
import { createFrameGate } from './frameGate';

describe('2D-3 frame gate — the visibility pause law', () => {
  it('an ordinary visible page draws every frame', () => {
    const gate = createFrameGate();
    expect(gate.beginFrame()).toBe('draw');
    expect(gate.beginFrame()).toBe('draw');
    const c = gate.counters();
    expect(c.framesDrawn).toBe(2);
    expect(c.framesSkipped).toBe(0);
    expect(c.pauses).toBe(0);
  });

  it('hidden pauses: every beginFrame reads skip while the page is hidden', () => {
    const gate = createFrameGate();
    expect(gate.setHidden(true)).toBe('paused');
    expect(gate.paused()).toBe(true);
    expect(gate.beginFrame()).toBe('skip');
    expect(gate.beginFrame()).toBe('skip');
    const c = gate.counters();
    expect(c.framesSkipped).toBe(2);
    expect(c.framesDrawn).toBe(0);
    expect(c.pauses).toBe(1);
  });

  it('a resume yields EXACTLY ONE zero-delta draw, then ordinary draws', () => {
    const gate = createFrameGate();
    gate.setHidden(true);
    gate.beginFrame();
    gate.beginFrame();
    expect(gate.setHidden(false)).toBe('resumed');
    expect(gate.paused()).toBe(false);
    expect(gate.beginFrame()).toBe('draw-zero-delta');
    expect(gate.beginFrame()).toBe('draw');
    expect(gate.beginFrame()).toBe('draw');
    const c = gate.counters();
    expect(c.resumes).toBe(1);
    expect(c.framesDrawn).toBe(3);
  });

  it('causes are idempotent (hide-while-hidden and resume-while-visible)', () => {
    const gate = createFrameGate();
    expect(gate.setHidden(true)).toBe('paused');
    expect(gate.setHidden(true)).toBe('none');
    expect(gate.counters().pauses).toBe(1);
    gate.setHidden(false);
    expect(gate.setHidden(false)).toBe('none');
    expect(gate.counters().resumes).toBe(1);
    expect(gate.beginFrame()).toBe('draw-zero-delta');
  });

  it('a re-hide before the resume frame consumes the pending zero-delta', () => {
    const gate = createFrameGate();
    gate.setHidden(true);
    gate.setHidden(false); // resumed — but hidden again BEFORE any frame ran
    gate.setHidden(true);
    expect(gate.beginFrame()).toBe('skip');
    gate.setHidden(false);
    expect(gate.beginFrame()).toBe('draw-zero-delta'); // exactly one, still
    expect(gate.beginFrame()).toBe('draw');
  });

  it('pause/resume cycles compose over a long session (counters honest)', () => {
    const gate = createFrameGate();
    for (let cycle = 0; cycle < 5; cycle += 1) {
      gate.setHidden(true);
      gate.beginFrame();
      gate.beginFrame();
      gate.setHidden(false);
      expect(gate.beginFrame()).toBe('draw-zero-delta');
      gate.beginFrame();
    }
    const c = gate.counters();
    expect(c.pauses).toBe(5);
    expect(c.resumes).toBe(5);
    expect(c.framesSkipped).toBe(10);
    expect(c.framesDrawn).toBe(10);
  });
});

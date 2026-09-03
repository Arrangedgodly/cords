/**
 * 2D-2/2D-3 — RENDERER SMOKE TESTS (Professor X's lane, headless-feasible).
 * The painter is driven against a RECORDING mock of the 2D context (the
 * repo's no-jsdom discipline — no heavy deps): assertions read the draw-call
 * stream, not pixels. What is pinned: DPR-correct sizing, the cached panel
 * blit, one module silkscreen per rectangle, the cord's layered stroke
 * passes, BOTH jacks drawn with the polarity inks, a seated jack's rotation
 * perpendicular to its socket, the deny ring's sim-clock fade — and 2D-3's
 * state furniture: the stretch ticks (tautness window + state gate), the
 * grace dim + band blink (the pure laws composed, reduced steady), the
 * vanish fade × dim multiplication + the shattered jack's disappearance, the
 * chase pulse's overdraw gate + end envelope + the seated band accent, and
 * the pooled shatter debris (count, band polarity, expiry, recycling).
 */
import { describe, expect, it } from 'vitest';
import type { SimState, Vec2 } from '../sim';
import { createStage } from '../world/stage';
import type { SeatPose } from '../world/stage';
import { createView } from '../world/view';
import {
  createRenderer,
  DENY_FADE_SECONDS,
  PLUG_BLUE,
  PLUG_RED,
  PULSE_INK,
} from './renderer';
import type { CordPaint, FrameInput, RendererCanvas } from './renderer';
import { graceBlinkOn, graceDimming } from './states';

type Call = { op: string; args: unknown[] };

/** Records every 2D-context call; property writes land in `props`. */
function makeCtx() {
  const calls: Call[] = [];
  const gradient = { addColorStop: (o: number, c: string) => calls.push({ op: 'addColorStop', args: [o, c] }) };
  const ctx: Record<string, unknown> = {
    calls,
    props: {} as Record<string, unknown>,
    setTransform(...a: number[]) { calls.push({ op: 'setTransform', args: a }); },
    drawImage(...a: unknown[]) { calls.push({ op: 'drawImage', args: a }); },
    fillRect(...a: number[]) { calls.push({ op: 'fillRect', args: a }); },
    strokeRect(...a: number[]) { calls.push({ op: 'strokeRect', args: a }); },
    beginPath() { calls.push({ op: 'beginPath', args: [] }); },
    closePath() { calls.push({ op: 'closePath', args: [] }); },
    moveTo(...a: number[]) { calls.push({ op: 'moveTo', args: a }); },
    lineTo(...a: number[]) { calls.push({ op: 'lineTo', args: a }); },
    arcTo(...a: number[]) { calls.push({ op: 'arcTo', args: a }); },
    arc(...a: number[]) { calls.push({ op: 'arc', args: a }); },
    quadraticCurveTo(...a: number[]) { calls.push({ op: 'quadraticCurveTo', args: a }); },
    fill() { calls.push({ op: 'fill', args: [] }); },
    stroke() { calls.push({ op: 'stroke', args: [] }); },
    save() { calls.push({ op: 'save', args: [] }); },
    restore() { calls.push({ op: 'restore', args: [] }); },
    translate(...a: number[]) { calls.push({ op: 'translate', args: a }); },
    rotate(...a: number[]) { calls.push({ op: 'rotate', args: a }); },
    fillText(...a: unknown[]) { calls.push({ op: 'fillText', args: a }); },
    createLinearGradient(...a: number[]) {
      calls.push({ op: 'createLinearGradient', args: a });
      return gradient;
    },
  };
  // Property assignments (fillStyle etc.) are proxied into props + calls.
  const proxied: Record<string, unknown> = {};
  for (const key of [
    'fillStyle', 'strokeStyle', 'lineWidth', 'lineJoin', 'lineCap',
    'font', 'textBaseline', 'globalAlpha', 'letterSpacing',
  ]) {
    Object.defineProperty(ctx, key, {
      get() { return proxied[key]; },
      set(v: unknown) {
        proxied[key] = v;
        calls.push({ op: `set:${key}`, args: [v] });
      },
    });
  }
  return ctx as unknown as CanvasRenderingContext2D & { calls: Call[] };
}

function makeCanvas(): RendererCanvas & { ctx: ReturnType<typeof makeCtx> } {
  const ctx = makeCtx();
  return {
    width: 0,
    height: 0,
    style: { width: '', height: '' },
    getContext: () => ctx,
    ctx,
  };
}

const VIEW = createView(1440, 838);
const POSE: SeatPose = { x: 0, y: 0, nx: 0, ny: 1, edge: 0, socketX: 0, socketY: 0 };

function straightCordState(): SimState {
  // 25 points slanting down-right — drawable, deterministic.
  const points: Vec2[] = [];
  for (let i = 0; i <= 24; i += 1) points.push({ x: -0.5 + i * 0.04, y: 1.6 - i * 0.03 });
  return { time: 0, cords: [{ id: 1, points }] };
}

describe('2D-2 renderer — sizing + the cached panel', () => {
  it('setView sizes the canvas by CSS × DPR and stamps the transform', () => {
    const canvas = makeCanvas();
    const bg = makeCanvas();
    const renderer = createRenderer(canvas, () => bg);
    renderer.setView(VIEW, 2);
    expect(canvas.width).toBe(2880);
    expect(canvas.height).toBe(1676);
    expect(canvas.style.width).toBe('1440px');
    expect(canvas.style.height).toBe('838px');
    const bgCtx = bg.ctx;
    expect(bgCtx.calls.some((c) => c.op === 'setTransform' && c.args[0] === 2)).toBe(true);
    // The panel cache painted machined tiles at CSS scale after the DPR
    // transform (a 1.2 u tile ≈ 1.2 × scale px).
    const tile = bgCtx.calls.find((c) => c.op === 'fillRect' && typeof c.args[2] === 'number' && Math.abs((c.args[2] as number) - 1.2 * VIEW.scale) < 0.5);
    expect(tile).toBeDefined();
  });

  it('each frame begins with ONE cached-panel blit then paints the modules', () => {
    const canvas = makeCanvas();
    const renderer = createRenderer(canvas, makeCanvas);
    renderer.setView(VIEW, 1);
    canvas.ctx.calls.length = 0; // isolate the frame's own draw stream
    const frame: FrameInput = {
      state: straightCordState(),
      modules: createStage(),
      seatPoseOf: () => null,
      deny: null,
      simTime: 0,
    };
    renderer.draw(frame);
    const calls = canvas.ctx.calls;
    expect(calls[0]?.op).toBe('setTransform');
    expect(calls[1]?.op).toBe('drawImage');
    // Eight silkscreen ids, one per module.
    const labels = calls.filter((c) => c.op === 'fillText').map((c) => c.args[0]);
    expect(labels).toEqual(['01', '02', '03', '04', '05', '06', '07', '08']);
    // Every module paints its candy zone (the keylined soft form).
    const zoneFills = calls.filter(
      (c) => c.op === 'set:fillStyle' && /^#(e8433f|f2903a|f2d43a|2fbd72|3ec8d8|4a7df2|d857c8|e8e3d5)$/.test(String(c.args[0])),
    );
    expect(zoneFills).toHaveLength(8);
  });
});

describe('2D-2 renderer — the cord + the jacks', () => {
  it('one cord draws exactly 3 layered stroke passes (base, rubber, sheen)', () => {
    const canvas = makeCanvas();
    const renderer = createRenderer(canvas, makeCanvas);
    renderer.setView(VIEW, 1);
    canvas.ctx.calls.length = 0;
    renderer.draw({
      state: straightCordState(),
      modules: [], // isolate the cord's own stroke passes
      seatPoseOf: () => null,
      deny: null,
      simTime: 0,
    });
    const calls = canvas.ctx.calls;
    expect(calls.filter((c) => c.op === 'set:lineJoin' && c.args[0] === 'round')).toHaveLength(1);
    // The cord's 3 layered passes are the only strokes wider than a hairline
    // (the jacks' keylines paint at 1px): base → rubber → sheen, descending.
    const widths = calls
      .filter((c) => c.op === 'set:lineWidth')
      .map((c) => c.args[0] as number)
      .filter((w) => w > 2);
    expect(widths).toHaveLength(3);
    expect(widths[0]).toBeGreaterThan(widths[1]);
    expect(widths[1]).toBeGreaterThan(widths[2]);
    // The smoothing pass ran through the points (quadratics present).
    expect(calls.some((c) => c.op === 'quadraticCurveTo')).toBe(true);
  });

  it('both jacks draw with the polarity inks (red end 0, blue end N)', () => {
    const canvas = makeCanvas();
    const renderer = createRenderer(canvas, makeCanvas);
    renderer.setView(VIEW, 1);
    renderer.draw({
      state: straightCordState(),
      modules: createStage(),
      seatPoseOf: () => null,
      deny: null,
      simTime: 0,
    });
    const calls = canvas.ctx.calls;
    expect(calls.some((c) => c.op === 'set:fillStyle' && c.args[0] === PLUG_RED)).toBe(true);
    expect(calls.some((c) => c.op === 'set:fillStyle' && c.args[0] === PLUG_BLUE)).toBe(true);
    // Two jacks = two rotations (one per drawn plug).
    expect(calls.filter((c) => c.op === 'rotate')).toHaveLength(2);
    // The jack anatomy reads: chrome, dark grip, band, boot all painted.
    expect(calls.some((c) => c.op === 'set:fillStyle' && c.args[0] === '#d6dade')).toBe(true);
    expect(calls.some((c) => c.op === 'set:fillStyle' && c.args[0] === '#17181c')).toBe(true);
  });

  it('a seated jack rotates perpendicular to its socket (top edge → +90°)', () => {
    const canvas = makeCanvas();
    const renderer = createRenderer(canvas, makeCanvas);
    renderer.setView(VIEW, 1);
    renderer.draw({
      state: straightCordState(),
      modules: createStage(),
      seatPoseOf: () => POSE, // every end seated on a top edge
      deny: null,
      simTime: 0,
    });
    const rotations = canvas.ctx.calls.filter((c) => c.op === 'rotate');
    // Two jacks + their two machined port insets, all perpendicular.
    expect(rotations).toHaveLength(4);
    for (const r of rotations) {
      // World up (0, 1) is screen (0, −1) → −90°.
      expect(r.args[0] as number).toBeCloseTo(-Math.PI / 2, 9);
    }
    // The socket inset is painted on the module face (the dark port ink).
    const sockets = canvas.ctx.calls.filter((c) => c.op === 'set:fillStyle' && c.args[0] === '#101215');
    expect(sockets.length).toBeGreaterThanOrEqual(2);
  });

  it('a free jack continues the cord tangent (end−neighbor direction)', () => {
    const canvas = makeCanvas();
    const renderer = createRenderer(canvas, makeCanvas);
    renderer.setView(VIEW, 1);
    renderer.draw({
      state: straightCordState(),
      modules: createStage(),
      seatPoseOf: () => null,
      deny: null,
      simTime: 0,
    });
    // End 0's tangent in SCREEN space (y flipped): world (+0.04, −0.03) →
    // screen (+0.04, +0.03) → rotation atan2(0.03, 0.04).
    const first = canvas.ctx.calls.find((c) => c.op === 'rotate');
    expect(first?.args[0] as number).toBeCloseTo(Math.atan2(0.03, 0.04), 6);
  });
});

describe('2D-2 renderer — the deny ring', () => {
  it('a live deny draws a fading Plug Red ring; an expired one draws nothing', () => {
    const canvas = makeCanvas();
    const renderer = createRenderer(canvas, makeCanvas);
    renderer.setView(VIEW, 1);
    const frame: FrameInput = {
      state: { time: 1, cords: [] },
      modules: createStage(),
      seatPoseOf: () => null,
      deny: { x: 0.5, y: 1.0, t: 1 - DENY_FADE_SECONDS / 2 },
      simTime: 1,
    };
    renderer.draw(frame);
    const alphaSets = canvas.ctx.calls.filter((c) => c.op === 'set:globalAlpha');
    expect(alphaSets.length).toBeGreaterThan(0);
    expect(alphaSets[0]?.args[0] as number).toBeGreaterThan(0);
    expect(alphaSets[0]?.args[0] as number).toBeLessThan(1);
    expect(canvas.ctx.calls.some((c) => c.op === 'set:strokeStyle' && c.args[0] === PLUG_RED)).toBe(true);
    // Expired: no alpha pass at all.
    const canvas2 = makeCanvas();
    const renderer2 = createRenderer(canvas2, makeCanvas);
    renderer2.setView(VIEW, 1);
    renderer2.draw({
      state: { time: 10, cords: [] },
      modules: createStage(),
      seatPoseOf: () => null,
      deny: { x: 0.5, y: 1.0, t: 0 },
      simTime: 10,
    });
    expect(canvas2.ctx.calls.filter((c) => c.op === 'set:globalAlpha')).toHaveLength(0);
  });
});

describe('2D-2 renderer — pool bounds (the world cap paints without throwing)', () => {
  it('16 cords × 25 points draw cleanly (the pool covers the cap)', () => {
    const canvas = makeCanvas();
    const renderer = createRenderer(canvas, makeCanvas);
    renderer.setView(VIEW, 1);
    const cords: Array<{ id: number; points: Vec2[] }> = [];
    for (let c = 0; c < 16; c += 1) {
      const points: Vec2[] = [];
      for (let i = 0; i <= 24; i += 1) points.push({ x: -1 + c * 0.13 + i * 0.02, y: 2.2 - i * 0.08 });
      cords.push({ id: c + 1, points });
    }
    expect(() =>
      renderer.draw({
        state: { time: 0, cords },
        modules: createStage(),
        seatPoseOf: () => null,
        deny: null,
        simTime: 0,
      }),
    ).not.toThrow();
    expect(canvas.ctx.calls.filter((c) => c.op === 'rotate')).toHaveLength(32);
  });
});

// =============================================================================
// 2D-3 — the state furniture (paint composed through the FrameInput reads)
// =============================================================================

/** A taut horizontal cord: 25 points at one rest segment each (2.4 u). */
function tautCordState(): SimState {
  const points: Vec2[] = [];
  for (let i = 0; i <= 24; i += 1) points.push({ x: i * 0.1, y: 1.5 });
  return { time: 0, cords: [{ id: 7, points }] };
}

const makePaint = (over: Partial<CordPaint> = {}): CordPaint => ({
  state: 'carried',
  tautness: 1,
  graceRemaining: null,
  failingEnd: null,
  fade: null,
  jackHiddenEnd: null,
  ...over,
});

/** The number of tick marks inside the ticks' single stroked path. */
const tickMarksIn = (calls: Call[]): number => {
  const at = calls.findIndex((c) => c.op === 'set:strokeStyle' && c.args[0] === '#b6bcc6');
  if (at < 0) return 0;
  // Order inside drawTicks: strokeStyle → lineWidth → globalAlpha → beginPath
  // → moveTo/lineTo… → stroke. Count the lineTo run up to the stroke.
  let marks = 0;
  for (let i = at + 1; i < calls.length; i += 1) {
    if (calls[i].op === 'stroke') break;
    if (calls[i].op === 'lineTo') marks += 1;
  }
  return marks;
};

describe('2D-3 renderer — stretch ticks', () => {
  it('a TAUT carried cord carries graduation marks (one per rest segment of measured arc)', () => {
    const canvas = makeCanvas();
    const renderer = createRenderer(canvas, makeCanvas);
    renderer.setView(VIEW, 1);
    renderer.draw({
      state: tautCordState(),
      modules: [],
      seatPoseOf: () => null,
      deny: null,
      simTime: 0,
      paint: [makePaint({ state: 'carried', tautness: 1 })],
    });
    // Measured arc 2.4 u / 0.1 u rest segment → 24 marks (the ruler is
    // honest; float accumulation may fold the last mark onto the end point).
    expect(tickMarksIn(canvas.ctx.calls)).toBeGreaterThanOrEqual(23);
    expect(tickMarksIn(canvas.ctx.calls)).toBeLessThanOrEqual(24);
    expect(renderer.stateProbe().cords[0]?.tickGain).toBe(1);
  });

  it('a slack cord paints NO ticks (furniture appears with tautness, not existence)', () => {
    const canvas = makeCanvas();
    const renderer = createRenderer(canvas, makeCanvas);
    renderer.setView(VIEW, 1);
    renderer.draw({
      state: straightCordState(), // tautness ≈ 0.5
      modules: [],
      seatPoseOf: () => null,
      deny: null,
      simTime: 0,
      paint: [makePaint({ state: 'carried', tautness: 0.5 })],
    });
    expect(tickMarksIn(canvas.ctx.calls)).toBe(0);
    expect(renderer.stateProbe().cords[0]?.tickGain).toBe(0);
  });

  it('ticks fade in with the law and are STATE-GATED off (linked, popped, vanishing)', () => {
    for (const state of ['linked', 'popped', 'vanishing'] as const) {
      const canvas = makeCanvas();
      const renderer = createRenderer(canvas, makeCanvas);
      renderer.setView(VIEW, 1);
      renderer.draw({
        state: tautCordState(),
        modules: [],
        seatPoseOf: () => null,
        deny: null,
        simTime: 0,
        paint: [makePaint({ state, tautness: 1, graceRemaining: 2 })],
      });
      expect(tickMarksIn(canvas.ctx.calls)).toBe(0);
      expect(renderer.stateProbe().cords[0]?.tickGain).toBe(0);
    }
    // Partial gain at 0.93 tautness (inside the fade-in window).
    const canvas = makeCanvas();
    const renderer = createRenderer(canvas, makeCanvas);
    renderer.setView(VIEW, 1);
    renderer.draw({
      state: tautCordState(),
      modules: [],
      seatPoseOf: () => null,
      deny: null,
      simTime: 0,
      paint: [makePaint({ state: 'awaiting-plug', tautness: 0.93 })],
    });
    const gain = renderer.stateProbe().cords[0]?.tickGain ?? 0;
    expect(gain).toBeGreaterThan(0);
    expect(gain).toBeLessThan(1);
    // The tick pass paints at the law's gain (strokeStyle → lineWidth → alpha).
    const at = canvas.ctx.calls.findIndex((c) => c.op === 'set:strokeStyle' && c.args[0] === '#b6bcc6');
    expect(at).toBeGreaterThan(0);
    const alpha = canvas.ctx.calls[at + 2];
    expect(alpha?.op).toBe('set:globalAlpha');
    expect(alpha?.args[0] as number).toBeCloseTo(gain, 9);
  });
});

describe('2D-3 renderer — the popped grace (dim + blink)', () => {
  it('the cord dims by the LAW exactly (linear clock, floor at expiry)', () => {
    for (const [remaining, expected] of [
      [2.4, graceDimming(2.4)],
      [1.5, graceDimming(1.5)],
      [0.6, graceDimming(0.6)],
      [0.0, 0.22],
    ] as const) {
      const canvas = makeCanvas();
      const renderer = createRenderer(canvas, makeCanvas);
      renderer.setView(VIEW, 1);
      renderer.draw({
        state: tautCordState(),
        modules: [],
        seatPoseOf: () => null,
        deny: null,
        simTime: 0,
        paint: [makePaint({ state: 'popped', tautness: 0.5, graceRemaining: remaining, failingEnd: 0 })],
      });
      const probe = renderer.stateProbe().cords[0];
      expect(probe?.dim).toBeCloseTo(expected, 12);
      // The cord's own passes painted at that alpha (dim = the visible clock).
      const alphaSet = canvas.ctx.calls.find((c) => c.op === 'set:globalAlpha' && (c.args[0] as number) < 1);
      expect(alphaSet?.args[0] as number).toBeCloseTo(expected, 12);
    }
  });

  it('the vanish fade composes MULTIPLICATIVELY with the dim (never back up)', () => {
    const canvas = makeCanvas();
    const renderer = createRenderer(canvas, makeCanvas);
    renderer.setView(VIEW, 1);
    renderer.draw({
      state: tautCordState(),
      modules: [],
      seatPoseOf: () => null,
      deny: null,
      simTime: 0,
      paint: [makePaint({ state: 'vanishing', graceRemaining: 0, fade: 0.5, failingEnd: 24, jackHiddenEnd: 24 })],
    });
    // (1 − 0.5) × floor 0.22 = 0.11 — the countdown continues from the dim.
    const alphaSet = canvas.ctx.calls.find((c) => c.op === 'set:globalAlpha' && (c.args[0] as number) < 1);
    expect(alphaSet?.args[0] as number).toBeCloseTo(0.11, 12);
  });

  it('the failing band blinks dark through the final window (both phases, exact inks)', () => {
    // Find an ON and an OFF phase inside the blink window from the law itself.
    let onR = -1;
    let offR = -1;
    for (let i = 0; i <= 600; i += 1) {
      const r = 1.5 - (i / 600) * 1.5;
      if (onR < 0 && graceBlinkOn(r)) onR = r;
      if (offR < 0 && !graceBlinkOn(r)) offR = r;
    }
    expect(onR).toBeGreaterThan(0);
    expect(offR).toBeGreaterThan(0);
    const redFills = (canvas: ReturnType<typeof makeCanvas>): number =>
      canvas.ctx.calls.filter((c) => c.op === 'set:fillStyle' && c.args[0] === PLUG_RED).length;
    const drawPopped = (remaining: number) => {
      const canvas = makeCanvas();
      const renderer = createRenderer(canvas, makeCanvas);
      renderer.setView(VIEW, 1);
      renderer.draw({
        state: tautCordState(),
        modules: [],
        seatPoseOf: () => null,
        deny: null,
        simTime: 0,
        paint: [makePaint({ state: 'popped', tautness: 0.5, graceRemaining: remaining, failingEnd: 0 })],
      });
      return { canvas, renderer };
    };
    // Steady OUTSIDE the window: the band + boot both colored (2 fills).
    const steady = drawPopped(2.4);
    expect(redFills(steady.canvas)).toBe(2);
    expect(steady.renderer.stateProbe().cords[0]?.bandLit).toEqual([true, true]);
    // ON phase: 2 red fills; OFF phase: the band paints the grip's dark ink
    // (only the boot keeps the polarity — 1 fill), exactly the v1 law.
    const on = drawPopped(onR);
    expect(redFills(on.canvas)).toBe(2);
    expect(on.renderer.stateProbe().cords[0]?.bandLit).toEqual([true, true]);
    const off = drawPopped(offR);
    expect(redFills(off.canvas)).toBe(1);
    expect(off.canvas.ctx.calls.some((c) => c.op === 'set:fillStyle' && c.args[0] === '#17181c')).toBe(true);
    expect(off.renderer.stateProbe().cords[0]?.bandLit).toEqual([false, true]);
  });

  it('reduced motion holds the band steady (the dim stays — state, not motion)', () => {
    let offR = -1;
    for (let i = 0; i <= 600; i += 1) {
      const r = 1.5 - (i / 600) * 1.5;
      if (offR < 0 && !graceBlinkOn(r)) {
        offR = r;
        break;
      }
    }
    const canvas = makeCanvas();
    const renderer = createRenderer(canvas, makeCanvas);
    renderer.setView(VIEW, 1);
    renderer.draw({
      state: tautCordState(),
      modules: [],
      seatPoseOf: () => null,
      deny: null,
      simTime: 0,
      reducedMotion: true,
      paint: [makePaint({ state: 'popped', tautness: 0.5, graceRemaining: offR, failingEnd: 0 })],
    });
    expect(canvas.ctx.calls.filter((c) => c.op === 'set:fillStyle' && c.args[0] === PLUG_RED).length).toBe(2);
    expect(renderer.stateProbe().cords[0]?.bandLit).toEqual([true, true]);
    expect(renderer.stateProbe().cords[0]?.dim).toBeCloseTo(graceDimming(offR), 12);
  });

  it('a re-plug restores full opacity INSTANTLY (LEDs back on)', () => {
    const canvas = makeCanvas();
    const renderer = createRenderer(canvas, makeCanvas);
    renderer.setView(VIEW, 1);
    renderer.draw({
      state: tautCordState(),
      modules: [],
      seatPoseOf: () => null,
      deny: null,
      simTime: 0,
      paint: [makePaint({ state: 'linked', tautness: 0.9 })],
    });
    expect(renderer.stateProbe().cords[0]?.dim).toBe(1);
    expect(canvas.ctx.calls.filter((c) => c.op === 'set:globalAlpha' && (c.args[0] as number) < 1)).toHaveLength(0);
  });

  it('the shattered end\'s jack is GONE (the debris owns it)', () => {
    const canvas = makeCanvas();
    const renderer = createRenderer(canvas, makeCanvas);
    renderer.setView(VIEW, 1);
    renderer.draw({
      state: tautCordState(),
      modules: [],
      seatPoseOf: () => null,
      deny: null,
      simTime: 0,
      paint: [makePaint({ state: 'vanishing', graceRemaining: 0, fade: 0.2, failingEnd: 24, jackHiddenEnd: 24 })],
    });
    // One jack drawn (was two) — the failing end shattered.
    expect(canvas.ctx.calls.filter((c) => c.op === 'rotate')).toHaveLength(1);
    expect(renderer.stateProbe().cords[0]?.jackHidden).toBe(true);
  });
});

describe('2D-3 renderer — the chase pulse (the one glow)', () => {
  const linkedFrame = (over: Partial<FrameInput> = {}): FrameInput => ({
    state: tautCordState(),
    modules: [],
    seatPoseOf: () => null,
    deny: null,
    simTime: 10,
    paint: [makePaint({ state: 'linked', tautness: 1 })],
    pulsePhase: 0.5,
    ...over,
  });

  it('a linked cord carries the amber LED segment mid-curve; the probe reads the road', () => {
    const canvas = makeCanvas();
    const renderer = createRenderer(canvas, makeCanvas);
    renderer.setView(VIEW, 1);
    renderer.draw(linkedFrame());
    const amberStroke = canvas.ctx.calls.some((c) => c.op === 'set:strokeStyle' && c.args[0] === PULSE_INK);
    expect(amberStroke).toBe(true);
    const probe = renderer.pulseProbe();
    expect(probe.phase).toBeCloseTo(0.5, 12);
    expect(probe.cords).toHaveLength(1);
    expect(probe.cords[0]?.gain).toBe(1);
    // Mid-travel at phase 0.5: the LED's screen center sits mid-cord.
    const v = VIEW;
    const midScreen = v.toScreen(1.2, 1.5, { x: 0, y: 0 });
    expect(probe.cords[0]?.cx).toBeCloseTo(midScreen.x, 0);
    expect(probe.cords[0]?.cy).toBeCloseTo(midScreen.y, 0);
  });

  it('the envelope ramps at the ends (leaving red, sinking into blue)', () => {
    const canvas = makeCanvas();
    const renderer = createRenderer(canvas, makeCanvas);
    renderer.setView(VIEW, 1);
    renderer.draw(linkedFrame({ pulsePhase: 0.01 }));
    const at = canvas.ctx.calls.findIndex((c) => c.op === 'set:strokeStyle' && c.args[0] === PULSE_INK);
    expect(at).toBeGreaterThan(0);
    expect(canvas.ctx.calls[at + 2]?.op).toBe('set:globalAlpha');
    expect(canvas.ctx.calls[at + 2]?.args[0] as number).toBeLessThan(0.2);
  });

  it('the gate is EXACTLY linked: awaiting-plug/popped/vanishing cords never glow', () => {
    for (const state of ['carried', 'awaiting-plug', 'popped', 'vanishing'] as const) {
      const canvas = makeCanvas();
      const renderer = createRenderer(canvas, makeCanvas);
      renderer.setView(VIEW, 1);
      renderer.draw(
        linkedFrame({ paint: [makePaint({ state, tautness: 1, graceRemaining: state === 'popped' ? 2 : null })] }),
      );
      expect(canvas.ctx.calls.some((c) => c.op === 'set:strokeStyle' && c.args[0] === PULSE_INK)).toBe(false);
      expect(renderer.pulseProbe().cords).toHaveLength(0);
    }
    // No phase at all (the seam absent) → no pulse either.
    const canvas = makeCanvas();
    const renderer = createRenderer(canvas, makeCanvas);
    renderer.setView(VIEW, 1);
    renderer.draw(linkedFrame({ pulsePhase: null }));
    expect(canvas.ctx.calls.some((c) => c.op === 'set:strokeStyle' && c.args[0] === PULSE_INK)).toBe(false);
  });

  it('SAME-FRAME gate flip: the light dies the draw the link does', () => {
    const canvas = makeCanvas();
    const renderer = createRenderer(canvas, makeCanvas);
    renderer.setView(VIEW, 1);
    renderer.draw(linkedFrame());
    expect(renderer.pulseProbe().cords[0]?.gain).toBe(1);
    canvas.ctx.calls.length = 0;
    renderer.draw(linkedFrame({ paint: [makePaint({ state: 'awaiting-plug', tautness: 1 })] }));
    expect(canvas.ctx.calls.some((c) => c.op === 'set:strokeStyle' && c.args[0] === PULSE_INK)).toBe(false);
    expect(renderer.pulseProbe().cords).toHaveLength(0);
  });

  it('a linked SEATED band lifts ×1.5 within its hue (the lit-ink accent)', () => {
    const canvas = makeCanvas();
    const renderer = createRenderer(canvas, makeCanvas);
    renderer.setView(VIEW, 1);
    renderer.draw(linkedFrame({ seatPoseOf: () => POSE })); // both ends seated
    // liftHex('#c22e26', 1.5) = '#ff4539'; liftHex('#2e58de', 1.5) = '#4584ff'.
    expect(canvas.ctx.calls.some((c) => c.op === 'set:fillStyle' && c.args[0] === '#ff4539')).toBe(true);
    expect(canvas.ctx.calls.some((c) => c.op === 'set:fillStyle' && c.args[0] === '#4584ff')).toBe(true);
    // Awaiting-plug: no accent anywhere.
    const canvas2 = makeCanvas();
    const renderer2 = createRenderer(canvas2, makeCanvas);
    renderer2.setView(VIEW, 1);
    renderer2.draw(
      linkedFrame({
        paint: [makePaint({ state: 'awaiting-plug', tautness: 1 })],
        seatPoseOf: () => POSE,
      }),
    );
    expect(canvas2.ctx.calls.some((c) => c.op === 'set:fillStyle' && c.args[0] === '#ff4539')).toBe(false);
  });
});

describe('2D-3 renderer — the shatter debris (pooled)', () => {
  const burstFrame = (simTime: number): FrameInput => ({
    state: { time: simTime, cords: [] },
    modules: [],
    seatPoseOf: () => null,
    deny: null,
    simTime,
  });

  it('a burst paints 18 steel shards + the band shard ink (the polarity reads)', () => {
    const canvas = makeCanvas();
    const renderer = createRenderer(canvas, makeCanvas);
    renderer.setView(VIEW, 1);
    renderer.burst({ x: 0.5, y: 0.05 }, 'blue', 1);
    renderer.draw(burstFrame(1.05));
    const probe = renderer.stateProbe();
    expect(probe.shards).toBe(20); // 18 steel + 2 band pieces
    const fills = canvas.ctx.calls.filter((c) => c.op === 'set:fillStyle').map((c) => String(c.args[0]));
    expect(fills).toContain(PLUG_BLUE); // the failing band's own shard
    expect(fills.some((f) => /^#2[03][0-9a-f]{4}$/.test(f))).toBe(true); // dark steel inks
    // Every shard rotates as it flies (a real burst, not a stamp).
    expect(canvas.ctx.calls.filter((c) => c.op === 'rotate').length).toBeGreaterThanOrEqual(20);
  });

  it('a red burst names the RED end (band shard ink follows polarity)', () => {
    const canvas = makeCanvas();
    const renderer = createRenderer(canvas, makeCanvas);
    renderer.setView(VIEW, 1);
    renderer.burst({ x: -0.5, y: 0.05 }, 'red', 1);
    renderer.draw(burstFrame(1.05));
    const fills = canvas.ctx.calls.filter((c) => c.op === 'set:fillStyle').map((c) => String(c.args[0]));
    expect(fills).toContain(PLUG_RED);
    expect(fills).not.toContain(PLUG_BLUE);
  });

  it('the debris dies on its own clock (0.55s) and never lingers', () => {
    const canvas = makeCanvas();
    const renderer = createRenderer(canvas, makeCanvas);
    renderer.setView(VIEW, 1);
    renderer.burst({ x: 0, y: 0.05 }, 'red', 1);
    renderer.draw(burstFrame(1.3));
    expect(renderer.stateProbe().shards).toBeGreaterThan(0);
    renderer.draw(burstFrame(1.7)); // 0.7s later — past the 0.55s life
    expect(renderer.stateProbe().shards).toBe(0);
  });

  it('the pool RECYCLES: more bursts than slots never grows or throws', () => {
    const canvas = makeCanvas();
    const renderer = createRenderer(canvas, makeCanvas);
    renderer.setView(VIEW, 1);
    for (let i = 0; i < 6; i += 1) {
      renderer.burst({ x: i * 0.2 - 0.5, y: 0.05 }, i % 2 === 0 ? 'red' : 'blue', 1);
    }
    renderer.draw(burstFrame(1.02));
    expect(renderer.stateProbe().shards).toBe(80); // 4 bursts × 20 — the cap
    expect(() => renderer.draw(burstFrame(1.05))).not.toThrow();
    expect(renderer.stateProbe().shards).toBeLessThanOrEqual(80);
  });

  it('the debris is clock-faithful: a backward sim clock (RESET) clears it', () => {
    const canvas = makeCanvas();
    const renderer = createRenderer(canvas, makeCanvas);
    renderer.setView(VIEW, 1);
    renderer.burst({ x: 0, y: 0.05 }, 'red', 5);
    renderer.draw(burstFrame(5.05));
    expect(renderer.stateProbe().shards).toBe(20);
    renderer.draw(burstFrame(0.1)); // reset rebuilt the world at t=0
    expect(renderer.stateProbe().shards).toBe(0);
  });

  it('clearFragments drops everything (the RESET path)', () => {
    const canvas = makeCanvas();
    const renderer = createRenderer(canvas, makeCanvas);
    renderer.setView(VIEW, 1);
    renderer.burst({ x: 0, y: 0.05 }, 'red', 1);
    renderer.clearFragments();
    renderer.draw(burstFrame(1.05));
    expect(renderer.stateProbe().shards).toBe(0);
  });
});

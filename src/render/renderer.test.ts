/**
 * 2D-2 — RENDERER SMOKE TESTS (Professor X's lane, headless-feasible). The
 * painter is driven against a RECORDING mock of the 2D context (the repo's
 * no-jsdom discipline — no heavy deps): assertions read the draw-call stream,
 * not pixels. What is pinned: DPR-correct sizing, the cached panel blit, one
 * module silkscreen per rectangle, the cord's layered stroke passes, BOTH
 * jacks drawn with the polarity inks, a seated jack's rotation perpendicular
 * to its socket, and the deny ring's sim-clock fade.
 */
import { describe, expect, it } from 'vitest';
import type { SimState, Vec2 } from '../sim';
import { createStage } from '../world/stage';
import type { SeatPose } from '../world/stage';
import { createView } from '../world/view';
import { createRenderer, DENY_FADE_SECONDS, PLUG_BLUE, PLUG_RED } from './renderer';
import type { FrameInput, RendererCanvas } from './renderer';

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

/**
 * REN-2 dev harness — the 12-cord staging + frame-budget page. NOT the
 * product: the production composition root is src/main.ts (the M1 single
 * cord). This page exists because the DoD's render target is 12 live cords
 * and the sim lane's step contract is still single-cord (multi-cord world is
 * LIFE-1's): it drives 12 REAL production ropes headlessly (createVerletRope
 * + the same 1/120 fixed-slice discipline), publishes them through plain
 * CordState shells as a SimState, and renders with the unmodified production
 * RenderLayer. Two jobs:
 *
 *  1. STAGE the screenshot of record: seated plugs (cube tops), carried
 *     plugs mid-air (scripted carries through rope.carryEnd/setPinTarget),
 *     a linked drape, and a hanging fleet — red/blue polarity readable.
 *  2. MEASURE (perf.html?bench=1): after a warmup, the average rAF delta
 *     over 300 frames of 12 LIVE cords (every cord perturbed every frame —
 *     worst-case tube rewrites + jack uploads) under swiftshader. Results go
 *     to #perf-out, console (`CORDS_PERF …`), and window.__PERF_JSON for the
 *     CDP measure script (scripts/measure-perf.mjs).
 */
import { createVerletRope } from '../sim';
import type { CordState, Rope, SimState, Vec3 } from '../sim';
import { createRenderLayer } from '../render/scene';

declare global {
  interface Window {
    __PERF_DONE?: boolean;
    __PERF_JSON?: string;
  }
}

// Same fixed-slice discipline as the composition root (ARC-3 semantics).
const H = 1 / 120;
const MAX_SUBSTEPS = 5;

const SEGS = 24; // 2.4 u of cord — the M1 length; leash = total rest length
const LAST = SEGS;

type Mode = 'hanging' | 'carried' | 'linked';

interface StagedCord {
  rope: Rope;
  points: Vec3[];
  mode: Mode;
  /** Carried-plug hold center (the Lissajous drift is added per substep). */
  hold: Vec3;
  /** Per-cord breeze phase so the fleet never moves in lockstep. */
  seed: number;
}

function makeCord(
  pin: { x: number; y: number; z: number },
  mode: Mode,
  hold: Vec3,
  seed: number,
): StagedCord {
  const rope = createVerletRope({
    segmentCount: SEGS,
    segmentLength: 0.1,
    floorY: 0,
    pinIndex: 0,
    pin,
  });
  const points: Vec3[] = Array.from({ length: SEGS + 1 }, () => ({ x: 0, y: 0, z: 0 }));
  rope.writePointsTo(points);
  const cord: StagedCord = { rope, points, mode, hold, seed };
  return cord;
}

/**
 * Sculpt the rope's initial pose as a catenary-ish arc from `a` (the pin)
 * to `b`, sagging by `sag`. The pose is the SCREENSHOT truth under virtual
 * time (frozen sim) and the seed the solver relaxes from under real time.
 * `setPoint` is the sanctioned mutator (SIM-1 surface).
 */
function sculpt(cord: StagedCord, a: Vec3, b: Vec3, sag: number): void {
  for (let i = 0; i <= SEGS; i += 1) {
    const t = i / SEGS;
    const s = Math.sin(Math.PI * t);
    cord.rope.setPoint(
      i,
      a.x + (b.x - a.x) * t,
      a.y + (b.y - a.y) * t - sag * s,
      a.z + (b.z - a.z) * t,
    );
  }
  // setPoint moves pos but leaves prev — without this, every point carries
  // the whole sculpt offset as velocity and the pose detonates on step 1.
  for (let i = 0; i <= SEGS; i += 1) cord.rope.setVelocity(i, 0, 0, 0, H);
  cord.rope.writePointsTo(cord.points);
}

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('stage12: #app missing');

const render = createRenderLayer(app, {
  cords: Array.from({ length: 12 }, (_, id) => ({
    id,
    pointCount: SEGS + 1,
    redEnd: 'first' as const,
  })),
});

// --- The staged world -------------------------------------------------------
// Cube tops (REN-1 cubes are 0.5 u at y=0.25, so tops sit at y=0.5):
//   cube 02 top (-0.85, 0.5, 0.95) · cube 04 top (0.85, 0.5, 1.05)
//   cube 05 top (1.7, 0.5, 0.15)   · cube 06 top (1.25, 0.5, -1.35)
const cords: StagedCord[] = [
  // 0 — the M1 twin: cord hangs from its seated red plug, tail on the bench.
  makeCord({ x: 0, y: 1.6, z: 0 }, 'hanging', { x: 0, y: 0, z: 0 }, 0),
  // 1 — carried mid-air, front-right: red plug seated on cube 04, blue plug
  //     held high against the dark sky by a scripted carry.
  makeCord({ x: 0.85, y: 0.5, z: 1.05 }, 'carried', { x: 0.3, y: 1.45, z: 1.55 }, 1.7),
  // 2 — carried mid-air, front-left from cube 02.
  makeCord({ x: -0.85, y: 0.5, z: 0.95 }, 'carried', { x: -1.72, y: 1.38, z: 1.45 }, 3.9),
  // 3 — linked: red plugged on cube 05's top, blue on cube 06's top; the
  //     cord drapes between the two modules.
  makeCord({ x: 1.7, y: 0.5, z: 0.15 }, 'linked', { x: 1.25, y: 0.5, z: -1.35 }, 6.1),
  // 4–11 — the hanging fleet: diagonal hangs whose tails pool on the bench
  //     (never vertical poles — each is sculpted with real slack).
  makeCord({ x: -2.0, y: 1.4, z: 0.8 }, 'hanging', { x: 0, y: 0, z: 0 }, 8.2),
  makeCord({ x: 2.2, y: 1.5, z: -0.6 }, 'hanging', { x: 0, y: 0, z: 0 }, 9.4),
  makeCord({ x: -1.9, y: 1.2, z: -1.2 }, 'hanging', { x: 0, y: 0, z: 0 }, 10.6),
  makeCord({ x: 1.9, y: 1.6, z: 1.3 }, 'hanging', { x: 0, y: 0, z: 0 }, 11.8),
  makeCord({ x: 0.3, y: 1.45, z: -1.8 }, 'hanging', { x: 0, y: 0, z: 0 }, 13.0),
  makeCord({ x: -0.7, y: 1.35, z: 1.9 }, 'hanging', { x: 0, y: 0, z: 0 }, 14.2),
  makeCord({ x: 2.4, y: 1.3, z: 0.9 }, 'hanging', { x: 0, y: 0, z: 0 }, 15.4),
  makeCord({ x: -2.5, y: 1.55, z: -0.2 }, 'hanging', { x: 0, y: 0, z: 0 }, 16.6),
];

// Sculpted initial poses (see sculpt()): pin end → tail end, sag.
sculpt(cords[0], { x: 0, y: 1.6, z: 0 }, { x: -0.35, y: 0.06, z: 0.35 }, 0.35);
sculpt(cords[1], { x: 0.85, y: 0.5, z: 1.05 }, { x: 0.3, y: 1.45, z: 1.55 }, 0.18);
sculpt(cords[2], { x: -0.85, y: 0.5, z: 0.95 }, { x: -1.72, y: 1.38, z: 1.45 }, 0.2);
sculpt(cords[3], { x: 1.7, y: 0.5, z: 0.15 }, { x: 1.25, y: 0.5, z: -1.35 }, 0.42);
sculpt(cords[4], { x: -2.0, y: 1.4, z: 0.8 }, { x: -1.45, y: 0.05, z: 1.15 }, 0.3);
sculpt(cords[5], { x: 2.2, y: 1.5, z: -0.6 }, { x: 1.75, y: 0.05, z: -0.2 }, 0.28);
sculpt(cords[6], { x: -1.9, y: 1.2, z: -1.2 }, { x: -1.3, y: 0.05, z: -1.05 }, 0.3);
sculpt(cords[7], { x: 1.9, y: 1.6, z: 1.3 }, { x: 1.55, y: 0.06, z: 1.85 }, 0.3);
sculpt(cords[8], { x: 0.3, y: 1.45, z: -1.8 }, { x: 0.6, y: 0.05, z: -1.45 }, 0.28);
sculpt(cords[9], { x: -0.7, y: 1.35, z: 1.9 }, { x: -0.25, y: 0.06, z: 1.65 }, 0.26);
sculpt(cords[10], { x: 2.4, y: 1.3, z: 0.9 }, { x: 2.0, y: 0.05, z: 1.25 }, 0.26);
sculpt(cords[11], { x: -2.5, y: 1.55, z: -0.2 }, { x: -2.1, y: 0.06, z: 0.1 }, 0.28);

// The linked cord seats AFTER sculpting: the seat adopts the sculpted
// drape as its rest state (SIM-3), so the solver relaxes from the drape,
// never from a collapsed default pose.
cords[3].rope.seat({ index: LAST, position: { x: 1.25, y: 0.5, z: -1.35 } });

// Plain-data world shells — the render layer reads these, sim-mutation style.
const world: SimState = {
  time: 0,
  cords: cords.map((c, id): CordState => ({ id, points: c.points })),
};

// Dev-harness debug hook (CDP inspection of the live pool).
(window as unknown as Record<string, unknown>).__STAGE_DEBUG = {
  jackPool: render.jackPool,
  ropes: cords.map((c) => c.rope),
  camera: render.camera,
  scene: render.scene,
};

// Attribution harness (?jacks=0): render the scene WITHOUT the jack pool to
// attribute any visual artifact to tubes vs plugs.
if (new URLSearchParams(window.location.search).get('jacks') === '0') {
  render.jackPool.group.visible = false;
}

/** One fixed slice: scripted carries + a gentle breeze, then solve. */
function substep(): void {
  world.time += H;
  for (const c of cords) {
    if (c.mode === 'carried') {
      if (c.rope.carriedIndex !== LAST) c.rope.carryEnd(LAST);
      const p = c.seed * 1.3;
      c.rope.setPinTarget(LAST, {
        x: c.hold.x + Math.sin(world.time * 0.7 + p) * 0.05,
        y: c.hold.y + Math.sin(world.time * 0.9 + p * 2) * 0.03,
        z: c.hold.z + Math.cos(world.time * 0.6 + p) * 0.05,
      });
    }
    // Breeze: a small impulse near a slowly wandering point keeps EVERY cord
    // moving (worst-case render load; a sleeping scene would gate uploads).
    // Gentle — the fleet sways, it never whips.
    const bi = 4 + (Math.floor(world.time * 1.5 + c.seed) % (SEGS - 9));
    const w = world.time * 2.1 + c.seed;
    c.rope.setVelocity(bi, Math.sin(w) * 0.22, Math.cos(w * 0.8) * 0.16, Math.cos(w) * 0.22, H);
    c.rope.step(H);
    c.rope.writePointsTo(c.points);
  }
}

// --- Frame loop + instrumentation -------------------------------------------

const bench = new URLSearchParams(window.location.search).get('bench') === '1';
const WARMUP_FRAMES = 180;
const SAMPLE_FRAMES = 300;
const samples = bench ? new Float64Array(SAMPLE_FRAMES) : new Float64Array(0);
// Decomposition evidence: per frame, the sim+staging slice (our JS) vs the
// three.js render call (which under swiftshader IS the software raster).
const simSamples = bench ? new Float64Array(SAMPLE_FRAMES) : new Float64Array(0);
const renderSamples = bench ? new Float64Array(SAMPLE_FRAMES) : new Float64Array(0);

let acc = 0;
let frameCount = 0;
let sampleCount = 0;

render.start((dtSeconds) => {
  const frameStart = performance.now();
  acc += Math.min(Math.max(dtSeconds, 0), 0.1);
  let substeps = 0;
  while (acc >= H && substeps < MAX_SUBSTEPS) {
    substep();
    acc -= H;
    substeps += 1;
  }
  const simEnd = performance.now();
  render.render(world);
  const renderEnd = performance.now();
  frameCount += 1;

  if (!bench || sampleCount >= SAMPLE_FRAMES) return;
  if (frameCount <= WARMUP_FRAMES) return;
  samples[sampleCount] = dtSeconds * 1000;
  simSamples[sampleCount] = simEnd - frameStart;
  renderSamples[sampleCount] = renderEnd - simEnd;
  sampleCount += 1;
  if (sampleCount === SAMPLE_FRAMES) report();
});

function avg(a: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i];
  return s / a.length;
}

function report(): void {
  const sorted = Float64Array.from(samples).sort();
  const sum = sorted.reduce((a, b) => a + b, 0);
  const p95 = sorted[Math.floor(SAMPLE_FRAMES * 0.95)];
  const info = render.renderer.info.render;
  const payload = {
    cords: cords.length,
    frames: SAMPLE_FRAMES,
    warmupFrames: WARMUP_FRAMES,
    avgFrameMs: Number((sum / SAMPLE_FRAMES).toFixed(3)),
    p95FrameMs: Number(p95.toFixed(3)),
    maxFrameMs: Number(sorted[SAMPLE_FRAMES - 1].toFixed(3)),
    minFrameMs: Number(sorted[0].toFixed(3)),
    avgSimPrepMs: Number(avg(simSamples).toFixed(3)),
    avgRenderCallMs: Number(avg(renderSamples).toFixed(3)),
    drawCalls: info.calls,
    triangles: info.triangles,
    gpu: 'swiftshader (headless, CPU raster — a CPU-side lower bound)',
  };
  const text = JSON.stringify(payload, null, 2);
  window.__PERF_DONE = true;
  window.__PERF_JSON = text;
  // eslint-disable-next-line no-console
  console.log(`CORDS_PERF ${text}`);
  const out = document.getElementById('perf-out');
  if (out !== null) {
    out.textContent = `REN-2 frame budget — ${payload.cords} live cords, ${payload.frames} frames (swiftshader)\n` +
      `avg ${payload.avgFrameMs} ms · p95 ${payload.p95FrameMs} ms · max ${payload.maxFrameMs} ms\n` +
      `sim+prep ${payload.avgSimPrepMs} ms · render call ${payload.avgRenderCallMs} ms (software raster)\n` +
      `${payload.drawCalls} draw calls · ${payload.triangles} triangles per frame`;
    out.style.display = 'block';
  }
}

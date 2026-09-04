/**
 * 2D-2/2D-3 — THE CANVAS 2D PAINTER (Professor X's lane: visual truth). The
 * flat Drum Machine Panel world: machined charcoal bench with panel seams and
 * corner bolts, eight candy-zoned steel modules, cords as stroked smooth
 * curves through the sim's own points, and the 1/4″ jack drawn in 2D at each
 * end — tapered tip, chrome shaft, dark knurled grip, color band + strain
 * relief (Plug Red #c22e26 / Plug Blue #2e58de, the refine-2 albedo values
 * proven to survive at full-frame distance).
 *
 * 2D-3 restores v1's finishing state furniture, translated flat and split
 * along the same purity line: the LAWS are pure sim-clock functions
 * (states.ts, pulse.ts — headless-testable), the PAINT lives here —
 *   • stretch ticks: neutral silkscreen graduation marks, one per REST
 *     segment of MEASURED arc, appearing above 0.90 tautness, state-gated to
 *     carried/awaiting-plug cords (never linked, never counting down);
 *   • popped grace: the cord dims LINEARly to the 0.22 floor (the visible
 *     countdown) while the failing jack's band blinks dark through the final
 *     1.5 s (3→5 Hz stepped ramp, sim-clock; steady under reduced motion);
 *     the vanish fade composes MULTIPLICATIVELY so expiry never flashes back;
 *   • shatter: a POOLED debris burst at the impact — 18 dark cool-steel
 *     shards plus the failing end's BAND shard (the largest piece) — two
 *     floor bounces, a friction slide, 0.55 s life, scale-out at the end.
 *     Zero glow, zero allocation after construction; skipped entirely under
 *     reduced motion (the composition's call, not the pool's);
 *   • the chase pulse: the ONE GLOW — a sulfur-amber LED segment overdrawn
 *     on the drawn curve, traveling the measured arc red→blue on the sim
 *     clock, gated to exactly `linked` (the composition's per-frame read).
 *
 * DESIGN.md's laws, translated flat: depth is MACHINED (1px bevels, seams,
 * fastener heads) or LIT (one fog falloff toward the top of the stage) — no
 * drop shadows, no glass; the only saturated color is state. Motion is the
 * sim's own — this layer paints exactly the state it is handed, so a frozen
 * sim holds its picture still.
 *
 * Discipline: ZERO per-frame allocation (screen-point shells are pooled
 * once; fonts/gradients are cached at resize; the shard pool and every
 * scratch array are constructed here), device-pixel-ratio correct (the
 * context transform carries the DPR; every coordinate is CSS px), and
 * resize-safe (`setView` rebuilds the cached panel at the new size).
 */
import type { LifecycleState, SimState, Vec2 } from '../sim';
import { SEAT_DEPTH } from '../world/stage';
import type { SeatPose, StageRect } from '../world/stage';
import type { View } from '../world/view';
import { graceBlinkOn, graceDimming, stretchTickGain } from './states';

/** The narrow canvas surface the renderer needs (HTMLCanvasElement-shaped). */
export interface RendererCanvas {
  width: number;
  height: number;
  readonly style: { width: string; height: string };
  getContext(contextId: '2d'): CanvasRenderingContext2D | null;
}

/** The failing end's polarity for a shatter burst (the band shard's ink). */
export type ShardBand = 'red' | 'blue' | null;

/** 2D-3 drive seam: the last drawn chase-pulse read (pulseProbe). */
export interface PulseProbe {
  phase: number;
  /** Per drawn cord: the gate's gain plus the LED segment's screen center. */
  cords: Array<{ id: number; gain: number; cx: number; cy: number }>;
}

/** 2D-3 drive seam: the last drawn state furniture (stateProbe). */
export interface StateProbe {
  cords: Array<{
    id: number;
    tickGain: number;
    dim: number;
    fade: number | null;
    jackHidden: boolean;
    bandLit: [boolean, boolean];
  }>;
  shards: number;
}

/**
 * Per-cord paint state — the composition's per-frame read of the lifecycle,
 * parallel to `FrameInput.state.cords` by index. Built by main.ts from the
 * machine's own reads; absent (null) = the plain 2D-2 paint, no furniture.
 */
export interface CordPaint {
  /** The lifecycle state ('none' for an unregistered cord). */
  state: LifecycleState | 'none';
  /**
   * End-to-end span over the rest total (0..~1) — the TAUTNESS read that
   * keys the stretch ticks (a leashed carried cord cannot exceed its rest
   * length in arc, so taut is the honest reading of "stretched").
   */
  tautness: number;
  /**
   * Grace seconds remaining while `popped`; 0 while `vanishing` (the dim
   * holds its floor through the fade); null in every other state.
   */
  graceRemaining: number | null;
  /** The end whose jack failed (the blinking band / the shatter), or null. */
  failingEnd: number | null;
  /** Vanish pull-window progress 0..1, or null when not vanishing. */
  fade: number | null;
  /** The end whose jack already shattered (hidden — shards replaced it). */
  jackHiddenEnd: number | null;
}

/** Per-frame render input — everything the painter may look at. */
export interface FrameInput {
  state: SimState;
  /** The LIVE stage (modules drag; the painter never mutates them). */
  modules: readonly StageRect[];
  /** The seated jack's pose for a cord end, or null (free/carried end). */
  seatPoseOf(cordId: number, index: number): SeatPose | null;
  /** The soft-cap deny ring (world point + SIM time of the denial), if live. */
  deny: { readonly x: number; readonly y: number; readonly t: number } | null;
  /** Sim clock seconds (the deny fade keys on it — deterministic). */
  simTime: number;
  /** 2D-3: per-cord lifecycle paint reads, parallel to state.cords. */
  paint?: readonly CordPaint[] | null;
  /**
   * 2D-3: the chase-pulse phase in [0,1) from the pure sim clock, or
   * null/absent to paint no pulse at all this frame.
   */
  pulsePhase?: number | null;
  /** 2D-3: prefers-reduced-motion (the blink holds steady). */
  reducedMotion?: boolean;
  /**
   * 2D-6 — the module whose 4 corner handles are shown RIGHT NOW (the
   * resizing one mid-drag, else the one under the pointer). −1/null/absent
   * = none. Honest furniture: machined notches, no glow, only while the
   * module is being worked on.
   */
  handlesFor?: number | null;
}

// --- Palette (DESIGN.md frontmatter; the shipped token values) ----------------
const STAGE_VOID = '#111114';
const BENCH = '#22252a';
const BENCH_ALT = '#232629';
const PANEL_SEAM = '#0d0f12';
const MACHINED_SEAM = '#0e1013';
const FASTENER_INK = '#101215';
const FASTENER_RIM = '#0a0b0d';
const BEVEL = 'rgba(255,255,255,0.08)';
const STEEL = '#2a2d31';
const SILKSCREEN_ID = '#8f96a0';
const CORD_RUBBER = '#2e3138';
const CORD_RUBBER_DARK = '#262930';
const PLUG_CHROME = '#d6dade';
const PLUG_CHROME_EDGE = '#8f959d';
const GRIP_RUBBER = '#17181c';
const PLUG_INK = '#14161a';
/** Polarity inks — refine-2's deeper-than-zone values (world contract). */
export const PLUG_RED = '#c22e26';
export const PLUG_BLUE = '#2e58de';
const ZONE_KEYLINE = 'rgba(0,0,0,0.45)';
const BOOT_SHADE = 'rgba(0,0,0,0.18)';
const KNURL = 'rgba(255,255,255,0.05)';
/** The stretch ticks' neutral registration ink (measurement, never red). */
const TICK_INK = '#b6bcc6';
/** The chase pulse — the panel's lit-segment amber. THE ONE GLOW. */
export const PULSE_INK = '#f2d43a';

// --- Jack anatomy (world units, tip → boot; v1's hero-scale proportions) ------
// The band and boot carry the polarity, so both print generously: the band is
// a wide collar and the boot a long colored taper — readable at full-frame
// distance (refine-2's lesson, kept in 2D).
const JACK_LEN = 0.415;
const JACK_TIP = 0.055;
const JACK_GROOVE = 0.079;
const JACK_SHAFT = 0.16;
const JACK_BAND = 0.235;
const JACK_GRIP = 0.33;
const TIP_HW = 0.007;
const SHAFT_HW = 0.031;
const BAND_HW = 0.042;
const GRIP_HW = 0.05;
const BOOT_TAIL_HW = 0.026;
/** The machined port a seated plug enters (the inset that sells insertion). */
const SOCKET_INK = '#101215';

/** Deny ring fade (flat Plug Red paint on the module face — never a lamp). */
export const DENY_FADE_SECONDS = 0.35;

const ID_FONT = '700 11px ui-monospace, "SF Mono", Menlo, Consolas, monospace';

/** The pool sizes for the world's own cap: 48 cords × 25 points (2D-7). */
const MAX_CORDS = 48;
const MAX_POINTS = 25;
/** One segment's rest length (world units) — the production rope default. */
const REST_SEGMENT = 0.1;

// --- the shatter debris (pooled; v1 REN-5/REFINE-1's grammar) ------------------
/** Steel shards per burst (the DESIGN law's 18) + the band's two pieces. */
const SHARD_STEEL_COUNT = 18;
const SHARD_BAND_COUNT = 2;
const SHARDS_PER_BURST = SHARD_STEEL_COUNT + SHARD_BAND_COUNT;
/** Concurrent bursts the pool covers (rapid-fire failures; oldest replaced). */
const SHARD_MAX_BURSTS = 4;
/** Debris life in seconds of sim time (scale-out over the final 35%). */
const SHARD_LIFE = 0.55;
const SHARD_LIFE_OUT = 0.35 * SHARD_LIFE;
/** Debris gravity (world units/s²) — the arc reads at bench scale. */
const SHARD_G = 9;
/** Fixed debris substep — the burst integrates on the sim clock's own grid,
 * so the debris is identical whatever the frame cadence (deterministic law). */
const SHARD_DT = 1 / 120;
const SHARD_DT_MAX_STEPS = 96; // ≥ SHARD_LIFE / SHARD_DT — a full life per draw
const SHARD_REST_Y = 0.012; // a shard rests at its own half-height on the bench
/** Dark cool-steel inks, channel-varied (per-instance, deterministic). */
const SHARD_STEEL_INKS = ['#23262b', '#26292f', '#2a2d33', '#2e3138', '#303339'] as const;

/** One pooled debris shard. */
interface Shard {
  active: boolean;
  /** The world position (x right, y up — the sim's own plane). */
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  /** Deterministic per-slot shape/speed seed (LCG-fixed at construction). */
  scale: number;
  /** Index into SHARD_STEEL_INKS, or −1 when this slot is a band shard. */
  inkIndex: number;
  dirX: number;
  dirY: number;
  speed: number;
  /** Live integration state (assigned at burst time). */
  ax: number;
  ay: number;
  avx: number;
  avy: number;
  arot: number;
  avr: number;
  bounces: number;
  birth: number;
  band: ShardBand;
}

/** ×1.5 within-hue lift of a #rrggbb ink (the linked seated band's accent). */
function liftHex(hex: string, factor: number): string {
  const r = Math.min(255, Math.round(parseInt(hex.slice(1, 3), 16) * factor));
  const g = Math.min(255, Math.round(parseInt(hex.slice(3, 5), 16) * factor));
  const b = Math.min(255, Math.round(parseInt(hex.slice(5, 7), 16) * factor));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
const LIT_RED = liftHex(PLUG_RED, 1.5);
const LIT_BLUE = liftHex(PLUG_BLUE, 1.5);

export interface Renderer {
  /** (Re)fit to a view + device pixel ratio; rebuilds the cached panel. */
  setView(view: View, dpr: number): void;
  /** Paint one frame. No allocation in steady state. */
  draw(frame: FrameInput): void;
  /** 2D-3: spawn a debris burst at `at` (world) on the sim clock. */
  burst(at: Vec2, band: ShardBand, simTime: number): void;
  /** 2D-3: drop every live burst (RESET). */
  clearFragments(): void;
  /**
   * 2D-3 drive seam: the last drawn pulse read — the phase used and, per
   * cord, the gate's gain plus the LED segment's screen center (the road:
   * red end → blue end). Allocates (probe calls only, never per frame).
   */
  pulseProbe(): PulseProbe;
  /**
   * 2D-3 drive seam: the last drawn state furniture per cord + the live
   * debris count. Allocates (probe calls only).
   */
  stateProbe(): StateProbe;
}

/**
 * Builds the painter over `canvas`. `createSurface` makes the offscreen
 * panel-cache canvas (the real DOM default; tests may stub it).
 */
export function createRenderer(
  canvas: RendererCanvas,
  createSurface: () => RendererCanvas = () =>
    document.createElement('canvas') as unknown as RendererCanvas,
): Renderer {
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('render: 2d context unavailable');
  const bgCanvas = createSurface();
  const bg = bgCanvas.getContext('2d');
  if (bg === null) throw new Error('render: 2d context unavailable (cache)');

  let view: View | null = null;
  let dpr = 1;
  let fog: CanvasGradient | null = null;
  let letterSpacingOK = false;

  // Screen-point pool — one shell per (cord slot, point index), allocated
  // once here; per-frame work only writes x/y.
  const pool: Vec2[] = [];
  for (let i = 0; i < MAX_CORDS * MAX_POINTS; i += 1) pool.push({ x: 0, y: 0 });
  const scratch: Vec2 = { x: 0, y: 0 };
  const scratchB: Vec2 = { x: 0, y: 0 };
  /** 2D-6 — the corner-handle screen points (reused per frame, 4 shells). */
  const handlePts: Vec2[] = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];
  /** Cumulative screen arc per point (the pulse road), reused per cord. */
  const arcScratch = new Float64Array(MAX_POINTS);

  // --- the debris pool ---------------------------------------------------------
  const shards: Shard[] = [];
  {
    let seed = 0x9e3779b9;
    const lcg = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let b = 0; b < SHARD_MAX_BURSTS; b += 1) {
      for (let s = 0; s < SHARDS_PER_BURST; s += 1) {
        const bandShard = s === 0 || s === SHARD_STEEL_COUNT; // the largest piece + one mid-scatter
        // Scatter: a biased-up hemisphere spray around the impact.
        const ang = -Math.PI / 2 + (lcg() - 0.5) * Math.PI * 1.7;
        shards.push({
          active: false,
          x: 0, y: 0, vx: 0, vy: 0, rot: 0, vr: 0,
          scale: bandShard
            ? 1.45 + lcg() * 0.35 // the band shard reads FIRST (v1's law)
            : 0.75 + lcg() * 1.05,
          inkIndex: bandShard ? -1 : Math.floor(lcg() * SHARD_STEEL_INKS.length),
          dirX: Math.cos(ang),
          dirY: Math.sin(ang),
          speed: 0.55 + lcg() * 1.75,
          ax: 0, ay: 0, avx: 0, avy: 0, arot: 0, avr: 0,
          bounces: 0,
          birth: 0,
          band: null,
        });
      }
    }
  }
  let shardClock = 0; // the debris' own integration clock (sim seconds)
  let liveShards = 0;

  // --- the probes (last drawn reads; allocated on probe() only) ---------------
  let probePhase = 0;
  const probePulseCords: Array<{ id: number; gain: number; cx: number; cy: number }> = [];
  const probeStateCords: Array<{
    id: number;
    tickGain: number;
    dim: number;
    fade: number | null;
    jackHidden: boolean;
    bandLit: [boolean, boolean];
  }> = [];

  const roundRectPath = (
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void => {
    const rr = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  };

  // --- panel background (cached; rebuilt only on setView) --------------------
  const paintPanel = (): void => {
    if (view === null) return;
    const w = view.width;
    const h = view.height;
    bgCanvas.width = Math.max(1, Math.round(w * dpr));
    bgCanvas.height = Math.max(1, Math.round(h * dpr));
    bg.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Bench charcoal — dark, never black. The room above dissolves into the
    // void via the fog painted per frame.
    bg.fillStyle = BENCH;
    bg.fillRect(0, 0, w, h);
    // Machined panels: 1.2 u tiles, half-tile offset so no seam runs under
    // the world origin (x centered on the stage, y hung off the floor line).
    const tile = 1.2 * view.scale;
    const hairline = 0.3 * view.scale;
    const gx0 = (w / 2) % tile - tile * 0.5;
    let row = 0;
    for (let y = view.floorScreenY % tile - tile * 0.5; y < h; y += tile, row += 1) {
      let col = row;
      for (let x = gx0; x < w; x += tile, col += 1) {
        bg.fillStyle = (col & 1) === 0 ? BENCH : BENCH_ALT;
        bg.fillRect(x, y, tile, tile);
        bg.strokeStyle = PANEL_SEAM;
        bg.lineWidth = 1;
        bg.strokeRect(x + 0.5, y + 0.5, tile - 1, tile - 1);
      }
    }
    // Subtle machining hairlines (0.3 u) — the grid texture.
    bg.strokeStyle = 'rgba(0,0,0,0.14)';
    bg.lineWidth = 1;
    bg.beginPath();
    for (let x = (w / 2) % hairline - hairline * 0.5; x < w; x += hairline) {
      bg.moveTo(Math.round(x) + 0.5, 0);
      bg.lineTo(Math.round(x) + 0.5, h);
    }
    for (let y = view.floorScreenY % hairline - hairline * 0.5; y < h; y += hairline) {
      bg.moveTo(0, Math.round(y) + 0.5);
      bg.lineTo(w, Math.round(y) + 0.5);
    }
    bg.stroke();
    // Corner bolts at the panel seam intersections — 4px machined heads with
    // inset highlights, the same furniture as the HUD strip's screws.
    for (let y = view.floorScreenY % tile - tile * 0.5; y < h + tile; y += tile) {
      for (let x = gx0; x < w + tile; x += tile) {
        bg.beginPath();
        bg.arc(x, y, 2.5, 0, Math.PI * 2);
        bg.fillStyle = FASTENER_INK;
        bg.fill();
        bg.strokeStyle = FASTENER_RIM;
        bg.lineWidth = 1;
        bg.stroke();
        bg.strokeStyle = 'rgba(255,255,255,0.06)';
        bg.beginPath();
        bg.moveTo(x - 1.5, y - 1.8);
        bg.lineTo(x + 1.5, y - 1.8);
        bg.stroke();
      }
    }
    // The bench edge: the floor line's machined seam; the strip below reads
    // as the front face (darker).
    bg.fillStyle = 'rgba(0,0,0,0.22)';
    bg.fillRect(0, view.floorScreenY, w, h - view.floorScreenY);
    bg.strokeStyle = BEVEL;
    bg.lineWidth = 1;
    bg.beginPath();
    bg.moveTo(0, view.floorScreenY - 1.5);
    bg.lineTo(w, view.floorScreenY - 1.5);
    bg.stroke();
    bg.strokeStyle = PANEL_SEAM;
    bg.lineWidth = 2;
    bg.beginPath();
    bg.moveTo(0, view.floorScreenY + 0.5);
    bg.lineTo(w, view.floorScreenY + 0.5);
    bg.stroke();
  };

  // --- one steel module -------------------------------------------------------
  const drawModule = (
    c: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    w: number,
    h: number,
    zone: string,
    label: string,
  ): void => {
    const x = sx - w / 2;
    const y = sy - h / 2;
    // Steel body with a machined border.
    roundRectPath(c, x, y, w, h, 5);
    c.fillStyle = STEEL;
    c.fill();
    c.strokeStyle = MACHINED_SEAM;
    c.lineWidth = 1;
    c.stroke();
    // 1px machined bevels: lit top edge, shaded bottom edge.
    c.strokeStyle = BEVEL;
    c.beginPath();
    c.moveTo(x + 4, y + 1.5);
    c.lineTo(x + w - 4, y + 1.5);
    c.stroke();
    c.strokeStyle = 'rgba(0,0,0,0.4)';
    c.beginPath();
    c.moveTo(x + 4, y + h - 1.5);
    c.lineTo(x + w - 4, y + h - 1.5);
    c.stroke();
    // Corner fasteners — the faceplate's own screws.
    const inset = 6.5;
    for (const [fx, fy] of [
      [x + inset, y + inset],
      [x + w - inset, y + inset],
      [x + inset, y + h - inset],
      [x + w - inset, y + h - inset],
    ] as const) {
      c.beginPath();
      c.arc(fx, fy, 2.2, 0, Math.PI * 2);
      c.fillStyle = FASTENER_INK;
      c.fill();
      c.strokeStyle = FASTENER_RIM;
      c.lineWidth = 1;
      c.stroke();
    }
    // The candy zone — the one soft form, keylined (DESIGN.md's shapes law).
    const zw = w * 0.62;
    const zh = h * 0.42;
    roundRectPath(c, sx - zw / 2, sy + h * 0.08, zw, zh, Math.min(8, zh / 2));
    c.fillStyle = zone;
    c.fill();
    c.strokeStyle = ZONE_KEYLINE;
    c.lineWidth = 1.5;
    c.stroke();
    // Silkscreen module id — the painted number 01…08.
    const scoped = c as CanvasRenderingContext2D & { letterSpacing?: string };
    if (letterSpacingOK) scoped.letterSpacing = '0.1em';
    c.fillStyle = SILKSCREEN_ID;
    c.font = ID_FONT;
    c.textBaseline = 'top';
    c.fillText(label, x + 11, y + 8);
    if (letterSpacingOK) scoped.letterSpacing = '0em';
  };

  /**
   * 2D-6 — THE CORNER HANDLES: four small machined notches, one centered on
   * each corner of the module being worked on (hovered or mid-resize). The
   * module's own furniture grammar — a dark inset square with a fastener rim
   * and a 1px top bevel, exactly the corner-screw/bolt vocabulary, never a
   * lit affordance: nothing glows unless the sim says so.
   */
  const drawHandles = (c: CanvasRenderingContext2D, corners: ReadonlyArray<Vec2>): void => {
    const half = 3.5; // a 7px notch — machined furniture, not a handlebar
    for (const p of corners) {
      const x = p.x - half;
      const y = p.y - half;
      c.fillStyle = FASTENER_INK;
      c.fillRect(x, y, half * 2, half * 2);
      c.strokeStyle = FASTENER_RIM;
      c.lineWidth = 1;
      c.strokeRect(x + 0.5, y + 0.5, half * 2 - 1, half * 2 - 1);
      c.strokeStyle = 'rgba(255,255,255,0.08)';
      c.beginPath();
      c.moveTo(x + 1.5, y + 1.5);
      c.lineTo(x + half * 2 - 1.5, y + 1.5);
      c.stroke();
    }
  };

  // --- the cord: layered strokes through the sim's own points -----------------
  // pts = the pool (absolute index base for this cord), n points.
  const drawCord = (
    c: CanvasRenderingContext2D,
    base: number,
    n: number,
    scale: number,
    alpha: number,
  ): void => {
    if (n < 2) return;
    c.lineJoin = 'round';
    c.lineCap = 'round';
    if (alpha < 1) c.globalAlpha = alpha;
    for (let pass = 0; pass < 3; pass += 1) {
      c.beginPath();
      c.moveTo(pool[base].x, pool[base].y);
      for (let i = 1; i < n - 1; i += 1) {
        const mx = (pool[base + i].x + pool[base + i + 1].x) / 2;
        const my = (pool[base + i].y + pool[base + i + 1].y) / 2;
        c.quadraticCurveTo(pool[base + i].x, pool[base + i].y, mx, my);
      }
      c.lineTo(pool[base + n - 1].x, pool[base + n - 1].y);
      if (pass === 0) {
        c.strokeStyle = CORD_RUBBER_DARK;
        c.lineWidth = 0.08 * scale;
      } else if (pass === 1) {
        c.strokeStyle = CORD_RUBBER;
        c.lineWidth = 0.066 * scale;
      } else {
        // The key light's sheen — a flat lighter stroke, layered, no glow.
        c.strokeStyle = 'rgba(255,255,255,0.07)';
        c.lineWidth = 0.02 * scale;
      }
      c.stroke();
    }
    if (alpha < 1) c.globalAlpha = 1;
  };

  /**
   * THE STRETCH TICKS — silkscreen graduation marks at every REST segment of
   * MEASURED arc along the WORLD polyline (the marks spread as the cord
   * straightens: the cord learning its length). Short neutral strokes
   * perpendicular to the local tangent; ink gain from the pure law.
   */
  const drawTicks = (
    c: CanvasRenderingContext2D,
    points: ReadonlyArray<Vec2>,
    n: number,
    segmentRest: number,
    gain: number,
    scale: number,
    alpha: number,
    v: View,
  ): void => {
    if (gain <= 0 || n < 2) return;
    c.strokeStyle = TICK_INK;
    c.lineWidth = 1.2;
    c.globalAlpha = gain * alpha;
    const halfLen = 0.052 * scale;
    let measured = 0;
    let nextMark = segmentRest;
    c.beginPath();
    for (let i = 0; i < n - 1 && measured < 1e9; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len <= 0) continue;
      while (nextMark <= measured + len) {
        const t = (nextMark - measured) / len;
        v.toScreen(a.x + dx * t, a.y + dy * t, scratch);
        // Screen tangent (dx, −dy) → screen normal (dy, dx), normalized by len.
        const nx = (dy / len) * halfLen;
        const ny = (dx / len) * halfLen;
        c.moveTo(scratch.x - nx, scratch.y - ny);
        c.lineTo(scratch.x + nx, scratch.y + ny);
        nextMark += segmentRest;
      }
      measured += len;
    }
    c.stroke();
    c.globalAlpha = 1;
  };

  /**
   * THE CHASE PULSE — the one glow. A sulfur-amber LED segment overdrawn on
   * the DRAWN curve, centered at `phase` of the MEASURED screen arc (red end
   * 0 → blue end 1), half-width σ ≈ 5% of the arc, its alpha ramping in as
   * it leaves the red jack and out as it sinks into the blue one.
   * Returns whether the LED was painted and, through `out`, its screen center.
   */
  const drawPulse = (
    c: CanvasRenderingContext2D,
    base: number,
    n: number,
    phase: number,
    scale: number,
    out: Vec2,
  ): boolean => {
    if (n < 2 || !Number.isFinite(phase)) {
      out.x = 0;
      out.y = 0;
      return false;
    }
    arcScratch[0] = 0;
    for (let i = 1; i < n; i += 1) {
      const dx = pool[base + i].x - pool[base + i - 1].x;
      const dy = pool[base + i].y - pool[base + i - 1].y;
      arcScratch[i] = arcScratch[i - 1] + Math.sqrt(dx * dx + dy * dy);
    }
    const total = arcScratch[n - 1];
    if (total <= 0) {
      out.x = pool[base].x;
      out.y = pool[base].y;
      return false;
    }
    const target = phase * total;
    // The LED's center (for the probe road).
    let j = 0;
    while (j < n - 2 && arcScratch[j + 1] < target) j += 1;
    const span = arcScratch[j + 1] - arcScratch[j];
    const f = span > 0 ? Math.min(1, Math.max(0, (target - arcScratch[j]) / span)) : 0;
    out.x = pool[base + j].x + (pool[base + j + 1].x - pool[base + j].x) * f;
    out.y = pool[base + j].y + (pool[base + j + 1].y - pool[base + j].y) * f;
    // The segment window [target − σ, target + σ] clamped to the curve.
    const sigma = 0.05 * total;
    let i0 = 0;
    while (i0 < n - 1 && arcScratch[i0] < target - sigma) i0 += 1;
    let i1 = n - 1;
    while (i1 > 0 && arcScratch[i1] > target + sigma) i1 -= 1;
    if (i1 <= i0) i1 = Math.min(n - 1, i0 + 1);
    // Brightness envelope: ramp in/out over the first/last 12% of the road.
    const u = target / total;
    const env = Math.min(1, Math.min(u, 1 - u) / 0.12);
    if (env <= 0) return false;
    c.beginPath();
    c.moveTo(pool[base + i0].x, pool[base + i0].y);
    for (let i = i0 + 1; i < i1; i += 1) {
      const mx = (pool[base + i].x + pool[base + i + 1].x) / 2;
      const my = (pool[base + i].y + pool[base + i + 1].y) / 2;
      c.quadraticCurveTo(pool[base + i].x, pool[base + i].y, mx, my);
    }
    c.lineTo(pool[base + i1].x, pool[base + i1].y);
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.strokeStyle = PULSE_INK;
    c.lineWidth = 0.042 * scale;
    c.globalAlpha = env;
    c.stroke();
    c.globalAlpha = 1;
    return true;
  };

  // --- the 1/4″ jack: tip at the sim pin, body extending along +axis ----------
  const drawJack = (
    c: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    ax: number,
    ay: number,
    bandInk: string,
    bootInk: string,
    scale: number,
    socket: Vec2 | null,
    alpha: number,
  ): void => {
    const s = scale;
    // The machined port a seated plug enters: a dark inset slot on the edge
    // line, aligned with the plug's axis — the affordance that reads
    // "plugged in" on a flat panel (drawn UNDER the jack, on the module).
    if (socket !== null) {
      c.save();
      c.translate(socket.x, socket.y);
      c.rotate(Math.atan2(ay, ax));
      c.fillStyle = SOCKET_INK;
      c.fillRect(-0.065 * s, -0.055 * s, 0.13 * s, 0.11 * s);
      c.strokeStyle = 'rgba(255,255,255,0.07)';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(-0.065 * s, -0.055 * s);
      c.lineTo(0.065 * s, -0.055 * s);
      c.stroke();
      c.restore();
    }
    c.save();
    if (alpha < 1) c.globalAlpha = alpha;
    c.translate(sx, sy);
    c.rotate(Math.atan2(ay, ax));
    // Tapered tip (chrome) — a cone widening to shaft half-width, with the
    // same machined underside shade as the shaft so it reads METAL.
    c.beginPath();
    c.moveTo(0, -TIP_HW * s);
    c.lineTo(JACK_TIP * s, -SHAFT_HW * s);
    c.lineTo(JACK_TIP * s, SHAFT_HW * s);
    c.lineTo(0, TIP_HW * s);
    c.closePath();
    c.fillStyle = PLUG_CHROME;
    c.fill();
    c.strokeStyle = PLUG_CHROME_EDGE;
    c.lineWidth = 1.2;
    c.stroke();
    c.beginPath();
    c.moveTo(0, TIP_HW * s);
    c.lineTo(JACK_TIP * s, SHAFT_HW * s * 0.45);
    c.lineTo(JACK_TIP * s, SHAFT_HW * s);
    c.lineTo(0, TIP_HW * s);
    c.closePath();
    c.fillStyle = 'rgba(0,0,0,0.22)';
    c.fill();
    // Insulator groove (near-black — separates tip from shaft hard).
    c.fillStyle = PLUG_INK;
    c.fillRect(JACK_TIP * s, -SHAFT_HW * s, (JACK_GROOVE - JACK_TIP) * s, SHAFT_HW * 2 * s);
    // Metal shaft (chrome) with a machined underside shade.
    c.fillStyle = PLUG_CHROME;
    c.fillRect(JACK_GROOVE * s, -SHAFT_HW * s, (JACK_SHAFT - JACK_GROOVE) * s, SHAFT_HW * 2 * s);
    c.fillStyle = 'rgba(0,0,0,0.22)';
    c.fillRect(
      JACK_GROOVE * s,
      SHAFT_HW * s * 0.35,
      (JACK_SHAFT - JACK_GROOVE) * s,
      SHAFT_HW * s * 0.65,
    );
    // Color sleeve band — the wide polarity collar (blink: the band's own
    // dark rubber ink — the low-battery LED's off-half reads as unlit plastic).
    c.fillStyle = bandInk;
    c.fillRect(JACK_SHAFT * s, -BAND_HW * s, (JACK_BAND - JACK_SHAFT) * s, BAND_HW * 2 * s);
    c.strokeStyle = ZONE_KEYLINE;
    c.lineWidth = 1;
    c.strokeRect(JACK_SHAFT * s, -BAND_HW * s, (JACK_BAND - JACK_SHAFT) * s, BAND_HW * 2 * s);
    // Knurled grip (dark rubber) + knurl flutes.
    c.fillStyle = GRIP_RUBBER;
    c.fillRect(JACK_BAND * s, -GRIP_HW * s, (JACK_GRIP - JACK_BAND) * s, GRIP_HW * 2 * s);
    c.strokeStyle = KNURL;
    c.lineWidth = 1;
    c.beginPath();
    const flute0 = JACK_BAND + (JACK_GRIP - JACK_BAND) * 0.18;
    const fluteStep = (JACK_GRIP - JACK_BAND) * 0.22;
    for (let f = 0; f < 4; f += 1) {
      const fx = (flute0 + f * fluteStep) * s;
      c.moveTo(fx, -GRIP_HW * s * 0.72);
      c.lineTo(fx, GRIP_HW * s * 0.72);
    }
    c.stroke();
    // Strain-relief boot — a LONG colored taper with a molded collar ring,
    // meeting the cord exactly where the rubber begins.
    c.beginPath();
    c.moveTo(JACK_GRIP * s, -GRIP_HW * s);
    c.lineTo((JACK_GRIP + 0.02) * s, -BAND_HW * s * 1.12);
    c.lineTo(JACK_LEN * s, -BOOT_TAIL_HW * s);
    c.lineTo(JACK_LEN * s, BOOT_TAIL_HW * s);
    c.lineTo((JACK_GRIP + 0.02) * s, BAND_HW * s * 1.12);
    c.lineTo(JACK_GRIP * s, GRIP_HW * s);
    c.closePath();
    c.fillStyle = bootInk;
    c.fill();
    c.strokeStyle = ZONE_KEYLINE;
    c.lineWidth = 1;
    c.stroke();
    c.fillStyle = BOOT_SHADE;
    c.beginPath();
    c.moveTo(JACK_GRIP * s, 0);
    c.lineTo((JACK_GRIP + 0.02) * s, BAND_HW * s * 1.12);
    c.lineTo(JACK_LEN * s, BOOT_TAIL_HW * s);
    c.lineTo(JACK_LEN * s, 0);
    c.closePath();
    c.fill();
    c.restore();
  };

  // --- the debris: step + paint -------------------------------------------------
  const stepShards = (now: number): void => {
    if (now < shardClock) {
      // The sim went backward (RESET): the debris dies with its world.
      for (const s of shards) s.active = false;
      liveShards = 0;
      shardClock = now;
      return;
    }
    let steps = 0;
    while (shardClock + SHARD_DT <= now && steps < SHARD_DT_MAX_STEPS) {
      shardClock += SHARD_DT;
      steps += 1;
      for (let i = 0; i < shards.length; i += 1) {
        const s = shards[i];
        if (!s.active) continue;
        if (now - s.birth >= SHARD_LIFE) {
          s.active = false;
          liveShards -= 1;
          continue;
        }
        s.avy -= SHARD_G * SHARD_DT;
        s.ax += s.avx * SHARD_DT;
        s.ay += s.avy * SHARD_DT;
        s.arot += s.avr * SHARD_DT;
        if (s.ay < SHARD_REST_Y) {
          s.ay = SHARD_REST_Y;
          if (s.bounces < 2) {
            s.avy = -s.avy * (s.bounces === 0 ? 0.4 : 0.22);
            s.avx *= 0.7;
            s.avr *= 0.7;
            s.bounces += 1;
          } else {
            s.avy = 0;
            // The friction slide (9/s exponential, dt-honest).
            const keep = Math.exp(-9 * SHARD_DT);
            s.avx *= keep;
            s.avr *= keep;
          }
        }
      }
    }
    if (steps === SHARD_DT_MAX_STEPS) shardClock = now; // bounded; the law holds
  };

  const drawShards = (c: CanvasRenderingContext2D, now: number, v: View): void => {
    let drawn = 0;
    for (let i = 0; i < shards.length; i += 1) {
      const s = shards[i];
      if (!s.active) continue;
      const age = now - s.birth;
      if (age >= SHARD_LIFE) continue;
      const outFactor = age > SHARD_LIFE - SHARD_LIFE_OUT
        ? (SHARD_LIFE - age) / SHARD_LIFE_OUT
        : 1;
      const k = s.scale * outFactor;
      if (k <= 0) continue;
      v.toScreen(s.ax, s.ay, scratch);
      c.save();
      c.translate(scratch.x, scratch.y);
      c.rotate(s.arot);
      if (s.band !== null) {
        // The failing band's own shard — a flat chip of the polarity ink.
        const w = 0.052 * k * v.scale;
        const h = 0.02 * k * v.scale;
        c.fillStyle = s.band === 'red' ? PLUG_RED : PLUG_BLUE;
        c.fillRect(-w / 2, -h / 2, w, h);
      } else {
        // A dark cool-steel triangle (base 0.03 world, scaled).
        const b = 0.03 * k * v.scale;
        c.beginPath();
        c.moveTo(-b * 0.5, -b * 0.38);
        c.lineTo(b * 0.58, -b * 0.12);
        c.lineTo(-b * 0.08, b * 0.46);
        c.closePath();
        c.fillStyle = SHARD_STEEL_INKS[s.inkIndex] ?? SHARD_STEEL_INKS[0];
        c.fill();
      }
      c.restore();
      drawn += 1;
    }
    liveShards = drawn;
  };

  return {
    setView(next: View, devicePixelRatio: number): void {
      view = next;
      dpr = devicePixelRatio > 0 && Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1;
      canvas.width = Math.max(1, Math.round(next.width * dpr));
      canvas.height = Math.max(1, Math.round(next.height * dpr));
      canvas.style.width = `${next.width}px`;
      canvas.style.height = `${next.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintPanel();
      // Fog — the lit bench dissolving into the room above.
      fog = ctx.createLinearGradient(0, 0, 0, next.height * 0.32);
      fog.addColorStop(0, STAGE_VOID);
      fog.addColorStop(0.5, 'rgba(17,17,20,0.6)');
      fog.addColorStop(1, 'rgba(17,17,20,0)');
      letterSpacingOK =
        typeof (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing
        === 'string';
    },

    burst(at, band, simTime): void {
      // Find this burst's slots: prefer inactive ones; if the pool is full,
      // recycle the OLDEST live shards until there is room (rapid-fire
      // failures — a fresh death always reads over a stale one).
      const base: number[] = [];
      for (let i = 0; i < shards.length && base.length < SHARDS_PER_BURST; i += 1) {
        if (!shards[i].active) base.push(i);
      }
      while (base.length < SHARDS_PER_BURST) {
        let oldestTime = Number.POSITIVE_INFINITY;
        let oldest = -1;
        for (let i = 0; i < shards.length; i += 1) {
          if (shards[i].active && shards[i].birth < oldestTime) {
            oldestTime = shards[i].birth;
            oldest = i;
          }
        }
        if (oldest < 0) break;
        shards[oldest].active = false;
        liveShards -= 1;
        base.push(oldest);
      }
      for (let k = 0; k < base.length; k += 1) {
        const s = shards[base[k]];
        s.active = true;
        s.ax = at.x;
        s.ay = Math.max(at.y, SHARD_REST_Y);
        s.avx = s.dirX * s.speed;
        s.avy = s.dirY * s.speed;
        s.arot = 0;
        s.avr = s.scale * 10 * (s.inkIndex % 2 === 0 ? 1 : -1);
        s.bounces = 0;
        s.birth = simTime;
        s.band = s.inkIndex === -1 ? band : null;
      }
      liveShards += base.length;
    },

    clearFragments(): void {
      for (const s of shards) s.active = false;
      liveShards = 0;
    },

    pulseProbe(): PulseProbe {
      return {
        phase: probePhase,
        cords: probePulseCords.map((p) => ({ ...p })),
      };
    },

    stateProbe(): StateProbe {
      return {
        cords: probeStateCords.map((p) => ({
          ...p,
          bandLit: [p.bandLit[0], p.bandLit[1]] as [boolean, boolean],
        })),
        shards: liveShards,
      };
    },

    draw(frame: FrameInput): void {
      if (view === null) return;
      const c = ctx;
      const v = view;
      const paints = frame.paint ?? null;
      const phase = typeof frame.pulsePhase === 'number' ? frame.pulsePhase : null;
      const reduced = frame.reducedMotion === true;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.drawImage(bgCanvas as unknown as CanvasImageSource, 0, 0, v.width, v.height);
      // Modules first (the live stage — they drag).
      for (let i = 0; i < frame.modules.length; i += 1) {
        const r = frame.modules[i];
        v.toScreen(r.x, r.y, scratch);
        drawModule(c, scratch.x, scratch.y, r.w * v.scale, r.h * v.scale, r.zone, r.label);
      }
      // 2D-6 — the corner handles of the module being worked on (the
      // resizing one mid-drag, else the hovered one): drawn ON the module,
      // under the cords and jacks — furniture, not chrome.
      const handlesFor = typeof frame.handlesFor === 'number' ? frame.handlesFor : -1;
      if (handlesFor >= 0) {
        const r = frame.modules.find((m) => m.id === handlesFor);
        if (r !== undefined) {
          const hw = r.w / 2;
          const hh = r.h / 2;
          v.toScreen(r.x - hw, r.y + hh, handlePts[0]); // top-left
          v.toScreen(r.x + hw, r.y + hh, handlePts[1]); // top-right
          v.toScreen(r.x + hw, r.y - hh, handlePts[2]); // bottom-right
          v.toScreen(r.x - hw, r.y - hh, handlePts[3]); // bottom-left
          drawHandles(c, handlePts);
        }
      }
      // Cords, then jacks on top (a seated jack's tip plugs into the face).
      const cords = frame.state.cords;
      probePhase = phase ?? 0;
      probePulseCords.length = 0;
      probeStateCords.length = 0;
      for (let k = 0; k < cords.length && k < MAX_CORDS; k += 1) {
        const cord = cords[k];
        const n = Math.min(cord.points.length, MAX_POINTS);
        const base = k * MAX_POINTS;
        for (let i = 0; i < n; i += 1) {
          v.toScreen(cord.points[i].x, cord.points[i].y, pool[base + i]);
        }
        // --- the 2D-3 state furniture (the composition's per-cord reads) ----
        const p = paints !== null && k < paints.length ? paints[k] : null;
        const state: LifecycleState | 'none' = p?.state ?? 'none';
        const graceRemaining = p?.graceRemaining ?? null;
        const fade = p?.fade ?? null;
        const failingEnd = p?.failingEnd ?? null;
        const hiddenEnd = p?.jackHiddenEnd ?? null;
        // The cord's opacity: the grace dim (the visible countdown) composed
        // MULTIPLICATIVELY with the vanish fade — expiry never flashes back.
        const dim = graceRemaining !== null ? graceDimming(graceRemaining) : 1;
        const cordAlpha = dim * (fade !== null ? Math.max(0, 1 - fade) : 1);
        drawCord(c, base, n, v.scale, cordAlpha);
        // Stretch ticks — carried/awaiting-plug only (linked is the pulse's
        // state; popped/vanishing are the dim's), appearing with tautness.
        const tickGain =
          p !== null && (state === 'carried' || state === 'awaiting-plug')
            ? stretchTickGain(p.tautness)
            : 0;
        if (tickGain > 0) {
          drawTicks(
            c,
            cord.points,
            n,
            REST_SEGMENT,
            tickGain,
            v.scale,
            cordAlpha,
            v,
          );
        }
        // The chase pulse — exactly `linked`, the one glow.
        let pulseGain = 0;
        if (state === 'linked' && phase !== null) {
          const painted = drawPulse(c, base, n, phase, v.scale, scratchB);
          pulseGain = painted ? 1 : 0;
          probePulseCords.push({
            id: cord.id,
            gain: pulseGain,
            cx: scratchB.x,
            cy: scratchB.y,
          });
        }
        // End 0 = red input jack; end n−1 = blue output jack. Seated ends
        // draw perpendicular to their socket (pose from the interaction
        // layer); free ends continue the cord's own tangent.
        const bandLit: [boolean, boolean] = [true, true];
        const jackAlpha = fade !== null ? Math.max(0, 1 - fade) : 1;
        for (const [pi, color, litColor] of [
          [0, PLUG_RED, LIT_RED],
          [n - 1, PLUG_BLUE, LIT_BLUE],
        ] as const) {
          const endIndex = pi === 0 ? 0 : cord.points.length - 1;
          if (hiddenEnd === endIndex) continue; // shattered — the debris owns it
          const px = pool[base + pi].x;
          const py = pool[base + pi].y;
          const pose = frame.seatPoseOf(cord.id, endIndex);
          const seated = pose !== null;
          let ax: number;
          let ay: number;
          let socket: Vec2 | null = null;
          if (seated) {
            // The pose's normal is in WORLD space (y up); screen y is down.
            ax = pose.nx;
            ay = -pose.ny;
            // The port sits SEAT_DEPTH back OUT along the normal — the edge
            // line the tip crosses into.
            socket = v.toScreen(pose.x + pose.nx * SEAT_DEPTH, pose.y + pose.ny * SEAT_DEPTH, scratch);
          } else {
            // Free end: the body extends back along the cord (tip outward).
            const q = pi === 0 ? 1 : n - 2;
            ax = pool[base + q].x - px;
            ay = pool[base + q].y - py;
            const len = Math.hypot(ax, ay);
            if (len < 1e-6) {
              ax = 0;
              ay = -1; // degenerate (a fresh coil): dangle tip-down
            } else {
              ax /= len;
              ay /= len;
            }
          }
          // The failing band blinks dark through the grace's final window
          // (steady under reduced motion); a linked seated band lifts ×1.5
          // within its own hue (the lit-ink accent).
          let bandInk: string = color;
          if (failingEnd === endIndex && graceRemaining !== null) {
            const lit = graceBlinkOn(graceRemaining, { reduced });
            bandLit[pi === 0 ? 0 : 1] = lit;
            if (!lit) bandInk = GRIP_RUBBER; // the LED's off-half: unlit plastic
          } else if (state === 'linked' && seated) {
            bandInk = litColor;
          }
          drawJack(c, px, py, ax, ay, bandInk, color, v.scale, socket, jackAlpha);
        }
        probeStateCords.push({
          id: cord.id,
          tickGain,
          dim,
          fade,
          jackHidden: hiddenEnd !== null,
          bandLit,
        });
      }
      // The debris — after the cords, before the deny ring.
      stepShards(frame.simTime);
      drawShards(c, frame.simTime, v);
      // The deny ring — flat Plug Red paint, fading on the sim clock.
      if (frame.deny !== null) {
        const age = frame.simTime - frame.deny.t;
        if (age >= 0 && age < DENY_FADE_SECONDS) {
          const p = age / DENY_FADE_SECONDS;
          v.toScreen(frame.deny.x, frame.deny.y, scratch);
          c.beginPath();
          c.arc(scratch.x, scratch.y, (0.075 + 0.03 * p) * v.scale, 0, Math.PI * 2);
          c.globalAlpha = 1 - p;
          c.strokeStyle = PLUG_RED;
          c.lineWidth = 2.5;
          c.stroke();
          c.globalAlpha = 1;
        }
      }
      // Fog last — the whole stage recedes into the void at the top.
      if (fog !== null) {
        c.fillStyle = fog;
        c.fillRect(0, 0, v.width, v.height * 0.32);
      }
    },
  };
}

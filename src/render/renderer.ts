/**
 * 2D-2 — THE CANVAS 2D PAINTER (Professor X's lane: visual truth). The flat
 * Drum Machine Panel world: machined charcoal bench with panel seams and
 * corner bolts, eight candy-zoned steel modules, cords as stroked smooth
 * curves through the sim's own points, and the 1/4″ jack drawn in 2D at each
 * end — tapered tip, chrome shaft, dark knurled grip, color band + strain
 * relief (Plug Red #c22e26 / Plug Blue #2e58de, the refine-2 albedo values
 * proven to survive at full-frame distance).
 *
 * DESIGN.md's laws, translated flat: depth is MACHINED (1px bevels, seams,
 * fastener heads) or LIT (one fog falloff toward the top of the stage) — no
 * drop shadows, no glass; the only saturated color is state (zone
 * identities, plug polarity, the deny ring's Plug Red); nothing glows.
 * Motion is the sim's own — this layer paints exactly the state it is
 * handed, so a frozen sim holds its picture still.
 *
 * Discipline: ZERO per-frame allocation (screen-point shells are pooled
 * once; fonts/gradients are cached at resize), device-pixel-ratio correct
 * (the context transform carries the DPR; every coordinate is CSS px), and
 * resize-safe (`setView` rebuilds the cached panel at the new size).
 */
import type { SimState, Vec2 } from '../sim';
import { SEAT_DEPTH } from '../world/stage';
import type { SeatPose, StageRect } from '../world/stage';
import type { View } from '../world/view';

/** The narrow canvas surface the renderer needs (HTMLCanvasElement-shaped). */
export interface RendererCanvas {
  width: number;
  height: number;
  readonly style: { width: string; height: string };
  getContext(contextId: '2d'): CanvasRenderingContext2D | null;
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

/** The pool sizes for the world's own caps: 16 cords × 25 points. */
const MAX_CORDS = 16;
const MAX_POINTS = 25;

export interface Renderer {
  /** (Re)fit to a view + device pixel ratio; rebuilds the cached panel. */
  setView(view: View, dpr: number): void;
  /** Paint one frame. No allocation in steady state. */
  draw(frame: FrameInput): void;
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

  // --- the cord: layered strokes through the sim's own points -----------------
  // pts = the pool (absolute index base for this cord), n points.
  const drawCord = (c: CanvasRenderingContext2D, base: number, n: number, scale: number): void => {
    if (n < 2) return;
    c.lineJoin = 'round';
    c.lineCap = 'round';
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
  };

  // --- the 1/4″ jack: tip at the sim pin, body extending along +axis ----------
  const drawJack = (
    c: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    ax: number,
    ay: number,
    color: string,
    scale: number,
    socket: Vec2 | null,
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
    // Color sleeve band — the wide polarity collar.
    c.fillStyle = color;
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
    c.fillStyle = color;
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

    draw(frame: FrameInput): void {
      if (view === null) return;
      const c = ctx;
      const v = view;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.drawImage(bgCanvas as unknown as CanvasImageSource, 0, 0, v.width, v.height);
      // Modules first (the live stage — they drag).
      for (let i = 0; i < frame.modules.length; i += 1) {
        const r = frame.modules[i];
        v.toScreen(r.x, r.y, scratch);
        drawModule(c, scratch.x, scratch.y, r.w * v.scale, r.h * v.scale, r.zone, r.label);
      }
      // Cords, then jacks on top (a seated jack's tip plugs into the face).
      const cords = frame.state.cords;
      for (let k = 0; k < cords.length && k < MAX_CORDS; k += 1) {
        const cord = cords[k];
        const n = Math.min(cord.points.length, MAX_POINTS);
        const base = k * MAX_POINTS;
        for (let i = 0; i < n; i += 1) {
          v.toScreen(cord.points[i].x, cord.points[i].y, pool[base + i]);
        }
        drawCord(c, base, n, v.scale);
        // End 0 = red input jack; end n−1 = blue output jack. Seated ends
        // draw perpendicular to their socket (pose from the interaction
        // layer); free ends continue the cord's own tangent.
        for (const [pi, color] of [
          [0, PLUG_RED],
          [n - 1, PLUG_BLUE],
        ] as const) {
          const px = pool[base + pi].x;
          const py = pool[base + pi].y;
          const pose = frame.seatPoseOf(cord.id, pi === 0 ? 0 : cord.points.length - 1);
          let ax: number;
          let ay: number;
          let socket: Vec2 | null = null;
          if (pose !== null) {
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
          drawJack(c, px, py, ax, ay, color, v.scale, socket);
        }
      }
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

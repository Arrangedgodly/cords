/**
 * Render layer — the three.js-owned side of the ARC-2 boundary. It READS sim
 * state and turns it into pixels; it never mutates sim state and never runs
 * simulation logic. src/sim/ must stay three-free (npm run check:sim); THIS
 * directory is the disposable part (PRODUCT.md: "The sim is liftable").
 *
 * REN-2 — the production cord + 1/4" jack renderer (the product's hero
 * object, per PRODUCT.md's brand commitment: "old-school 1/4″ phone plugs —
 * shiny metal shaft, tapered tip, dark sleeve grip; red input / blue output
 * coding carried on the sleeve band and/or strain relief"). The world is
 * still the committed REN-1 Drum Machine Panel stage; what changed:
 *
 * - CORD: the debug tube becomes the production tube — Catmull-Rom-smoothed
 *   centerline over the sim polyline (parallel-transport frames, analytic
 *   normals), matte dark rubber with a slight specular. Geometry is REBUILT
 *   only on a topology change (point-count change); on ordinary motion only
 *   the preallocated position/normal buffers are rewritten — and only when
 *   the rope actually MOVED (sim sleep = bitwise-frozen points = zero
 *   buffer writes and zero GPU re-uploads, checked per cord per frame).
 * - JACKS: both ends of every cord render as true phone plugs built from
 *   lathe profiles (no external models, no network): tapered metal tip →
 *   shaft with an insulator groove → color-coded sleeve band (red input /
 *   blue output) → dark knurled sleeve grip → color-coded strain-relief
 *   boot into the cable. All plugs of all cords share THREE InstancedMeshes
 *   (metal / dark grip / color-coded) — 3 draw calls for up to 16 cords —
 *   with per-instance matrices composed from the sim's end points and the
 *   outward tangent of the last cord segment (a seated or carried jack
 *   aligns along its cord, so the sim alone drives jack placement).
 * - PICKING: the invisible-but-raycastable end proxies stay (the INT-1 grab
 *   path is untouched); each now rides its VISIBLE jack instead of a bare
 *   end-cap, so what you grab is what you see.
 *
 * INT-2 — SEATED JACKS + DENY CUE:
 * - A seated jack must read as plugged into its cube face — perpendicular,
 *   not wobbling with the settling cord's last segment. `setSeatOverride`
 *   pins one end's plug to a seated transform (position + tip axis from the
 *   interaction layer's socket rule); sync writes that slot from the pose
 *   every moved frame, and set-time writes cover frozen/sleeping frames.
 *   Clearing the override returns the jack to cord-driven placement.
 * - `flashDeny` draws the cap-rejection cue: a flat red ring laid ON the
 *   cube face at the denied hit point, fading over ~0.35 s. World-honest by
 *   contract: an opaque painted mark in the scene — no glow, no additive
 *   blending, no bloom.
 *
 * T-LIFE-2 — THE VANISH SEQUENCE'S RENDER SIDE (the choreography itself is
 * the sim's, src/sim/vanish.ts; this layer only REACTS to its events):
 * - `shatter(at)` bursts a small pool of dark fragment particles at the
 *   impact point — the jack's own grip rubber as matte shards, ballistic,
 *   one floor bounce, brief, scale-out. Pooled and allocation-free.
 * - `hideJack` despawns the shattered end's jack with the fragments.
 * - `setCordFade` fades the whole cord through the pull window: the tube's
 *   OWN material clone (the fleet must not dim with it) plus the riding
 *   jack's pool-scale shrink.
 * - On despawn the view hides, its proxies leave the raycast layers (a dead
 *   proxy must not shadow its host cube's face), and the jack slots zero.
 *
 * REN-4 — THE LINK CHASE PULSE (the one sanctioned glow): on a LINKED cord a
 * short bright region — a warm amber LED, the panel's lit-segment ink —
 * travels the tube from the RED input end to the BLUE output end and
 * repeats, like signal flowing, like a chase light locked to a tempo clock.
 * The phase is a PURE function of SimState.time (src/render/pulse.ts —
 * deterministic, never wall-clock), consumed by ONE shader program shared by
 * every cord (per-cord uniform gate, no per-cord program):
 * - GEOMETRY: each tube carries a per-vertex arc-length fraction attribute
 *   (`aPulseArc`, 0 at the red jack, 1 at the blue jack), recomputed inside
 *   the existing zero-alloc moved-frame update pass — arc lengths DO change
 *   as the cord moves, so they ride the same rewrite (a sleeping cord's
 *   frozen geometry keeps its frozen arc lengths; the pulse animates only
 *   through the uniform).
 * - SHADER: the shared MeshStandardMaterial (each cord's fade clone) gains a
 *   gaussian LED term added to `totalEmissiveRadiance` — no additive
 *   blending, no bloom, no halo pass; the tube's own PBR surface simply
 *   emits where the light is. The brightness envelope ramps in as the light
 *   leaves the red jack and out as it sinks into the blue one (no hard pop
 *   at either end or at the wrap).
 * - GATING: the pulse exists ONLY on `linked` cords (the caller passes the
 *   linked ids per frame; awaiting-plug / popped / vanishing / carried cords
 *   carry gain 0 — nothing decorative glows). Seated jacks of a linked cord
 *   carry a faint lit accent: their color-coded sleeve band brightens within
 *   its own hue (an albedo lift in the panel's lit-ink grammar — no halo, so
 *   it can never read as decoration), reverting the frame the link is gone.
 *
 * REN-5 — STATE PAINT (ticks, grace, shatter refinement; the pure laws live
 * in states.ts): every non-linked lifecycle state now carries its own honest
 * visual, all still gated by the caller's per-frame lifecycle truth:
 * - STRETCH TICKS: a taut carried/awaiting-plug cord (span ≥ 90% of its rest
 *   length — the leash moment, "learning its length") carries thin silkscreen
 *   registration marks along the tube, one every rest-length, painted INTO
 *   the tube's albedo (a mix toward neutral ink — measurement furniture, not
 *   glow, never red). They spread with the measured arc, appear with taut
 *   stretch and vanish at rest, linked/popped/vanishing cords carry none.
 * - POPPED GRACE: the cord dims linearly toward states.ts's floor through
 *   the ~3s window (the visible countdown), and the popped jack's color band
 *   blinks like a low-battery LED through the window's final half,
 *   quickening toward expiry — reduced motion holds the band steady (the
 *   A11Y seam). The dim composes multiplicatively with LIFE-2's vanish fade,
 *   so the expiry hand-off never flashes back to full.
 * - SHATTER (LIFE-2's first pass, refined): small dark METAL shards plus one
 *   red/blue BAND shard (the failure reads as THAT end dying), two floor
 *   bounces then a friction slide, resting briefly and scaling out with the
 *   cord. Still one pooled InstancedMesh — per-instance color, zero glow.
 *
 * Frame budget (Thor): floor + 8 cubes + N cord tubes + 3 instanced jack
 * meshes; the per-cord moved-gate means a sleeping scene costs only draws.
 * All textures and the PMREM environment (for the plugs' chrome) are baked
 * once at startup — zero network, zero assets.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { CordState, SimState, Vec3 } from '../sim';
import { createFrameGate } from './frameGate';
import type { FrameGate } from './frameGate';
import { pulsePhase } from './pulse';
import { graceBlinkOn, graceDimming, stretchTickGain } from './states';

/** The single sanctioned conversion point from sim data to three.js types. */
export function toThreeVector(v: Vec3): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, v.z);
}

/** World objects the composition root registers with the INT-1 picker. */
export interface StagePickables {
  /** The 8 steel-panel cubes (class 'cube' payloads live in main.ts). */
  cubes: THREE.Mesh[];
  /**
   * The invisible-but-raycastable grab proxy riding the VISIBLE jack of cord
   * `cordId` at sim point index `endIndex` (0 or the cord's last index).
   * Registered as pick class 'jack' by the composition root.
   */
  jackProxy(cordId: number, endIndex: number): THREE.Object3D | undefined;
}

/**
 * INT-2 — a seated jack's pose in world space (the interaction layer's
 * socket rule computes it; this layer only draws it). `position` is the
 * rope-end pin (the plug's tip apex); `axis` is the direction the tip
 * points — into the socket face.
 */
export interface SeatPose {
  position: Vec3;
  axis: Vec3;
}

/**
 * REN-5 — one cord's live grace countdown, composed per frame by the caller
 * (plain data, safe to reuse): `end` names the POPPED/failing jack (its band
 * is the low-battery LED), `remaining` the machine's grace seconds left,
 * `window` the cord's grace window. A VANISHING cord stays in the list at
 * `remaining` 0 so the dim holds its floor through LIFE-2's fade (no flash
 * back to full at expiry).
 */
export interface CordGraceInfo {
  id: number;
  end: 'first' | 'last';
  /** Seconds of grace left; 0 = at/past expiry (vanishing cords ride here). */
  remaining: number;
  /** The cord's grace window in seconds (the dimming ramp's denominator). */
  window: number;
}

/**
 * REN-4/REN-5 — the per-frame pulse + state-paint info (what the composition
 * tells the render layer about LIVE state; read-only, plain data, safe to
 * reuse). Absent = no cord pulses and no grace countdowns (the pre-REN-4
 * behavior).
 */
export interface RenderFrameInfo {
  /**
   * Cord ids currently in the `linked` lifecycle state — the ONLY state that
   * pulses. Ids not in the list render gain 0 (nothing decorative glows).
   */
  linked?: readonly number[];
  /**
   * REN-5 — popped (and expiry-riding vanishing) cords mid-countdown: the
   * dimming ramp + the final-second band blink. Absent/empty = no countdown.
   */
  grace?: readonly CordGraceInfo[];
  /**
   * The A11Y-1 seam (wired from prefers-reduced-motion by the composition;
   * A11Y-1 formalizes the policy): slows the chase cadence by
   * REDUCED_PULSE_SPEED_FACTOR instead of removing the pulse, and holds the
   * grace band STEADY (no blink; the dimming stays — it is state, not motion).
   */
  reducedMotion?: boolean;
}

/**
 * REN-5 — the per-cord paint truth one sync consumes (filled into ONE reused
 * object by the layer per frame; plain data, never retained).
 */
export interface CordPaintFrame {
  /** The sim's own clock (the blink's only time base — never wall time). */
  simTime: number;
  reduced: boolean;
  /** This cord's grace entry, or null when it is not counting down. */
  grace: CordGraceInfo | null;
}

export interface RenderLayer {
  /**
   * Draws one frame from a sim snapshot. Read-only over the state. The
   * optional `dtSeconds` (the frame's real delta) advances the T-LIFE-2
   * shatter fragments; without it the layer falls back to its own clamped
   * wall-clock delta (visual-only — the sim never sees it). The optional
   * `frame` is the REN-4/REN-5 pulse + state-paint frame info (which cords
   * are `linked`, which are mid-grace, + the reduced-motion seam); absent =
   * no cord pulses and no grace countdowns.
   */
  render(state: SimState, dtSeconds?: number, frame?: RenderFrameInfo): void;
  /** Starts the animation loop, invoking `frame(dtSeconds)` every tick. */
  start(frame: (dtSeconds: number) => void): void;
  dispose(): void;
  /**
   * INT-2 — pins cord `cordId`'s jack at end `end` ('first' = sim point 0,
   * 'last' = the cord's final point) to the SEATED pose the interaction
   * layer's socket rule computed; the jack then renders perpendicular to its
   * cube face even while the cord body is still settling (the last segment's
   * tangent wobbles; a seated plug must not). `null` clears the override and
   * returns the jack to cord-driven placement. Unknown cord ids are ignored.
   */
  setSeatOverride(cordId: number, end: 'first' | 'last', pose: SeatPose | null): void;
  /**
   * T-LIFE-2 — collapses ONE end's jack (the shattered end's mesh despawns
   * with the fragments): the slot's matrix zeroes and stays zero until the
   * cord despawns or the id re-spawns. Unknown cord ids are ignored.
   */
  hideJack(cordId: number, end: 'first' | 'last'): void;
  /**
   * T-LIFE-2 — the vanish fade: `t` runs 0→1 through the pull window. The
   * cord's tube (its own material clone) loses opacity; the still-riding
   * jack shrinks through the pool's per-slot scale. t ≤ 0 restores full
   * opacity. Unknown cord ids are ignored.
   */
  setCordFade(cordId: number, t: number): void;
  /**
   * T-LIFE-2 (REN-5-refined) — the shatter effect: a small burst of dark
   * METAL shards plus the failing jack's color-band fragment at the impact
   * point, brief, pooled — `band` names the failing end's polarity ('red' |
   * 'blue') so the failure reads as THAT end dying. `reduced` is the A11Y-1
   * seam (prefers-reduced-motion skips the particles; the SEQUENCE — jack
   * despawn, pull-out, fade — is unchanged). NO glow, no additive blending.
   */
  shatter(at: Vec3, options?: { reduced?: boolean; band?: 'red' | 'blue' }): void;
  /**
   * INT-2 — the soft-cap deny cue: a flat red ring laid onto cube
   * `cubeIndex`'s face at world point `at`, oriented along `normal` (the
   * resolved face axis), fading out over ~0.35 s. One ring exists — a second
   * flash replaces the first (a denial is a single decisive mark).
   */
  flashDeny(cubeIndex: number, at: Vec3, normal: Vec3): void;
  /**
   * INT-1 integration seam (read-only): the picking layer's raycaster needs
   * the projection camera and the canvas viewport rect to turn client pixels
   * into world rays. Render ownership stays here — these are references, not
   * control.
   */
  readonly camera: THREE.PerspectiveCamera;
  readonly domElement: HTMLCanvasElement;
  /**
   * Read-only renderer reference (dev instrumentation — draw-call/triangle
   * counts for the frame-budget evidence; never used to mutate the scene).
   */
  readonly renderer: THREE.WebGLRenderer;
  /**
   * Read-only reference to the shared jack instance pool (dev instrumentation
   * + harness evidence: per-mesh instance counts without touching the scene).
   */
  readonly jackPool: JackInstances;
  /** Read-only scene reference (dev instrumentation, same contract as camera). */
  readonly scene: THREE.Scene;
  /** REN-1/REN-2: what the composition root registers as pickable. */
  readonly pickables: StagePickables;
  /**
   * LIFE-3 — the resilience gate (context-loss + hidden-tab pauses, clean
   * resume, the env re-bake hook). start() wires the real DOM events through
   * it; the probe is read-only verification truth (main.ts re-exposes it as
   * `window.cords.resilience()` for the e2e drives).
   */
  readonly frameGate: FrameGate;
  /** REN-4 — the render layer's live pulse read (verification seam). */
  readonly pulseProbe: PulseProbe;
  /**
   * REN-5 — the render layer's live state-paint read (verification seam):
   * every view's tautness, tick gain/spacing, grace dim factor, and band
   * state — the drives assert the RENDERER's truth, not a re-computation.
   */
  readonly stateProbe: StateProbe;
}

/** Per-cord render spec the world hands the stage at construction time. */
export interface CordRenderSpec {
  /** Matches `CordState.id` from the sim. */
  id: number;
  /** Sim point count (segmentCount + 1) — sizes the tube's buffers. */
  pointCount: number;
  /**
   * Which end carries the RED input plug: 'first' (point index 0, the
   * default) or 'last'. The other end is the BLUE output plug.
   */
  redEnd?: 'first' | 'last';
  /**
   * REN-5 — one segment's rest length (world units); `(pointCount − 1) ×
   * segmentLength` is the cord's total rest length, the tautness denominator
   * and the tick ruler's unit. Default 0.1 = the sim's DEFAULT_ROPE_CONFIG.
   */
  segmentLength?: number;
}

export interface StageWorldOptions {
  /** Cords to pre-allocate views for (more may appear lazily at render). */
  cords?: CordRenderSpec[];
}

/**
 * REN-4 — the render layer's own pulse read (the verification seam, the
 * render-side twin of `window.cords.pulse()`'s clock math): the LIVE phase
 * uniform this layer will draw the next frame with, plus every cord view's
 * gain gate. Read-only; drives/e2e assert against it, nothing writes it.
 */
export type PulseProbe = () => {
  phase: number;
  cords: Array<{ id: number; gain: number }>;
};

/**
 * REN-5 — the render layer's own state-paint read (the verification seam for
 * ticks + grace): per cord view, the tautness the ticks key on, the tick
 * gain/spacing uniforms as drawn, the grace dim factor applied to the tube,
 * and whether the failing jack's band is blinked OFF this frame — plus the
 * shatter pool's live shard count (the burst is observable without pixels).
 * Read-only.
 */
export type StateProbe = () => {
  /** Live shatter shards in the pooled fragment mesh (0 = none in flight). */
  fragments: number;
  cords: Array<{
    id: number;
    /** End-to-end span over rest length (1 = leash-taut). */
    stretch: number;
    tickGain: number;
    tickSpacing: number;
    /** Tube opacity factor from the grace countdown (1 = not counting down). */
    graceFactor: number;
    /** True while the popped/failing jack's band is in its blinked-off phase. */
    bandOff: boolean;
  }>;
};

// ---------------------------------------------------------------------------
// Procedural textures — small canvases painted once at startup. The Drum
// Machine Panel grammar: machined charcoal steel, silkscreen-honest markings
// (seams, screws, module ids), candy color zones only where state will live.
// ---------------------------------------------------------------------------

function makeFloorTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('render: 2d canvas unavailable');

  // Base plate tone: charcoal, but ALBEDO-dark not ALBEDO-black — the bench
  // must read as lit steel under the key, not as a hole in the scene.
  ctx.fillStyle = '#22252a';
  ctx.fillRect(0, 0, size, size);

  // Machined speckle — faint machining noise across the plate.
  for (let i = 0; i < 700; i += 1) {
    const l = Math.random();
    ctx.fillStyle =
      l > 0.5
        ? `rgba(255,255,255,${0.012 + Math.random() * 0.03})`
        : `rgba(0,0,0,${0.02 + Math.random() * 0.05})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 1);
  }

  // Panel seam along the tile's top and right edges (repeat-wrapped, so the
  // floor reads as 4x4-unit machined panels). Dark gap + one lit bevel edge.
  ctx.fillStyle = '#0d0f12';
  ctx.fillRect(0, 0, size, 5);
  ctx.fillRect(size - 5, 0, 5, size);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(0, 5, size, 1);
  ctx.fillRect(size - 6, 0, 1, size);

  // Corner bolts per panel — real fasteners, not decoration.
  for (const [bx, by] of [[18, 18], [size - 18, 18], [18, size - 18], [size - 18, size - 18]]) {
    ctx.fillStyle = '#101215';
    ctx.beginPath();
    ctx.arc(bx, by, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    ctx.beginPath();
    ctx.arc(bx - 1, by - 1, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(16, 16);
  // Half-tile offset so no seam runs through the world origin — otherwise a
  // seam sits exactly under the hanging cord and reads as one long pole.
  texture.offset.set(0.5, 0.5);
  texture.anisotropy = Math.min(8, maxAnisotropy);
  return texture;
}

/** The eight candy zones — 80s instrument colors over charcoal steel. */
const CUBE_COLORS = [
  '#e8433f', // signal red
  '#f2903a', // tangerine
  '#f2d43a', // sulfur yellow
  '#2fbd72', // jade — REFINE-2: cooler/deeper green (was #58c470, HSV hue 133°);
             // beside the CORDS amber it read amber-warm at meter scale
  '#3ec8d8', // reef cyan
  '#4a7df2', // cobalt
  '#d857c8', // magenta
  '#e8e3d5', // bone
] as const;

function makeCubeTexture(index: number): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('render: 2d canvas unavailable');

  // Brushed steel plate.
  ctx.fillStyle = '#2a2d31';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 48; i += 1) {
    ctx.fillStyle =
      i % 2 === 0
        ? `rgba(255,255,255,${0.015 + Math.random() * 0.02})`
        : `rgba(0,0,0,${0.02 + Math.random() * 0.03})`;
    const y = Math.random() * size;
    ctx.fillRect(0, y, size, 1);
  }

  // Faceplate edge: inset seam + lit bevel.
  ctx.strokeStyle = '#15171a';
  ctx.lineWidth = 6;
  ctx.strokeRect(9, 9, size - 18, size - 18);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 2;
  ctx.strokeRect(13, 13, size - 26, size - 26);

  // Corner screws.
  for (const [sx, sy] of [[26, 26], [size - 26, 26], [26, size - 26], [size - 26, size - 26]]) {
    ctx.fillStyle = '#111316';
    ctx.beginPath();
    ctx.arc(sx, sy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.arc(sx - 1.5, sy - 1.5, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Candy color zone — the module's pad. Flat fill, darker keyline.
  const color = CUBE_COLORS[index % CUBE_COLORS.length];
  const zx = 64;
  const zy = 118;
  const zw = 128;
  const zh = 56;
  const r = 10;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(zx, zy, zw, zh, r);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Silkscreen module id — names the real pickable, nothing else.
  ctx.fillStyle = '#8f96a0';
  ctx.font = '700 24px ui-monospace, Menlo, Consolas, monospace';
  ctx.textBaseline = 'top';
  ctx.fillText(`0${index + 1}`, 30, 42);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Scattered bench placement (x, z) — a stage, not a grid; clear of the cord.
 * Exported for the composition root's opening staging (REFINE-3), so the
 * seated opening plug can never drift from the bench it sits on. */
export const CUBE_POSITIONS: ReadonlyArray<readonly [number, number]> = [
  [-1.65, -0.35],
  [-0.85, 0.95],
  [-1.25, -1.55],
  [0.85, 1.05],
  [1.7, 0.15],
  [1.25, -1.35],
  [-0.4, -2.1],
  [0.45, 1.95],
];

/** Edge length of the stage's cubes (world units) — INT-3 drags these. */
export const CUBE_SIZE = 0.5;

// ---------------------------------------------------------------------------
// Cord tube — the production cord mesh: a fixed-capacity geometry whose
// position/normal buffers are rewritten IN PLACE from the sim polyline, and
// only when that polyline changed. The centerline is Catmull-Rom-smoothed
// (the sim's linear segments become a continuous cable), framed with
// parallel transport, and shaded with analytic normals — smooth without any
// recompute pass.
// ---------------------------------------------------------------------------

const CORD_RADIUS = 0.03;
const CORD_RADIAL_SEGMENTS = 10;
const CORD_SUBDIVISIONS = 4; // rings per sim segment

export class CordTube {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.BufferGeometry;
  // Replaced only when the sim's point count changes (never in steady state);
  // the buffers themselves are written in place every update.
  private positions: THREE.BufferAttribute;
  private normals: THREE.BufferAttribute;
  /**
   * REN-4 — per-vertex arc-length fraction along the rendered centerline,
   * oriented RED end → BLUE end (0 at the red jack, 1 at the blue one).
   * Recomputed inside the same moved-frame pass as the positions: arc
   * lengths change as the cord moves, so they ride the identical rewrite.
   */
  private pulseArc: THREE.BufferAttribute;
  private pointCount = 0;
  private rings = 0;
  private centers: Float64Array = new Float64Array(0);
  private tangents: Float64Array = new Float64Array(0);
  private ringNormals: Float64Array = new Float64Array(0);
  private binormals: Float64Array = new Float64Array(0);
  /** REN-4 — cumulative centerline arc length per ring (scratch). */
  private ringArc: Float64Array = new Float64Array(0);
  /**
   * REN-5 — the last update's measured total arc (world units): the tick
   * ruler's denominator (spacing = segmentLength / arc) and, divided by the
   * rest total, the stretch read the tick gain keys on. Frozen with the tube
   * when the rope sleeps.
   */
  measuredArc = 0;

  constructor(material: THREE.Material) {
    this.geometry = new THREE.BufferGeometry();
    this.positions = new THREE.BufferAttribute(new Float32Array(0), 3);
    this.normals = new THREE.BufferAttribute(new Float32Array(0), 3);
    this.pulseArc = new THREE.BufferAttribute(new Float32Array(0), 1);
    this.geometry.setAttribute('position', this.positions);
    this.geometry.setAttribute('normal', this.normals);
    this.geometry.setAttribute('aPulseArc', this.pulseArc);
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false; // buffers mutate in place every frame
    this.mesh.visible = false;
  }

  /** Rebuilds index/scratch buffers when (and only when) the point count changes. */
  private ensureCapacity(pointCount: number): void {
    if (pointCount === this.pointCount) return;
    this.pointCount = pointCount;
    const segments = pointCount - 1;
    this.rings = segments * CORD_SUBDIVISIONS + 1;
    const ringVerts = this.rings * CORD_RADIAL_SEGMENTS;
    const vertexCount = ringVerts + 2; // + two cap centers

    this.positions = new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3);
    this.normals = new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3);
    this.pulseArc = new THREE.BufferAttribute(new Float32Array(vertexCount), 1);
    this.geometry.setAttribute('position', this.positions);
    this.geometry.setAttribute('normal', this.normals);
    this.geometry.setAttribute('aPulseArc', this.pulseArc);

    const indices: number[] = [];
    for (let j = 0; j < this.rings - 1; j += 1) {
      for (let r = 0; r < CORD_RADIAL_SEGMENTS; r += 1) {
        const a = j * CORD_RADIAL_SEGMENTS + r;
        const b = j * CORD_RADIAL_SEGMENTS + (r + 1) % CORD_RADIAL_SEGMENTS;
        const c = a + CORD_RADIAL_SEGMENTS;
        const d = b + CORD_RADIAL_SEGMENTS;
        indices.push(a, c, b, b, c, d);
      }
    }
    const capA = ringVerts;
    const capB = ringVerts + 1;
    const lastRingStart = (this.rings - 1) * CORD_RADIAL_SEGMENTS;
    for (let r = 0; r < CORD_RADIAL_SEGMENTS; r += 1) {
      const r0 = r;
      const r1 = (r + 1) % CORD_RADIAL_SEGMENTS;
      indices.push(capA, r1, r0); // start cap (faces -tangent)
      indices.push(capB, lastRingStart + r0, lastRingStart + r1); // end cap
    }
    this.geometry.setIndex(indices);
    // Written in place every frame; a static huge bounds avoids per-frame
    // recompute without wrongly culling the mesh.
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e3);

    this.centers = new Float64Array(this.rings * 3);
    this.tangents = new Float64Array(this.rings * 3);
    this.ringNormals = new Float64Array(this.rings * 3);
    this.binormals = new Float64Array(this.rings * 3);
    this.ringArc = new Float64Array(this.rings);
  }

  /**
   * Rewrites the tube along the sim polyline. Zero per-frame allocation:
   * every buffer here is preallocated and only ever mutated.
   * `redEnd` orients the REN-4 pulse arc (0 at the red input jack, 1 at the
   * blue output jack — the chase light's travel direction).
   */
  update(points: ReadonlyArray<Vec3>, redEnd: 'first' | 'last' = 'first'): void {
    this.ensureCapacity(points.length);
    const n = points.length;
    const rings = this.rings;
    const { centers, tangents, ringNormals, binormals } = this;

    // Ring centers: Catmull-Rom samples along the polyline — the sim's
    // straight segments read as one continuous cable. Ring 0 and the last
    // ring land EXACTLY on the sim's end points (the jacks mount there).
    const maxT = n - 1;
    for (let j = 0; j < rings; j += 1) {
      const t = (j / (rings - 1)) * maxT;
      let i = Math.floor(t);
      if (i > n - 2) i = n - 2;
      const f = t - i;
      const ia = i > 0 ? i - 1 : 0;
      const id = i + 2 < n ? i + 2 : n - 1;
      const p0 = points[ia];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[id];
      const f2 = f * f;
      const f3 = f2 * f;
      const k = j * 3;
      for (let c = 0; c < 3; c += 1) {
        const v0 = c === 0 ? p0.x : c === 1 ? p0.y : p0.z;
        const v1 = c === 0 ? p1.x : c === 1 ? p1.y : p1.z;
        const v2 = c === 0 ? p2.x : c === 1 ? p2.y : p2.z;
        const v3 = c === 0 ? p3.x : c === 1 ? p3.y : p3.z;
        centers[k + c] =
          0.5 *
          (2 * v1 +
            (-v0 + v2) * f +
            (2 * v0 - 5 * v1 + 4 * v2 - v3) * f2 +
            (-v0 + 3 * v1 - 3 * v2 + v3) * f3);
      }
    }

    // REN-4 — the chase light's road: cumulative arc length over the
    // RENDERED ring centers (the exact centerline the pulse travels — a
    // segment-index fraction would misplace the LED wherever the cord
    // stretches taut or pools slack, so the arc is measured, not assumed).
    // Written into the per-vertex aPulseArc attribute, oriented red → blue.
    {
      const arc = this.ringArc;
      arc[0] = 0;
      let total = 0;
      for (let j = 1; j < rings; j += 1) {
        const k = j * 3;
        const kp = k - 3;
        const dx = centers[k] - centers[kp];
        const dy = centers[k + 1] - centers[kp + 1];
        const dz = centers[k + 2] - centers[kp + 2];
        // sqrt of the sum, not Math.hypot: measured ~0.2 ms/frame cheaper on
        // the 12-cord worst case (hypot's 3-arg path is slow in V8) for the
        // same IEEE-754-quality result at these magnitudes.
        total += Math.sqrt(dx * dx + dy * dy + dz * dz);
        arc[j] = total;
      }
      const arcArr = this.pulseArc.array as Float32Array;
      const inv = total > 1e-12 ? 1 / total : 0;
      const flip = redEnd === 'last'; // 0 at the RED jack, 1 at the BLUE one
      for (let j = 0; j < rings; j += 1) {
        const s = flip ? 1 - arc[j] * inv : arc[j] * inv;
        const base = j * CORD_RADIAL_SEGMENTS;
        for (let r = 0; r < CORD_RADIAL_SEGMENTS; r += 1) arcArr[base + r] = s;
      }
      // Cap centers sit exactly on ring 0 / the last ring — same arc value.
      arcArr[rings * CORD_RADIAL_SEGMENTS] = arcArr[0];
      arcArr[rings * CORD_RADIAL_SEGMENTS + 1] =
        arcArr[(rings - 1) * CORD_RADIAL_SEGMENTS];
      // REN-5 — publish the measured total for this frame's tick paint.
      this.measuredArc = total;
    }

    // Tangents (central differences, one-sided at the ends), normalized.
    // Degenerate segments (coincident points — a collapsed cord) inherit the
    // previous ring's tangent, or +Y at the start, so normals never zero out.
    for (let j = 0; j < rings; j += 1) {
      const k = j * 3;
      const kp = Math.max(j - 1, 0) * 3;
      const kn = Math.min(j + 1, rings - 1) * 3;
      const tx = centers[kn] - centers[kp];
      const ty = centers[kn + 1] - centers[kp + 1];
      const tz = centers[kn + 2] - centers[kp + 2];
      const len = Math.hypot(tx, ty, tz);
      if (len < 1e-9) {
        if (j > 0) {
          tangents[k] = tangents[k - 3];
          tangents[k + 1] = tangents[k - 2];
          tangents[k + 2] = tangents[k - 1];
        } else {
          tangents[k] = 0;
          tangents[k + 1] = 1;
          tangents[k + 2] = 0;
        }
      } else {
        tangents[k] = tx / len;
        tangents[k + 1] = ty / len;
        tangents[k + 2] = tz / len;
      }
    }

    // Parallel transport: carry a normal along the curve, orthonormalized
    // against each tangent — twist-free, continuous frame for the tube.
    {
      const t0x = tangents[0];
      const t0y = tangents[1];
      const t0z = tangents[2];
      // Seed normal: cross(t0, world axis LEAST aligned with t0) — a hanging
      // cord's top segment is vertical, so "up" is exactly the wrong seed.
      const ax = Math.abs(t0x);
      const ay = Math.abs(t0y);
      const az = Math.abs(t0z);
      let nx: number;
      let ny: number;
      let nz: number;
      if (ax <= ay && ax <= az) {
        nx = 0; ny = t0z; nz = -t0y; // × (1,0,0)
      } else if (ay <= az) {
        nx = -t0z; ny = 0; nz = t0x; // × (0,1,0)
      } else {
        nx = t0y; ny = -t0x; nz = 0; // × (0,0,1)
      }
      const nl = Math.hypot(nx, ny, nz) || 1;
      ringNormals[0] = nx / nl;
      ringNormals[1] = ny / nl;
      ringNormals[2] = nz / nl;
      binormals[0] = t0y * ringNormals[2] - t0z * ringNormals[1];
      binormals[1] = t0z * ringNormals[0] - t0x * ringNormals[2];
      binormals[2] = t0x * ringNormals[1] - t0y * ringNormals[0];
    }
    for (let j = 1; j < rings; j += 1) {
      const k = j * 3;
      const kp = (j - 1) * 3;
      const tx = tangents[k];
      const ty = tangents[k + 1];
      const tz = tangents[k + 2];
      // Project the previous normal onto the plane ⊥ this tangent.
      const d =
        ringNormals[kp] * tx + ringNormals[kp + 1] * ty + ringNormals[kp + 2] * tz;
      let nx = ringNormals[kp] - d * tx;
      let ny = ringNormals[kp + 1] - d * ty;
      let nz = ringNormals[kp + 2] - d * tz;
      let nl = Math.hypot(nx, ny, nz);
      if (nl < 1e-9) {
        // Pathological (tangent flipped against the normal): fall back to
        // projecting the previous BINORMAL, which is orthogonal to the normal
        // that just failed and almost never parallel to the new tangent.
        const bx = binormals[kp];
        const by = binormals[kp + 1];
        const bz = binormals[kp + 2];
        const db = bx * tx + by * ty + bz * tz;
        nx = bx - db * tx;
        ny = by - db * ty;
        nz = bz - db * tz;
        nl = Math.hypot(nx, ny, nz) || 1;
      }
      ringNormals[k] = nx / nl;
      ringNormals[k + 1] = ny / nl;
      ringNormals[k + 2] = nz / nl;
      // Binormal = t × n.
      binormals[k] = ty * ringNormals[k + 2] - tz * ringNormals[k + 1];
      binormals[k + 1] = tz * ringNormals[k] - tx * ringNormals[k + 2];
      binormals[k + 2] = tx * ringNormals[k + 1] - ty * ringNormals[k];
    }

    // Vertices: ring j around centers[j]; analytic normals (no recompute).
    const posArr = this.positions.array as Float32Array;
    const nrmArr = this.normals.array as Float32Array;
    for (let j = 0; j < rings; j += 1) {
      const k = j * 3;
      const cx = centers[k];
      const cy = centers[k + 1];
      const cz = centers[k + 2];
      const nx = ringNormals[k];
      const ny = ringNormals[k + 1];
      const nz = ringNormals[k + 2];
      const bx = binormals[k];
      const by = binormals[k + 1];
      const bz = binormals[k + 2];
      for (let r = 0; r < CORD_RADIAL_SEGMENTS; r += 1) {
        const a = (r / CORD_RADIAL_SEGMENTS) * Math.PI * 2;
        const cosA = Math.cos(a);
        const sinA = Math.sin(a);
        const ox = nx * cosA + bx * sinA;
        const oy = ny * cosA + by * sinA;
        const oz = nz * cosA + bz * sinA;
        const vi = (j * CORD_RADIAL_SEGMENTS + r) * 3;
        posArr[vi] = cx + ox * CORD_RADIUS;
        posArr[vi + 1] = cy + oy * CORD_RADIUS;
        posArr[vi + 2] = cz + oz * CORD_RADIUS;
        nrmArr[vi] = ox;
        nrmArr[vi + 1] = oy;
        nrmArr[vi + 2] = oz;
      }
    }
    // Cap centers.
    const capA = rings * CORD_RADIAL_SEGMENTS * 3;
    posArr[capA] = centers[0];
    posArr[capA + 1] = centers[1];
    posArr[capA + 2] = centers[2];
    nrmArr[capA] = -tangents[0];
    nrmArr[capA + 1] = -tangents[1];
    nrmArr[capA + 2] = -tangents[2];
    const capB = (rings * CORD_RADIAL_SEGMENTS + 1) * 3;
    const kl = (rings - 1) * 3;
    posArr[capB] = centers[kl];
    posArr[capB + 1] = centers[kl + 1];
    posArr[capB + 2] = centers[kl + 2];
    nrmArr[capB] = tangents[kl];
    nrmArr[capB + 1] = tangents[kl + 1];
    nrmArr[capB + 2] = tangents[kl + 2];

    this.positions.needsUpdate = true;
    this.normals.needsUpdate = true;
    this.pulseArc.needsUpdate = true;
    this.mesh.visible = true;
  }
}

// ---------------------------------------------------------------------------
// REN-4 — THE LINK CHASE PULSE's shader side. ONE program for the whole
// fleet: every cord tube's material (the per-cord fade clone) carries the
// identical onBeforeCompile injection, and `customProgramCacheKey` pins the
// cache entry, so 12 cords = 12 draw calls (unchanged) sharing one compiled
// program. The uniforms split by ownership:
//   - SHARED (one object, referenced by every material): uPulsePhase (the
//     sim-clock phase, written once per frame) + uPulseColor (the amber).
//   - PER CORD: uPulseGain — 0 for every non-linked cord (the gate), the
//     emissive gain for a linked one. Same object reference flows into every
//   clone's shader.uniforms, so updating .value updates the whole fleet.
//
// The light itself: a gaussian LED term added to totalEmissiveRadiance —
// the tube's own PBR surface emits where the light is (no additive blend,
// no bloom, no halo pass; fog still owns distance). The brightness envelope
// ramps in as the light leaves the red jack and out as it sinks into the
// blue one, so neither end nor the wrap ever pops.
// ---------------------------------------------------------------------------

/** The panel's lit-segment amber (index-html silkscreen LED, #f2d43a). */
const PULSE_AMBER_HEX = 0xf2d43a;
/** Emissive gain at the LED's core (reads as a lit LED through ACES 1.45). */
export const PULSE_EMISSIVE_GAIN = 2.4;
/**
 * Gaussian sharpness 1/(2σ²) in arc fraction: σ ≈ 0.05 ≈ 0.12 u of a 2.4 u
 * cord — a chunky chase-light segment (probe-measured ~25–30 px on a draped
 * bench cord at the fixed camera; wide enough to read mid-travel in a still,
 * narrow enough to travel like a chase light, nothing like a lit tube).
 */
const PULSE_SHARPNESS = 200.0;
/** The LED ramps in over the first / out over the last 15% of the traverse. */
const PULSE_EDGE = 0.15;

/**
 * REN-5 — the stretch ticks' ink: the panel's key-chip neutral (#b6bcc6, the
 * measured 6.76:1 legend ink), NOT red — silkscreen registration furniture,
 * measurement rather than damage. Mixed into the tube's ALBEDO (a painted
 * mark on the rubber, like silkscreen on a cable) — no emissive term, so the
 * furniture can never read as glow.
 */
const TICK_INK_HEX = 0xb6bcc6;

/** The per-fleet shared chase-pulse + tick uniforms (phase/amber/ink), one object. */
export interface ChasePulseState {
  readonly phase: { value: number };
  readonly color: { value: THREE.Color };
  /** REN-5 — the shared tick ink (every cord's marks print in the same ink). */
  readonly tickInk: { value: THREE.Color };
}

export function createChasePulseState(): ChasePulseState {
  return {
    phase: { value: 0 },
    color: { value: new THREE.Color(PULSE_AMBER_HEX) },
    tickInk: { value: new THREE.Color(TICK_INK_HEX) },
  };
}

/** REN-5 — one cord's own tick uniforms (gain gate + ruler spacing). */
export interface TickState {
  /** 0 = no furniture (rest / linked / counting-down cords); 1 = full ink. */
  readonly gain: { value: number };
  /** Arc FRACTION per tick (segmentLength / measured arc). */
  readonly spacing: { value: number };
}

/**
 * Attaches the chase-pulse + tick injection to ONE cord tube material (the
 * fade clone). `gain` is that cord's own pulse uniform (0 = not linked);
 * `tick` its own tick pair. The injected source is byte-identical for every
 * cord, so three.js compiles ONE program for the fleet.
 */
export function attachChasePulse(
  material: THREE.MeshStandardMaterial,
  pulse: ChasePulseState,
  gain: { value: number },
  tick: TickState = { gain: { value: 0 }, spacing: { value: 0.25 } },
): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uPulsePhase = pulse.phase;
    shader.uniforms.uPulseColor = pulse.color;
    shader.uniforms.uPulseGain = gain;
    shader.uniforms.uTickGain = tick.gain;
    shader.uniforms.uTickSpacing = tick.spacing;
    shader.uniforms.uTickInk = pulse.tickInk;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aPulseArc;\nvarying float vPulseArc;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvPulseArc = aPulseArc;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vPulseArc;\nuniform float uPulsePhase;\nuniform vec3 uPulseColor;\nuniform float uPulseGain;\nuniform float uTickGain;\nuniform float uTickSpacing;\nuniform vec3 uTickInk;',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  // REN-5 — the stretch ticks: silkscreen registration marks painted into
  // the tube's albedo, one per rest length of MEASURED arc (the spacing
  // uniform is a fraction of the arc, so the ruler spreads as the cord
  // straightens and reads as measured, not assumed). A thin band across the
  // tube: full ink within ±0.07 of the spacing, eased to nothing by ±0.15
  // (≈4–7 px at bench depth — a graduation mark, not a stripe).
  float tickPhase = fract(vPulseArc / max(uTickSpacing, 1e-5));
  float tickD = min(tickPhase, 1.0 - tickPhase);
  float tick = 1.0 - smoothstep(0.07, 0.15, tickD);
  diffuseColor.rgb = mix(diffuseColor.rgb, uTickInk, tick * uTickGain);
}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  // REN-4 — the chase LED: gaussian core at the phase, envelope ramped in
  // leaving the red jack and out arriving at the blue one (no hard pop).
  float pulseEnv = smoothstep(0.0, ${PULSE_EDGE.toFixed(2)}, uPulsePhase)
    * (1.0 - smoothstep(${(1 - PULSE_EDGE).toFixed(2)}, 1.0, uPulsePhase));
  float pulseD = vPulseArc - uPulsePhase;
  float pulseCore = exp(-pulseD * pulseD * ${PULSE_SHARPNESS.toFixed(1)});
  totalEmissiveRadiance += uPulseColor * (pulseCore * pulseEnv * uPulseGain);
}`,
      );
  };
  // Identical injection source for every cord → ONE program in the cache.
  material.customProgramCacheKey = () => 'cords-chase-pulse';
}

// ---------------------------------------------------------------------------
// 1/4" phone plugs — the brand commitment (PRODUCT.md), built from lathe
// profiles (primitives only; no models, no network). Local frame: +Y points
// from the cable TOWARD the tip (the direction the plug enters a socket);
// a jack is oriented along its cord's outward end tangent.
//
// Anatomy (tip → cable), the checklist each plug must read as:
//   1. TAPERED TIP      — shiny metal cone with a soft apex  [metal lathe]
//   2. insulator groove — dark recess separating tip from sleeve [metal lathe]
//   3. SHAFT (sleeve)   — shiny metal cylinder, the long body [metal lathe]
//   4. SLEEVE BAND      — color-coded ring: red input / blue output [coded]
//   5. SLEEVE GRIP      — dark knurled rubber, slightly fatter [grip lathe]
//   6. STRAIN RELIEF    — color-coded rubber boot into the cable [coded]
//
// Scale: the cord cable is r=0.03 (0.06 diameter). A true-scale 1/4" plug
// is barely wider than its cable (6.35 mm shaft vs ~6 mm cable) — honest,
// but at sandbox scale it renders as a thin stick and the anatomy cannot
// read. The plug is drawn at hero-object scale (~0.37 long, head ~0.15
// wide — proportions of a real vintage plug's head-to-shaft): the tip
// taper, the color band, and the knurled grip all stay readable next to a
// 0.5-unit cube.
// ---------------------------------------------------------------------------

const PLUG_RADIAL_SEGMENTS = 16;
/** Red input coding (PRODUCT.md) — deep signal red; it must survive the
 * warm key without drifting to orange. */
const PLUG_RED = 0xc22e26;
/**
 * Blue output coding — REFINE-2: a deeper cobalt than the cube zone's
 * (#4a7df2 → #2e58de; G/B 0.52 → 0.40, same hue family, +0.02 OKLCH chroma),
 * the exact treatment PLUG_RED already documents: the warm key (#ffd2a0,
 * ACES 1.45) drains the blue channel and lifts green, and the old band's
 * carry-distance pixels rendered ~(79,104,154) — desaturated slate that read
 * teal/gray mid-air. Measured at the critique's own carry point, the deeper
 * albedo renders (65,91,173) — hue 220.6°→225.8°, sat 0.49→0.64 — while the
 * red control holds (206,64,48); like-for-like with the red (OKLCH L 51.7
 * vs the red's 53.6 — the polarity pair sits at matched lightness and
 * differentiates by hue alone).
 */
const PLUG_BLUE = 0x2e58de;
/**
 * REN-4 — the seated-jack LIT ACCENT (the approved reading: "the pulse +
 * seated jacks may read lit"): a linked cord's seated plugs brighten their
 * color-coded band WITHIN ITS OWN HUE (a ×1.5 albedo lift — lit ink in the
 * panel's grammar, not a glow; no halo, no bloom, so it can never read as
 * decoration). The accent exists only while the cord is linked and reverts
 * the frame the link is gone. Computed once at module scope.
 */
const PLUG_RED_LIT = new THREE.Color(PLUG_RED).multiplyScalar(1.5);
const PLUG_BLUE_LIT = new THREE.Color(PLUG_BLUE).multiplyScalar(1.5);
/**
 * REN-5 — the popped jack's band in its BLINKED-OFF phase: the grip rubber's
 * own dark (a low-battery LED's dark half reads as unlit plastic, not as a
 * new color — the band paints dark, exactly like the grip beside it).
 */
const PLUG_BAND_OFF = new THREE.Color(0x17181c);

function latheFrom(profile: ReadonlyArray<readonly [number, number]>): THREE.LatheGeometry {
  const points = profile.map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(points, PLUG_RADIAL_SEGMENTS);
}

export interface PlugGeometries {
  /** Tip + insulator groove + shaft — one continuous metal profile. */
  metal: THREE.LatheGeometry;
  /** Dark knurled sleeve grip. */
  grip: THREE.LatheGeometry;
  /** Color-coded sleeve band + strain-relief boot (merged). */
  coded: THREE.BufferGeometry;
}

export function buildPlugGeometries(): PlugGeometries {
  // Metal: tip apex (y=0) down the shaft. The radius dips between tip and
  // sleeve — the insulating groove that makes the TS silhouette read.
  const metal = latheFrom([
    [0.0015, 0.0],
    [0.01, -0.005],
    [0.026, -0.02],
    [0.044, -0.04], // tapered tip cone
    [0.049, -0.05],
    [0.049, -0.06],
    [0.037, -0.066], // insulator groove
    [0.037, -0.076],
    [0.049, -0.082], // saddle
    [0.049, -0.17], // shiny shaft (sleeve conductor)
  ]);

  // Dark rubber grip with two shallow knurl grooves (real plugs have them).
  const grip = latheFrom([
    [0.066, -0.206],
    [0.068, -0.212],
    [0.068, -0.224],
    [0.063, -0.228], // knurl groove
    [0.068, -0.232],
    [0.068, -0.244],
    [0.063, -0.248], // knurl groove
    [0.068, -0.252],
    [0.068, -0.28],
  ]);

  // Color coding: the sleeve band (between shaft and grip) and the strain
  // relief boot (from the grip into the cable) — red OR blue per plug.
  const band = latheFrom([
    [0.055, -0.17],
    [0.055, -0.206],
  ]);
  const relief = latheFrom([
    [0.072, -0.28],
    [0.074, -0.29], // slight bulge — a real molded boot
    [0.06, -0.325],
    [CORD_RADIUS, -0.368], // meets the cable surface exactly
  ]);
  const coded = mergeGeometries([band, relief]);
  band.dispose();
  relief.dispose();
  if (coded === null) throw new Error('render: plug geometry merge failed');
  return { metal, grip, coded };
}

/** Shared plug materials. `env` is the baked PMREM map that makes metal read as metal. */
export interface PlugMaterials {
  metal: THREE.MeshStandardMaterial;
  grip: THREE.MeshStandardMaterial;
  coded: THREE.MeshStandardMaterial; // white base; per-instance red/blue
}

export function createPlugMaterials(env: THREE.Texture | null): PlugMaterials {
  return {
    metal: new THREE.MeshStandardMaterial({
      color: 0xd6dade,
      metalness: 1.0,
      roughness: 0.24,
      envMap: env,
      envMapIntensity: 1.1,
    }),
    grip: new THREE.MeshStandardMaterial({
      color: 0x17181c,
      roughness: 0.88,
      metalness: 0.0,
      envMap: env,
      envMapIntensity: 0.25,
    }),
    coded: new THREE.MeshStandardMaterial({
      color: 0xffffff, // instanceColor carries the red/blue coding
      roughness: 0.62,
      metalness: 0.0,
      envMap: env,
      envMapIntensity: 0.3,
    }),
  };
}

const JACK_CAPACITY = 32; // 16 cords × 2 ends — headroom over the 12-cord DoD

/**
 * Every plug of every cord, in THREE draw calls. Each cord claims two stable
 * instance slots (first end, last end); per frame the stage writes instance
 * matrices straight into the preallocated InstancedMesh arrays (position =
 * the sim's end point, orientation = the outward end tangent) and flags the
 * upload only when something actually changed. The span is MONOTONE — a
 * frame where no cord moved must never collapse `count` (a frozen sim still
 * shows its plugs); vanished cords are zeroed in place via hideSlots.
 *
 * T-LIFE-2 — per-slot UNIFORM SCALE (the vanish fade) and single-slot HIDES
 * (the shattered end's jack despawns with the fragments): writeJack composes
 * with `slotScale[slot]` (default 1), hideSlot zeroes one slot's matrix.
 * Both are pooled state — no allocation, no material swaps.
 */
export class JackInstances {
  readonly group: THREE.Group;
  private readonly metal: THREE.InstancedMesh;
  private readonly grip: THREE.InstancedMesh;
  private readonly coded: THREE.InstancedMesh;
  /** Slots are stable per cord, so count tracks the SPAN — never shrinks. */
  private span = 0;
  private lastDrawn = -1;
  private colorDirty = true;
  private slotsDirty = false;
  // Per-slot polarity stamp: skip rewriting instanceColor when unchanged.
  private readonly polarity: Uint8Array;
  /** T-LIFE-2 — per-slot uniform scale (1 = full size; 0 = collapse). */
  private readonly slotScale: Float64Array;
  private readonly zeroMatrix = new Float32Array(16);
  // Preallocated scratch — the per-frame path allocates nothing.
  private readonly scratchMatrix = new THREE.Matrix4();
  private readonly scratchQuat = new THREE.Quaternion();
  private readonly scratchPos = new THREE.Vector3();
  private readonly scratchDir = new THREE.Vector3();
  private readonly scratchScale = new THREE.Vector3();
  private readonly scratchColor = new THREE.Color();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(materials: PlugMaterials, capacity: number = JACK_CAPACITY) {
    const geo = buildPlugGeometries();
    this.metal = new THREE.InstancedMesh(geo.metal, materials.metal, capacity);
    this.grip = new THREE.InstancedMesh(geo.grip, materials.grip, capacity);
    this.coded = new THREE.InstancedMesh(geo.coded, materials.coded, capacity);
    for (const mesh of [this.metal, this.grip, this.coded]) {
      mesh.frustumCulled = false; // instances move every frame
      mesh.count = 0;
    }
    // Preallocate the instance color buffer (startup, not per frame).
    for (let i = 0; i < capacity; i += 1) this.coded.setColorAt(i, this.scratchColor.setHex(0xffffff));
    this.coded.instanceColor!.needsUpdate = true;
    this.polarity = new Uint8Array(capacity);
    this.slotScale = new Float64Array(capacity).fill(1);
    this.group = new THREE.Group();
    this.group.add(this.metal, this.grip, this.coded);
  }

  get capacity(): number {
    return JACK_CAPACITY;
  }

  beginFrame(): void {
    // Intentionally no span reset: a frame where nothing moves must keep
    // drawing the plugs it already uploaded (frozen/sleeping sim).
  }

  /**
   * Writes the plug at instance slot `slot`: anchored at (x,y,z), tip along
   * the (already outward) tangent (tx,ty,tz), color red or blue, scaled by
   * the slot's vanish fade (T-LIFE-2). `lit` (REN-4) brightens the
   * color-coded band — the seated-jack accent of a LINKED cord. `bandOff`
   * (REN-5) paints the band DARK — the popped jack's low-battery blink's
   * off-phase; the stamp space (1/2 red/blue, 3/4 lit, 5/6 band-off) keeps
   * rewrites to actual state flips only. Zero allocation.
   */
  writeJack(
    slot: number,
    x: number, y: number, z: number,
    tx: number, ty: number, tz: number,
    red: boolean,
    lit = false,
    bandOff = false,
  ): void {
    this.scratchDir.set(tx, ty, tz);
    const len = this.scratchDir.length();
    if (len < 1e-9) this.scratchDir.copy(this.up);
    else this.scratchDir.multiplyScalar(1 / len);
    this.scratchQuat.setFromUnitVectors(this.up, this.scratchDir);
    const s = this.slotScale[slot];
    this.scratchMatrix.compose(
      this.scratchPos.set(x, y, z),
      this.scratchQuat,
      this.scratchScale.set(s, s, s),
    );
    const elements = this.scratchMatrix.elements;
    for (const mesh of [this.metal, this.grip, this.coded]) {
      ;(mesh.instanceMatrix.array as Float32Array).set(elements, slot * 16);
    }
    if (slot + 1 > this.span) this.span = slot + 1;
    // Stamp: 1/2 = red/blue at rest; 3/4 = red/blue LIT (the linked accent);
    // 5/6 = red/blue BAND-OFF (the grace blink's dark phase).
    const stamp = (red ? 1 : 2) + (lit ? 2 : 0) + (bandOff ? 4 : 0);
    if (this.polarity[slot] !== stamp) {
      this.polarity[slot] = stamp;
      if (bandOff) {
        this.scratchColor.copy(PLUG_BAND_OFF);
      } else if (lit) {
        this.scratchColor.copy(red ? PLUG_RED_LIT : PLUG_BLUE_LIT);
      } else {
        this.scratchColor.setHex(red ? PLUG_RED : PLUG_BLUE);
      }
      this.coded.setColorAt(slot, this.scratchColor);
      this.colorDirty = true;
    }
  }

  /** Collapses a vanished cord's two slots (zero-scale matrices render
   * nothing) — the middle of the pool must not resurrect stale plugs. */
  hideSlots(slotA: number, slotB: number): void {
    this.hideSlot(slotA);
    this.hideSlot(slotB);
  }

  /**
   * T-LIFE-2 — collapses ONE slot: the shattered end's jack despawns with
   * the fragments (its matrix zeroes; its scale stamps 0 so a stray rewrite
   * still renders nothing until the slot is explicitly revived).
   */
  hideSlot(slot: number): void {
    for (const mesh of [this.metal, this.grip, this.coded]) {
      (mesh.instanceMatrix.array as Float32Array).set(this.zeroMatrix, slot * 16);
    }
    this.slotScale[slot] = 0;
    this.slotsDirty = true;
  }

  /**
   * T-LIFE-2 — records a slot's uniform scale (the vanish fade shrinks the
   * riding jack as the tube fades). Pure record: the matrix picks it up on
   * the next writeJack (a fading cord is always in motion), and hideSlot /
   * the despawn/revive path stamps it authoritatively.
   */
  setSlotScale(slot: number, scale: number): void {
    if (!Number.isFinite(scale) || scale < 0) return;
    this.slotScale[slot] = scale;
  }

  /** Uploads buffers only when the instance set or its contents changed. */
  endFrame(forceUpload: boolean): void {
    const changed =
      forceUpload || this.slotsDirty || this.span !== this.lastDrawn || this.colorDirty;
    if (!changed) return;
    for (const mesh of [this.metal, this.grip, this.coded]) {
      mesh.count = this.span;
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (this.colorDirty && this.coded.instanceColor !== null) {
      this.coded.instanceColor.needsUpdate = true;
    }
    this.lastDrawn = this.span;
    this.colorDirty = false;
    this.slotsDirty = false;
  }
}

// ---------------------------------------------------------------------------
// T-LIFE-2/REN-5 — the shatter fragments, refined to the panel grammar: the
// jack breaks into small dark METAL shards plus its color-coded BAND fragment
// (the failure reads as THAT end dying — a red band shard or a blue one). Two
// floor bounces, then a short friction slide; the shards rest briefly and
// scale out with the cord. NO glow, no additive blending, no bloom — hardware
// honesty. Pooled and allocation-free after construction (ONE InstancedMesh,
// flat state arrays, per-instance colors); deterministic per construction (a
// seeded LCG, no wall-clock, no Math.random).
// ---------------------------------------------------------------------------

const FRAGMENT_CAPACITY = 64;
const FRAGMENT_LIFETIME = 0.55; // seconds — brief, resting, gone with the cord
const FRAGMENT_GRAVITY = 9.81;
/** Two bounces (a couple, per the contract), the second deader than the first. */
const FRAGMENT_RESTITUTIONS = [0.4, 0.22] as const;
/** Rest-slide friction, per second (exponential decay — dt-honest). */
const FRAGMENT_SLIDE_FRICTION = 9;
/**
 * REFINE-1 — the burst's default shard count: 18 (was 14). The critique read
 * the old burst as "a few pixels" at full-frame distance; three more steel
 * pieces + one more band piece restore the "jack broke" read while staying
 * far inside the 64-slot pool (three concurrent bursts before wrap).
 */
const FRAGMENT_BURST_COUNT = 18;
/**
 * REFINE-1 — a shard of the plug's own scale: base 0.03 (was 0.02). At the
 * bench's ~173 px/world-unit the old 0.024–0.032 rendered shards were 4–5 px
 * of noise; 0.03 with the widened scale range below puts steel at ~6–9 px and
 * the band piece at ~10 px — legible metal, still zero glow.
 */
const FRAGMENT_BASE_SIZE = 0.03;
/**
 * The dark-steel shard ink, PER CHANNEL (a numeric hex RANGE would carry
 * bytes across channels): the base byte varies 0x23..0x3a (slight LCG
 * variation, never pure black), green a touch under, blue a touch over —
 * a dark cool steel that still catches the env's chrome glint.
 */
const FRAGMENT_STEEL_MIN_BYTE = 0x23;
const FRAGMENT_STEEL_RANGE_BYTE = 0x18;

export class FragmentPool {
  readonly mesh: THREE.InstancedMesh;
  private readonly capacity: number;
  private readonly life: Float64Array;
  private readonly maxLife: Float64Array;
  private readonly px: Float64Array;
  private readonly py: Float64Array;
  private readonly pz: Float64Array;
  private readonly vx: Float64Array;
  private readonly vy: Float64Array;
  private readonly vz: Float64Array;
  private readonly size: Float64Array;
  private readonly yaw: Float64Array;
  private readonly pitch: Float64Array;
  private readonly spin: Float64Array;
  /** Bounces spent (0..2 — then the shard rests and slides. */
  private readonly bounced: Uint8Array;
  private cursor = 0;
  private active = 0;
  private cleared = true;
  private colorDirty = false;
  /** Seeded LCG — two pools produce identical bursts (no Math.random). */
  private rngState = 0x2f6e2b1;
  // Scratch — the per-frame path allocates nothing.
  private readonly scratchMatrix = new THREE.Matrix4();
  private readonly scratchQuat = new THREE.Quaternion();
  private readonly scratchEuler = new THREE.Euler();
  private readonly scratchPos = new THREE.Vector3();
  private readonly scratchScale = new THREE.Vector3();
  private readonly scratchColor = new THREE.Color();
  private readonly zeroMatrix = new Float32Array(16);

  constructor(material: THREE.Material, capacity: number = FRAGMENT_CAPACITY) {
    this.capacity = capacity;
    this.mesh = new THREE.InstancedMesh(
      new THREE.TetrahedronGeometry(FRAGMENT_BASE_SIZE),
      material,
      capacity,
    );
    this.mesh.frustumCulled = false;
    this.mesh.count = capacity; // dead slots carry zero matrices
    this.life = new Float64Array(capacity);
    this.maxLife = new Float64Array(capacity);
    this.px = new Float64Array(capacity);
    this.py = new Float64Array(capacity);
    this.pz = new Float64Array(capacity);
    this.vx = new Float64Array(capacity);
    this.vy = new Float64Array(capacity);
    this.vz = new Float64Array(capacity);
    this.size = new Float64Array(capacity);
    this.yaw = new Float64Array(capacity);
    this.pitch = new Float64Array(capacity);
    this.spin = new Float64Array(capacity);
    this.bounced = new Uint8Array(capacity);
    // Preallocate the instance color buffer (startup, not per burst) — every
    // shard's color is per-instance; the material stays white-based.
    for (let i = 0; i < capacity; i += 1) this.mesh.setColorAt(i, this.scratchColor.setHex(0xffffff));
    this.mesh.instanceColor!.needsUpdate = true;
    // Every slot starts as a zero matrix so nothing draws at the origin.
    const zeros = this.zeroMatrix;
    for (let i = 0; i < capacity; i += 1) {
      (this.mesh.instanceMatrix.array as Float32Array).set(zeros, i * 16);
    }
  }

  /** Uniform random in [0, 1) from the seeded LCG (deterministic). */
  private nextRandom(): number {
    this.rngState = (Math.imul(this.rngState, 1664525) + 1013904223) >>> 0;
    return this.rngState / 4294967296;
  }

  get activeCount(): number {
    return this.active;
  }

  /**
   * Scatters `count` shards from the impact point `at` — dark metal, plus
   * (when `band` names the failing end's polarity) two shards in that end's
   * RED/BLUE band ink, one of them the burst's largest piece: the failure
   * reads as THAT end dying. `reduced: true` is the A11Y-1 seam
   * (prefers-reduced-motion): the burst no-ops entirely — the SEQUENCE is
   * unchanged (the jack still despawns; only the particles simplify away).
   */
  burst(
    at: Vec3,
    options: { count?: number; reduced?: boolean; band?: 'red' | 'blue' } = {},
  ): number {
    if (options.reduced === true) return 0;
    const count = Math.max(0, Math.min(options.count ?? FRAGMENT_BURST_COUNT, this.capacity));
    const bandHex = options.band === 'red' ? PLUG_RED : options.band === 'blue' ? PLUG_BLUE : null;
    for (let k = 0; k < count; k += 1) {
      const slot = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
      if (this.life[slot] <= 0) this.active += 1;
      const theta = this.nextRandom() * Math.PI * 2;
      const elevation = 0.35 + this.nextRandom() * 0.9; // up-and-out hemisphere
      const speed = 0.7 + this.nextRandom() * 1.5;
      const cosE = Math.cos(elevation);
      this.life[slot] = FRAGMENT_LIFETIME * (0.85 + this.nextRandom() * 0.3);
      this.maxLife[slot] = this.life[slot];
      this.px[slot] = at.x + (this.nextRandom() - 0.5) * 0.03;
      this.py[slot] = Math.max(0.012, at.y + (this.nextRandom() - 0.5) * 0.02);
      this.pz[slot] = at.z + (this.nextRandom() - 0.5) * 0.03;
      this.vx[slot] = cosE * Math.cos(theta) * speed;
      this.vy[slot] = Math.sin(elevation) * speed;
      this.vz[slot] = cosE * Math.sin(theta) * speed;
      // REFINE-1 — scale range widened 0.6–1.6 → 0.75–1.75 so every shard
      // clears the pixel-noise floor at full-frame camera distance.
      this.size[slot] = 0.75 + this.nextRandom();
      this.yaw[slot] = this.nextRandom() * Math.PI * 2;
      this.pitch[slot] = this.nextRandom() * Math.PI;
      this.spin[slot] = (this.nextRandom() > 0.5 ? 1 : -1) * (2 + this.nextRandom() * 4);
      this.bounced[slot] = 0;
      // The paint: dark cool steel with slight LCG variation, or the band
      // ink for the two band shards (slot k=0 — the burst's first and
      // largest piece — and one more a little into the scatter, so both
      // read at a glance).
      const isBand = bandHex !== null && (k === 0 || k === Math.min(3, count - 1));
      if (isBand) {
        this.scratchColor.setHex(bandHex);
        if (k === 0) this.size[slot] = Math.max(this.size[slot], 1.8); // the big one
      } else {
        const base =
          FRAGMENT_STEEL_MIN_BYTE + Math.floor(this.nextRandom() * FRAGMENT_STEEL_RANGE_BYTE);
        const hex = (base << 16) | (Math.max(0, base - 3) << 8) | Math.min(0xff, base + 8);
        this.scratchColor.setHex(hex);
      }
      this.mesh.setColorAt(slot, this.scratchColor);
      this.colorDirty = true;
    }
    this.cleared = false;
    return count;
  }

  /**
   * Advances every live shard by `dt` (clamped — a backgrounded tab's spike
   * cannot fling debris) and rewrites the instance matrices: ballistic
   * flight, gravity, TWO floor bounces (restitution 0.4 then 0.22, tangential
   * loss at each impact), then a friction slide to rest; the last 35% of
   * each life eases the scale to zero (the vanish takes its debris with it).
   * Zero allocation; dead slots above the live set are zeroed so the pool's
   * tail never flashes stale shards.
   */
  update(dtSeconds: number): void {
    if (this.active === 0 && this.cleared && !this.colorDirty) return;
    const dt = Number.isFinite(dtSeconds) && dtSeconds > 0 ? Math.min(dtSeconds, 0.05) : 0;
    const array = this.mesh.instanceMatrix.array as Float32Array;
    let live = 0;
    for (let slot = 0; slot < this.capacity; slot += 1) {
      let remaining = this.life[slot];
      if (remaining <= 0) {
        array.set(this.zeroMatrix, slot * 16);
        continue;
      }
      remaining -= dt;
      if (remaining <= 0) {
        this.life[slot] = 0;
        array.set(this.zeroMatrix, slot * 16);
        this.active -= 1;
        continue;
      }
      this.life[slot] = remaining;
      if (dt > 0) {
        this.vy[slot] -= FRAGMENT_GRAVITY * dt;
        this.px[slot] += this.vx[slot] * dt;
        this.py[slot] += this.vy[slot] * dt;
        this.pz[slot] += this.vz[slot] * dt;
        this.yaw[slot] += this.spin[slot] * dt;
        const rest = FRAGMENT_BASE_SIZE * this.size[slot];
        if (this.py[slot] < rest) {
          this.py[slot] = rest;
          if (this.bounced[slot] < FRAGMENT_RESTITUTIONS.length && this.vy[slot] < -0.05) {
            // A bounce: give back a fraction of the impact, lose tangential.
            const restitution = FRAGMENT_RESTITUTIONS[this.bounced[slot]];
            this.vy[slot] = -this.vy[slot] * restitution;
            this.vx[slot] *= 0.65;
            this.vz[slot] *= 0.65;
            this.bounced[slot] += 1;
          } else {
            // Resting: the short slide — friction eats the horizontal run and
            // the spin settles with it (dt-honest exponential decay).
            this.vy[slot] = 0;
            const f = Math.max(0, 1 - FRAGMENT_SLIDE_FRICTION * dt);
            this.vx[slot] *= f;
            this.vz[slot] *= f;
            this.spin[slot] *= f;
          }
        }
      }
      // Scale-out over the final 35% of life — debris leaving with the cord.
      const fade = Math.min(1, remaining / (this.maxLife[slot] * 0.35));
      const s = this.size[slot] * fade;
      this.scratchEuler.set(this.pitch[slot], this.yaw[slot], 0);
      this.scratchQuat.setFromEuler(this.scratchEuler);
      this.scratchMatrix.compose(
        this.scratchPos.set(this.px[slot], this.py[slot], this.pz[slot]),
        this.scratchQuat,
        this.scratchScale.set(s, s, s),
      );
      array.set(this.scratchMatrix.elements, slot * 16);
      live += 1;
    }
    if (live === 0) this.cleared = true;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.colorDirty && this.mesh.instanceColor !== null) {
      this.mesh.instanceColor.needsUpdate = true;
      this.colorDirty = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Cord view — one cord's tube + its two jack slots + its two pick proxies,
// with the per-frame moved-gate (sim sleep = frozen points = no GPU work).
// ---------------------------------------------------------------------------

export class CordView {
  readonly tube: CordTube;
  /** Invisible-but-raycastable proxies: [first end, last end]. */
  readonly proxies: [THREE.Mesh, THREE.Mesh];
  readonly slotFirst: number;
  readonly slotLast: number;
  readonly redEnd: 'first' | 'last';
  /**
   * INT-2 — per-end seated poses (null = cord-driven placement). When set,
   * the end's jack renders from the pose (perpendicular to its cube face)
   * instead of the settling cord's last-segment tangent.
   */
  readonly seats: [SeatPose | null, SeatPose | null] = [null, null];
  /**
   * T-LIFE-2 — per-end jack hides: the shattered end's jack despawns with
   * the fragments and must never resurrect while its cord lives out the
   * pull window (sync would otherwise rewrite it every moved frame).
   */
  readonly hiddenEnds: [boolean, boolean] = [false, false];
  /**
   * T-LIFE-2 — true once the cord left the sim (despawned): tube hidden,
   * proxies' raycast layers off (a dead proxy must not shadow its host
   * cube's face — the LIFE-1 verifier's hazard), fade reset. A re-spawned
   * id revives the view in place.
   */
  despawned = false;
  /**
   * REN-4 — the chase-pulse gate: true only while the cord is `linked` (the
   * caller's per-frame truth). Drives this view's OWN uPulseGain uniform and
   * the seated jacks' lit accent; a change forces a jack rewrite even on a
   * FROZEN (sleeping) cord, where sync's moved-gate would otherwise skip it.
   */
  linked = false;
  /**
   * REN-4 — this cord's own pulse gain uniform (0 = nothing glows;
   * PULSE_EMISSIVE_GAIN while linked). Public read for the tests/e2e probe.
   */
  readonly pulseGain: { value: number };
  /**
   * REN-5 — this cord's own tick uniforms: the furniture's gain gate (0 on
   * rest/linked/counting-down cords) and the ruler's arc-fraction spacing.
   * Public reads for the state probe.
   */
  readonly tickGain: { value: number };
  readonly tickSpacing: { value: number };
  /**
   * REN-5 — the tautness the ticks key on (end-to-end span over rest total;
   * 1 = leash-taut). Updated every sync from the live points, frozen with
   * them when the rope sleeps. Public read for the state probe.
   */
  stretch = 0;
  /**
   * REN-5 — the grace countdown's tube opacity factor (1 = not counting
   * down; states.ts's floor at expiry). Composes MULTIPLICATIVELY with the
   * vanish fade so the expiry hand-off never flashes back to full.
   */
  graceFactor = 1;
  /**
   * REN-5 — true while this cord's popped/failing jack band is in its
   * blinked-OFF phase (the low-battery LED's dark half).
   */
  bandOff = false;
  /** REN-5 — one segment's rest length (the ruler unit; from the spec). */
  private readonly segmentLength: number;
  /** T-LIFE-2 — the cord's OWN material clone (a fade must not dim the fleet). */
  private readonly fadeMaterial: THREE.MeshStandardMaterial;
  /** T-LIFE-2/REN-5 — the vanish fade 0..1 (composes with graceFactor). */
  private fadeT = 0;
  /** Bitwise copy of the last synced sim points — the moved-gate. */
  private lastPoints: Float64Array;
  /** Frame id of the last render this view was seen in (vanish detection). */
  lastSeenFrame = -1;

  constructor(
    spec: CordRenderSpec,
    slots: { first: number; last: number },
    material: THREE.Material,
    proxyGeometry: THREE.BufferGeometry,
    proxyMaterial: THREE.Material,
    pulse: ChasePulseState = createChasePulseState(),
  ) {
    this.fadeMaterial = material.clone() as THREE.MeshStandardMaterial;
    this.pulseGain = { value: 0 };
    this.tickGain = { value: 0 };
    this.tickSpacing = { value: 0.25 };
    this.segmentLength = spec.segmentLength ?? 0.1; // the sim's rope default
    // REN-4/REN-5 — the clone carries the shared one-program injection with
    // this cord's OWN gates (pulse gain + the tick pair; clone() does not
    // carry onBeforeCompile, so the attachment is explicit per clone).
    attachChasePulse(this.fadeMaterial, pulse, this.pulseGain, {
      gain: this.tickGain,
      spacing: this.tickSpacing,
    });
    this.tube = new CordTube(this.fadeMaterial);
    this.proxies = [
      new THREE.Mesh(proxyGeometry, proxyMaterial),
      new THREE.Mesh(proxyGeometry, proxyMaterial),
    ];
    this.slotFirst = slots.first;
    this.slotLast = slots.last;
    this.redEnd = spec.redEnd ?? 'first';
    this.lastPoints = new Float64Array(spec.pointCount * 3);
  }

  /**
   * Syncs one sim cord into the GPU buffers + jack instances. Returns true
   * when anything moved (and therefore buffers were rewritten). `linked`
   * (REN-4) is the caller's per-frame lifecycle truth: it gates the chase
   * pulse (this view's uPulseGain) and the seated jacks' lit accent, and a
   * CHANGE forces the jack rewrite even for a frozen cord. `paint` (REN-5)
   * is the per-cord state paint: the grace countdown (tube dim + the failing
   * jack's band blink) and the sim clock the blink keys on; its band flips
   * also force the jack rewrite on a frozen (settled, sleeping) popped cord.
   */
  sync(cord: CordState, jacks: JackInstances, linked = false, paint?: CordPaintFrame): boolean {
    const points = cord.points;
    const n = points.length;
    if (n * 3 !== this.lastPoints.length) {
      // Topology change: rebuild path (rare — only on spawn/despawn).
      this.lastPoints = new Float64Array(n * 3);
    }
    let moved = false;
    const last = this.lastPoints;
    for (let i = 0; i < n; i += 1) {
      const p = points[i];
      const k = i * 3;
      if (last[k] !== p.x || last[k + 1] !== p.y || last[k + 2] !== p.z) {
        moved = true;
        break;
      }
    }
    // REN-4 — the pulse gate. Gain is the LED's own brightness: 0 for every
    // non-linked state (awaiting-plug, popped, vanishing, carried — nothing
    // decorative glows), full for the one live state that does.
    const linkFlipped = linked !== this.linked;
    if (linkFlipped) {
      this.linked = linked;
      this.pulseGain.value = linked ? PULSE_EMISSIVE_GAIN : 0;
    }
    if (moved) {
      for (let i = 0; i < n; i += 1) {
        const p = points[i];
        const k = i * 3;
        last[k] = p.x;
        last[k + 1] = p.y;
        last[k + 2] = p.z;
      }
      this.tube.update(points, this.redEnd);
    }
    // REN-5 — STATE PAINT (computed every sync, frozen-cords included; two
    // uniform writes + a material property, no buffer work).
    const a = points[0];
    const b = points[n - 1];
    const span = Math.sqrt(
      (b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y) + (b.z - a.z) * (b.z - a.z),
    );
    const restTotal = Math.max(1e-9, (n - 1) * this.segmentLength);
    this.stretch = span / restTotal;
    const inGrace = paint !== undefined && paint.grace !== null;
    // Ticks: only the stretching states (carried / awaiting-plug) — linked
    // belongs to the pulse, and a counting-down (popped/vanishing) cord
    // belongs to the grace dim. Furniture appears with tautness, not motion.
    this.tickGain.value = linked || inGrace ? 0 : stretchTickGain(this.stretch);
    const arc = this.tube.measuredArc;
    this.tickSpacing.value = arc > 1e-9 ? this.segmentLength / arc : 0.25;
    // Grace: the tube dims toward the floor, and the failing jack's band
    // blinks through the final half of the window, quickening toward expiry
    // (steady under reduced motion — A11Y-1).
    let bandOff = false;
    if (inGrace && paint !== undefined) {
      const g = paint.grace as CordGraceInfo;
      this.graceFactor = graceDimming(g.remaining, g.window);
      bandOff = !graceBlinkOn(g.remaining, paint.simTime, { reduced: paint.reduced });
    } else {
      this.graceFactor = 1;
    }
    const bandFlipped = bandOff !== this.bandOff;
    this.bandOff = bandOff;
    this.applyOpacity();
    if (moved || linkFlipped || bandFlipped) {
      // Jacks: anchored at the exact sim end points, tipped along the
      // OUTWARD tangent of the last cord segment (the sim's state — seated,
      // carried, or dangling — alone drives plug placement) — UNLESS the end
      // is seated (INT-2): a plugged jack snaps to its socket pose so it
      // stays perpendicular to the cube face while the cord settles. A
      // SEATED jack of a LINKED cord carries the faint lit accent (REN-4);
      // a counting-down cord's FAILING end carries the band blink (REN-5).
      const first = points[0];
      const second = points[1];
      const penult = points[n - 2];
      const endLast = points[n - 1];
      const seatFirst = this.seats[0];
      const seatLast = this.seats[1];
      const offFirst = bandOff && paint !== undefined && paint.grace !== null
        && (paint.grace as CordGraceInfo).end === 'first';
      const offLast = bandOff && paint !== undefined && paint.grace !== null
        && (paint.grace as CordGraceInfo).end === 'last';
      // T-LIFE-2 — a hidden end (the shattered jack) writes nothing: its
      // zero matrix stands until the whole cord despawns or the id revives.
      if (!this.hiddenEnds[0]) {
        if (seatFirst !== null) {
          jacks.writeJack(
            this.slotFirst,
            seatFirst.position.x, seatFirst.position.y, seatFirst.position.z,
            seatFirst.axis.x, seatFirst.axis.y, seatFirst.axis.z,
            this.redEnd === 'first',
            linked,
          );
        } else {
          jacks.writeJack(
            this.slotFirst,
            first.x, first.y, first.z,
            first.x - second.x, first.y - second.y, first.z - second.z,
            this.redEnd === 'first',
            false,
            offFirst,
          );
        }
      }
      if (!this.hiddenEnds[1]) {
        if (seatLast !== null) {
          jacks.writeJack(
            this.slotLast,
            seatLast.position.x, seatLast.position.y, seatLast.position.z,
            seatLast.axis.x, seatLast.axis.y, seatLast.axis.z,
            this.redEnd === 'last',
            linked,
          );
        } else {
          jacks.writeJack(
            this.slotLast,
            endLast.x, endLast.y, endLast.z,
            endLast.x - penult.x, endLast.y - penult.y, endLast.z - penult.z,
            this.redEnd === 'last',
            false,
            offLast,
          );
        }
      }
      this.proxies[0].position.set(first.x, first.y, first.z);
      this.proxies[1].position.set(endLast.x, endLast.y, endLast.z);
    }
    return moved;
  }

  /**
   * INT-2 — writes a seated end's jack slot straight from its pose (used at
   * override time, so the snap is visible even on a frozen/sleeping frame
   * where sync's moved-gate would skip the rewrite). REN-4: a LINKED cord's
   * seated plug carries the faint lit accent.
   */
  writeSeatedJack(jacks: JackInstances, end: 'first' | 'last'): void {
    const seat = end === 'first' ? this.seats[0] : this.seats[1];
    if (seat === null) return;
    if (end === 'first' ? this.hiddenEnds[0] : this.hiddenEnds[1]) return; // T-LIFE-2
    jacks.writeJack(
      end === 'first' ? this.slotFirst : this.slotLast,
      seat.position.x, seat.position.y, seat.position.z,
      seat.axis.x, seat.axis.y, seat.axis.z,
      this.redEnd === end,
      this.linked,
    );
  }

  /**
   * T-LIFE-2 — the vanish fade: `t` runs 0→1 through the pull window. The
   * tube's own material clone drops opacity — COMPOSED with the grace dim
   * (REN-5: `(1 − t) × graceFactor`, so a grace-expiry hand-off continues
   * from the dimmed level instead of flashing back to full). t ≥ 1 hides it
   * entirely (the despawn/revive path owns the final state); t ≤ 0 restores
   * full opacity. The riding jacks shrink through the pool's per-slot scale
   * (set by the layer, same t).
   */
  setFade(t: number): void {
    this.fadeT = !Number.isFinite(t) || t <= 0 ? 0 : t > 1 ? 1 : t;
    this.applyOpacity();
  }

  /**
   * REN-5 — the tube's effective opacity in one place: the vanish fade times
   * the grace dim. Full opacity stays OPAQUE (no transparency render-order
   * cost on a healthy cord); anything less turns transparency on.
   */
  private applyOpacity(): void {
    const o = Math.max(0, 1 - this.fadeT) * this.graceFactor;
    if (o >= 1 - 1e-9) {
      this.fadeMaterial.transparent = false;
      this.fadeMaterial.opacity = 1;
    } else {
      this.fadeMaterial.transparent = true;
      this.fadeMaterial.opacity = o;
    }
    if (this.fadeT >= 1) this.tube.mesh.visible = false;
    else this.tube.mesh.visible = true; // setFade(0) is revive()'s visibility reset
  }

  hide(): void {
    this.tube.mesh.visible = false;
  }

  /**
   * T-LIFE-2 — the cord left the sim: hide everything AND take the proxies
   * off the raycast layers (visibility never stopped a raycast — a dead
   * proxy would keep shadowing its host cube's face under jack > cube
   * priority; the LIFE-1 verifier's hazard, closed here).
   */
  despawn(): void {
    // T-REN-3 fix (latent LIFE-2 defect): reset the fade material FIRST,
    // hide LAST — setFade(0) RESTORES tube visibility (it is revive()'s
    // reset), so the previous order left a despawned view's frozen tube
    // mesh visible forever: a ghost cord frozen at its pulled pose after
    // every vanish. REN-3's RESET empties the whole scene through this
    // exact path, so the order is now pinned by test (scene.test.ts).
    this.seats[0] = null;
    this.seats[1] = null;
    this.linked = false; // REN-4 — a dead cord never glows
    this.pulseGain.value = 0;
    this.tickGain.value = 0; // REN-5 — and carries no furniture
    this.stretch = 0;
    this.graceFactor = 1; // REN-5 — no countdown outlives the cord
    this.bandOff = false;
    this.setFade(0);
    this.hide();
    this.hiddenEnds[0] = true;
    this.hiddenEnds[1] = true;
    for (const proxy of this.proxies) proxy.layers.disableAll();
    this.despawned = true;
  }

  /** T-LIFE-2 — the id re-spawned into this view: everything live again. */
  revive(jacks: JackInstances): void {
    this.hiddenEnds[0] = false;
    this.hiddenEnds[1] = false;
    jacks.setSlotScale(this.slotFirst, 1);
    jacks.setSlotScale(this.slotLast, 1);
    this.linked = false; // REN-4 — a fresh spawn is not linked; nothing glows
    this.pulseGain.value = 0;
    this.tickGain.value = 0; // REN-5 — fresh cord, no inherited paint
    this.stretch = 0;
    this.graceFactor = 1;
    this.bandOff = false;
    this.setFade(0);
    for (const proxy of this.proxies) proxy.layers.enable(0);
    this.despawned = false;
  }
}

// ---------------------------------------------------------------------------
// Stage assembly
// ---------------------------------------------------------------------------

export function createRenderLayer(
  host: HTMLElement,
  world: StageWorldOptions,
): RenderLayer {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.45;
  host.appendChild(renderer.domElement);

  // Baked environment for the plugs' chrome (startup-only; the committed
  // stage's own materials are untouched — no scene.environment). The bake's
  // pixels exist ONLY on the GPU (a PMREM render-target pass), so a WebGL
  // context loss destroys it — rebakeEnvironment() (LIFE-3) re-bakes it on
  // restore; three.js re-uploads every CPU-backed resource itself.
  let envTexture: THREE.Texture;
  {
    const pmrem = new THREE.PMREMGenerator(renderer);
    envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  }

  /**
   * LIFE-3 — the app-level half of WebGL context-restore: re-bake the ONE
   * resource whose pixels live only on the GPU (the PMREM environment) and
   * re-point every material at the fresh texture. Called by the frame gate's
   * restore hook AFTER three's own `webglcontextrestored` handler rebuilt its
   * GL caches (listener order: three's listener was registered at renderer
   * construction, ours at start()), so the new bake lands on a live context
   * and every CPU-backed resource (geometries, canvas textures, the fleet's
   * one shader program) re-uploads on the next render.
   */
  function rebakeEnvironment(): void {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const next = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    envTexture.dispose();
    envTexture = next;
    cordMaterial.envMap = next;
    cordMaterial.needsUpdate = true;
    plugMaterials.metal.envMap = next;
    plugMaterials.metal.needsUpdate = true;
    plugMaterials.grip.envMap = next;
    plugMaterials.grip.needsUpdate = true;
    plugMaterials.coded.envMap = next;
    plugMaterials.coded.needsUpdate = true;
    fragmentMaterial.envMap = next;
    fragmentMaterial.needsUpdate = true;
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111114);
  scene.fog = new THREE.Fog(0x111114, 8, 26);

  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    100,
  );
  camera.position.set(0, 1.45, 4.5);
  camera.lookAt(0, 0.55, 0);

  // Lighting story: ONE warm key (the bench lamp), a dim cool fill. The key
  // sits low enough to model the cubes' faces (a pure overhead key flattens
  // them into silhouettes). No shadow maps yet (contract: only if free) —
  // the panel-line floor and fog carry the depth instead.
  const key = new THREE.DirectionalLight(0xffd2a0, 6.0);
  key.position.set(4, 3.2, 3);
  key.position.normalize().multiplyScalar(10);
  scene.add(key);
  scene.add(new THREE.HemisphereLight(0x3a4150, 0x101216, 1.25));

  // Ground: the studio bench. Panel seams every 4 world units, fog-faded.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(64, 64),
    new THREE.MeshStandardMaterial({
      map: makeFloorTexture(renderer.capabilities.getMaxAnisotropy()),
      roughness: 0.85,
      metalness: 0.05,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // Eight steel-panel cubes with candy zones — scattered, sitting on y=0.
  const cubeGeometry = new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE);
  const cubes: THREE.Mesh[] = [];
  CUBE_POSITIONS.forEach(([x, z], index) => {
    const cube = new THREE.Mesh(
      cubeGeometry,
      new THREE.MeshStandardMaterial({
        map: makeCubeTexture(index),
        roughness: 0.55,
        metalness: 0.2,
      }),
    );
    cube.position.set(x, CUBE_SIZE / 2, z);
    cubes.push(cube);
    scene.add(cube);
  });

  // The cord fleet: one shared rubber material, one shared jack instance
  // pool. Cord 0's slot pair rides at the front of the pool.
  const cordMaterial = new THREE.MeshStandardMaterial({
    color: 0x2e3138, // dark rubber — reads against the bench via the key
    roughness: 0.82, // matte; the key draws a tight, slight sheen
    metalness: 0.05,
    envMap: envTexture,
    envMapIntensity: 0.1,
  });
  const plugMaterials = createPlugMaterials(envTexture);
  const jacks = new JackInstances(plugMaterials);
  scene.add(jacks.group);

  // Pick proxies: invisible to pixels AND skipped by the draw loop
  // (visible=false), yet still raycastable — three's Raycaster tests layers,
  // not visibility (pinned by scene.test.ts so the INT-1 grab path can never
  // silently break).
  const proxyGeometry = new THREE.SphereGeometry(0.12, 10, 8);
  const proxyMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  proxyMaterial.visible = false; // material-level: no draw, raycast unaffected

  // INT-2 deny cue: ONE preallocated flat red ring, hidden until a cap
  // rejection flashes it onto the denied cube face. World-honest by
  // contract — an opaque painted mark that fades, no glow/additive blend.
  const denyRing = new THREE.Mesh(
    new THREE.RingGeometry(0.075, 0.105, 40),
    new THREE.MeshBasicMaterial({
      color: 0xc22e26, // the plug red — reads as the same ink, not a new color
      transparent: true,
      opacity: 1,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  denyRing.visible = false;
  denyRing.renderOrder = 1; // draw after the cubes it lies on
  scene.add(denyRing);
  const DENY_RING_MS = 350;
  let denyStartMs = -Infinity;
  const denyRingMaterial = denyRing.material as THREE.MeshBasicMaterial;
  const denyNormal = new THREE.Vector3();
  const denyPlusZ = new THREE.Vector3(0, 0, 1);

  // T-LIFE-2/REN-5 — the shatter fragments: the jack breaks into small dark
  // METAL shards (per-instance dark-steel inks over a white-based material,
  // the baked env for the chrome glint) plus the failing end's color-BAND
  // shard — one pooled InstancedMesh, NO glow/additive blend.
  const fragmentMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff, // instanceColor carries each shard's ink
    roughness: 0.45,
    metalness: 0.8,
    envMap: envTexture,
    envMapIntensity: 0.5,
  });
  const fragments = new FragmentPool(fragmentMaterial);
  scene.add(fragments.mesh);
  let lastFragmentWallMs = performance.now();

  const views = new Map<number, CordView>();
  let nextSlot = 0;
  let frameId = 0;
  let layoutDirty = false;

  // REN-4 — the fleet's ONE chase-pulse clock: the shared phase + amber
  // color uniforms every cord's tube material references. Written once per
  // frame from the SIM clock (never wall time — the light is locked to it).
  const pulseState = createChasePulseState();

  // REN-5 — the ONE reused per-cord paint frame (grace entry + sim clock +
  // the reduced-motion seam), refilled per cord inside render(). Plain data,
  // never retained past the frame; zero steady-state allocation.
  const paint: CordPaintFrame = { simTime: 0, reduced: false, grace: null };

  function ensureView(spec: CordRenderSpec): CordView {
    let view = views.get(spec.id);
    if (view !== undefined) return view;
    if (nextSlot + 2 > jacks.capacity) {
      throw new Error(`render: jack instance pool exhausted (${jacks.capacity} slots)`);
    }
    view = new CordView(
      spec,
      { first: nextSlot, last: nextSlot + 1 },
      cordMaterial,
      proxyGeometry,
      proxyMaterial,
      pulseState,
    );
    nextSlot += 2;
    views.set(spec.id, view);
    scene.add(view.tube.mesh, view.proxies[0], view.proxies[1]);
    layoutDirty = true;
    return view;
  }
  (world.cords ?? []).forEach((spec) => ensureView(spec));

  const onResize = (): void => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', onResize);

  // LIFE-3 — the resilience gate: context-loss and hidden-tab pauses, the
  // clean zero-delta resume, and the app-level restore hook (the env
  // re-bake). start() wires the real DOM events through it; the probe is
  // exposed read-only for the composition's verification seam.
  const frameGate = createFrameGate({ onContextRestored: rebakeEnvironment });

  // LIFE-3 — the DOM half of the wiring, alive only while the loop runs.
  let teardownResilience: (() => void) | null = null;

  return {
    camera,
    domElement: renderer.domElement,
    renderer,
    jackPool: jacks,
    scene,
    pickables: {
      cubes,
      jackProxy(cordId, endIndex) {
        const view = views.get(cordId);
        if (view === undefined) return undefined;
        return endIndex === 0 ? view.proxies[0] : view.proxies[1];
      },
    },
    frameGate,
    pulseProbe: () => ({
      phase: pulseState.phase.value,
      cords: Array.from(views, ([id, view]) => ({ id, gain: view.pulseGain.value })),
    }),
    stateProbe: () => ({
      fragments: fragments.activeCount,
      cords: Array.from(views, ([id, view]) => ({
        id,
        stretch: view.stretch,
        tickGain: view.tickGain.value,
        tickSpacing: view.tickSpacing.value,
        graceFactor: view.graceFactor,
        bandOff: view.bandOff,
      })),
    }),
    setSeatOverride(cordId, end, pose) {
      const view = views.get(cordId);
      if (view === undefined) return;
      view.seats[end === 'first' ? 0 : 1] = pose;
      if (pose !== null) {
        // Write the slot immediately (covers a frozen/sleeping sim whose
        // moved-gate would skip sync's rewrite) and force the pool upload.
        view.writeSeatedJack(jacks, end);
        layoutDirty = true;
      }
    },

    hideJack(cordId, end) {
      const view = views.get(cordId);
      if (view === undefined) return;
      view.hiddenEnds[end === 'first' ? 0 : 1] = true;
      jacks.hideSlot(end === 'first' ? view.slotFirst : view.slotLast);
      layoutDirty = true;
    },

    setCordFade(cordId, t) {
      const view = views.get(cordId);
      if (view === undefined) return;
      view.setFade(t);
      const s = Number.isFinite(t) && t > 0 ? Math.max(0, 1 - t) : 1;
      // Both slots: the shattered one is already zero-matrix-hidden; the
      // riding one shrinks out with the tube.
      jacks.setSlotScale(view.slotFirst, s);
      jacks.setSlotScale(view.slotLast, s);
      layoutDirty = true;
    },

    shatter(at, options) {
      fragments.burst(at, {
        reduced: options?.reduced === true,
        band: options?.band,
      });
    },

    flashDeny(cubeIndex, at, normal) {
      if (cubeIndex < 0 || cubeIndex >= cubes.length) return;
      const len = Math.hypot(normal.x, normal.y, normal.z);
      if (len < 1e-9) return; // no honest face axis — no ring
      denyNormal.set(normal.x / len, normal.y / len, normal.z / len);
      // Lie the ring ON the face, a hair proud of it (no z-fighting), facing
      // along the face axis. setFromUnitVectors has no up-vector degeneracy.
      denyRing.position.set(
        at.x + denyNormal.x * 0.01,
        at.y + denyNormal.y * 0.01,
        at.z + denyNormal.z * 0.01,
      );
      denyRing.quaternion.setFromUnitVectors(denyPlusZ, denyNormal);
      denyRingMaterial.opacity = 1;
      denyRing.visible = true;
      denyStartMs = performance.now();
    },

    render(state, dtSeconds, frame) {
      frameId += 1;
      // INT-2 deny cue: fade the ring, then hide it — a mark, not a lamp.
      if (denyRing.visible) {
        const t = (performance.now() - denyStartMs) / DENY_RING_MS;
        if (t >= 1) denyRing.visible = false;
        else denyRingMaterial.opacity = 1 - t;
      }
      // T-LIFE-2 — the shatter debris: advance on the caller's frame delta
      // when provided, else a clamped wall-clock delta (visual-only timing;
      // the sim owns every physical motion in the sequence).
      if (typeof dtSeconds === 'number' && Number.isFinite(dtSeconds) && dtSeconds > 0) {
        lastFragmentWallMs = performance.now();
        fragments.update(dtSeconds);
      } else {
        const now = performance.now();
        fragments.update((now - lastFragmentWallMs) / 1000);
        lastFragmentWallMs = now;
      }
      let anyMoved = false;
      let seen = 0;
      // REN-4 — the chase clock ticks with the SIM clock: same sim instant,
      // same phase, always (deterministic; a frozen sim holds the light; a
      // backgrounded tab's discarded backlog cannot make it skip). The
      // reduced-motion seam slows the cadence rather than removing the
      // pulse (A11Y-1 owns the policy). One multiply + floor per frame.
      const linkedFrame = frame?.linked;
      // REN-5 — the state paint's per-frame inputs: the grace list (a tiny
      // caller-composed array; a linear scan per cord is the honest cost —
      // ≤ 12 entries) + the sim clock + the reduced-motion seam.
      const graceFrame = frame?.grace;
      const reduced = frame?.reducedMotion === true;
      paint.simTime = state.time;
      paint.reduced = reduced;
      pulseState.phase.value = pulsePhase(state.time, { reduced });
      jacks.beginFrame();
      for (const cord of state.cords) {
        let view = views.get(cord.id);
        if (view === undefined) {
          // A cord the world didn't announce (INT-4 spawn): grow lazily.
          view = ensureView({ id: cord.id, pointCount: cord.points.length });
        }
        if (view.despawned) view.revive(jacks); // T-LIFE-2: the id lives again
        view.lastSeenFrame = frameId;
        seen += 1;
        const linked =
          linkedFrame !== undefined && linkedFrame.includes(cord.id);
        paint.grace = null;
        if (graceFrame !== undefined) {
          for (let i = 0; i < graceFrame.length; i += 1) {
            if (graceFrame[i].id === cord.id) {
              paint.grace = graceFrame[i];
              break;
            }
          }
        }
        if (view.sync(cord, jacks, linked, paint)) anyMoved = true;
      }
      // Vanished cords (LIFE-2 despawn): hide, take their proxies off the
      // raycast layers, drop their seat overrides, and re-upload the pool.
      if (seen !== views.size) {
        for (const view of views.values()) {
          if (view.lastSeenFrame !== frameId) {
            view.despawn();
            jacks.hideSlots(view.slotFirst, view.slotLast);
          }
        }
        layoutDirty = true;
      }
      jacks.endFrame(anyMoved || layoutDirty);
      layoutDirty = false;
      renderer.render(scene, camera);
    },
    start(frame) {
      let lastTime = performance.now();
      renderer.setAnimationLoop(() => {
        const now = performance.now();
        // LIFE-3 — the gate decides every tick. A paused tick refreshes the
        // delta baseline so the resume can never hand the loop the pause's
        // whole wall-clock gap; the first UNpaused tick after a pause is a
        // 'resume' and advances with dt 0 (nothing was owed — the backlog is
        // discarded before it exists, belt and braces under ARC-3's clamp).
        const verdict = frameGate.beforeFrame();
        if (verdict === 'skip') {
          lastTime = now;
          return;
        }
        const dtSeconds = verdict === 'resume' ? 0 : (now - lastTime) / 1000;
        lastTime = now;
        frame(dtSeconds);
      });
      // LIFE-3 — the environmental listeners. Three's own context listeners
      // (registered at renderer construction) run first on each event — its
      // restore handler rebuilds the GL caches before our hook re-bakes the
      // environment. Our loss handler preventDefaults again (idempotent) and
      // pauses the loop; the visibility handler is the explicit hidden-tab
      // path on top of ARC-3's delta clamp.
      const onContextLost = (event: Event): void => {
        frameGate.handleContextLost(event);
      };
      const onContextRestored = (): void => {
        frameGate.handleContextRestored();
      };
      const onVisibility = (): void => {
        frameGate.setVisibility(document.hidden);
      };
      renderer.domElement.addEventListener('webglcontextlost', onContextLost, false);
      renderer.domElement.addEventListener('webglcontextrestored', onContextRestored, false);
      document.addEventListener('visibilitychange', onVisibility, false);
      frameGate.setVisibility(document.hidden); // open-hidden (automation) starts paused
      teardownResilience = () => {
        renderer.domElement.removeEventListener('webglcontextlost', onContextLost, false);
        renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored, false);
        document.removeEventListener('visibilitychange', onVisibility, false);
      };
    },
    dispose() {
      renderer.setAnimationLoop(null);
      window.removeEventListener('resize', onResize);
      teardownResilience?.();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

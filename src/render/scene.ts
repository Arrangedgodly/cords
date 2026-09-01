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
 * Frame budget (Thor): floor + 8 cubes + N cord tubes + 3 instanced jack
 * meshes; the per-cord moved-gate means a sleeping scene costs only draws.
 * All textures and the PMREM environment (for the plugs' chrome) are baked
 * once at startup — zero network, zero assets.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { CordState, SimState, Vec3 } from '../sim';

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

export interface RenderLayer {
  /**
   * Draws one frame from a sim snapshot. Read-only over the state. The
   * optional `dtSeconds` (the frame's real delta) advances the T-LIFE-2
   * shatter fragments; without it the layer falls back to its own clamped
   * wall-clock delta (visual-only — the sim never sees it).
   */
  render(state: SimState, dtSeconds?: number): void;
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
   * T-LIFE-2 — the shatter's first-pass effect: a small burst of dark
   * fragment particles at the impact point, brief, pooled. `reduced` is the
   * A11Y-1 seam (prefers-reduced-motion skips the particles; the SEQUENCE —
   * jack despawn, pull-out, fade — is unchanged). NO glow, no additive
   * blending — hardware honesty.
   */
  shatter(at: Vec3, options?: { reduced?: boolean }): void;
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
}

export interface StageWorldOptions {
  /** Cords to pre-allocate views for (more may appear lazily at render). */
  cords?: CordRenderSpec[];
}

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
  '#58c470', // jade
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

/** Scattered bench placement (x, z) — a stage, not a grid; clear of the cord. */
const CUBE_POSITIONS: ReadonlyArray<readonly [number, number]> = [
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
  private pointCount = 0;
  private rings = 0;
  private centers: Float64Array = new Float64Array(0);
  private tangents: Float64Array = new Float64Array(0);
  private ringNormals: Float64Array = new Float64Array(0);
  private binormals: Float64Array = new Float64Array(0);

  constructor(material: THREE.Material) {
    this.geometry = new THREE.BufferGeometry();
    this.positions = new THREE.BufferAttribute(new Float32Array(0), 3);
    this.normals = new THREE.BufferAttribute(new Float32Array(0), 3);
    this.geometry.setAttribute('position', this.positions);
    this.geometry.setAttribute('normal', this.normals);
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
    this.geometry.setAttribute('position', this.positions);
    this.geometry.setAttribute('normal', this.normals);

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
  }

  /**
   * Rewrites the tube along the sim polyline. Zero per-frame allocation:
   * every buffer here is preallocated and only ever mutated.
   */
  update(points: ReadonlyArray<Vec3>): void {
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
    this.mesh.visible = true;
  }
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
/** Blue output coding — the palette's cobalt, readable against charcoal. */
const PLUG_BLUE = 0x4a7df2;

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
   * the slot's vanish fade (T-LIFE-2). Zero allocation — matrices go
   * straight into the instance buffers.
   */
  writeJack(
    slot: number,
    x: number, y: number, z: number,
    tx: number, ty: number, tz: number,
    red: boolean,
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
    const stamp = red ? 1 : 2;
    if (this.polarity[slot] !== stamp) {
      this.polarity[slot] = stamp;
      this.coded.setColorAt(slot, this.scratchColor.setHex(red ? PLUG_RED : PLUG_BLUE));
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
// T-LIFE-2 — the shatter fragments: the jack's own material as small dark
// debris. A first-pass effect in the Drum Machine Panel grammar (REN-5
// refines the visuals later): matte dark shards, ballistic scatter, one
// floor bounce, brief life, scale-out. NO glow, no additive blending, no
// bloom — hardware honesty. Pooled and allocation-free after construction
// (one InstancedMesh, flat state arrays); deterministic per construction (a
// seeded LCG, no wall-clock, no Math.random).
// ---------------------------------------------------------------------------

const FRAGMENT_CAPACITY = 64;
const FRAGMENT_LIFETIME = 0.55; // seconds — brief
const FRAGMENT_GRAVITY = 9.81;
const FRAGMENT_RESTITUTION = 0.35; // one small bounce, hardware-honest
const FRAGMENT_BASE_SIZE = 0.02; // a shard of the plug's dark grip rubber

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
  private readonly bounced: Uint8Array;
  private cursor = 0;
  private active = 0;
  private cleared = true;
  /** Seeded LCG — two pools produce identical bursts (no Math.random). */
  private rngState = 0x2f6e2b1;
  // Scratch — the per-frame path allocates nothing.
  private readonly scratchMatrix = new THREE.Matrix4();
  private readonly scratchQuat = new THREE.Quaternion();
  private readonly scratchEuler = new THREE.Euler();
  private readonly scratchPos = new THREE.Vector3();
  private readonly scratchScale = new THREE.Vector3();
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
   * Scatters `count` shards from the impact point `at`. `reduced: true` is
   * the A11Y-1 seam (prefers-reduced-motion): the burst no-ops entirely —
   * the SEQUENCE is unchanged (the jack still despawns; only the particles
   * simplify away) until A11Y-1 wires its own policy here.
   */
  burst(at: Vec3, options: { count?: number; reduced?: boolean } = {}): number {
    if (options.reduced === true) return 0;
    const count = Math.max(0, Math.min(options.count ?? 14, this.capacity));
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
      this.size[slot] = 0.6 + this.nextRandom();
      this.yaw[slot] = this.nextRandom() * Math.PI * 2;
      this.pitch[slot] = this.nextRandom() * Math.PI;
      this.spin[slot] = (this.nextRandom() > 0.5 ? 1 : -1) * (2 + this.nextRandom() * 4);
      this.bounced[slot] = 0;
    }
    this.cleared = false;
    return count;
  }

  /**
   * Advances every live shard by `dt` (clamped — a backgrounded tab's spike
   * cannot fling debris) and rewrites the instance matrices: ballistic
   * flight, gravity, ONE floor bounce, then rest; the last 35% of each life
   * eases the scale to zero (the vanish takes its debris with it). Zero
   * allocation; dead slots above the live set are zeroed so the pool's tail
   * never flashes stale shards.
   */
  update(dtSeconds: number): void {
    if (this.active === 0 && this.cleared) return;
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
          if (this.bounced[slot] === 0 && this.vy[slot] < 0) {
            this.vy[slot] = -this.vy[slot] * FRAGMENT_RESTITUTION;
            this.vx[slot] *= 0.6;
            this.vz[slot] *= 0.6;
            this.bounced[slot] = 1;
          } else {
            this.vy[slot] = 0; // rest on the bench
            this.vx[slot] *= 0.9;
            this.vz[slot] *= 0.9;
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
  }
}

// ---------------------------------------------------------------------------
// Cord view — one cord's tube + its two jack slots + its two pick proxies,
// with the per-frame moved-gate (sim sleep = frozen points = no GPU work).
// ---------------------------------------------------------------------------

class CordView {
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
  /** T-LIFE-2 — the cord's OWN material clone (a fade must not dim the fleet). */
  private readonly fadeMaterial: THREE.MeshStandardMaterial;
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
  ) {
    this.fadeMaterial = material.clone() as THREE.MeshStandardMaterial;
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
   * when anything moved (and therefore buffers were rewritten).
   */
  sync(cord: CordState, jacks: JackInstances): boolean {
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
    if (moved) {
      for (let i = 0; i < n; i += 1) {
        const p = points[i];
        const k = i * 3;
        last[k] = p.x;
        last[k + 1] = p.y;
        last[k + 2] = p.z;
      }
      this.tube.update(points);

      // Jacks: anchored at the exact sim end points, tipped along the
      // OUTWARD tangent of the last cord segment (the sim's state — seated,
      // carried, or dangling — alone drives plug placement) — UNLESS the end
      // is seated (INT-2): a plugged jack snaps to its socket pose so it
      // stays perpendicular to the cube face while the cord settles.
      const first = points[0];
      const second = points[1];
      const penult = points[n - 2];
      const endLast = points[n - 1];
      const seatFirst = this.seats[0];
      const seatLast = this.seats[1];
      // T-LIFE-2 — a hidden end (the shattered jack) writes nothing: its
      // zero matrix stands until the whole cord despawns or the id revives.
      if (!this.hiddenEnds[0]) {
        if (seatFirst !== null) {
          jacks.writeJack(
            this.slotFirst,
            seatFirst.position.x, seatFirst.position.y, seatFirst.position.z,
            seatFirst.axis.x, seatFirst.axis.y, seatFirst.axis.z,
            this.redEnd === 'first',
          );
        } else {
          jacks.writeJack(
            this.slotFirst,
            first.x, first.y, first.z,
            first.x - second.x, first.y - second.y, first.z - second.z,
            this.redEnd === 'first',
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
          );
        } else {
          jacks.writeJack(
            this.slotLast,
            endLast.x, endLast.y, endLast.z,
            endLast.x - penult.x, endLast.y - penult.y, endLast.z - penult.z,
            this.redEnd === 'last',
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
   * where sync's moved-gate would skip the rewrite).
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
    );
  }

  /**
   * T-LIFE-2 — the vanish fade: `t` runs 0→1 through the pull window. The
   * tube's own material clone drops opacity; t ≥ 1 hides it entirely (the
   * despawn/revive path owns the final state). The riding jacks shrink
   * through the pool's per-slot scale (set by the layer, same t).
   */
  setFade(t: number): void {
    if (!Number.isFinite(t) || t <= 0) {
      this.fadeMaterial.transparent = false;
      this.fadeMaterial.opacity = 1;
      this.tube.mesh.visible = true;
      return;
    }
    this.fadeMaterial.transparent = true;
    this.fadeMaterial.opacity = Math.max(0, 1 - t);
    if (t >= 1) this.tube.mesh.visible = false;
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
    this.hide();
    this.seats[0] = null;
    this.seats[1] = null;
    this.setFade(0);
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
  // stage's own materials are untouched — no scene.environment).
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

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
  const jacks = new JackInstances(createPlugMaterials(envTexture));
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

  // T-LIFE-2 — the shatter fragments: the plug's own dark grip rubber as
  // small matte shards (one pooled InstancedMesh; NO glow/additive blend).
  const fragments = new FragmentPool(
    new THREE.MeshStandardMaterial({
      color: 0x17181c, // the jack's grip rubber — the jack shatters into itself
      roughness: 0.9,
      metalness: 0.05,
      envMap: envTexture,
      envMapIntensity: 0.2,
    }),
  );
  scene.add(fragments.mesh);
  let lastFragmentWallMs = performance.now();

  const views = new Map<number, CordView>();
  let nextSlot = 0;
  let frameId = 0;
  let layoutDirty = false;

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
      fragments.burst(at, { reduced: options?.reduced === true });
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

    render(state, dtSeconds) {
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
        if (view.sync(cord, jacks)) anyMoved = true;
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
        const dtSeconds = (now - lastTime) / 1000;
        lastTime = now;
        frame(dtSeconds);
      });
    },
    dispose() {
      renderer.setAnimationLoop(null);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

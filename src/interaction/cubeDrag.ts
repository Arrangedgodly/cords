/**
 * INT-3 — the cube-drag controller: the translate-only grab/drag/release
 * POLICY for cubes, the sibling of carry.ts (which owns cord ends). Pure,
 * headless, renderer-free, DOM-free — unit-tested without a window.
 *
 * - GRAB: pointer-down on a cube (INT-1 pick class 'cube') starts the drag.
 *   The DRAG PLANE is the camera-parallel plane through the GRAB POINT (the
 *   world hit point on the cube's surface — a fixed plane point avoids depth
 *   drift while the hand moves, exactly like the M1 carry). The cube's center
 *   keeps its grab-time offset from the hit point, so grabbing a corner
 *   drags from that corner instead of snapping the cube under the cursor.
 * - DRAG: each frame, the cursor ray ∩ drag plane gives the grab point's new
 *   world position; the cube translates with it (translate-only — approved
 *   MVP scope: NO rotation, ever). The center is CLAMPED above the floor
 *   continuously, so a cursor dragged below the bench holds the cube resting
 *   exactly on it and a drop can never leave the cube partially below the
 *   floor (the sim's pins are floor-exempt BY DESIGN; cubes are the
 *   interaction layer's solid bodies and this is where their floor is paid).
 * - RELEASE: pointer-up ends the drag. The cube is kinematic — it simply
 *   stays at its last composed (already floor-clamped) position; there is no
 *   drop physics to run. A seated cord's socket follows in the composition
 *   root (main.ts): the seat pose rides the cube's delta and the sim's
 *   plugged pin hard-follows through the latched seatTarget seam.
 *
 * Steady-state allocation contract: composition reuses ONE target shell —
 * no objects are created per frame (pinned by test, same bar as carry.ts).
 */
import type { Ray3, Vec3 } from '../sim';

/** A cube drag has no intermediate drop phase: release is immediate. */
export type CubeDragPhase = 'idle' | 'dragging';

/** One frame's drag result: which cube, and where its CENTER goes. */
export interface CubeDragTarget {
  cubeId: number;
  readonly position: Vec3;
}

export interface CubeDragController {
  /**
   * Pointer-down on cube `cubeId`: begin following the cursor on the
   * camera-parallel plane through `grabPoint` (the world hit point),
   * preserving `cubeCenter`'s offset from it. A begin while already dragging
   * is a fresh grab (the newest pointer-down wins — deterministic).
   */
  beginDrag(cubeId: number, grabPoint: Vec3, cubeCenter: Vec3): void;
  /** Pointer-up: release. The cube stays at its last composed position. */
  endDrag(): void;
  /** Cancel without semantics (e.g. the pointer left the stage). No-op idle. */
  cancel(): void;
  /** Current phase. */
  readonly phase: CubeDragPhase;
  /** The cube being dragged, or null. */
  readonly draggingCubeId: number | null;
  /**
   * Per-frame: compose the dragged cube's next center, or null to hold
   * (idle, or the ray missed the plane). `planeNormal` is the camera's view
   * direction (refreshed per frame by the caller).
   */
  composeTarget(args: {
    ray: Ray3 | null;
    planeNormal: Vec3;
  }): CubeDragTarget | null;
}

export function createCubeDragController(options: {
  /** Half the cube's edge — the center's minimum height above the floor. */
  cubeHalfSize: number;
  /** The world floor Y (the REN-1 bench sits at 0). */
  floorY: number;
}): CubeDragController {
  const { cubeHalfSize, floorY } = options;
  const minCenterY = floorY + cubeHalfSize;

  let phase: CubeDragPhase = 'idle';
  let dragCubeId: number | null = null;
  // Fixed drag plane: point (grab moment) + the cube-center offset from it.
  let planeX = 0;
  let planeY = 0;
  let planeZ = 0;
  let offX = 0;
  let offY = 0;
  let offZ = 0;

  // Reused shell — steady-state composition allocates nothing.
  const target: CubeDragTarget = { cubeId: -1, position: { x: 0, y: 0, z: 0 } };

  return {
    get phase() {
      return phase;
    },

    get draggingCubeId() {
      return dragCubeId;
    },

    beginDrag(cubeId, grabPoint, cubeCenter) {
      phase = 'dragging';
      dragCubeId = cubeId;
      target.cubeId = cubeId;
      planeX = grabPoint.x;
      planeY = grabPoint.y;
      planeZ = grabPoint.z;
      offX = cubeCenter.x - grabPoint.x;
      offY = cubeCenter.y - grabPoint.y;
      offZ = cubeCenter.z - grabPoint.z;
    },

    endDrag() {
      if (phase !== 'dragging') return;
      phase = 'idle';
      dragCubeId = null;
    },

    cancel() {
      phase = 'idle';
      dragCubeId = null;
    },

    composeTarget({ ray, planeNormal }) {
      if (phase !== 'dragging' || ray === null) return null; // pointer off-stage: hold
      // Ray ∩ plane (through the grab point ⊥ the camera direction); a miss
      // (parallel) or a plane behind the ray holds — same contract as carry.
      const denom =
        ray.direction.x * planeNormal.x +
        ray.direction.y * planeNormal.y +
        ray.direction.z * planeNormal.z;
      if (!(Math.abs(denom) > 1e-9)) return null;
      const px = planeX - ray.origin.x;
      const py = planeY - ray.origin.y;
      const pz = planeZ - ray.origin.z;
      const t = (px * planeNormal.x + py * planeNormal.y + pz * planeNormal.z) / denom;
      if (!(t > 0)) return null; // plane behind the pointer
      const x = ray.origin.x + ray.direction.x * t + offX;
      const y = ray.origin.y + ray.direction.y * t + offY;
      const z = ray.origin.z + ray.direction.z * t + offZ;
      // Totality: garbage upstream math holds instead of moving the cube to
      // a NaN (the mesh is a solid body; it never teleports into nowhere).
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
      // The floor clamp: the cube's bottom never sinks below the bench —
      // applied continuously, so a drop below-floor is already clamped.
      target.position.x = x;
      target.position.y = y > minCenterY ? y : minCenterY;
      target.position.z = z;
      return target;
    },
  };
}

/**
 * INT/M1 — the carry controller: the grab/drag/release POLICY that turns
 * pointer intent into the sim's `SimInput.pinTarget` contract (SIM-2).
 *
 * The M1 grab proxy is the rope's free end itself (jacks proper arrive with
 * REN-2); this module owns everything AFTER the pick:
 *
 * - DRAG: the carried end follows the cursor ON A PLANE — the camera-facing
 *   plane through the grab point (fixed point avoids depth drift while the
 *   hand moves). Targets are clamped to `floorRestY`, a hair above the REN-1
 *   floor, so a hand can never drag the cord's end through the bench (the
 *   sim's pins are exempt from the floor clamp BY DESIGN — the world's solid
 *   floor is the interaction layer's responsibility, and this is where it
 *   pays that debt).
 * - RELEASE: pointer-up starts a DROP — the controller keeps sending a
 *   floor-level target at the released spot, so the end slides down at the
 *   sim's bounded pin speed and rests ON the bench (the REN-1 floor clamp
 *   holds the body there). Once the end has converged (or the drop has
 *   stalled against a taut leash past `dropTimeoutSeconds`), targets stop
 *   and the sim's release stub freezes the end where it landed. This is the
 *   M1 release policy; LIFE-1's real free-fall release replaces it.
 *
 * Renderer-free, DOM-free, allocation-free in steady state (the returned
 * PinTargetInput is a reused shell) — unit-tested headless in carry.test.ts.
 */
import type { PinTargetInput, Ray3, Vec3 } from '../sim';

export type CarryPhase = 'idle' | 'dragging' | 'dropping';

export interface CarryController {
  /** Pointer-down on the free end: begin following the cursor on the plane. */
  beginDrag(grabPoint: Vec3): void;
  /** Pointer-up: begin the drop-to-floor release from `endPoint`. */
  endDrag(endPoint: Vec3): void;
  /**
   * INT-2 — the grab ended by PLUGGING, not dropping: stop sending targets
   * without the drop-to-floor policy (the end's fate belongs to the seat
   * from here). No-op when idle.
   */
  cancel(): void;
  /** Current phase — drives the grab/grabbing cursor affordance. */
  readonly phase: CarryPhase;
  /**
   * Per-frame: compose the pinTarget to send this frame, or null to send
   * nothing (idle, or a hold). `planeNormal` is the camera's view direction;
   * `endPoint` is the cord end's CURRENT position (read from sim state).
   */
  composeTarget(args: {
    ray: Ray3 | null;
    planeNormal: Vec3;
    endPoint: Vec3;
    dtSeconds: number;
  }): PinTargetInput | null;
}

export function createCarryController(options: {
  freeEndIndex: number;
  /** Y the released/dragged end is held at — just above the REN-1 floor. */
  floorRestY: number;
  /** Drop give-up time when the leash stalls the descent. Default 2 s. */
  dropTimeoutSeconds?: number;
  /**
   * INT-4 — cord id stamped on every composed target so the multi-cord world
   * step can route the intent. Default 0 (the anchor cord), which keeps the
   * single-cord M1 composition byte-compatible.
   */
  cordId?: number;
}): CarryController {
  const { freeEndIndex, floorRestY } = options;
  const dropTimeout = options.dropTimeoutSeconds ?? 2;
  const cordId = options.cordId ?? 0;

  let phase: CarryPhase = 'idle';
  // Fixed drag plane: point (grab moment), normal refreshed per frame.
  let planeX = 0;
  let planeY = 0;
  let planeZ = 0;
  let dropX = 0;
  let dropZ = 0;
  let dropElapsed = 0;

  // Reused shell — steady-state composition allocates nothing. The shell
  // carries the controller's fixed (cordId, index) pair; only `position`
  // mutates per frame.
  const target: PinTargetInput = {
    cordId,
    index: freeEndIndex,
    position: { x: 0, y: 0, z: 0 },
  };

  /** Ray ∩ plane; null when the ray misses (parallel) or the plane is behind. */
  function intersectPlane(ray: Ray3, normal: Vec3): Vec3 | null {
    const denom = ray.direction.x * normal.x + ray.direction.y * normal.y + ray.direction.z * normal.z;
    if (Math.abs(denom) < 1e-9) return null;
    const px = planeX - ray.origin.x;
    const py = planeY - ray.origin.y;
    const pz = planeZ - ray.origin.z;
    const t = (px * normal.x + py * normal.y + pz * normal.z) / denom;
    if (!(t > 0)) return null; // plane behind the pointer
    return {
      x: ray.origin.x + ray.direction.x * t,
      y: ray.origin.y + ray.direction.y * t,
      z: ray.origin.z + ray.direction.z * t,
    };
  }

  return {
    get phase() {
      return phase;
    },

    beginDrag(grabPoint) {
      phase = 'dragging';
      planeX = grabPoint.x;
      planeY = grabPoint.y;
      planeZ = grabPoint.z;
    },

    endDrag(endPoint) {
      if (phase !== 'dragging' && phase !== 'dropping') return;
      phase = 'dropping';
      dropX = endPoint.x;
      dropZ = endPoint.z;
      dropElapsed = 0;
    },

    cancel() {
      phase = 'idle';
    },

    composeTarget({ ray, planeNormal, endPoint, dtSeconds }) {
      if (phase === 'dragging') {
        if (ray === null) return null; // pointer off-stage: hold where converged
        const hit = intersectPlane(ray, planeNormal);
        if (hit === null) return null;
        target.position.x = hit.x;
        target.position.y = Math.max(hit.y, floorRestY);
        target.position.z = hit.z;
        return target;
      }
      if (phase === 'dropping') {
        dropElapsed += dtSeconds;
        const dx = endPoint.x - dropX;
        const dy = endPoint.y - floorRestY;
        const dz = endPoint.z - dropZ;
        const converged = dx * dx + dy * dy + dz * dz < 0.03 * 0.03;
        if (converged || dropElapsed >= dropTimeout) {
          phase = 'idle'; // targets stop → the sim's release stub freezes the end
          return null;
        }
        target.position.x = dropX;
        target.position.y = floorRestY;
        target.position.z = dropZ;
        return target;
      }
      return null;
    },
  };
}

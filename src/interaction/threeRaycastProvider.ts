/**
 * INT-1 — thin three.js adapter implementing picking.ts's HitTestProvider
 * with a real THREE.Raycaster. This is the ONLY three-touching piece of the
 * picking module (three.js is allowed under src/interaction/, never under
 * src/sim/); everything testable lives in picking.ts against fake providers.
 *
 * Also owns the minimal pickable REGISTRATION API: scene objects enter the
 * pick set here (REN-1/INT-2+ register jacks, cubes, cord meshes as they
 * create them), tagged with their priority class. Registered groups are
 * hit-tested recursively, and a hit on any descendant resolves back to the
 * registered ancestor — so a jack can stay a Group (mesh + glow sprite) and
 * still pick as one jack.
 *
 * Integration point (composition root): `render.camera`/`render.domElement`
 * feed `rayFromClient`, which plugs straight into createPointerMapper's
 * RayFromClient seam; queries go through createPicker(provider).
 */
import * as THREE from 'three';
import type { Ray3, Vec3 } from '../sim';
import { clientToNdc } from './picking';
import type { PickClass, PickHit } from './picking';

/** Handle returned by registration — remove the pickable from the pick set. */
export interface PickableHandle {
  unregister(): void;
}

interface RegistrationEntry {
  class: PickClass;
  payload: unknown;
}

export interface ThreeRaycastProvider {
  /**
   * Registers `object` (and its whole subtree) as a pickable of `class`.
   * `payload` is returned verbatim on hits (defaults to the registered
   * object). Registration order breaks exact distance ties deterministically.
   */
  registerPickable(options: {
    class: PickClass;
    object: THREE.Object3D;
    payload?: unknown;
  }): PickableHandle;
  /** HitTestProvider seam — consumes sim-space rays. */
  hitTest(ray: Ray3): PickHit[];
  /** RayFromClient seam for createPointerMapper — null when off-stage. */
  rayFromClient(clientX: number, clientY: number): Ray3 | null;
}

export function createThreeRaycastProvider(options: {
  camera: THREE.Camera;
  /** Element whose viewport rect maps client pixels (the render canvas). */
  element: HTMLElement;
}): ThreeRaycastProvider {
  const { camera, element } = options;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  // Scratch vectors — raycaster.set copies, so reuse is safe; keeps the
  // per-event picking path allocation-free in the spirit of the sim core.
  const scratchOrigin = new THREE.Vector3();
  const scratchDirection = new THREE.Vector3();

  // Registration order preserved for tie-breaking; Map gives O(1) class/payload
  // resolution when mapping raw intersections back to pickables.
  const entries: { object: THREE.Object3D; entry: RegistrationEntry }[] = [];
  const byObject = new Map<THREE.Object3D, RegistrationEntry>();

  /**
   * Walks up from the hit object to its nearest registered ancestor,
   * returning the full registration record (object identity + class/payload).
   */
  function resolveRegistration(
    object: THREE.Object3D,
  ): { object: THREE.Object3D; entry: RegistrationEntry } | null {
    let current: THREE.Object3D | null = object;
    while (current !== null) {
      const entry = byObject.get(current);
      if (entry !== undefined) return { object: current, entry };
      current = current.parent;
    }
    return null;
  }

  return {
    registerPickable({ class: pickClass, object, payload }) {
      const entry: RegistrationEntry = {
        class: pickClass,
        payload: payload !== undefined ? payload : object,
      };
      entries.push({ object, entry });
      byObject.set(object, entry);
      return {
        unregister() {
          const index = entries.findIndex((e) => e.object === object);
          if (index !== -1) entries.splice(index, 1);
          byObject.delete(object);
        },
      };
    },

    hitTest(ray) {
      scratchOrigin.set(ray.origin.x, ray.origin.y, ray.origin.z);
      scratchDirection.set(ray.direction.x, ray.direction.y, ray.direction.z);
      raycaster.set(scratchOrigin, scratchDirection);
      // Recursive so registered groups pick as one unit via their children.
      // THREE.Raycaster sorts intersections by distance; a ray can pierce the
      // same pickable several times (entry+exit faces, quad-diagonal
      // triangles), so each REGISTRATION is reported at most once — at its
      // nearest intersection. One pickable, one hit: predictable for callers.
      const intersections = raycaster.intersectObjects(
        entries.map((e) => e.object),
        true,
      );
      const seen = new Set<THREE.Object3D>();
      const hits: PickHit[] = [];
      for (const intersection of intersections) {
        const registration = resolveRegistration(intersection.object);
        if (registration === null) continue; // hit an unregistered ancestor gap
        if (seen.has(registration.object)) continue;
        seen.add(registration.object);
        hits.push({
          class: registration.entry.class,
          distance: intersection.distance,
          payload: registration.entry.payload,
          point: toSimPoint(intersection.point),
          // INT-2: the hit FACE's outward normal, in world space (null when
          // the hit has no face — e.g. a Line/Points pickable). Transformed
          // by the hit object's normal matrix so rotated/parented pickables
          // report world-honest normals.
          normal: toWorldNormal(intersection),
        });
      }
      return hits;
    },

    rayFromClient(clientX, clientY) {
      const rect = element.getBoundingClientRect();
      const coords = clientToNdc(clientX, clientY, rect);
      if (coords === null) return null;
      ndc.set(coords.x, coords.y);
      raycaster.setFromCamera(ndc, camera);
      return {
        origin: toSimPoint(raycaster.ray.origin),
        direction: toSimPoint(raycaster.ray.direction),
      };
    },
  };
}

/** The single sanctioned conversion from three.js vectors back to sim data. */
function toSimPoint(v: THREE.Vector3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

// INT-2: face normals come back in OBJECT space; these module scratch slots
// (single-threaded event path) carry them into world space without allocating.
const scratchNormalMatrix = new THREE.Matrix3();
const scratchNormal = new THREE.Vector3();

/**
 * INT-2 — the hit face's outward normal in WORLD space, or null when the
 * intersection has no face (non-mesh pickables). three returns the triangle
 * normal in the hit OBJECT's local space; the object's normal matrix
 * (inverse-transpose of its world transform) carries it to world space,
 * then a re-normalize keeps unit length under any uniform-ish scaling.
 */
function toWorldNormal(intersection: THREE.Intersection): Vec3 | null {
  if (intersection.face == null) return null;
  scratchNormalMatrix.getNormalMatrix(intersection.object.matrixWorld);
  scratchNormal.copy(intersection.face.normal).applyMatrix3(scratchNormalMatrix);
  const len = scratchNormal.length();
  if (len < 1e-12) return null; // degenerate transform: no honest normal exists
  scratchNormal.multiplyScalar(1 / len);
  return { x: scratchNormal.x, y: scratchNormal.y, z: scratchNormal.z };
}

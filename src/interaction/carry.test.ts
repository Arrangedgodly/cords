/**
 * REN-1/M1 — carry controller tests. The controller is the grab/drag/release
 * policy on top of SIM-2's pinTarget contract, so the tests pin the policy
 * headless: drag targets land on the camera-facing plane through the grab
 * point and never below the floor; release drops the end to the bench and
 * then stops (the sim's release stub takes over); a leash-stalled drop times
 * out; re-grabbing mid-drop resumes the drag. Render-free, DOM-free.
 */
import { describe, expect, it } from 'vitest';
import { createCarryController } from './carry';
import type { Ray3, Vec3 } from '../sim';

const FLOOR_REST_Y = 0.02;
const FREE_END = 16;

/** A ray from `origin` pointing at `point` (normalized direction). */
function rayTo(origin: Vec3, point: Vec3): Ray3 {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const dz = point.z - origin.z;
  const len = Math.hypot(dx, dy, dz);
  return { origin, direction: { x: dx / len, y: dy / len, z: dz / len } };
}

// The M1 camera looks down the -z/-y diagonal; the plane faces the camera.
const PLANE_NORMAL: Vec3 = { x: 0, y: -0.212, z: -0.977 };
const EYE: Vec3 = { x: 0, y: 1.45, z: 4.5 };

function makeController() {
  return createCarryController({ freeEndIndex: FREE_END, floorRestY: FLOOR_REST_Y });
}

describe('M1 carry controller', () => {
  it('drag targets land on the plane through the grab point, at the free-end index', () => {
    const carry = makeController();
    // Grab above the rest height so the floor clamp is out of play here
    // (the clamp itself is pinned by the next test).
    carry.beginDrag({ x: 0, y: 0.5, z: 0 });
    // Aim the cursor at a point ON the drag plane (the plane's normal has no
    // x component, so any point straight along +x from the grab point lies
    // in it) — the intersection must then BE that point.
    const ray = rayTo(EYE, { x: 0.5, y: 0.5, z: 0 });
    const target = carry.composeTarget({ ray, planeNormal: PLANE_NORMAL, endPoint: { x: 0, y: 0.5, z: 0 }, dtSeconds: 1 / 60 });
    expect(target).not.toBeNull();
    expect(target?.index).toBe(FREE_END);
    const p = target!.position;
    // The hit lies ON the plane through (0,0.5,0) with the given normal…
    const planeDot =
      (p.x - 0) * PLANE_NORMAL.x + (p.y - 0.5) * PLANE_NORMAL.y + (p.z - 0) * PLANE_NORMAL.z;
    expect(planeDot).toBeCloseTo(0, 9);
    // …exactly where the cursor aimed.
    expect(p.x).toBeCloseTo(0.5, 6);
    expect(p.y).toBeCloseTo(0.5, 6);
    expect(p.z).toBeCloseTo(0, 6);
  });

  it('a cursor below the bench is clamped to the floor rest height — the hand never drags the end through the floor', () => {
    const carry = makeController();
    carry.beginDrag({ x: 0, y: 0.5, z: 0 });
    const ray = rayTo(EYE, { x: 0.4, y: -1.5, z: 0 }); // aims under the floor
    const target = carry.composeTarget({ ray, planeNormal: PLANE_NORMAL, endPoint: { x: 0, y: 0.5, z: 0 }, dtSeconds: 1 / 60 });
    expect(target?.position.y).toBe(FLOOR_REST_Y);
  });

  it('holds when the pointer ray is null, parallel to the plane, or behind it', () => {
    const carry = makeController();
    carry.beginDrag({ x: 0, y: 0.5, z: 0 });
    expect(carry.composeTarget({ ray: null, planeNormal: PLANE_NORMAL, endPoint: { x: 0, y: 0.5, z: 0 }, dtSeconds: 1 / 60 })).toBeNull();
    // Parallel ray (direction ⊥ plane normal).
    const parallel: Ray3 = { origin: EYE, direction: { x: 1, y: 0, z: 0 } };
    expect(carry.composeTarget({ ray: parallel, planeNormal: PLANE_NORMAL, endPoint: { x: 0, y: 0.5, z: 0 }, dtSeconds: 1 / 60 })).toBeNull();
    // Plane behind the ray.
    const away: Ray3 = { origin: EYE, direction: { x: 0, y: 1, z: 0 } };
    expect(carry.composeTarget({ ray: away, planeNormal: PLANE_NORMAL, endPoint: { x: 0, y: 0.5, z: 0 }, dtSeconds: 1 / 60 })).toBeNull();
  });

  it('release drops the end to the bench, reports convergence, then stops sending targets', () => {
    const carry = makeController();
    carry.beginDrag({ x: 0, y: 1.0, z: 0 });
    const ray = rayTo(EYE, { x: 0.6, y: 0.4, z: 0.2 });
    carry.composeTarget({ ray, planeNormal: PLANE_NORMAL, endPoint: { x: 0, y: 1.0, z: 0 }, dtSeconds: 1 / 60 });
    carry.endDrag({ x: 0.6, y: 1.0, z: 0.2 });
    expect(carry.phase).toBe('dropping');

    // While dropping: a floor-level target at the released spot.
    let last: { x: number; y: number; z: number } = { x: 0.6, y: 1.0, z: 0.2 };
    for (let f = 0; f < 30; f += 1) {
      const target = carry.composeTarget({ ray: null, planeNormal: PLANE_NORMAL, endPoint: last, dtSeconds: 1 / 60 });
      if (target === null) break;
      // Targets sit at the rest height at the released x/z.
      expect(target.position.y).toBe(FLOOR_REST_Y);
      expect(target.position.x).toBeCloseTo(0.6, 9);
      expect(target.position.z).toBeCloseTo(0.2, 9);
      // Simulate the bounded-velocity convergence (12 u/s).
      const dx = target.position.x - last.x;
      const dy = target.position.y - last.y;
      const dz = target.position.z - last.z;
      const d = Math.hypot(dx, dy, dz);
      const step = Math.min(d, 12 / 60);
      last = { x: last.x + (dx / d) * step, y: last.y + (dy / d) * step, z: last.z + (dz / d) * step };
    }
    expect(carry.phase).toBe('idle'); // converged → release stub takes over
    expect(
      carry.composeTarget({ ray: null, planeNormal: PLANE_NORMAL, endPoint: last, dtSeconds: 1 / 60 }),
    ).toBeNull();
  });

  it('a leash-stalled drop times out and releases instead of hanging forever', () => {
    const carry = makeController();
    carry.beginDrag({ x: 0, y: 1.0, z: 0 });
    carry.composeTarget({ ray: rayTo(EYE, { x: 1.4, y: 1.2, z: 0 }), planeNormal: PLANE_NORMAL, endPoint: { x: 0, y: 1.0, z: 0 }, dtSeconds: 1 / 60 });
    carry.endDrag({ x: 1.4, y: 1.2, z: 0 });
    // The end never converges (taut leash), but the timeout must end the drop.
    let sawTarget = false;
    for (let f = 0; f < 60 * 5; f += 1) {
      const target = carry.composeTarget({ ray: null, planeNormal: PLANE_NORMAL, endPoint: { x: 1.4, y: 1.2, z: 0 }, dtSeconds: 1 / 60 });
      if (target !== null) sawTarget = true;
      else break;
    }
    expect(sawTarget).toBe(true);
    expect(carry.phase).toBe('idle');
  });

  it('re-grabbing mid-drop resumes the drag; idle composes nothing', () => {
    const carry = makeController();
    expect(carry.phase).toBe('idle');
    expect(carry.composeTarget({ ray: rayTo(EYE, { x: 0, y: 0, z: 0 }), planeNormal: PLANE_NORMAL, endPoint: { x: 0, y: 0, z: 0 }, dtSeconds: 1 / 60 })).toBeNull();

    carry.beginDrag({ x: 0, y: 1, z: 0 });
    carry.composeTarget({ ray: rayTo(EYE, { x: 0.5, y: 0.5, z: 0 }), planeNormal: PLANE_NORMAL, endPoint: { x: 0, y: 1, z: 0 }, dtSeconds: 1 / 60 });
    carry.endDrag({ x: 0.5, y: 0.5, z: 0 });
    expect(carry.phase).toBe('dropping');
    carry.beginDrag({ x: 0.3, y: 0.4, z: 0 }); // grabbed again mid-fall
    expect(carry.phase).toBe('dragging');
    // The drag plane is now through (0.3,0.4,0); aim at a point ON it.
    const target = carry.composeTarget({
      ray: rayTo(EYE, { x: -0.2, y: 0.4, z: 0 }),
      planeNormal: PLANE_NORMAL,
      endPoint: { x: 0.3, y: 0.4, z: 0 },
      dtSeconds: 1 / 60,
    });
    expect(target?.position.x).toBeCloseTo(-0.2, 6); // follows the new cursor
  });

  it('steady-state composition reuses one target shell (no per-frame allocation)', () => {
    const carry = makeController();
    carry.beginDrag({ x: 0, y: 0.5, z: 0 });
    const a = carry.composeTarget({ ray: rayTo(EYE, { x: 0.2, y: 0.3, z: 0 }), planeNormal: PLANE_NORMAL, endPoint: { x: 0, y: 0.5, z: 0 }, dtSeconds: 1 / 60 });
    const b = carry.composeTarget({ ray: rayTo(EYE, { x: 0.3, y: 0.3, z: 0 }), planeNormal: PLANE_NORMAL, endPoint: { x: 0, y: 0.5, z: 0 }, dtSeconds: 1 / 60 });
    expect(a).toBe(b); // same shell, mutated in place
  });

  it('INT-2: cancel ends the grab by PLUGGING — no drop targets, straight to idle', () => {
    const carry = makeController();
    carry.beginDrag({ x: 0, y: 0.5, z: 0 });
    carry.composeTarget({ ray: rayTo(EYE, { x: 0.5, y: 0.5, z: 0 }), planeNormal: PLANE_NORMAL, endPoint: { x: 0, y: 0.5, z: 0 }, dtSeconds: 1 / 60 });
    carry.cancel(); // the pointer-up became a seat, not a release
    expect(carry.phase).toBe('idle');
    // No drop-to-floor policy runs: the seat owns the end's fate from here.
    expect(carry.composeTarget({ ray: null, planeNormal: PLANE_NORMAL, endPoint: { x: 0, y: 0.5, z: 0 }, dtSeconds: 1 / 60 })).toBeNull();
    // Cancel when idle is a harmless no-op.
    carry.cancel();
    expect(carry.phase).toBe('idle');
  });

  it('INT-4: targets are stamped with the controller cord id (default 0) so the world step can route them', () => {
    // Absent cordId means the anchor cord 0 — the pre-INT-4 compositions
    // are unchanged.
    const anchorCord = makeController();
    anchorCord.beginDrag({ x: 0, y: 0.5, z: 0 });
    const plain = anchorCord.composeTarget({ ray: rayTo(EYE, { x: 0.2, y: 0.3, z: 0 }), planeNormal: PLANE_NORMAL, endPoint: { x: 0, y: 0.5, z: 0 }, dtSeconds: 1 / 60 });
    expect(plain?.cordId).toBe(0);
    // A spawned cord's controller stamps its own id on the reused shell.
    const spawned = createCarryController({ freeEndIndex: 0, floorRestY: FLOOR_REST_Y, cordId: 7 });
    spawned.beginDrag({ x: 0, y: 0.5, z: 0 });
    const a = spawned.composeTarget({ ray: rayTo(EYE, { x: 0.2, y: 0.3, z: 0 }), planeNormal: PLANE_NORMAL, endPoint: { x: 0, y: 0.5, z: 0 }, dtSeconds: 1 / 60 });
    const b = spawned.composeTarget({ ray: rayTo(EYE, { x: 0.3, y: 0.3, z: 0 }), planeNormal: PLANE_NORMAL, endPoint: { x: 0, y: 0.5, z: 0 }, dtSeconds: 1 / 60 });
    expect(a?.cordId).toBe(7);
    expect(a).toBe(b); // same shell, id stamped once at construction
  });
});

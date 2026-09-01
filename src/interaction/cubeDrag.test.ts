/**
 * INT-3 — cube-drag controller tests. The controller is the translate-only
 * grab/drag/release policy over the INT-1 'cube' pick class, so the tests
 * pin the policy headless (render-free, DOM-free): composed centers keep the
 * grab offset and land on the camera-parallel plane through the grab point;
 * the floor clamp holds the cube ON the bench through drags AND drops; a
 * missed/parallel/behind/garbage ray holds; release is immediate; steady
 * state reuses one target shell (no per-frame allocation).
 */
import { describe, expect, it } from 'vitest';
import { createCubeDragController } from './cubeDrag';
import type { Ray3, Vec3 } from '../sim';

/** The M1 camera looks down the -z/-y diagonal; the drag plane faces it. */
const PLANE_NORMAL: Vec3 = { x: 0, y: -0.212, z: -0.977 };
const EYE: Vec3 = { x: 0, y: 1.45, z: 4.5 };
const HALF = 0.25; // the REN-1 stage cube is 0.5
const FLOOR_Y = 0;
const MIN_CENTER_Y = FLOOR_Y + HALF;

/** A ray from `origin` pointing at `point` (normalized direction). */
function rayTo(origin: Vec3, point: Vec3): Ray3 {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const dz = point.z - origin.z;
  const len = Math.hypot(dx, dy, dz);
  return { origin, direction: { x: dx / len, y: dy / len, z: dz / len } };
}

function makeController(floorY: number = FLOOR_Y) {
  return createCubeDragController({ cubeHalfSize: HALF, floorY });
}

describe('INT-3 cube-drag controller', () => {
  it('drag targets land on the plane through the grab point with the grab offset preserved', () => {
    const drag = makeController();
    // Grabbed a floor cube's top face: hit point (0.5, 0.5, 0), center (0.5, 0.25, 0).
    const GRAB: Vec3 = { x: 0.5, y: 0.5, z: 0 };
    const CENTER: Vec3 = { x: 0.5, y: 0.25, z: 0 };
    drag.beginDrag(3, GRAB, CENTER);
    expect(drag.phase).toBe('dragging');
    expect(drag.draggingCubeId).toBe(3);

    // Aim the cursor at a point ON the drag plane: the plane's normal has no
    // x component, so any point straight along +x from the grab point lies
    // in it — the intersection must be exactly that point.
    const aim: Vec3 = { x: 1.1, y: 0.5, z: 0 };
    const target = drag.composeTarget({ ray: rayTo(EYE, aim), planeNormal: PLANE_NORMAL });
    expect(target).not.toBeNull();
    expect(target?.cubeId).toBe(3);
    // The grab-point slot rides the plane (dot with the plane normal = 0)…
    const gx = target!.position.x - (CENTER.x - GRAB.x);
    const gy = target!.position.y - (CENTER.y - GRAB.y);
    const gz = target!.position.z - (CENTER.z - GRAB.z);
    const planeDot = (gx - GRAB.x) * PLANE_NORMAL.x + (gy - GRAB.y) * PLANE_NORMAL.y + (gz - GRAB.z) * PLANE_NORMAL.z;
    expect(planeDot).toBeCloseTo(0, 9);
    // …exactly where the cursor aimed, offset preserved: the center moved by
    // the same delta the grab point did (no snap-to-cursor).
    expect(target!.position.x).toBeCloseTo(1.1, 6);
    expect(target!.position.y).toBeCloseTo(0.25, 6);
    expect(target!.position.z).toBeCloseTo(0, 6);
    expect(target!.position.x - CENTER.x).toBeCloseTo(aim.x - GRAB.x, 6);
    expect(target!.position.y - CENTER.y).toBeCloseTo(aim.y - GRAB.y, 6);
    expect(target!.position.z - CENTER.z).toBeCloseTo(aim.z - GRAB.z, 6);
  });

  it('a cursor below the bench holds the cube resting exactly on it — drags and drops are floor-clamped', () => {
    const drag = makeController();
    // Grabbed mid-air (top-face hit 1.25 up), dragged hard below the floor.
    drag.beginDrag(2, { x: 0, y: 1.25, z: 0 }, { x: 0, y: 1.0, z: 0 });
    // Aim ON the drag plane, deep below the bench: the in-plane direction
    // (0.4, -DOWN, 0.5) is ⊥ the plane normal (built that way), so the ray ∩
    // plane is exactly the aim point and the assertions can be exact.
    const DOWN = (0.977 / 0.212) * 0.5; // dz = 0.5 needs dy = -(0.977/0.212)*0.5
    const aim: Vec3 = { x: 0.4, y: 1.25 - DOWN, z: 0.5 };
    const target = drag.composeTarget({ ray: rayTo(EYE, aim), planeNormal: PLANE_NORMAL });
    expect(target?.position.y).toBe(MIN_CENTER_Y); // bottom exactly ON the bench
    expect(target?.position.x).toBeCloseTo(0.4, 6); // x/z still follow the hand
    expect(target?.position.z).toBeCloseTo(0.5, 6);
    // Releasing there is a drop of a cube already resting on the floor: no
    // further targets, the clamped position stands.
    drag.endDrag();
    expect(drag.phase).toBe('idle');
    expect(
      drag.composeTarget({ ray: rayTo(EYE, aim), planeNormal: PLANE_NORMAL }),
    ).toBeNull();
  });

  it('the floor clamp respects the configured floorY (minCenterY = floorY + half size)', () => {
    const drag = makeController(0.5); // a raised platform floor
    drag.beginDrag(1, { x: 0, y: 0.5, z: 0 }, { x: 0, y: 0.25, z: 0 });
    const DOWN = (0.977 / 0.212) * 1.5;
    const target = drag.composeTarget({
      ray: rayTo(EYE, { x: 0, y: 0.5 - DOWN, z: 0.5 }), // on the plane, far below
      planeNormal: PLANE_NORMAL,
    });
    expect(target?.position.y).toBe(0.75);
  });

  it('holds on a null ray, a parallel ray, a plane behind the ray, and a garbage ray', () => {
    const drag = makeController();
    drag.beginDrag(0, { x: 0, y: 0.5, z: 0 }, { x: 0, y: 0.25, z: 0 });
    expect(drag.composeTarget({ ray: null, planeNormal: PLANE_NORMAL })).toBeNull();
    const parallel: Ray3 = { origin: EYE, direction: { x: 1, y: 0, z: 0 } };
    expect(drag.composeTarget({ ray: parallel, planeNormal: PLANE_NORMAL })).toBeNull();
    const away: Ray3 = { origin: EYE, direction: { x: 0, y: 1, z: 0 } };
    expect(drag.composeTarget({ ray: away, planeNormal: PLANE_NORMAL })).toBeNull();
    // Zero-direction garbage from upstream: held, never a NaN center.
    const zero: Ray3 = { origin: EYE, direction: { x: 0, y: 0, z: 0 } };
    expect(drag.composeTarget({ ray: zero, planeNormal: PLANE_NORMAL })).toBeNull();
    // Infinite-origin garbage: held too.
    const inf: Ray3 = {
      origin: { x: Number.POSITIVE_INFINITY, y: 0, z: 0 },
      direction: { x: 0, y: -1, z: 0 },
    };
    expect(drag.composeTarget({ ray: inf, planeNormal: PLANE_NORMAL })).toBeNull();
  });

  it('the plane point stays pinned to the grab point when the camera (plane normal) turns', () => {
    const drag = makeController();
    // High enough that the floor clamp stays out of play (it is pinned by
    // its own tests): the plane-membership property is what's under test.
    const GRAB: Vec3 = { x: 0.3, y: 1.4, z: 0.2 };
    const CENTER: Vec3 = { x: 0.3, y: 1.15, z: 0.2 };
    drag.beginDrag(5, GRAB, CENTER);
    const turned: Vec3 = { x: 0.4, y: -0.5, z: -0.77 }; // a different camera angle
    const target = drag.composeTarget({
      ray: rayTo({ x: 0, y: 1.45, z: 4.5 }, GRAB),
      planeNormal: turned,
    });
    // Whatever the intersection, the grab-point slot (center minus the
    // grab-time offset) still satisfies the NEW plane through the grab point.
    expect(target).not.toBeNull();
    const gx = target!.position.x - (CENTER.x - GRAB.x);
    const gy = target!.position.y - (CENTER.y - GRAB.y);
    const gz = target!.position.z - (CENTER.z - GRAB.z);
    const dot = (gx - GRAB.x) * turned.x + (gy - GRAB.y) * turned.y + (gz - GRAB.z) * turned.z;
    expect(dot).toBeCloseTo(0, 9);
  });

  it('release stops composing; re-grabbing another cube retargets plane and id', () => {
    const drag = makeController();
    expect(drag.phase).toBe('idle');
    expect(drag.draggingCubeId).toBeNull();
    expect(
      drag.composeTarget({ ray: rayTo(EYE, { x: 0, y: 0, z: 0 }), planeNormal: PLANE_NORMAL }),
    ).toBeNull();

    drag.beginDrag(1, { x: 0, y: 0.5, z: 0 }, { x: 0, y: 0.25, z: 0 });
    drag.composeTarget({ ray: rayTo(EYE, { x: 0.5, y: 0.5, z: 0 }), planeNormal: PLANE_NORMAL });
    drag.endDrag();
    expect(drag.draggingCubeId).toBeNull();

    drag.beginDrag(6, { x: -0.8, y: 0.3, z: 0.1 }, { x: -0.8, y: 0.25, z: 0.1 });
    expect(drag.draggingCubeId).toBe(6);
    const target = drag.composeTarget({
      ray: rayTo(EYE, { x: -0.3, y: 0.3, z: 0.1 }), // on the new plane (+x of it)
      planeNormal: PLANE_NORMAL,
    });
    expect(target?.cubeId).toBe(6);
    expect(target!.position.x).toBeCloseTo(-0.3, 6);
  });

  it('cancel releases without semantics', () => {
    const drag = makeController();
    drag.beginDrag(4, { x: 0, y: 0.5, z: 0 }, { x: 0, y: 0.25, z: 0 });
    drag.cancel();
    expect(drag.phase).toBe('idle');
    expect(
      drag.composeTarget({ ray: rayTo(EYE, { x: 0, y: 0, z: 0 }), planeNormal: PLANE_NORMAL }),
    ).toBeNull();
    drag.cancel(); // idle cancel is a harmless no-op
    expect(drag.phase).toBe('idle');
  });

  it('a fresh begin while dragging is a fresh grab (the newest pointer-down wins)', () => {
    const drag = makeController();
    drag.beginDrag(1, { x: 0, y: 0.5, z: 0 }, { x: 0, y: 0.25, z: 0 });
    drag.beginDrag(2, { x: 1, y: 0.5, z: 0 }, { x: 1, y: 0.25, z: 0 });
    expect(drag.draggingCubeId).toBe(2);
    const target = drag.composeTarget({
      ray: rayTo(EYE, { x: 1.5, y: 0.5, z: 0 }), // on the new plane (+x of it)
      planeNormal: PLANE_NORMAL,
    });
    expect(target?.cubeId).toBe(2);
    expect(target!.position.x).toBeCloseTo(1.5, 6);
  });

  it('steady-state composition reuses one target shell (no per-frame allocation)', () => {
    const drag = makeController();
    drag.beginDrag(7, { x: 0, y: 0.5, z: 0 }, { x: 0, y: 0.25, z: 0 });
    const a = drag.composeTarget({ ray: rayTo(EYE, { x: 0.2, y: 0.5, z: 0 }), planeNormal: PLANE_NORMAL });
    const b = drag.composeTarget({ ray: rayTo(EYE, { x: 0.9, y: 0.5, z: 0 }), planeNormal: PLANE_NORMAL });
    expect(a).toBe(b); // same shell, mutated in place
    expect(a?.cubeId).toBe(7);
  });
});

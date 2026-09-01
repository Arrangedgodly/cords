import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createPicker } from './picking';
import { createThreeRaycastProvider } from './threeRaycastProvider';
import type { ClientRect } from './picking';
import type { Ray3 } from '../sim';

/**
 * INT-1 adapter slice: the thin THREE.Raycaster provider against REAL
 * geometry math (BufferGeometry raycasting is pure math — no renderer, no
 * WebGL, no DOM: the viewport rect is stubbed). Proves the whole flow the
 * contract asks for — ray in → class-tagged hits out → deterministic grab
 * through createPicker — so the seam main.ts plugs into is verified, not
 * assumed. REN-1 re-runs these shapes in the live scene.
 */

const CENTER_RAY: Ray3 = {
  origin: { x: 0, y: 0, z: 5 },
  direction: { x: 0, y: 0, z: -1 },
};

/** Node-test stand-in for the render canvas — only the rect is consumed. */
function stubElement(rect: ClientRect): HTMLElement {
  return {
    getBoundingClientRect: () => rect,
  } as unknown as HTMLElement;
}

const FULL_RECT: ClientRect = { left: 0, top: 0, width: 100, height: 100 };

function makeCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  return camera;
}

function makeCube(position: THREE.Vector3): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial(),
  );
  mesh.position.copy(position);
  return mesh;
}

describe('threeRaycastProvider — registration + hit mapping', () => {
  it('maps a real raycast onto a registered cube: class, distance, hit point, default payload', () => {
    const provider = createThreeRaycastProvider({
      camera: makeCamera(),
      element: stubElement(FULL_RECT),
    });
    const cube = makeCube(new THREE.Vector3(0, 0, 0));
    provider.registerPickable({ class: 'cube', object: cube });

    // Center ray: crosses the quad diagonal (two coplanar triangles) AND the
    // far side of the box — the raw raycaster sees several intersections, the
    // provider still reports exactly ONE hit per pickable, at the nearest.
    const hits = provider.hitTest(CENTER_RAY);

    expect(hits).toHaveLength(1);
    expect(hits[0].class).toBe('cube');
    expect(hits[0].distance).toBeCloseTo(4.5, 6); // front face at z = 0.5
    expect(hits[0].point?.z).toBeCloseTo(0.5, 6);
    expect(hits[0].payload).toBe(cube); // payload defaults to the object
  });

  it('resolves hits on group children back to the registered ancestor — a jack picks as one unit', () => {
    const provider = createThreeRaycastProvider({
      camera: makeCamera(),
      element: stubElement(FULL_RECT),
    });
    const jack = new THREE.Group();
    jack.add(makeCube(new THREE.Vector3(0, 0.4, 0)));
    const payload = { kind: 'jack', id: 7 };
    provider.registerPickable({ class: 'jack', object: jack, payload });

    const hits = provider.hitTest({
      origin: { x: 0, y: 0.4, z: 5 },
      direction: { x: 0, y: 0, z: -1 },
    });

    expect(hits).toHaveLength(1);
    expect(hits[0].class).toBe('jack');
    expect(hits[0].payload).toBe(payload); // explicit payload, not the child mesh
  });

  it('unregister removes the pickable from the pick set', () => {
    const provider = createThreeRaycastProvider({
      camera: makeCamera(),
      element: stubElement(FULL_RECT),
    });
    const cube = makeCube(new THREE.Vector3(0, 0, 0));
    const handle = provider.registerPickable({ class: 'cube', object: cube });
    handle.unregister();

    expect(provider.hitTest(CENTER_RAY)).toEqual([]);
  });
});

describe('threeRaycastProvider + createPicker — the real grab flow', () => {
  it('a cord body in front of a cube is excluded from the grab and sorted last', () => {
    const provider = createThreeRaycastProvider({
      camera: makeCamera(),
      element: stubElement(FULL_RECT),
    });
    const cube = makeCube(new THREE.Vector3(0, 0, 0));
    provider.registerPickable({ class: 'cube', object: cube, payload: 'cube' });

    const cord = makeCube(new THREE.Vector3(0, 0, 1));
    cord.scale.set(20, 0.02, 0.02); // a thin stretched body crossing the ray
    provider.registerPickable({
      class: 'cordBody',
      object: cord,
      payload: 'cord',
    });

    const picker = createPicker(provider);
    expect(picker.pickGrabbable(CENTER_RAY)?.payload).toBe('cube');
    expect(picker.pick(CENTER_RAY).map((h) => h.payload)).toEqual([
      'cube',
      'cord',
    ]);
  });
});

describe('threeRaycastProvider — hit face normals (INT-2 socket seam)', () => {
  it('reports the outward world-space face normal of the struck cube face', () => {
    const provider = createThreeRaycastProvider({
      camera: makeCamera(),
      element: stubElement(FULL_RECT),
    });
    const cube = makeCube(new THREE.Vector3(0, 0, 0));
    provider.registerPickable({ class: 'cube', object: cube });

    const hits = provider.hitTest(CENTER_RAY); // travels −z, strikes the +z face
    expect(hits).toHaveLength(1);
    expect(hits[0].normal).not.toBeNull();
    expect(hits[0].normal!.x).toBeCloseTo(0, 9);
    expect(hits[0].normal!.y).toBeCloseTo(0, 9);
    expect(hits[0].normal!.z).toBeCloseTo(1, 9); // outward on the +z face
  });

  it('transforms normals through rotation — a yawed cube reports its world-space face normal', () => {
    const provider = createThreeRaycastProvider({
      camera: makeCamera(),
      element: stubElement(FULL_RECT),
    });
    const cube = makeCube(new THREE.Vector3(0, 0, 0));
    cube.rotation.y = Math.PI / 4; // local +z face normal turns 45° toward +x
    cube.updateMatrixWorld(); // headless: no render loop refreshes matrices
    provider.registerPickable({ class: 'cube', object: cube });

    const hits = provider.hitTest(CENTER_RAY);
    expect(hits).toHaveLength(1);
    const sqrtHalf = Math.SQRT1_2;
    expect(hits[0].normal!.x).toBeCloseTo(sqrtHalf, 9);
    expect(hits[0].normal!.y).toBeCloseTo(0, 9);
    expect(hits[0].normal!.z).toBeCloseTo(sqrtHalf, 9);
  });

  it('reports null for face-less hits (a Line has no face)', () => {
    const provider = createThreeRaycastProvider({
      camera: makeCamera(),
      element: stubElement(FULL_RECT),
    });
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, -1),
    ]);
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial());
    provider.registerPickable({ class: 'cordBody', object: line });

    // Raycaster's Line threshold defaults to 1 — the ray down the line hits it.
    const hits = provider.hitTest(CENTER_RAY);
    expect(hits).toHaveLength(1);
    expect(hits[0].normal).toBeNull();
  });
});

describe('threeRaycastProvider — rayFromClient (NDC → camera ray)', () => {
  it('center of the rect rays through the world origin and hits the cube', () => {
    const provider = createThreeRaycastProvider({
      camera: makeCamera(),
      element: stubElement(FULL_RECT),
    });
    const cube = makeCube(new THREE.Vector3(0, 0, 0));
    provider.registerPickable({ class: 'cube', object: cube, payload: 'cube' });

    const ray = provider.rayFromClient(50, 50);
    expect(ray).not.toBeNull();
    expect(provider.hitTest(ray as Ray3).map((h) => h.payload)).toEqual([
      'cube',
    ]);
  });

  it('top-left corner rays up-left: direction −x, +y, −z from a camera looking down −z', () => {
    const provider = createThreeRaycastProvider({
      camera: makeCamera(),
      element: stubElement(FULL_RECT),
    });
    const ray = provider.rayFromClient(0, 0);
    expect(ray).not.toBeNull();
    expect(ray!.direction.x).toBeLessThan(0);
    expect(ray!.direction.y).toBeGreaterThan(0);
    expect(ray!.direction.z).toBeLessThan(0);
  });

  it('returns null for a degenerate viewport rect instead of poisoning the ray', () => {
    const provider = createThreeRaycastProvider({
      camera: makeCamera(),
      element: stubElement({ left: 0, top: 0, width: 0, height: 0 }),
    });
    expect(provider.rayFromClient(50, 50)).toBeNull();
  });
});

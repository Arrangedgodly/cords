import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Ray3 } from '../sim';
import { createThreeRaycastProvider } from './threeRaycastProvider';
import type { PickableHandle } from './threeRaycastProvider';
import { createPicker } from './picking';

/**
 * T-LIFE-2 — THE SHADOW-HAZARD REGRESSION, mechanism pin (the pixel-level
 * proof lives in scripts/life2-e2e.mjs; this pins the MECHANISM with main.ts's
 * exact calls): under the approved priority jack > cube, a vanishing cord's
 * seated plug keeps shadowing its host cube's face — releases aimed at that
 * face hit the jack, take the drop path, and the face is un-droppable. The
 * fix: main.ts unregisters the plug's pick proxy in the choreography's PULL
 * event (the exact moment the plug physically leaves its socket; the failing
 * end's proxy goes at sequence START). After the unregistration the ray hits
 * the CUBE — the face seats again.
 *
 * This file lives in src/interaction/ (not src/sim/) because it exercises the
 * real three.js Raycaster adapter; the sim stays three-free (check:sim).
 */

describe('T-LIFE-2 — the vanishing plug stops shadowing its host cube’s face', () => {
  function stage(): {
    provider: ReturnType<typeof createThreeRaycastProvider>;
    jackHandle: PickableHandle;
    cubeHandle: PickableHandle;
    ray: Ray3;
  } {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 1.2, 5);
    camera.lookAt(0, 1.2, 0);
    camera.updateMatrixWorld(true);
    const element = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    } as unknown as HTMLElement;
    const provider = createThreeRaycastProvider({ camera, element });

    // The host cube, face-on to the camera...
    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.5, 0.5),
      new THREE.MeshBasicMaterial(),
    );
    cube.position.set(0, 1.2, 0);
    cube.updateMatrixWorld(true);
    // ...and the seated plug's grab proxy, sitting proud of that exact face —
    // the production proxy's visibility state (invisible to pixels, raycastable).
    const proxy = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 10, 8),
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
    );
    proxy.position.set(0, 1.2, 0.26);
    (proxy.material as THREE.MeshBasicMaterial).visible = false;
    proxy.updateMatrixWorld(true);

    const cubeHandle = provider.registerPickable({
      class: 'cube',
      object: cube,
      payload: { kind: 'cube', id: 0 },
    });
    const jackHandle = provider.registerPickable({
      class: 'jack',
      object: proxy,
      payload: { kind: 'cordEnd', cordId: 1, index: 0 },
    });
    // A ray through the plug's face point (the release aim).
    const ray: Ray3 = { origin: { x: 0, y: 1.2, z: 5 }, direction: { x: 0, y: 0, z: -1 } };
    return { provider, jackHandle, cubeHandle, ray };
  }

  it('before the pull-out the proxy shadows the face (jack > cube) — the hazard, reproduced', () => {
    const { provider, ray } = stage();
    const hit = createPicker(provider).pickGrabbable(ray);
    expect(hit?.class).toBe('jack'); // the release would hit the plug, not the cube
  });

  it('after the PULL event’s unregistration the face is droppable-on again — and nothing leaks', () => {
    const { provider, jackHandle, cubeHandle, ray } = stage();
    jackHandle.unregister(); // main.ts's exact call in handleVanishEvent('pull')
    const hit = createPicker(provider).pickGrabbable(ray);
    expect(hit?.class).toBe('cube'); // the face wins the release again
    expect(hit?.normal).not.toBeNull(); // a real face normal for the socket rule
    // Belt and braces: with the cube gone too, the ray finds nothing at all —
    // no stale proxy resurrects from the pick set.
    cubeHandle.unregister();
    expect(createPicker(provider).pickGrabbable(ray)).toBeNull();
    expect(createPicker(provider).pick(ray)).toHaveLength(0);
  });
});

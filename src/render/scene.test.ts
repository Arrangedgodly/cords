/**
 * REN-2 render-layer tests — headless (no WebGL, no DOM): the tube and jack
 * machinery are pure buffer math over three.js geometry objects, so they are
 * testable under node. The last test is Thor's evidence: the full 12-cord
 * render UPDATE path (tube rewrites + instance matrices, worst case — every
 * cord moving every frame) timed over 300 frames.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Ray3, Vec3 } from '../sim';
import { CordTube, FragmentPool, JackInstances, createPlugMaterials } from './scene';

/** A deterministic wiggly 25-point polyline (spans ~2 units). */
function wigglyPoints(n: number, phase: number, out: Vec3[]): void {
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1);
    out[i].x = Math.sin(t * 6 + phase) * 0.3 + t * 0.5;
    out[i].y = 1.4 - t * 1.1 + Math.sin(t * 11 + phase * 1.3) * 0.05;
    out[i].z = Math.cos(t * 7 + phase * 0.7) * 0.2;
  }
}

function makeShells(n: number): Vec3[] {
  return Array.from({ length: n }, () => ({ x: 0, y: 0, z: 0 }));
}

describe('CordTube (production cord mesh)', () => {
  it('lands the first and last rings exactly on the sim end points', () => {
    const tube = new CordTube(new THREE.MeshStandardMaterial());
    const pts = makeShells(25);
    wigglyPoints(25, 0, pts);
    tube.update(pts);

    const pos = tube.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const rings = (25 - 1) * 4 + 1;
    const radial = 10;
    // Ring 0 center = average of its radial vertices = points[0].
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let r = 0; r < radial; r += 1) {
      cx += pos.getX(r);
      cy += pos.getY(r);
      cz += pos.getZ(r);
    }
    expect(cx / radial).toBeCloseTo(pts[0].x, 12);
    expect(cy / radial).toBeCloseTo(pts[0].y, 12);
    expect(cz / radial).toBeCloseTo(pts[0].z, 12);
    // Last ring likewise.
    const lastRingStart = (rings - 1) * radial;
    cx = 0; cy = 0; cz = 0;
    for (let r = 0; r < radial; r += 1) {
      cx += pos.getX(lastRingStart + r);
      cy += pos.getY(lastRingStart + r);
      cz += pos.getZ(lastRingStart + r);
    }
    // Buffers are Float32 — float32 precision is the honest exactness bar.
    expect(cx / radial).toBeCloseTo(pts[24].x, 8);
    expect(cy / radial).toBeCloseTo(pts[24].y, 8);
    expect(cz / radial).toBeCloseTo(pts[24].z, 8);
  });

  it('reuses buffers across updates (no rebuild on move) and rebuilds only on topology change', () => {
    const tube = new CordTube(new THREE.MeshStandardMaterial());
    const pts = makeShells(25);
    wigglyPoints(25, 0, pts);
    tube.update(pts);
    const posA = tube.mesh.geometry.getAttribute('position');
    const indexA = tube.mesh.geometry.getIndex();

    wigglyPoints(25, 1.5, pts); // same point count = move, not rebuild
    tube.update(pts);
    expect(tube.mesh.geometry.getAttribute('position')).toBe(posA);
    expect(tube.mesh.geometry.getIndex()).toBe(indexA);

    const ptsLong = makeShells(33); // topology change → new capacity
    wigglyPoints(33, 0, ptsLong);
    tube.update(ptsLong);
    const posB = tube.mesh.geometry.getAttribute('position');
    expect(posB).not.toBe(posA);
    expect(posB.count).toBeGreaterThan(posA.count);
  });

  it('every vertex stays finite across adversarial tangles', () => {
    const tube = new CordTube(new THREE.MeshStandardMaterial());
    const pts = makeShells(17);
    // Degenerate tangle: duplicated + coincident points (0/0 tangent risk).
    for (let i = 0; i < 17; i += 1) {
      pts[i].x = i < 8 ? 0.2 : i * 0.01;
      pts[i].y = i < 8 ? 0.2 : 1;
      pts[i].z = i < 8 ? 0.2 : -0.4;
    }
    tube.update(pts);
    const pos = tube.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const nrm = tube.mesh.geometry.getAttribute('normal') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i += 1) {
      expect(Number.isFinite(pos.getX(i))).toBe(true);
      expect(Number.isFinite(nrm.getX(i))).toBe(true);
      const nl = Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
      expect(nl).toBeCloseTo(1, 5);
    }
  });
});

describe('JackInstances (1/4" plug pool)', () => {
  it('writes matrices into stable slots and keeps the span across gaps', () => {
    const mats = createPlugMaterials(null);
    const jacks = new JackInstances(mats, 8);
    jacks.beginFrame();
    jacks.writeJack(0, 0, 1, 0, 0, 1, 0, true); // cord A first end (red)
    jacks.writeJack(1, 0, 1, 0, 0, -1, 0, false); // cord A last end (blue)
    jacks.writeJack(4, 1, 1, 1, 1, 0, 0, true); // cord C first end (span 5)
    jacks.endFrame(false);

    expect(jacks.group.children.length).toBe(3);
    const expected = new THREE.Matrix4().compose(
      new THREE.Vector3(0, 1, 0),
      new THREE.Quaternion(), // tip +Y → +Y: identity rotation
      new THREE.Vector3(1, 1, 1),
    ).elements;
    for (const child of jacks.group.children) {
      const mesh = child as THREE.InstancedMesh;
      expect(mesh.count).toBe(5); // span, not write count — slot 4 must draw
      const m = mesh.instanceMatrix.array as Float32Array;
      // Slot 0: position (0,1,0), tip along +Y → identity rotation.
      expect(Array.from(m.subarray(0, 16))).toEqual(Array.from(expected));
      // Slot 4: position (1,1,1).
      expect(m[4 * 16 + 12]).toBe(1);
      expect(m[4 * 16 + 13]).toBe(1);
      expect(m[4 * 16 + 14]).toBe(1);
    }
  });

  it('color-codes red input / blue output per slot and skips rewrites', () => {
    const mats = createPlugMaterials(null);
    const jacks = new JackInstances(mats, 8);
    const coded = jacks.group.children[2] as THREE.InstancedMesh;
    jacks.beginFrame();
    jacks.writeJack(0, 0, 1, 0, 0, 1, 0, true);
    jacks.writeJack(1, 0, 1, 0, 0, 1, 0, false);
    jacks.endFrame(false);
    const color = coded.instanceColor!;
    // Red band ≈ (0.79, 0.21, 0.18) sRGB-linear-ized by THREE.Color; blue ≈ cobalt.
    expect(color.getX(0)).toBeGreaterThan(color.getX(1)); // red: R > G
    expect(color.getZ(0)).toBeLessThan(0.3);
    expect(color.getX(1)).toBeLessThan(0.35); // blue: B > R
    expect(color.getZ(1)).toBeGreaterThan(color.getX(1));

    const before = Array.from(color.array as Float32Array);
    jacks.beginFrame();
    jacks.writeJack(0, 1, 2, 3, 0, 1, 0, true); // moved, same polarity
    jacks.writeJack(1, 1, 2, 3, 0, 1, 0, false);
    jacks.endFrame(false);
    expect(Array.from(color.array as Float32Array)).toEqual(before); // untouched
  });

  it('hideSlots collapses vanished cords so stale plugs never draw', () => {
    const mats = createPlugMaterials(null);
    const jacks = new JackInstances(mats, 8);
    jacks.beginFrame();
    jacks.writeJack(0, 0, 1, 0, 0, 1, 0, true);
    jacks.writeJack(1, 0, 1, 0, 0, 1, 0, false);
    jacks.writeJack(2, 5, 5, 5, 0, 1, 0, true);
    jacks.writeJack(3, 5, 5, 5, 0, 1, 0, false);
    jacks.endFrame(false);
    jacks.beginFrame();
    jacks.hideSlots(0, 1); // cord A vanishes; cord B (slots 2,3) must survive
    jacks.writeJack(2, 6, 5, 5, 0, 1, 0, true);
    jacks.writeJack(3, 6, 5, 5, 0, 1, 0, false);
    jacks.endFrame(false);
    const metal = jacks.group.children[0] as THREE.InstancedMesh;
    expect(metal.count).toBe(4); // span still covers B's slots
    const m = metal.instanceMatrix.array as Float32Array;
    expect(m[12]).toBe(0); // slot 0 collapsed (zero matrix)
    expect(m[16 + 12]).toBe(0); // slot 1 collapsed
    expect(m[2 * 16 + 12]).toBe(6); // slot 2 alive at its new position
  });
});

describe('pick-proxy raycast contract', () => {
  it('an invisible proxy mesh still raycasts (the grab path depends on it)', () => {
    // The M1 grab proxy uses visible=false + colorWrite=false so the pool
    // costs zero draw calls; the INT-1 provider (THREE.Raycaster) must still
    // hit it. Pinned here so the grab path can never silently break.
    const proxy = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 10, 8),
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
    );
    proxy.position.set(0, 1.2, 0);
    proxy.visible = false;
    proxy.material.visible = false; // the production proxy's exact visibility state
    proxy.updateMatrixWorld(true);

    const raycaster = new THREE.Raycaster();
    raycaster.set(new THREE.Vector3(0, 1.2, 5), new THREE.Vector3(0, 0, -1));
    const hits = raycaster.intersectObject(proxy, false);
    expect(hits.length).toBe(1);
    // Facet distance, not ideal-sphere distance: the 10×8 poly sphere's
    // chords sit slightly inside r=0.12 — the hit is on the near hemisphere.
    expect(hits[0].distance).toBeGreaterThan(4.7);
    expect(hits[0].distance).toBeLessThan(4.92);
  });
});

describe('Thor — 12-cord render update path (CPU, worst case)', () => {
  it('tubes + jack instances for 12 moving cords over 300 frames stay far under the frame budget', () => {
    const CORDS = 12;
    const POINTS = 25;
    const FRAMES = 300;
    const mats = createPlugMaterials(null);
    const tubes = Array.from({ length: CORDS }, () => new CordTube(new THREE.MeshStandardMaterial()));
    const jacks = new JackInstances(mats);
    const fleet = Array.from({ length: CORDS }, () => makeShells(POINTS));

    // Warmup (JIT + first-rebuild path).
    for (let c = 0; c < CORDS; c += 1) {
      wigglyPoints(POINTS, c, fleet[c]);
      tubes[c].update(fleet[c]);
    }

    const start = performance.now();
    for (let f = 0; f < FRAMES; f += 1) {
      const phase = f * 0.05;
      jacks.beginFrame();
      for (let c = 0; c < CORDS; c += 1) {
        wigglyPoints(POINTS, phase + c, fleet[c]); // every cord moves: worst case
        tubes[c].update(fleet[c]);
        const pts = fleet[c];
        const a = pts[0];
        const b = pts[1];
        const y = pts[POINTS - 1];
        const w = pts[POINTS - 2];
        jacks.writeJack(c * 2, a.x, a.y, a.z, a.x - b.x, a.y - b.y, a.z - b.z, true);
        jacks.writeJack(c * 2 + 1, y.x, y.y, y.z, y.x - w.x, y.y - w.y, y.z - w.z, false);
      }
      jacks.endFrame(false);
    }
    const elapsedMs = performance.now() - start;
    const perFrameMs = elapsedMs / FRAMES;
    // eslint-disable-next-line no-console
    console.log(
      `[Thor/RenBench] 12 cords × ${FRAMES} frames: total ${elapsedMs.toFixed(1)} ms, ` +
        `${perFrameMs.toFixed(3)} ms/frame (tube rewrite + jack matrices, no raster)`,
    );
    // Generous CI-safe ceiling — the number is the evidence, not the assert.
    expect(perFrameMs).toBeLessThan(8);
  });

  it('the moved-gate skips GPU buffer writes for frozen (asleep) cords', () => {
    // Mirrors CordView's gate: bitwise point compare must read "not moved"
    // for a sleeping cord (SIM-3 freezes points bitwise) and "moved" for a
    // 1-ULP change anywhere in the polyline.
    const pts = makeShells(9);
    wigglyPoints(9, 0, pts);
    const last = new Float64Array(9 * 3);
    for (let i = 0; i < 9; i += 1) {
      last[i * 3] = pts[i].x;
      last[i * 3 + 1] = pts[i].y;
      last[i * 3 + 2] = pts[i].z;
    }
    let moved = false;
    for (let i = 0; i < 9; i += 1) {
      if (last[i * 3] !== pts[i].x || last[i * 3 + 1] !== pts[i].y || last[i * 3 + 2] !== pts[i].z) {
        moved = true;
        break;
      }
    }
    expect(moved).toBe(false);
    pts[4].x += Number.EPSILON;
    for (let i = 0; i < 9; i += 1) {
      if (last[i * 3] !== pts[i].x || last[i * 3 + 1] !== pts[i].y || last[i * 3 + 2] !== pts[i].z) {
        moved = true;
        break;
      }
    }
    expect(moved).toBe(true);
  });
});

describe('T-LIFE-2 — FragmentPool (the shatter’s first-pass effect)', () => {
  const IMPACT: Vec3 = { x: 0, y: 0, z: 0 };

  it('bursts pooled dark shards at the impact point, ballistic and finite, and clears after its life', () => {
    const pool = new FragmentPool(new THREE.MeshStandardMaterial(), 32);
    const n = pool.burst({ x: 0.2, y: 0.05, z: -0.1 });
    expect(n).toBe(14); // the default count
    expect(pool.activeCount).toBe(14);
    const mesh = pool.mesh;
    expect(mesh.count).toBe(32); // the full pool: dead slots carry zero matrices
    // Advance past the (longest) life: everything expires, nothing draws.
    for (let i = 0; i < 120; i += 1) pool.update(1 / 60); // 2s >> 0.55s life
    expect(pool.activeCount).toBe(0);
    const m = mesh.instanceMatrix.array as Float32Array;
    for (let slot = 0; slot < 32; slot += 1) {
      for (let k = 0; k < 16; k += 1) {
        if (!Number.isFinite(m[slot * 16 + k])) throw new Error(`non-finite matrix at slot ${slot}`);
      }
      const sx = m[slot * 16 + 0]; // uniform scale on the diagonal
      expect(sx).toBe(0); // every slot zeroed — no stale shard flashes
    }
  });

  it('mid-flight: shards rise off the impact, fall under gravity, rest on the bench — all finite', () => {
    const pool = new FragmentPool(new THREE.MeshStandardMaterial(), 32);
    pool.burst(IMPACT);
    let peak = -Infinity;
    for (let i = 0; i < 66; i += 1) {
      pool.update(1 / 60); // 1.1s — the whole life
      peak = Math.max(peak, pool.activeCount);
      const m = pool.mesh.instanceMatrix.array as Float32Array;
      for (let slot = 0; slot < 32; slot += 1) {
        for (let k = 0; k < 16; k += 1) {
          if (!Number.isFinite(m[slot * 16 + k])) throw new Error('non-finite fragment matrix');
        }
      }
    }
    expect(peak).toBe(14); // all live until expiry begins
    expect(pool.activeCount).toBe(0); // 1.1s > max life 0.55·1.15
  });

  it('reduced motion is the A11Y-1 seam: the burst no-ops, the sequence untouched', () => {
    const pool = new FragmentPool(new THREE.MeshStandardMaterial(), 32);
    expect(pool.burst(IMPACT, { reduced: true })).toBe(0);
    expect(pool.activeCount).toBe(0);
    pool.update(1 / 60); // a no-op pass, not a crash
    expect(pool.activeCount).toBe(0);
  });

  it('deterministic: two pools fed the same bursts produce identical matrices', () => {
    const a = new FragmentPool(new THREE.MeshStandardMaterial(), 32);
    const b = new FragmentPool(new THREE.MeshStandardMaterial(), 32);
    a.burst({ x: 0.3, y: 0.05, z: 0.2 });
    b.burst({ x: 0.3, y: 0.05, z: 0.2 });
    for (let i = 0; i < 30; i += 1) {
      a.update(1 / 60);
      b.update(1 / 60);
    }
    const ma = a.mesh.instanceMatrix.array as Float32Array;
    const mb = b.mesh.instanceMatrix.array as Float32Array;
    expect(Array.from(ma)).toEqual(Array.from(mb)); // seeded LCG, no Math.random
  });
});

describe('T-LIFE-2 — JackInstances hideSlot + setSlotScale (the vanish render path)', () => {
  it('hideSlot collapses exactly ONE slot; the neighbor survives', () => {
    const mats = createPlugMaterials(null);
    const jacks = new JackInstances(mats, 8);
    jacks.beginFrame();
    jacks.writeJack(0, 0, 1, 0, 0, 1, 0, true);
    jacks.writeJack(1, 0, 1, 0, 0, 1, 0, false);
    jacks.endFrame(false);
    jacks.beginFrame();
    jacks.hideSlot(0); // the shattered end's jack despawns with the fragments
    jacks.writeJack(1, 1, 1, 0, 0, 1, 0, false); // the riding end keeps living
    jacks.endFrame(false);
    const metal = jacks.group.children[0] as THREE.InstancedMesh;
    const m = metal.instanceMatrix.array as Float32Array;
    expect(metal.count).toBe(2); // span intact
    expect(m[0]).toBe(0); // slot 0 collapsed (zero matrix)
    expect(m[16 + 12]).toBe(1); // slot 1 alive at its new x
  });

  it('setSlotScale shrinks the next write (the riding jack fades with the tube)', () => {
    const mats = createPlugMaterials(null);
    const jacks = new JackInstances(mats, 8);
    jacks.setSlotScale(1, 0.25);
    jacks.beginFrame();
    jacks.writeJack(0, 0, 1, 0, 0, 1, 0, true);
    jacks.writeJack(1, 0, 1, 0, 0, 1, 0, false);
    jacks.endFrame(false);
    const m = (jacks.group.children[0] as THREE.InstancedMesh).instanceMatrix
      .array as Float32Array;
    expect(m[0]).toBeCloseTo(1, 9); // full-size slot untouched
    expect(m[16 + 0]).toBeCloseTo(0.25, 9); // faded slot scaled down
    expect(m[16 + 5]).toBeCloseTo(0.25, 9);
    expect(m[16 + 10]).toBeCloseTo(0.25, 9);
  });
});

// Type-level import to keep the sim-space Ray3 contract visible in this file
// (the picking seam consumes it; render only ever READS sim state).
export type { Ray3 };

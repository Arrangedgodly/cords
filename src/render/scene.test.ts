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
import { createCordWorldStep } from '../sim/cordWorld';
import { createFixedTimestepDriver } from '../sim/fixedTimestep';
import type { SimInput, SimState } from '../sim';
import {
  PULSE_EMISSIVE_GAIN,
  CordTube,
  CordView,
  FragmentPool,
  JackInstances,
  createChasePulseState,
  createPlugMaterials,
} from './scene';
import type { CordGraceInfo } from './scene';
import { GRACE_DIM_FLOOR, graceDimming } from './states';

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

describe('T-REN-3 — CordView despawn/revive visibility (RESET empties the scene)', () => {
  // The faceplate's RESET clears every cord; the render loop then despawns
  // every CordView through this exact path. despawn() must leave the tube
  // INVISIBLE — setFade(0) restores visibility (it is revive()'s material
  // reset), so the old despawn order (hide, then setFade(0)) resurrected a
  // frozen ghost tube after every vanish. Pinned here; fixed in scene.ts.
  const makeView = () =>
    new CordView(
      { id: 1, pointCount: 5 },
      { first: 0, last: 1 },
      new THREE.MeshStandardMaterial(),
      new THREE.SphereGeometry(0.1, 6, 4),
      new THREE.MeshBasicMaterial(),
    );

  it('despawn leaves the tube hidden even after a mid-fade kill (ghost-cord regression)', () => {
    const view = makeView();
    view.setFade(0.6); // mid-vanish fade: transparent, partially faded
    view.despawn();
    expect(view.tube.mesh.visible).toBe(false);
    const mat = view.tube.mesh.material as THREE.MeshStandardMaterial;
    expect(mat.transparent).toBe(false); // the material reset still happened
    expect(mat.opacity).toBe(1);
    expect(view.despawned).toBe(true);
  });

  it('despawn stays hidden when the fade never ran (RESET on a live cord)', () => {
    const view = makeView();
    view.despawn(); // no fade ever written — the plain RESET case
    expect(view.tube.mesh.visible).toBe(false);
    expect(view.despawned).toBe(true);
  });

  it('revive restores a despawned view to visible (id reuse after RESET)', () => {
    const mats = createPlugMaterials(null);
    const jacks = new JackInstances(mats, 8);
    const view = makeView();
    view.despawn();
    view.revive(jacks);
    expect(view.tube.mesh.visible).toBe(true); // the id lives again
    expect(view.despawned).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T-REN-4 — the LINK CHASE PULSE: the arc-length road, the linked-only gate,
// and the seated-jack lit accent. Headless (buffer math + instance colors).
// ---------------------------------------------------------------------------

/** A straight 25-point polyline with EQUAL 0.1 segments along +X (uniform arc). */
function straightPoints(n: number, out: Vec3[]): void {
  for (let i = 0; i < n; i += 1) {
    out[i].x = i * 0.1;
    out[i].y = 1;
    out[i].z = 0;
  }
}

describe('T-REN-4 — the pulse arc attribute (the LED’s road)', () => {
  it('runs 0 → 1 red end to blue end, monotone, uniform on a uniform cord', () => {
    const tube = new CordTube(new THREE.MeshStandardMaterial());
    const pts = makeShells(25);
    straightPoints(25, pts);
    tube.update(pts, 'first');
    const arc = tube.mesh.geometry.getAttribute('aPulseArc') as THREE.BufferAttribute;
    const rings = (25 - 1) * 4 + 1;
    expect(arc.count).toBe(rings * 10 + 2);
    expect(arc.getX(0)).toBeCloseTo(0, 6); // ring 0 = the RED jack
    const lastRing = (rings - 1) * 10;
    expect(arc.getX(lastRing)).toBeCloseTo(1, 6); // last ring = the BLUE jack
    // Monotone along the rings (each radial vertex of a ring shares the value).
    let prev = -1;
    for (let j = 0; j < rings; j += 1) {
      const v = arc.getX(j * 10);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    // Uniform cord → the arc is the ring fraction (a stretched or pooled
    // cord would deviate — that is the point of measuring, not assuming).
    expect(arc.getX(Math.floor(rings / 2) * 10)).toBeCloseTo(0.5, 3);
    // All radial vertices of one ring carry the ring's value.
    expect(arc.getX(3 * 10 + 7)).toBeCloseTo(arc.getX(3 * 10), 9);
    // Cap centers sit exactly on their rings' values.
    expect(arc.getX(rings * 10)).toBeCloseTo(0, 6);
    expect(arc.getX(rings * 10 + 1)).toBeCloseTo(1, 6);
  });

  it('orients by redEnd: a red LAST end flips the road (the light still travels red → blue)', () => {
    const tube = new CordTube(new THREE.MeshStandardMaterial());
    const pts = makeShells(25);
    straightPoints(25, pts);
    tube.update(pts, 'last');
    const arc = tube.mesh.geometry.getAttribute('aPulseArc') as THREE.BufferAttribute;
    const rings = (25 - 1) * 4 + 1;
    expect(arc.getX(0)).toBeCloseTo(1, 6); // ring 0 is the BLUE end now
    expect(arc.getX((rings - 1) * 10)).toBeCloseTo(0, 6);
  });

  it('a stretching cord relocates the LED honestly: arc follows the measured geometry', () => {
    const tube = new CordTube(new THREE.MeshStandardMaterial());
    const pts = makeShells(9); // 8 segments × 0.1 = 0.8 total
    straightPoints(9, pts);
    tube.update(pts, 'first');
    const arc = tube.mesh.geometry.getAttribute('aPulseArc') as THREE.BufferAttribute;
    const rings = (9 - 1) * 4 + 1;
    // Uniform cord first: the mid ring (segment index 4 = x 0.4) reads 0.5.
    expect(arc.getX(Math.floor(rings / 2) * 10)).toBeCloseTo(0.5, 3);
    // Now make the LAST segment 8× longer (0.8): total 1.5, so the same mid
    // ring — still at x ≈ 0.4 — must read ≈ 0.4/1.5 ≈ 0.267. The LED's road
    // is MEASURED arc, not segment index: the light spends most of its
    // traverse in the now-long stretch, exactly like signal on a cable.
    pts[8].x = pts[7].x + 0.8;
    tube.update(pts, 'first');
    const mid = arc.getX(Math.floor(rings / 2) * 10);
    expect(mid).toBeLessThan(0.5);
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeCloseTo(0.4 / 1.5, 2);
    // And the far end still reads exactly 1 (the whole road, re-normalized).
    expect(arc.getX((rings - 1) * 10)).toBeCloseTo(1, 6);
  });
});

describe('T-REN-4 — the linked-only gate (glow exists only on live state)', () => {
  const makePulseView = (redEnd: 'first' | 'last' = 'first') =>
    new CordView(
      { id: 1, pointCount: 9, redEnd },
      { first: 0, last: 1 },
      new THREE.MeshStandardMaterial(),
      new THREE.SphereGeometry(0.1, 6, 4),
      new THREE.MeshBasicMaterial(),
      createChasePulseState(),
    );
  const cordOf = (pts: Vec3[]) => ({ id: 1, points: pts });

  it('gain 0 by default; linked → full gain; unlinked → back to 0 (no hard glow lingers)', () => {
    const jacks = new JackInstances(createPlugMaterials(null), 8);
    const view = makePulseView();
    const pts = makeShells(9);
    wigglyPoints(9, 0, pts);
    view.sync(cordOf(pts), jacks, false);
    expect(view.pulseGain.value).toBe(0);
    view.sync(cordOf(pts), jacks, true);
    expect(view.pulseGain.value).toBe(PULSE_EMISSIVE_GAIN);
    view.sync(cordOf(pts), jacks, false);
    expect(view.pulseGain.value).toBe(0);
  });

  it('a merely-seated (awaiting-plug) end does NOT light: one seat ≠ linked', () => {
    const jacks = new JackInstances(createPlugMaterials(null), 8);
    const view = makePulseView();
    const pts = makeShells(9);
    wigglyPoints(9, 0, pts);
    view.seats[0] = { position: pts[0], axis: { x: 0, y: 1, z: 0 } };
    view.sync(cordOf(pts), jacks, false);
    expect(view.pulseGain.value).toBe(0); // awaiting-plug: nothing pulses
    const coded = jacks.group.children[2] as THREE.InstancedMesh;
    const c = coded.instanceColor!;
    expect(c.getX(0)).toBeLessThanOrEqual(1); // base red, not the lit lift
  });

  it('the gate flips a FROZEN (sleeping) cord too — the moved-gate must not swallow it', () => {
    // The over-stretch pop lands while a linked cord is settled/asleep: the
    // points are bitwise unchanged, yet the glow must go out that same frame.
    const jacks = new JackInstances(createPlugMaterials(null), 8);
    const view = makePulseView();
    const pts = makeShells(9);
    wigglyPoints(9, 0, pts);
    view.seats[0] = { position: pts[0], axis: { x: 0, y: 1, z: 0 } };
    view.sync(cordOf(pts), jacks, true); // linked + seated
    expect(view.pulseGain.value).toBe(PULSE_EMISSIVE_GAIN);
    // SAME points (bitwise frozen), link gone: forced rewrite, gain drops.
    view.sync(cordOf(pts), jacks, false);
    expect(view.pulseGain.value).toBe(0);
  });

  it('the seated jack’s lit accent: brighter within its own hue while linked, reverted when not', () => {
    const jacks = new JackInstances(createPlugMaterials(null), 8);
    const view = makePulseView();
    const pts = makeShells(9);
    wigglyPoints(9, 0, pts);
    view.seats[0] = { position: pts[0], axis: { x: 0, y: 1, z: 0 } };
    view.seats[1] = { position: pts[8], axis: { x: 0, y: 1, z: 0 } };
    const coded = jacks.group.children[2] as THREE.InstancedMesh;
    const c = coded.instanceColor!;
    view.sync(cordOf(pts), jacks, false);
    const baseR = c.getX(0); // slot 0 = red band at rest
    const baseB = c.getX(1); // slot 1 = blue band at rest
    view.sync(cordOf(pts), jacks, true);
    expect(c.getX(0)).toBeCloseTo(baseR * 1.5, 6); // lit: ×1.5 lift, same hue law
    expect(c.getX(1)).toBeCloseTo(baseB * 1.5, 6);
    view.sync(cordOf(pts), jacks, false);
    expect(c.getX(0)).toBe(baseR); // reverted exactly
    expect(c.getX(1)).toBe(baseB);
  });

  it('a FREE (dangling/carried) end never carries the accent, even on a linked cord', () => {
    const jacks = new JackInstances(createPlugMaterials(null), 8);
    const view = makePulseView();
    const pts = makeShells(9);
    wigglyPoints(9, 0, pts);
    view.seats[0] = { position: pts[0], axis: { x: 0, y: 1, z: 0 } }; // one seat only
    const coded = jacks.group.children[2] as THREE.InstancedMesh;
    const c = coded.instanceColor!;
    view.sync(cordOf(pts), jacks, false);
    const baseR = c.getX(0);
    const baseB = c.getX(1);
    view.sync(cordOf(pts), jacks, true);
    expect(c.getX(0)).toBeCloseTo(baseR * 1.5, 6); // the SEATED end: lit
    expect(c.getX(1)).toBe(baseB); // the FREE end: at rest, no accent
  });

  it('despawn kills the glow; revive starts dark (id reuse never inherits a pulse)', () => {
    const mats = createPlugMaterials(null);
    const jacks = new JackInstances(mats, 8);
    const view = makePulseView();
    const pts = makeShells(9);
    wigglyPoints(9, 0, pts);
    view.sync(cordOf(pts), jacks, true);
    expect(view.pulseGain.value).toBe(PULSE_EMISSIVE_GAIN);
    view.despawn();
    expect(view.pulseGain.value).toBe(0);
    view.revive(jacks);
    expect(view.pulseGain.value).toBe(0);
  });
});

describe('T-REN-4 — the gate driven by the REAL lifecycle (linked → pulse on; grab → off)', () => {
  // main.ts's composition rule, pinned against the actual machine: the ids
  // handed to the renderer are exactly those whose lifecycle stateOf reads
  // 'linked'. Seat both ends → linked → the derived flag lights the view;
  // GRAB one seated end (the hand-pulled plug) → awaiting-plug → glow out.
  const DT = 1 / 120;
  const FRAME = 1 / 60;
  const SEGMENTS = 8;
  const END = SEGMENTS;
  const A: Vec3 = { x: 0.9, y: 0.42, z: 0 };
  const B: Vec3 = { x: 0.35, y: 0.42, z: 0.1 };

  it('spawn → seat → seat = linked = pulsing; grab a seated end = awaiting-plug = dark', () => {
    const step = createCordWorldStep({
      cord: { segmentCount: SEGMENTS, floorY: 0 },
    });
    const driver = createFixedTimestepDriver(step, { timestep: DT, maxSubsteps: 2 });
    let state: SimState = { time: 0, cords: [] };
    const advance = (frames: number, input: SimInput) => {
      for (let f = 0; f < frames; f += 1) state = driver.advance(state, FRAME, input).state;
      return state;
    };
    advance(1, { pointerRay: null, spawnCord: { cordId: 1, at: { x: 0.5, y: 1, z: 0 } } });
    advance(3, { pointerRay: null, seatTargets: [{ cordId: 1, index: 0, position: A }] });
    expect(step.lifecycle.stateOf(1)).toBe('awaiting-plug'); // one seat: no glow
    advance(3, {
      pointerRay: null,
      seatTargets: [
        { cordId: 1, index: 0, position: A },
        { cordId: 1, index: END, position: B },
      ],
    });
    expect(step.lifecycle.stateOf(1)).toBe('linked');

    // The render side, fed exactly what main.ts feeds it (the derived flag).
    const jacks = new JackInstances(createPlugMaterials(null), 8);
    const pulse = createChasePulseState();
    const view = new CordView(
      { id: 1, pointCount: SEGMENTS + 1 },
      { first: 0, last: 1 },
      new THREE.MeshStandardMaterial(),
      new THREE.SphereGeometry(0.1, 6, 4),
      new THREE.MeshBasicMaterial(),
      pulse,
    );
    const linkedFlag = (s: SimState) =>
      s.cords.filter((c) => step.lifecycle.stateOf(c.id) === 'linked').map((c) => c.id);
    const cord = state.cords.find((c) => c.id === 1);
    if (cord === undefined) throw new Error('cord 1 missing from the world');
    view.sync(cord, jacks, linkedFlag(state).includes(1));
    expect(view.pulseGain.value).toBe(PULSE_EMISSIVE_GAIN); // LINKED: pulsing

    // The hand-pulled plug: a carry intent names the seated red end.
    advance(2, {
      pointerRay: null,
      pinTargets: [{ cordId: 1, index: 0, position: { x: 0.5, y: 0.9, z: 0 } }],
    });
    expect(step.lifecycle.stateOf(1)).toBe('awaiting-plug'); // link broken
    const cordAfter = state.cords.find((c) => c.id === 1);
    if (cordAfter === undefined) throw new Error('cord 1 vanished unexpectedly');
    view.sync(cordAfter, jacks, linkedFlag(state).includes(1));
    expect(view.pulseGain.value).toBe(0); // glow out, the same frame
  });
});

// ---------------------------------------------------------------------------
// T-REN-5 — STATE PAINT: the stretch ticks (tautness-gated furniture), the
// popped grace countdown (dim + the final-second band blink, with the
// reduced-motion seam), the grace×fade composition, and the refined shatter
// (metal + band shards, two bounces, friction slide, pooled). Headless.
// ---------------------------------------------------------------------------

/** A TAUT 9-point polyline: straight along +X, span = rest total (0.8). */
function tautPoints(n: number, out: Vec3[]): void {
  for (let i = 0; i < n; i += 1) {
    out[i].x = i * 0.1;
    out[i].y = 1;
    out[i].z = 0;
  }
}

/** A SLACK 9-point polyline: pooled on itself, span ≈ 0.3 × rest total. */
function slackPoints(n: number, out: Vec3[]): void {
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1);
    out[i].x = 0.15 + t * 0.1;
    out[i].y = 0.3 + Math.sin(t * 9) * 0.05;
    out[i].z = t * 0.1;
  }
}

describe('T-REN-5 — the stretch ticks (silkscreen furniture on a stretching cord)', () => {
  const makeView = (spec: Partial<ConstructorParameters<typeof CordView>[0]> = {}) =>
    new CordView(
      { id: 1, pointCount: 9, ...spec },
      { first: 0, last: 1 },
      new THREE.MeshStandardMaterial(),
      new THREE.SphereGeometry(0.1, 6, 4),
      new THREE.MeshBasicMaterial(),
      createChasePulseState(),
    );
  const cordOf = (pts: Vec3[]) => ({ id: 1, points: pts });

  it('no furniture at rest: a pooled/slack cord carries gain 0 and spacing collapses', () => {
    const jacks = new JackInstances(createPlugMaterials(null), 8);
    const view = makeView();
    const pts = makeShells(9);
    slackPoints(9, pts);
    view.sync(cordOf(pts), jacks, false);
    expect(view.stretch).toBeLessThan(0.9);
    expect(view.tickGain.value).toBe(0);
  });

  it('full furniture on a taut cord: gain 1, one tick per REST length of measured arc', () => {
    const jacks = new JackInstances(createPlugMaterials(null), 8);
    const view = makeView();
    const pts = makeShells(9);
    tautPoints(9, pts);
    view.sync(cordOf(pts), jacks, false);
    expect(view.stretch).toBeCloseTo(1, 6); // span === rest total: leash-taut
    expect(view.tickGain.value).toBe(1);
    // Straight 8-segment cord: measured arc 0.8, so the ruler's unit
    // (0.1) is exactly 1/8 of the arc — a tick every rest length.
    expect(view.tickSpacing.value).toBeCloseTo(0.1 / 0.8, 5);
    expect(view.tickSpacing.value).toBeCloseTo(1 / 8, 5);
  });

  it('appear-with-stretch is monotone: the gain ramps as the cord straightens', () => {
    const jacks = new JackInstances(createPlugMaterials(null), 8);
    const view = makeView();
    const slack = makeShells(9);
    slackPoints(9, slack);
    const taut = makeShells(9);
    tautPoints(9, taut);
    const pts = makeShells(9);
    let prev = -1;
    for (let k = 0; k <= 10; k += 1) {
      const f = k / 10;
      for (let i = 0; i < 9; i += 1) {
        pts[i].x = slack[i].x + (taut[i].x - slack[i].x) * f;
        pts[i].y = slack[i].y + (taut[i].y - slack[i].y) * f;
        pts[i].z = slack[i].z + (taut[i].z - slack[i].z) * f;
      }
      view.sync(cordOf(pts), jacks, false);
      expect(view.tickGain.value).toBeGreaterThanOrEqual(prev);
      expect(view.tickGain.value).toBeLessThanOrEqual(1);
      prev = view.tickGain.value;
    }
    expect(prev).toBe(1); // the fully-taut end of the sweep
  });

  it('the furniture is state-gated OFF: a linked cord (the pulse state) and a counting-down cord carry none', () => {
    const jacks = new JackInstances(createPlugMaterials(null), 8);
    const view = makeView();
    const pts = makeShells(9);
    tautPoints(9, pts);
    const paint = { simTime: 0, reduced: false, grace: null as CordGraceInfo | null };
    view.sync(cordOf(pts), jacks, true); // linked + taut
    expect(view.pulseGain.value).toBe(PULSE_EMISSIVE_GAIN);
    expect(view.tickGain.value).toBe(0); // the pulse owns linked
    view.sync(cordOf(pts), jacks, false, {
      ...paint,
      grace: { id: 1, end: 'last', remaining: 2, window: 3 },
    });
    expect(view.tickGain.value).toBe(0); // the grace dim owns popped/vanishing
  });

  it('a FROZEN stretched cord keeps its ticks (the paint is computed every sync, not only on motion)', () => {
    const jacks = new JackInstances(createPlugMaterials(null), 8);
    const view = makeView();
    const pts = makeShells(9);
    tautPoints(9, pts);
    view.sync(cordOf(pts), jacks, false);
    expect(view.tickGain.value).toBe(1);
    view.sync(cordOf(pts), jacks, false); // bitwise-identical points (asleep)
    expect(view.tickGain.value).toBe(1);
    const rested = makeShells(9);
    slackPoints(9, rested);
    view.sync(cordOf(rested), jacks, false); // the cord relaxes to rest
    expect(view.tickGain.value).toBe(0); // vanished at rest
  });
});

describe('T-REN-5 — the popped grace countdown (dim + the low-battery blink)', () => {
  const makeView = () =>
    new CordView(
      { id: 1, pointCount: 9 },
      { first: 0, last: 1 },
      new THREE.MeshStandardMaterial(),
      new THREE.SphereGeometry(0.1, 6, 4),
      new THREE.MeshBasicMaterial(),
      createChasePulseState(),
    );
  const cordOf = (pts: Vec3[]) => ({ id: 1, points: pts });
  const paintOf = (remaining: number, simTime = 0, reduced = false): {
    simTime: number;
    reduced: boolean;
    grace: CordGraceInfo;
  } => ({
    simTime,
    reduced,
    grace: { id: 1, end: 'last', remaining, window: 3 },
  });

  it('the tube dims monotone toward the floor as the window burns (opacity = the law)', () => {
    const jacks = new JackInstances(createPlugMaterials(null), 8);
    const view = makeView();
    const pts = makeShells(9);
    slackPoints(9, pts);
    view.sync(cordOf(pts), jacks, false, paintOf(3));
    const mat = view.tube.mesh.material as THREE.MeshStandardMaterial;
    expect(view.graceFactor).toBe(1);
    expect(mat.opacity).toBe(1);
    expect(mat.transparent).toBe(false); // full = opaque, no render-order cost
    let prev = 1.001;
    for (let i = 11; i >= 0; i -= 1) {
      const remaining = (i / 12) * 3; // burns 2.75 → 0
      view.sync(cordOf(pts), jacks, false, paintOf(remaining));
      expect(view.graceFactor).toBeCloseTo(graceDimming(remaining, 3), 12);
      expect(mat.opacity).toBeCloseTo(graceDimming(remaining, 3), 12);
      expect(mat.transparent).toBe(true); // anything below full is transparent
      expect(mat.opacity).toBeLessThanOrEqual(prev); // monotone to expiry
      prev = mat.opacity;
    }
    expect(mat.opacity).toBeCloseTo(GRACE_DIM_FLOOR, 12); // at expiry: the floor
  });

  it('the dim COMPOSES with the vanish fade — expiry hands off dimmed, never flashing back to full', () => {
    const jacks = new JackInstances(createPlugMaterials(null), 8);
    const view = makeView();
    const pts = makeShells(9);
    slackPoints(9, pts);
    // Just popped: full. Mid-window: dimmed. At expiry (remaining 0): floor.
    view.sync(cordOf(pts), jacks, false, paintOf(0));
    expect((view.tube.mesh.material as THREE.MeshStandardMaterial).opacity)
      .toBeCloseTo(GRACE_DIM_FLOOR, 12);
    // LIFE-2's fade takes over FROM the dimmed level (vanishing cords ride
    // the grace list at remaining 0 — the composition's contract).
    view.setFade(0.5);
    expect((view.tube.mesh.material as THREE.MeshStandardMaterial).opacity)
      .toBeCloseTo(0.5 * GRACE_DIM_FLOOR, 12);
    // A re-plug restores INSTANTLY (LEDs come back on; hardware grammar).
    view.sync(cordOf(pts), jacks, true);
    view.setFade(0);
    const mat = view.tube.mesh.material as THREE.MeshStandardMaterial;
    expect(mat.opacity).toBe(1);
    expect(mat.transparent).toBe(false);
    expect(view.tube.mesh.visible).toBe(true);
  });

  it('the failing jack band BLINKS in the final second — and rewrites even a FROZEN cord', () => {
    const jacks = new JackInstances(createPlugMaterials(null), 8);
    const view = makeView();
    const pts = makeShells(9);
    slackPoints(9, pts);
    const coded = jacks.group.children[2] as THREE.InstancedMesh;
    const color = coded.instanceColor!;
    // Steady through the window (2s left): the band stays its own red/blue.
    view.sync(cordOf(pts), jacks, false, paintOf(2, 0));
    expect(view.bandOff).toBe(false);
    const steadyColor = Array.from(color.array as Float32Array).slice(3, 6); // slot 1 = 'last'
    // Final second: same (bitwise FROZEN) points, only the sim clock moves —
    // the blink must still flip the band (the moved-gate must not swallow it).
    let sawOff = false;
    let sawOn = false;
    let offColor: number[] | null = null;
    for (let i = 0; i < 120; i += 1) {
      view.sync(cordOf(pts), jacks, false, paintOf(0.5, i / 120));
      const c = Array.from(color.array as Float32Array).slice(3, 6);
      if (view.bandOff) {
        sawOff = true;
        offColor = c;
        // The off phase paints the band to the grip's dark rubber ink.
        expect(Math.max(...c)).toBeLessThan(0.05);
      } else {
        sawOn = true;
        expect(c).toEqual(steadyColor); // the lit phase is exactly the band
      }
    }
    expect(sawOff).toBe(true); // the dark half exists
    expect(sawOn).toBe(true); // and the lit half
    expect(offColor).not.toBeNull();
    // The steady-state window never blinked:
    for (let i = 0; i < 60; i += 1) {
      view.sync(cordOf(pts), jacks, false, paintOf(2, i / 60));
      expect(view.bandOff).toBe(false);
    }
  });

  it('REDUCED MOTION: steady dim only — the band never blinks (the A11Y seam)', () => {
    const jacks = new JackInstances(createPlugMaterials(null), 8);
    const view = makeView();
    const pts = makeShells(9);
    slackPoints(9, pts);
    for (let i = 0; i < 240; i += 1) {
      view.sync(cordOf(pts), jacks, false, paintOf(0.01, i / 120, true));
      expect(view.bandOff).toBe(false); // steady — no flicker under the seam
      // ...while the DIM still counts down (it is state, not motion):
      expect(view.graceFactor).toBeCloseTo(graceDimming(0.01, 3), 12);
    }
  });

  it('despawn/revive reset the paint: no countdown or furniture outlives a cord', () => {
    const mats = createPlugMaterials(null);
    const jacks = new JackInstances(mats, 8);
    const view = makeView();
    const pts = makeShells(9);
    tautPoints(9, pts);
    view.sync(cordOf(pts), jacks, false, paintOf(0.4));
    expect(view.tickGain.value).toBe(0);
    expect(view.graceFactor).toBeLessThan(1);
    view.despawn();
    expect(view.tickGain.value).toBe(0);
    expect(view.graceFactor).toBe(1);
    expect(view.bandOff).toBe(false);
    view.revive(jacks);
    expect(view.tickGain.value).toBe(0);
    expect(view.graceFactor).toBe(1);
  });
});

describe('T-REN-5 — the grace countdown driven by the REAL lifecycle', () => {
  const DT = 1 / 120;
  const FRAME = 1 / 60;
  const SEGMENTS = 8;
  const END = SEGMENTS;
  const A: Vec3 = { x: 0.9, y: 0.42, z: 0 };
  const B: Vec3 = { x: 0.35, y: 0.42, z: 0.1 };

  it('pop → the dim follows graceRemaining monotone to expiry; re-plug → restored the same frame', () => {
    const step = createCordWorldStep({ cord: { segmentCount: SEGMENTS, floorY: 0 } });
    const driver = createFixedTimestepDriver(step, { timestep: DT, maxSubsteps: 2 });
    let state: SimState = { time: 0, cords: [] };
    const advance = (frames: number, input: SimInput) => {
      for (let f = 0; f < frames; f += 1) state = driver.advance(state, FRAME, input).state;
      return state;
    };
    advance(1, { pointerRay: null, spawnCord: { cordId: 1, at: { x: 0.5, y: 1, z: 0 } } });
    advance(3, { pointerRay: null, seatTargets: [{ cordId: 1, index: 0, position: A }] });
    advance(3, {
      pointerRay: null,
      seatTargets: [
        { cordId: 1, index: 0, position: A },
        { cordId: 1, index: END, position: B },
      ],
    });
    expect(step.lifecycle.stateOf(1)).toBe('linked');
    advance(2, { pointerRay: null, popCords: [{ cordId: 1, index: END }] });
    expect(step.lifecycle.stateOf(1)).toBe('popped');

    // main.ts's composition rule, mirrored verbatim: the grace entry names
    // the end whose mode is NOT seated, with the machine's own remaining.
    const graceOf = (): CordGraceInfo | null => {
      const s = step.lifecycle.stateOf(1);
      if (s !== 'popped' && s !== 'vanishing') return null;
      const end = step.lifecycle.endMode(1, 0) !== 'seated' ? 'first' : 'last';
      return {
        id: 1,
        end,
        remaining: s === 'popped' ? (step.lifecycle.graceRemaining(1) ?? 0) : 0,
        window: 3,
      };
    };
    const jacks = new JackInstances(createPlugMaterials(null), 8);
    const view = new CordView(
      { id: 1, pointCount: SEGMENTS + 1 },
      { first: 0, last: 1 },
      new THREE.MeshStandardMaterial(),
      new THREE.SphereGeometry(0.1, 6, 4),
      new THREE.MeshBasicMaterial(),
      createChasePulseState(),
    );
    let prev = 1.001;
    let samples = 0;
    for (let f = 0; f < 90; f += 1) {
      advance(1, { pointerRay: null });
      const grace = graceOf();
      const cord = state.cords.find((c) => c.id === 1);
      if (cord === undefined) break;
      view.sync(cord, jacks, false, { simTime: state.time, reduced: false, grace });
      if (grace !== null) {
        expect(grace.end).toBe('last'); // END popped; end 0 holds the socket
        expect(view.graceFactor).toBeLessThanOrEqual(prev + 1e-12);
        prev = view.graceFactor;
        samples += 1;
      }
    }
    expect(samples).toBeGreaterThan(30); // half the window, dimming monotone

    // RE-PLUG while grace remains: linked, the dim restored the same frame.
    expect(step.lifecycle.stateOf(1)).toBe('popped');
    expect(view.graceFactor).toBeLessThan(1);
    advance(2, { pointerRay: null, seatTargets: [{ cordId: 1, index: END, position: B }] });
    expect(step.lifecycle.stateOf(1)).toBe('linked');
    {
      const cordNow = state.cords.find((c) => c.id === 1);
      if (cordNow === undefined) throw new Error('cord 1 gone unexpectedly');
      view.sync(cordNow, jacks, true, { simTime: state.time, reduced: false, grace: null });
      expect(view.graceFactor).toBe(1); // restored, the same frame
    }

    // Pop again and burn the WHOLE window: expiry lands at the floor (the
    // composition keeps a vanishing cord on the grace list at remaining 0).
    advance(2, { pointerRay: null, popCords: [{ cordId: 1, index: END }] });
    expect(step.lifecycle.stateOf(1)).toBe('popped');
    for (let f = 0; f < 200; f += 1) {
      advance(1, { pointerRay: null });
      const grace = graceOf();
      const cord = state.cords.find((c) => c.id === 1);
      if (cord === undefined) break;
      view.sync(cord, jacks, false, { simTime: state.time, reduced: false, grace });
    }
    expect(step.lifecycle.stateOf(1)).toBe('vanishing'); // the window closed
    expect(view.graceFactor).toBeCloseTo(GRACE_DIM_FLOOR, 6); // floor at expiry
  });
});

describe('T-REN-5 — JackInstances band blink stamps', () => {
  it('bandOff paints the band dark and back — rewrites only on real flips', () => {
    const mats = createPlugMaterials(null);
    const jacks = new JackInstances(mats, 8);
    const coded = jacks.group.children[2] as THREE.InstancedMesh;
    const color = coded.instanceColor!;
    jacks.beginFrame();
    jacks.writeJack(0, 0, 1, 0, 0, 1, 0, true, false, false);
    jacks.endFrame(false);
    const red = Array.from(color.array as Float32Array).slice(0, 3);
    expect(red[0]).toBeGreaterThan(0.5); // the red band
    // Blink off: the band paints to the grip's dark rubber.
    jacks.beginFrame();
    jacks.writeJack(0, 0, 1, 0, 0, 1, 0, true, false, true);
    jacks.endFrame(false);
    const off = Array.from(color.array as Float32Array).slice(0, 3);
    expect(Math.max(...off)).toBeLessThan(0.05);
    // Back on: exactly the red again.
    jacks.beginFrame();
    jacks.writeJack(0, 0, 1, 0, 0, 1, 0, true, false, false);
    jacks.endFrame(false);
    expect(Array.from(color.array as Float32Array).slice(0, 3)).toEqual(red);
  });

  it('a repeated same-state write leaves the color buffer untouched (blink cost = flips only)', () => {
    const mats = createPlugMaterials(null);
    const jacks = new JackInstances(mats, 8);
    const coded = jacks.group.children[2] as THREE.InstancedMesh;
    jacks.beginFrame();
    jacks.writeJack(1, 0, 1, 0, 0, 1, 0, false, false, true);
    jacks.endFrame(false);
    const before = Array.from((coded.instanceColor!.array as Float32Array).slice(3, 9));
    jacks.beginFrame();
    jacks.writeJack(1, 1, 1, 0, 0, 1, 0, false, false, true); // moved, same state
    jacks.endFrame(false);
    expect(Array.from((coded.instanceColor!.array as Float32Array).slice(3, 9))).toEqual(before);
  });
});

describe('T-REN-5 — FragmentPool, refined to the panel grammar', () => {
  const IMPACT: Vec3 = { x: 0, y: 0.05, z: 0 };

  /** Reads one slot's rendered truth: position + uniform scale (column norm). */
  function readSlot(pool: FragmentPool, slot: number): { x: number; y: number; z: number; s: number } {
    const m = pool.mesh.instanceMatrix.array as Float32Array;
    const k = slot * 16;
    return {
      x: m[k + 12],
      y: m[k + 13],
      z: m[k + 14],
      s: Math.hypot(m[k], m[k + 1], m[k + 2]),
    };
  }

  it('the failing end POLARITY reads in the debris: exactly two red band shards (then blue)', () => {
    const pool = new FragmentPool(new THREE.MeshStandardMaterial(), 32);
    pool.burst(IMPACT, { band: 'red' });
    pool.update(0); // write the matrices from the burst state
    const color = pool.mesh.instanceColor!;
    let redShards = 0;
    let steelShards = 0;
    for (let slot = 0; slot < 32; slot += 1) {
      const r = color.getX(slot);
      const b = color.getZ(slot);
      if (r > 0.4 && b < 0.4) redShards += 1;
      else if (r < 0.2) steelShards += 1;
    }
    expect(redShards).toBe(2); // the band breaks into exactly two readable pieces
    expect(steelShards).toBe(12); // the rest is dark metal
    const first = readSlot(pool, 0);
    expect(first.s).toBeGreaterThanOrEqual(1.44); // the big one leads (f32)

    const blue = new FragmentPool(new THREE.MeshStandardMaterial(), 32);
    blue.burst(IMPACT, { band: 'blue' });
    const bc = blue.mesh.instanceColor!;
    expect(bc.getZ(0)).toBeGreaterThan(0.4); // a BLUE band shard
    expect(bc.getZ(0)).toBeGreaterThan(bc.getX(0));
  });

  it('no band → all dark metal (a bare burst stays monochrome)', () => {
    const pool = new FragmentPool(new THREE.MeshStandardMaterial(), 32);
    pool.burst(IMPACT);
    const color = pool.mesh.instanceColor!;
    for (let slot = 0; slot < 14; slot += 1) {
      expect(color.getX(slot)).toBeLessThan(0.2);
      expect(color.getY(slot)).toBeLessThan(0.2);
      expect(color.getZ(slot)).toBeLessThan(0.2);
    }
  });

  it('a couple of bounces, then a friction slide to rest — read from the rendered matrices', () => {
    const pool = new FragmentPool(new THREE.MeshStandardMaterial(), 32);
    pool.burst(IMPACT, { band: 'red' });
    // Fine sampling (240 Hz): the SECOND bounce's small rise resolves between
    // the 60 Hz frames it hides inside.
    const DT = 1 / 240;
    const xs: number[][] = Array.from({ length: 14 }, () => []);
    const ys: number[][] = Array.from({ length: 14 }, () => []);
    for (let f = 0; f < 720; f += 1) {
      pool.update(DT);
      const m = pool.mesh.instanceMatrix.array as Float32Array;
      for (let slot = 0; slot < 14; slot += 1) {
        xs[slot].push(m[slot * 16 + 12]);
        ys[slot].push(m[slot * 16 + 13]);
      }
    }
    // BOUNCE = touching a running minimum of height, then rising off it.
    let totalBounces = 0;
    let maxBounces = 0;
    for (let slot = 0; slot < 14; slot += 1) {
      let minSoFar = Infinity;
      let bounces = 0;
      for (let i = 0; i < ys[slot].length - 1; i += 1) {
        const y = ys[slot][i];
        if (y < minSoFar) minSoFar = y;
        if (y > 0 && y <= minSoFar + 2e-6 && ys[slot][i + 1] > y + 1e-4) bounces += 1;
      }
      totalBounces += bounces;
      maxBounces = Math.max(maxBounces, bounces);
    }
    expect(totalBounces).toBeGreaterThanOrEqual(14); // every shard bounces at least once
    expect(maxBounces).toBeGreaterThanOrEqual(2); // and at least one bounces a couple of times
    // SLIDE: after a shard's first sustained rest, it keeps traveling while
    // friction eats the run — the first 0.125s of the resting slide must
    // outrun the next (accumulated only while the shard is still alive).
    let slideEarly = 0;
    let slideLate = 0;
    for (let slot = 0; slot < 14; slot += 1) {
      let minSoFar = Infinity;
      let rest0 = -1;
      for (let i = 0; i < ys[slot].length; i += 1) {
        const y = ys[slot][i];
        if (y < minSoFar) minSoFar = y;
        // Resting: AT the running min, alive, and the previous frame was
        // too (a bounce frame's predecessor is still descending — excluded).
        if (rest0 < 0 && i > 0 && y > 0 && y <= minSoFar + 2e-6 && ys[slot][i - 1] <= y + 2e-6) {
          rest0 = i;
        }
      }
      if (rest0 < 0) continue;
      let last = xs[slot][rest0];
      for (let i = rest0 + 1; i < ys[slot].length && ys[slot][i] > 0; i += 1) {
        const d = Math.abs(xs[slot][i] - last);
        last = xs[slot][i];
        const t = i - rest0;
        if (t <= 30) slideEarly += d;
        else if (t <= 60) slideLate += d;
      }
    }
    expect(slideEarly + slideLate).toBeGreaterThan(0.004); // a real slide exists
    expect(slideEarly).toBeGreaterThan(slideLate * 1.1); // and friction decays it
  });

  it('deterministic INCLUDING the band ink: two pools fed the same burst match bitwise', () => {
    const a = new FragmentPool(new THREE.MeshStandardMaterial(), 32);
    const b = new FragmentPool(new THREE.MeshStandardMaterial(), 32);
    a.burst({ x: 0.3, y: 0.05, z: 0.2 }, { band: 'red' });
    b.burst({ x: 0.3, y: 0.05, z: 0.2 }, { band: 'red' });
    for (let i = 0; i < 30; i += 1) {
      a.update(1 / 60);
      b.update(1 / 60);
    }
    expect(Array.from(a.mesh.instanceMatrix.array as Float32Array))
      .toEqual(Array.from(b.mesh.instanceMatrix.array as Float32Array));
    expect(Array.from(a.mesh.instanceColor!.array as Float32Array))
      .toEqual(Array.from(b.mesh.instanceColor!.array as Float32Array));
  });

  it('pooled forever: 100 bursts + updates never swap or grow a buffer (no alloc, no leak)', () => {
    const pool = new FragmentPool(new THREE.MeshStandardMaterial(), 32);
    const matrixArray = pool.mesh.instanceMatrix.array as Float32Array;
    const colorArray = pool.mesh.instanceColor!.array as Float32Array;
    const geometry = pool.mesh.geometry;
    for (let i = 0; i < 100; i += 1) {
      pool.burst({ x: (i % 7) * 0.1, y: 0.05, z: 0 }, { count: 8, band: i % 2 ? 'red' : 'blue' });
      for (let f = 0; f < 12; f += 1) pool.update(1 / 60);
      expect(pool.activeCount).toBeLessThanOrEqual(32); // bounded by capacity
      expect(pool.mesh.instanceMatrix.array).toBe(matrixArray); // same buffer
      expect(pool.mesh.instanceColor!.array).toBe(colorArray);
      expect(pool.mesh.geometry).toBe(geometry); // one mesh, one geometry
      const m = matrixArray;
      for (let k = 0; k < m.length; k += 1) {
        if (!Number.isFinite(m[k])) throw new Error(`non-finite matrix at ${k}`);
      }
    }
    for (let i = 0; i < 120; i += 1) pool.update(1 / 60); // drain
    expect(pool.activeCount).toBe(0);
  });
});

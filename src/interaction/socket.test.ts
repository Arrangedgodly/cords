import { describe, expect, it } from 'vitest';
import {
  MAX_PLUGS_PER_CUBE,
  PLUG_SEATED_DEPTH,
  computeSeatTransform,
  createSocketRegistry,
  pickSeatTarget,
  planSeat,
  resolveFaceNormal,
} from './socket';
import type { PickHit } from './picking';
import type { Vec3 } from '../sim';

/**
 * INT-2 acceptance (plan.md): "unit tests for face-normal selection incl.
 * edge/corner; cap rejection observable" — plus the task contract's seated
 * transform math, self-links, and determinism pins. All pure: no three.js,
 * no DOM, no RNG (the sweep uses a seeded LCG, so the suite is itself
 * deterministic).
 */

describe('socket rule — deterministic nearest-face resolution', () => {
  it('resolves clean face hits to their axis', () => {
    expect(resolveFaceNormal({ x: 1, y: 0, z: 0 })).toEqual({ x: 1, y: 0, z: 0 });
    expect(resolveFaceNormal({ x: -0.9999, y: 0.0001, z: 0 })).toEqual({ x: -1, y: 0, z: 0 });
    expect(resolveFaceNormal({ x: 0, y: 1, z: 0 })).toEqual({ x: 0, y: 1, z: 0 });
    expect(resolveFaceNormal({ x: 0, y: 0.3, z: 0.9 })).toEqual({ x: 0, y: 0, z: 1 });
    expect(resolveFaceNormal({ x: 0, y: 0, z: -1 })).toEqual({ x: 0, y: 0, z: -1 });
  });

  it('EXACT EDGE tie: two equal components resolve by axis order — x before y', () => {
    const edge = Math.SQRT1_2;
    expect(resolveFaceNormal({ x: edge, y: edge, z: 0 })).toEqual({ x: 1, y: 0, z: 0 });
    // Same tie on the negative side keeps the sign of the winning axis.
    expect(resolveFaceNormal({ x: -edge, y: -edge, z: 0 })).toEqual({ x: -1, y: 0, z: 0 });
    // y vs z tie (x absent) → y wins.
    expect(resolveFaceNormal({ x: 0, y: edge, z: edge })).toEqual({ x: 0, y: 1, z: 0 });
    expect(resolveFaceNormal({ x: 0, y: -edge, z: edge })).toEqual({ x: 0, y: -1, z: 0 });
  });

  it('EXACT CORNER tie: three equal components resolve by axis order — x first, sign kept', () => {
    const corner = 1 / Math.sqrt(3);
    expect(resolveFaceNormal({ x: corner, y: corner, z: corner })).toEqual({ x: 1, y: 0, z: 0 });
    expect(resolveFaceNormal({ x: -corner, y: corner, z: -corner })).toEqual({ x: -1, y: 0, z: 0 });
    // Mixed-sign corner: the winner's own sign, not the majority sign.
    expect(resolveFaceNormal({ x: corner, y: -corner, z: corner })).toEqual({ x: 1, y: 0, z: 0 });
  });

  it('near-ties beyond float noise still pick the genuinely dominant axis', () => {
    // x edge tie with a whisker more x: x wins on magnitude, not on order.
    const e = Math.SQRT1_2;
    expect(resolveFaceNormal({ x: e + 1e-6, y: e, z: 0 })).toEqual({ x: 1, y: 0, z: 0 });
    // ...and a whisker less x hands the win to y — the rule follows the face.
    expect(resolveFaceNormal({ x: e - 1e-6, y: e, z: 0 })).toEqual({ x: 0, y: 1, z: 0 });
  });

  it('is total over garbage: zero and non-finite inputs resolve deterministically, never throw', () => {
    expect(resolveFaceNormal({ x: 0, y: 0, z: 0 })).toEqual({ x: 1, y: 0, z: 0 });
    expect(resolveFaceNormal({ x: Number.NaN, y: Number.NaN, z: Number.NaN })).toEqual({
      x: -1, y: 0, z: 0,
    });
    expect(resolveFaceNormal({ x: Number.NaN, y: 0.6, z: 0.2 })).toEqual({ x: 0, y: 1, z: 0 });
    // Same garbage in, same answer out — bit-for-bit.
    const a = resolveFaceNormal({ x: Number.NaN, y: Number.POSITIVE_INFINITY, z: 0.3 });
    const b = resolveFaceNormal({ x: Number.NaN, y: Number.POSITIVE_INFINITY, z: 0.3 });
    expect(a).toEqual(b);
  });

  it('DETERMINISM sweep (seeded LCG): every normal resolves to a unit axis matching its dominant component, identically across runs', () => {
    let seed = 0x2f6e2b1; // fixed seed — the sweep is reproducible
    const next = () => {
      // xorshift-ish LCG; values in [-1, 1)
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed / 0x3fffffff - 1);
    };
    const firstRun: Vec3[] = [];
    for (let i = 0; i < 2000; i += 1) {
      const raw: Vec3 = { x: next(), y: next(), z: next() };
      const resolved = resolveFaceNormal(raw);
      // Always a signed unit axis…
      const mag = Math.abs(resolved.x) + Math.abs(resolved.y) + Math.abs(resolved.z);
      expect(mag).toBe(1);
      // …and always the dominant |component|'s axis (first on ties).
      const ax = Math.abs(raw.x);
      const ay = Math.abs(raw.y);
      const az = Math.abs(raw.z);
      const want: Vec3 =
        ax >= ay && ax >= az
          ? { x: Math.sign(raw.x) || 1, y: 0, z: 0 }
          : ay >= az
            ? { x: 0, y: Math.sign(raw.y) || 1, z: 0 }
            : { x: 0, y: 0, z: Math.sign(raw.z) || 1 };
      expect(resolved).toEqual(want);
      firstRun.push(resolved);
    }
    // Re-run with the same seed: bitwise-identical decisions.
    seed = 0x2f6e2b1;
    for (let i = 0; i < 2000; i += 1) {
      const raw: Vec3 = { x: next(), y: next(), z: next() };
      expect(resolveFaceNormal(raw)).toEqual(firstRun[i]);
    }
  });
});

describe('socket rule — seated transform math', () => {
  it('seats the jack perpendicular to the face, offset off the face by the plug seated depth', () => {
    // Hit on a cube's +y top face.
    const pose = computeSeatTransform({ x: 0.85, y: 0.5, z: 1.05 }, { x: 0, y: 1, z: 0 });
    expect(pose.normal).toEqual({ x: 0, y: 1, z: 0 });
    expect(pose.position.x).toBe(0.85);
    expect(pose.position.z).toBe(1.05);
    expect(pose.position.y).toBeCloseTo(0.5 - PLUG_SEATED_DEPTH, 15); // tip buried in the socket
    // The plug AXIS is the face normal (perpendicular); the tip points into it.
    expect(pose.axis).toEqual({ x: 0, y: -1, z: 0 });
  });

  it('works on every face — the offset always runs along the resolved outward normal', () => {
    const cases: { hit: Vec3; raw: Vec3; want: Vec3 }[] = [
      { hit: { x: 0.6, y: 0.25, z: 1 }, raw: { x: 0, y: 0, z: 1 }, want: { x: 0, y: 0, z: -PLUG_SEATED_DEPTH } },
      { hit: { x: 0.6, y: 0.25, z: 1 }, raw: { x: 0, y: 0, z: -1 }, want: { x: 0, y: 0, z: PLUG_SEATED_DEPTH } },
      { hit: { x: 1, y: 0.25, z: 0.4 }, raw: { x: 1, y: 0, z: 0 }, want: { x: -PLUG_SEATED_DEPTH, y: 0, z: 0 } },
      { hit: { x: -1, y: 0.25, z: 0.4 }, raw: { x: -1, y: 0, z: 0 }, want: { x: PLUG_SEATED_DEPTH, y: 0, z: 0 } },
      { hit: { x: 0.2, y: 0, z: 0.4 }, raw: { x: 0, y: -1, z: 0 }, want: { x: 0, y: PLUG_SEATED_DEPTH, z: 0 } },
    ];
    for (const c of cases) {
      const pose = computeSeatTransform(c.hit, c.raw);
      expect(pose.position.x).toBeCloseTo(c.hit.x + c.want.x, 15);
      expect(pose.position.y).toBeCloseTo(c.hit.y + c.want.y, 15);
      expect(pose.position.z).toBeCloseTo(c.hit.z + c.want.z, 15);
      // Tip into the face, exactly opposite the outward normal.
      expect(pose.axis.x).toBeCloseTo(-pose.normal.x, 15);
      expect(pose.axis.y).toBeCloseTo(-pose.normal.y, 15);
      expect(pose.axis.z).toBeCloseTo(-pose.normal.z, 15);
    }
  });

  it('edge hits seat on the RESOLVED face — one deterministic socket, never a blend', () => {
    // Cursor on the exact top/front edge: the raw normal is a 50/50 blend.
    const edge = Math.SQRT1_2;
    const hit: Vec3 = { x: 0.85, y: 0.5, z: 1.3 };
    const a = computeSeatTransform(hit, { x: 0, y: edge, z: edge });
    const b = computeSeatTransform(hit, { x: 0, y: edge, z: edge });
    // Axis order picks +y (top face) — and the same input picks it again.
    expect(a.normal).toEqual({ x: 0, y: 1, z: 0 });
    expect(a.position.y).toBeCloseTo(hit.y - PLUG_SEATED_DEPTH, 15);
    expect(a.position.z).toBe(hit.z); // untouched — the offset runs on y only
    expect(a).toEqual(b);
  });

  it('is bitwise deterministic — identical inputs, identical outputs', () => {
    const hit: Vec3 = { x: 0.85, y: 0.5, z: 1.05 };
    const raw: Vec3 = { x: 0, y: 1, z: 0 };
    const a = computeSeatTransform(hit, raw);
    const b = computeSeatTransform(hit, raw);
    expect(a.position.x).toBe(b.position.x);
    expect(a.position.y).toBe(b.position.y);
    expect(a.position.z).toBe(b.position.z);
    expect(a.axis).toEqual(b.axis);
  });
});

describe('socket rule — the jack in hand never shadows its own socket', () => {
  const carriedJack = { kind: 'cordEnd', cordId: 0, index: 24 };
  const otherJack = { kind: 'cordEnd', cordId: 1, index: 0 };
  const cube = { kind: 'cube', id: 3 };

  const jackHit = (payload: object, distance: number): PickHit<object> => ({
    class: 'jack',
    distance,
    payload,
    point: { x: 0, y: 0.5, z: 0 },
    normal: { x: 0, y: 1, z: 0 },
  });
  const cubeHit = (payload: object, distance: number): PickHit<object> => ({
    class: 'cube',
    distance,
    payload,
    point: { x: 0.5, y: 0.5, z: 0.5 },
    normal: { x: 0, y: 1, z: 0 },
  });

  it('the carried jack under the cursor is skipped — the cube beneath it is the seat target', () => {
    // Exactly the release pose: the converged jack proxy (nearer) + the cube.
    const target = pickSeatTarget([jackHit(carriedJack, 0.05), cubeHit(cube, 0.4)], carriedJack);
    expect(target?.class).toBe('cube');
    expect(target?.payload).toBe(cube);
  });

  it('every OTHER jack keeps its priority — a foreign jack still beats the cube', () => {
    const target = pickSeatTarget([jackHit(otherJack, 0.1), cubeHit(cube, 0.4)], carriedJack);
    expect(target?.class).toBe('jack');
    expect(target?.payload).toBe(otherJack);
  });

  it('carried jack alone under the cursor → null (nothing to seat into, honest drop)', () => {
    expect(pickSeatTarget([jackHit(carriedJack, 0.05)], carriedJack)).toBeNull();
    expect(pickSeatTarget([], carriedJack)).toBeNull();
  });
});

describe('socket rule — soft cap (12 plugs per cube) with visible-deny decision', () => {
  it('allows seats up to the cap and registers each one', () => {
    const registry = createSocketRegistry();
    for (let i = 0; i < MAX_PLUGS_PER_CUBE; i += 1) {
      expect(registry.canSeat(0)).toBe(true);
      const attempt = planSeat(registry, { cubeId: 0, hitPoint: { x: 0, y: 0.5, z: 0 }, faceNormal: { x: 0, y: 1, z: 0 } });
      expect(attempt.outcome).toBe('seated');
    }
    expect(registry.count(0)).toBe(MAX_PLUGS_PER_CUBE);
  });

  it('CAP REJECTION: plug 13 on the same cube is denied — no pose, cue payload supplied, nothing registered', () => {
    const registry = createSocketRegistry();
    for (let i = 0; i < MAX_PLUGS_PER_CUBE; i += 1) {
      registry.seat(0);
    }
    expect(registry.canSeat(0)).toBe(false);
    const attempt = planSeat(registry, {
      cubeId: 0,
      hitPoint: { x: 0.3, y: 0.5, z: 0.9 },
      faceNormal: { x: 0, y: 1, z: 0 },
    });
    expect(attempt.outcome).toBe('denied-cap');
    expect(registry.count(0)).toBe(MAX_PLUGS_PER_CUBE); // the deny changed nothing
    if (attempt.outcome === 'denied-cap') {
      // The deny cue's world payload: where the ring draws and how it orients.
      expect(attempt.hitPoint).toEqual({ x: 0.3, y: 0.5, z: 0.9 });
      expect(attempt.normal).toEqual({ x: 0, y: 1, z: 0 });
    }
  });

  it('the cap is PER CUBE — a full cube never blocks a neighbor', () => {
    const registry = createSocketRegistry();
    for (let i = 0; i < MAX_PLUGS_PER_CUBE; i += 1) registry.seat(3);
    expect(planSeat(registry, { cubeId: 3, hitPoint: { x: 0, y: 0.5, z: 0 }, faceNormal: { x: 0, y: 1, z: 0 } }).outcome).toBe('denied-cap');
    expect(planSeat(registry, { cubeId: 4, hitPoint: { x: 0, y: 0.5, z: 0 }, faceNormal: { x: 0, y: 1, z: 0 } }).outcome).toBe('seated');
  });

  it('SELF-LINKS: both ends of one cord may seat on the SAME cube — the cap counts plugs, not cords', () => {
    const registry = createSocketRegistry();
    const top = { hitPoint: { x: 0.85, y: 0.5, z: 1.05 }, faceNormal: { x: 0, y: 1, z: 0 } };
    expect(planSeat(registry, { cubeId: 4, ...top }).outcome).toBe('seated');
    expect(planSeat(registry, { cubeId: 4, ...top }).outcome).toBe('seated');
    expect(registry.count(4)).toBe(2);
  });

  it('release frees a slot — an unplugged cube accepts new plugs again (INT-6 seam)', () => {
    const registry = createSocketRegistry();
    for (let i = 0; i < MAX_PLUGS_PER_CUBE; i += 1) registry.seat(2);
    expect(registry.canSeat(2)).toBe(false);
    registry.release(2);
    expect(registry.canSeat(2)).toBe(true);
    expect(planSeat(registry, { cubeId: 2, hitPoint: { x: 0, y: 0.5, z: 0 }, faceNormal: { x: 0, y: 1, z: 0 } }).outcome).toBe('seated');
    // Releasing an empty cube is a harmless no-op.
    registry.release(99);
    expect(registry.count(99)).toBe(0);
  });
});

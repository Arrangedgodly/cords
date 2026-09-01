/**
 * INT-2 dev harness — the socket-rule staging page. NOT the product: the
 * production composition root is src/main.ts (seat on pointer-up over a
 * cube). This page stages the screenshot of record with the REAL production
 * pieces and the REAL seat math — no rendering shortcuts:
 *
 * - One REAL production rope (createVerletRope, same 1/120 fixed-slice
 *   discipline as the composition root), anchor pinned mid-air, free end
 *   SEATED into cube 04's top face through the actual socket rule
 *   (`computeSeatTransform` from src/interaction/socket.ts — the same pure
 *   function a user's pointer-up runs) → `rope.seat` (the SIM-3 hard pin)
 *   → `render.setSeatOverride` (the seated jack snaps perpendicular to the
 *   face while the cord body settles per the verified settle window).
 * - The cap-deny cue: `render.flashDeny` fires a flat red ring onto the
 *   SAME cube's camera-facing front face. `?denyHold=1` re-fires it every
 *   frame so a headless capture at any virtual time shows it at full
 *   strength — a STAGING-ONLY hold (production fades it after ~0.35 s);
 *   the fade path is the one production code runs.
 */
import { createVerletRope } from '../sim';
import type { CordState, SimState, Vec3 } from '../sim';
import { createRenderLayer } from '../render/scene';
import { computeSeatTransform } from '../interaction/socket';

// Same fixed-slice discipline as the composition root (ARC-3 semantics).
const H = 1 / 120;
const MAX_SUBSTEPS = 5;

const SEGS = 24; // 2.4 u of cord — the M1 length; leash = total rest length
const LAST = SEGS;

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('int2stage: #app missing');

const render = createRenderLayer(app, {
  cords: [{ id: 0, pointCount: SEGS + 1, redEnd: 'first' }],
});

// --- The staged seat --------------------------------------------------------
// The M1 anchor (mid-air pin, red jack riding it) and the socket: cube 05
// (scene index 4) at (1.7, z 0.15) — its TOP face plane is y = 0.5, fully in
// view with nothing occluding the drape. The hit is the face center, so the
// seated jack reads dead-center perpendicular on the module's pad.
const ANCHOR: Vec3 = { x: 1.2, y: 1.75, z: 0.6 };
const TOP_HIT: Vec3 = { x: 1.7, y: 0.5, z: 0.15 };
const TOP_NORMAL: Vec3 = { x: 0, y: 1, z: 0 };
// The REAL socket math a pointer-up would run (INT-2's pure core).
const seat = computeSeatTransform(TOP_HIT, TOP_NORMAL);

const rope = createVerletRope({
  segmentCount: SEGS,
  segmentLength: 0.1,
  floorY: 0,
  pin: ANCHOR,
});

// Sculpt the initial pose as a sagging arc from the anchor to the seated
// transform, then seat: SIM-3 adopts the sculpted drape as its rest state,
// so the settle relaxes from the drape — the honest plug sequence.
for (let i = 0; i <= SEGS; i += 1) {
  const t = i / SEGS;
  const s = Math.sin(Math.PI * t);
  const sag = 0.22;
  rope.setPoint(
    i,
    ANCHOR.x + (seat.position.x - ANCHOR.x) * t,
    ANCHOR.y + (seat.position.y - ANCHOR.y) * t - sag * s,
    ANCHOR.z + (seat.position.z - ANCHOR.z) * t,
  );
}
for (let i = 0; i <= SEGS; i += 1) rope.setVelocity(i, 0, 0, 0, H);

rope.seat({ index: LAST, position: seat.position });
// The seated jack snaps perpendicular to the face (the plug tip points into
// the socket) instead of riding the settling cord's last-segment tangent.
render.setSeatOverride(0, 'last', { position: seat.position, axis: seat.axis });

const points: Vec3[] = Array.from({ length: SEGS + 1 }, () => ({ x: 0, y: 0, z: 0 }));
rope.writePointsTo(points);
const world: SimState = { time: 0, cords: [{ id: 0, points } as CordState] };

// --- The staged deny --------------------------------------------------------
// The SAME cube's camera-facing front face (z = 0.15 + 0.25). denyHold is a
// STAGING-ONLY pin for headless captures (see header).
const HOLD_DENY = new URLSearchParams(window.location.search).get('denyHold') === '1';
const DENY_CUBE_SCENE_INDEX = 4; // render.pickables.cubes[4] — silkscreen "05"
const DENY_HIT: Vec3 = { x: 1.7, y: 0.3, z: 0.4 };
const DENY_NORMAL: Vec3 = { x: 0, y: 0, z: 1 };

// Dev-harness debug hook (CDP inspection).
(window as unknown as Record<string, unknown>).__INT2_DEBUG = {
  rope,
  seat,
  camera: render.camera,
  settled: () => rope.isSettled(),
};

let acc = 0;
render.start((dtSeconds) => {
  acc += Math.min(Math.max(dtSeconds, 0), 0.1);
  let substeps = 0;
  while (acc >= H && substeps < MAX_SUBSTEPS) {
    world.time += H;
    rope.step(H);
    rope.writePointsTo(points);
    acc -= H;
    substeps += 1;
  }
  if (HOLD_DENY) render.flashDeny(DENY_CUBE_SCENE_INDEX, DENY_HIT, DENY_NORMAL);
  render.render(world);
});

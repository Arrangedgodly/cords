/**
 * INT-2 — the SOCKET PLACEMENT RULE (Doctor Strange's risk #2: "plug
 * anywhere" must never feel broken). Pure, headless, deterministic: given a
 * cube hit point + the raw face normal from INT-1's hit payload, this module
 * derives the seated jack transform and owns the per-cube plug capacity.
 * No three.js, no DOM — everything here unit-tests without a renderer.
 *
 * Approved rules (scoping brief / plan.md INT-2):
 *
 * 1. PERPENDICULAR SEAT — a jack seats with its axis along the cube face
 *    normal, tip into the socket. The seated rope-end pin (the jack's tip
 *    apex, REN-2 anatomy) sits `PLUG_SEATED_DEPTH` INSIDE the face, measured
 *    off the face along the outward normal — exactly the depth that buries
 *    tip + insulator groove, so the plug's shaft shoulder meets the face
 *    plane: on screen the jack reads as plugged in, never hovering.
 *
 * 2. DETERMINISTIC NEAREST FACE — at an edge or corner the raycaster's raw
 *    normal is a blend of two/three faces. `resolveFaceNormal` snaps it to
 *    the dominant axis (max |component|), ties broken by stable axis order
 *    x → y → z, sign preserved. Same cursor position ⇒ same socket, every
 *    machine, every run — ambiguity here is what would feel broken.
 *
 * 3. SOFT CAP — MAX_PLUGS_PER_CUBE seated plugs on one cube is a perf guard
 *    (the plan's "soft cap of 12 plugs/cube with a visible deny"). Attempt
 *    13+ is DENIED: the caller shows the deny cue and the jack stays carried
 *    (un-seated). Cosmetic polarity only: any jack into any cube, and both
 *    ends of one cord may seat on the SAME cube (self-links allowed) — the
 *    cap counts plugs, not cords.
 */
import type { Vec3 } from '../sim';
import type { PickHit } from './picking';

/**
 * How deep the jack's tip sits in the socket, in world units, measured off
 * the face along the OUTWARD normal (the seated pin = hit − depth·normal).
 * Value = the REN-2 plug's tip cone + insulator groove length (0.082): at
 * this depth the metal shaft's shoulder lands exactly on the face plane, so
 * the visible anatomy (shaft → band → grip → boot) stands proud of the face
 * like real hardware while tip + groove are buried.
 */
export const PLUG_SEATED_DEPTH = 0.082;

/** Perf-guard soft cap: seated plugs allowed on ONE cube before deny. */
export const MAX_PLUGS_PER_CUBE = 12;

/**
 * A seated jack's transform, world space. `normal` is the resolved OUTWARD
 * face axis (a unit world axis); `position` is where the rope-end pin (the
 * plug's tip apex) hard-pins; `axis` is the direction the plug's TIP points —
 * into the face (−normal) — which is the orientation the renderer snaps the
 * seated jack to.
 */
export interface SeatedJackPose {
  readonly position: Vec3;
  readonly normal: Vec3;
  readonly axis: Vec3;
}

/**
 * The deterministic nearest-face rule: snap a (possibly edge/corner-blended)
 * raw hit normal to the single world axis it is most aligned with. Exact
 * ties (a perfect edge or corner hit, where two/three |components| equal)
 * resolve by stable AXIS ORDER x → y → z; the component's SIGN is kept.
 * The rule is total — a degenerate input (zero vector, or non-finite
 * components that would make "max" meaningless) still resolves
 * deterministically through the same axis order rather than throwing, so
 * garbage upstream can never make the socket rule nondeterministic.
 */
export function resolveFaceNormal(raw: Vec3): Vec3 {
  const ax = Number.isFinite(raw.x) ? Math.abs(raw.x) : -1;
  const ay = Number.isFinite(raw.y) ? Math.abs(raw.y) : -1;
  const az = Number.isFinite(raw.z) ? Math.abs(raw.z) : -1;
  // >= comparisons in fixed x→y→z order: the FIRST axis holding the max
  // magnitude wins every exact tie — the same input can never flip.
  if (ax >= ay && ax >= az) {
    return raw.x >= 0 ? { x: 1, y: 0, z: 0 } : { x: -1, y: 0, z: 0 };
  }
  if (ay >= az) {
    return raw.y >= 0 ? { x: 0, y: 1, z: 0 } : { x: 0, y: -1, z: 0 };
  }
  return raw.z >= 0 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 0, z: -1 };
}

/**
 * The seated jack transform for a plug landing on `hitPoint` with raw face
 * normal `faceNormal`. Position = the hit point offset off the face by the
 * plug's seated depth (into the socket, along the resolved outward normal);
 * orientation = the face normal (plug axis perpendicular to the face, tip
 * pointing into it). Deterministic: identical inputs give bitwise-identical
 * outputs — the float ops are one multiply and two subtractions on
 * axis-aligned values.
 */
export function computeSeatTransform(hitPoint: Vec3, faceNormal: Vec3): SeatedJackPose {
  const normal = resolveFaceNormal(faceNormal);
  const position: Vec3 = {
    x: hitPoint.x - normal.x * PLUG_SEATED_DEPTH,
    y: hitPoint.y - normal.y * PLUG_SEATED_DEPTH,
    z: hitPoint.z - normal.z * PLUG_SEATED_DEPTH,
  };
  // The plug enters the socket tip-first: the tip points OPPOSITE the
  // outward normal (into the face), exactly perpendicular to it. `|| 0`
  // canonicalizes -0 → +0 so the output is deterministic down to the sign
  // of zero (the same discipline as the NDC mapping in picking.ts).
  const axis: Vec3 = { x: -normal.x || 0, y: -normal.y || 0, z: -normal.z || 0 };
  return { position, normal, axis };
}

/**
 * Per-cube seated-plug bookkeeping for the soft cap. Plain closure state;
 * `planSeat` is the single decision point that mutates it.
 */
export interface SocketRegistry {
  /** True while cube `cubeId` still has cap headroom. */
  canSeat(cubeId: number): boolean;
  /** Current seated-plug count on `cubeId`. */
  count(cubeId: number): number;
  /** Registers one seated plug (after a successful seat). */
  seat(cubeId: number): void;
  /** Releases one seat (a jack leaves the cube — INT-6's future unplug). */
  release(cubeId: number): void;
}

export function createSocketRegistry(cap: number = MAX_PLUGS_PER_CUBE): SocketRegistry {
  const counts = new Map<number, number>();
  return {
    canSeat(cubeId) {
      return (counts.get(cubeId) ?? 0) < cap;
    },
    count(cubeId) {
      return counts.get(cubeId) ?? 0;
    },
    seat(cubeId) {
      counts.set(cubeId, (counts.get(cubeId) ?? 0) + 1);
    },
    release(cubeId) {
      const next = (counts.get(cubeId) ?? 0) - 1;
      if (next > 0) counts.set(cubeId, next);
      else counts.delete(cubeId);
    },
  };
}

/** The pointer-up seat decision, as plain data (QA-replayable, UI-agnostic). */
export type SeatAttempt =
  | { readonly outcome: 'seated'; readonly cubeId: number; readonly pose: SeatedJackPose }
  | {
      readonly outcome: 'denied-cap';
      readonly cubeId: number;
      /** Where the deny cue draws: the cursor's hit point on the face. */
      readonly hitPoint: Vec3;
      /** The resolved face axis the cue orients to. */
      readonly normal: Vec3;
    };

/**
 * The one socket-rule decision: a carried jack released over a cube. Seats
 * when the cube has cap headroom (computing + registering the seated
 * transform), denies at the cap (nothing registered — the jack stays
 * carried; the caller owes the visible deny cue). Polarity is cosmetic and
 * self-links are legal, so cord/end identity never enters the decision —
 * only the cube's count does.
 */
export function planSeat(
  registry: SocketRegistry,
  args: { cubeId: number; hitPoint: Vec3; faceNormal: Vec3 },
): SeatAttempt {
  const normal = resolveFaceNormal(args.faceNormal);
  if (!registry.canSeat(args.cubeId)) {
    return { outcome: 'denied-cap', cubeId: args.cubeId, hitPoint: args.hitPoint, normal };
  }
  const pose = computeSeatTransform(args.hitPoint, args.faceNormal);
  registry.seat(args.cubeId);
  return { outcome: 'seated', cubeId: args.cubeId, pose };
}

/**
 * The socket query for a release: the first hit in the picker's
 * priority-sorted order that is NOT the carried jack itself. The carried end
 * converges to the cursor, so its own pick proxy is always under it — the
 * raw priority order (jack > cube) would let the jack in hand shadow its own
 * socket forever and "plug anywhere" would never fire. Self is skipped by
 * payload identity; every OTHER jack keeps its approved priority over cubes.
 */
export function pickSeatTarget<TPayload>(
  hits: ReadonlyArray<PickHit<TPayload>>,
  carriedPayload: TPayload,
): PickHit<TPayload> | null {
  for (const hit of hits) {
    if (hit.payload === carriedPayload) continue;
    return hit;
  }
  return null;
}

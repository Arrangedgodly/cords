import type { CordState, SimState, SimStep, Vec2 } from './types';
import { createVerletRope, resolveRopeConfig } from './rope';
import type { RopeConfig } from './rope';

/**
 * SIM-1/SIM-2 — the rope-backed SimStep: the real solver behind the SimStep
 * contract, replacing the ARC-2 no-op at the composition root. The
 * fixed-timestep driver (ARC-3) calls this once per substep, so every
 * `rope.step(dt)` receives exactly one fixed slice.
 *
 * 2D PIVOT (town-hall Revision 2): Vec2 throughout — the plane's own
 * coordinates, gravity −Y, floor a horizontal line. Every law identical.
 *
 * SIM-2 carry intent flows in through `SimInput.pinTarget`: while the
 * interaction layer keeps sending a target, that endpoint is a carried
 * kinematic pin (bounded-velocity convergence + stretch leash inside
 * `rope.step`); the first target engages the carry. When targets stop
 * arriving the pin holds where it converged — the release stub; the real
 * grab/release FSM is INT/LIFE lane work.
 *
 * SIM-3 plug intent flows in through `SimInput.seatTarget`: the frame it
 * arrives, that endpoint hardens into the plugged pin (`rope.seat`) and the
 * settle runs (rest adaptation, seatDamped decay, sleep at rest). A carried
 * end and a seated end coexist until then — the awaiting-plug state. Repeats
 * for an already-plugged index are idempotent, and a stale carry
 * target naming the plugged end is ignored (the jack is in its socket).
 *
 * INT-3 — the same latched `seatTarget` is also the SEAT TRANSPORT: when it
 * names the already-seated index, its position is applied through
 * `rope.setSeatPosition`, so a dragged rectangle's socket transform moves the
 * plugged pin every substep (hard-follow — the cord follows its host).
 * Unchanged re-sends are bitwise no-ops inside the rope, so the per-frame
 * latch never kicks the cord into an endless re-settle.
 *
 * INT-2 GUARD (closes the SIM-3 verifier's "pinTarget-on-anchor-end" hole):
 * neither intent may name the ORIGINAL anchor end (`pinnedIndex`) —
 * `rope.carryEnd(pinnedIndex)` and `rope.seat({ index: pinnedIndex })` both
 * THROW by contract, and an intent arriving through SimInput is upstream
 * data, not a programmer error. The step is total: anchor-naming intents are
 * ignored exactly like stale seated-end intents, so garbage can never crash
 * the driver. Regression-pinned in ropeStep.test.ts.
 *
 * M1 world model: ONE cord. The rope lives in the closure and IS the state —
 * the incoming `state.cords` is ignored beyond its clock, and the same
 * SimState/CordState/Vec2 shells are mutated and returned every call, so a
 * frame advances with zero allocation (render reads the snapshot read-only).
 * SIM-2/LIFE-1 grow this into a multi-cord world; determinism already holds
 * because the step is a pure function of (initial state, call sequence).
 */
export interface RopeSimStepConfig {
  /** Overrides for the single cord's rope (defaults: DEFAULT_ROPE_CONFIG). */
  cord?: Partial<RopeConfig>;
}

export function createRopeSimStep(config: RopeSimStepConfig = {}): SimStep {
  const cordConfig: Partial<RopeConfig> = config.cord ?? {};
  const resolved = resolveRopeConfig(cordConfig);
  const rope = createVerletRope(resolved);

  // Spawn pose: hanging straight down from the pin — a calm cord at rest.
  // Feel tuning (coils, settle) is SIM-3's; the spawn stays deterministic.
  const pin = resolved.pin;
  rope.placeAlong(
    pin,
    {
      x: pin.x,
      y: pin.y - resolved.segmentCount * resolved.segmentLength,
    },
  );

  // Preallocated world shells — created once here, mutated in place forever.
  const cordPoints: Vec2[] = new Array(rope.pointCount);
  rope.writePointsTo(cordPoints); // fills the shells with the spawn pose
  const cord: CordState = { id: 0, points: cordPoints };
  const world: SimState = { time: 0, cords: [cord] };

  return (state, dt, input) => {
    // SIM-2 carry intent: engage on the first target, update thereafter. The
    // scalars are copied inside setPinTarget — no aliasing, no allocation.
    // SIM-3: a stale target naming the plugged end is ignored — a jack in a
    // socket is not a hand-held end. INT-2: the anchor end is likewise not a
    // hand-held end — carryEnd would throw there, so the intent is dropped
    // at the input boundary instead (totality: SimInput garbage is ignored,
    // never fatal).
    const carry = input.pinTarget;
    if (
      carry !== null &&
      carry !== undefined &&
      carry.index !== rope.pinnedIndex &&
      !rope.isEndSeated(carry.index)
    ) {
      if (rope.carriedIndex !== carry.index) rope.carryEnd(carry.index);
      rope.setPinTarget(carry.index, carry.position);
    }
    // SIM-3 plug intent: the frame it arrives, the end hardens into the
    // plugged pin and the settle begins. Idempotent for a plugged index, and
    // ignored for the anchor index (seat() throws there by contract — the
    // anchor is seated by construction, not by a plug event).
    //
    // INT-3 SEAT TRANSPORT: a seatTarget naming the ALREADY-seated index is
    // the socket moving (its rectangle is being dragged) — the plugged pin is
    // set to the transform's position each substep (hard-follow: the jack
    // rides its socket kinematically; the cord body follows through the
    // constraint solve). Re-sends of an UNCHANGED transform are no-ops inside
    // the rope (setSeatPosition skips bitwise-identical positions without
    // waking), so the latched per-frame re-send can never restart the settle
    // — the post-drag calm-down stays bounded by the settle window.
    //
    // Boundary totality: a garbage (non-finite) position on the PLUG intent
    // is ignored here exactly like anchor-naming intents — upstream SimInput
    // data must never reach rope.seat's throwing validation (the step stays
    // total); the transport branch tolerates garbage inside the rope.
    const seatTo = input.seatTarget;
    if (
      seatTo !== null &&
      seatTo !== undefined &&
      seatTo.index !== rope.pinnedIndex
    ) {
      if (!rope.isEndSeated(seatTo.index)) {
        const p = seatTo.position;
        if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
          rope.seat(seatTo);
        }
      } else {
        rope.setSeatPosition(seatTo.index, seatTo.position.x, seatTo.position.y);
      }
    }
    rope.step(dt);
    rope.writePointsTo(cordPoints);
    world.time = state.time + dt;
    return world;
  };
}

/**
 * T-LIFE-1 — the cord lifecycle FSM (Hulk lane, LIFE lane: "FSM, failure
 * paths, clamps, recovery"). The approved lifecycle (town-hall, restated in
 * plan.md LIFE-1) as an EXPLICIT state machine:
 *
 *   carried (jack in hand / nothing seated)
 *     → awaiting-plug (one end seated, other carried/free)
 *       → linked (both ends seated)
 *         → popped (auto-unplugged by over-stretch; dangles from the seated
 *           end under a grace timer)
 *           → linked again (re-seated before grace expires)
 *           → vanishing (grace expiry ~3s)
 *       → vanishing (the carried jack released off-cube — the user-initiated
 *         failure)
 *     → vanishing is also reachable from popped by dropping the held end
 *       off-cube inside the grace window (same failure class, same target
 *       state — the approved popped→vanishing pair, second documented
 *       trigger).
 *
 * APPROVED TRANSITIONS — the ONLY legal ones; everything else is rejected:
 *
 *   #  from           to            trigger                    owner
 *   1  carried        awaiting-plug first seat lands          INT-2 seat path
 *   2  awaiting-plug  linked        second seat lands         INT-2 seat path
 *   3  awaiting-plug  vanishing     carried jack released     main.ts release
 *                                    off-cube                 routing (here:
 *                                                              releaseJack)
 *   4  linked         popped        over-stretch              INT-6 (popCords
 *                                                               intent; tests
 *                                                               may fire it)
 *   5  popped         linked        re-seated before grace    INT-2 seat path
 *                                    expires (cancels it)
 *   6  popped         vanishing     grace expiry (~3s)        the grace clock
 *                                                               (advance)
 *   7  linked        awaiting-plug  a seated end is grabbed   INT-4 re-grab
 *                                    by hand (the plug pulls (the carry intent
 *                                    out; the other seat       on a seated
 *                                    still holds)              end)
 *   8  awaiting-plug  carried       the remaining seat is     INT-4 re-grab
 *                                    grabbed by hand (nothing
 *                                    seated anymore)
 *   +  vanishing      gone          the vanish sequence       LIFE-2
 *                                    reports completion       (despawnCords
 *                                    → cord removed            intent →
 *                                    from world                completeVanish)
 *
 * HAND-PULLED PLUGS ARE LEGAL (coordinator amendment, on the record: INT-4's
 * verified "seated ends re-grabbable" behavior stands). #7/#8 are the un-seat
 * transitions, and they do NOT bypass the failure model — they COMPOSE with
 * it: a hand-unseated end is a carried jack on an `awaiting-plug` cord, and
 * releasing it off-cube is exactly the approved #3 failure
 * (awaiting-plug → vanishing). Manual unplug + off-cube release IS an
 * approved removal path. Two seated ends remain un-pullable, deliberately:
 * POPPED's surviving socket (popped's exits are the re-seat #5 and the grace
 * #6 — INT-6's pop must not be dodgeable by grabbing the socket that still
 * holds) and anything while VANISHING (the lock; the only pull-out there is
 * LIFE-2's choreography seam, mode-only, never a transition). The
 * rope-level `unseat` primitive is untouched (it is the mechanism); this
 * machine is the POLICY that gates it.
 *
 * DEFINED NON-TRANSITIONS (explicit, not oversights):
 * - Releasing a carried cord's held end off-cube (`carried`, zero seats):
 *   the ordinary floor drop — nothing was ever plugged, so there is no
 *   failure to punish; the cord stays `carried` and re-grabbable. This keeps
 *   the approved spawn/drop churn (fuzz-pinned) intact.
 * - Seat TRANSPORT (the per-frame latch re-sending a seated end's
 *   transform): idempotent physics, not a lifecycle event. Transports stay
 *   legal while `vanishing` (the seated plug stays in its socket until
 *   LIFE-2's pull-out).
 * - `noteCarrying` bookkeeping (free→carrying per-end mode) never transitions
 *   the cord state: cord-level state is DERIVED from the seats, not from
 *   what the hand happens to hold.
 *
 * REJECTION CONTRACT: illegal transitions are rejected loudly in tests and
 * no-op-with-warning in production. `strict: true` (test worlds) THROWS on
 * every illegal transition; the default (production) emits a `rejected`
 * event through `onRejected` and leaves the state untouched. Machine
 * mutators return whether the transition was APPLIED, so a caller (the world
 * step) pairs its own rope mutation with acceptance — machine and rope can
 * never disagree.
 *
 * GRACE TIMER: sim-time, never wall-clock. `advance(dt)` is driven by the
 * world step with the driver's fixed slice, so a backgrounded-tab deltaT
 * spike (clamped to maxSubsteps by the fixed-timestep driver) can never burn
 * more than the clamped sim time — the grace window inherits the clamp.
 * Expiry fires #6 exactly when the countdown crosses zero; a re-seat (#5)
 * cancels it.
 *
 * DETERMINISM: pure TypeScript plain data — no three.js, no DOM, no
 * wall-clock, no RNG. Identical construction + call sequences produce
 * identical states, grace counts, and event streams (pinned by test).
 */

/** The cord-level lifecycle states (`gone` is only ever a transition target:
 *  the record is removed from the registry the moment it is reached). */
export type LifecycleState =
  | 'carried'
  | 'awaiting-plug'
  | 'linked'
  | 'popped'
  | 'vanishing'
  | 'gone';

/** Per-end mode, tracked for every cord (REN-5/INT-6/A11Y queries). */
export type EndMode = 'seated' | 'carrying' | 'free';

// T-LIFE-2 — the choreography read shape consumed by the view interface
// below (type-only; the sequencer itself lives in vanish.ts).
import type { VanishInfo } from './vanish';

/** Default popped grace window in seconds of sim time (~3s, plan.md INT-6). */
export const DEFAULT_GRACE_SECONDS = 3;

/** Why a transition fired. `pop` carries its caller's reason verbatim. */
export type TransitionReason =
  | 'seated' // approved #1: carried → awaiting-plug
  | 'second-seated' // approved #2: awaiting-plug → linked
  | 'unplugged' // approved #7/#8: a seated end pulled by hand (INT-4 re-grab)
  | 're-seated' // approved #5: popped → linked (grace cancelled)
  | 'over-stretch' // approved #4 default: linked → popped
  | 'released-off-cube' // approved #3 / popped's second trigger: → vanishing
  | 'grace-expired' // approved #6: popped → vanishing
  | 'vanish-complete' // vanishing → gone (LIFE-2 completion)
  | (string & {}); // pop reasons are caller-supplied (open set)

/** One lifecycle transition, emitted in order through `onTransition`. */
export interface LifecycleTransition {
  readonly cordId: number;
  readonly from: LifecycleState;
  readonly to: LifecycleState;
  readonly reason: TransitionReason;
  /**
   * The end the transition concerns (seats, pops, releases), or null for
   * cord-level events (grace expiry keeps the popped end, completion has
   * none). Lets the render lane light the RIGHT jack.
   */
  readonly end: number | null;
  /** Machine sim clock (seconds) at the transition — advanced by advance(). */
  readonly time: number;
}

/** One rejected (illegal) transition — the production "warning". */
export interface LifecycleRejection {
  readonly cordId: number;
  /** The state the cord was in when the illegal transition was attempted. */
  readonly from: LifecycleState;
  readonly action: 'register' | 'seat' | 'unseat' | 'pop' | 'release-off-cube' | 'complete-vanish';
  /** Human-readable why (the loudness lives here in production). */
  readonly detail: string;
  readonly time: number;
}

export interface CordLifecycleOptions {
  /** Popped grace window in seconds of sim time. Default DEFAULT_GRACE_SECONDS. */
  graceSeconds?: number;
  /**
   * Test loudness: true THROWS on every illegal transition (and on a bad
   * config). Default false — production rejects with a warning event.
   */
  strict?: boolean;
  /** Transition events, emitted synchronously in deterministic order. */
  onTransition?: (event: LifecycleTransition) => void;
  /** Rejection warnings (production's "no-op-with-warning" channel). */
  onRejected?: (rejection: LifecycleRejection) => void;
}

/** Read/write surface of the machine (the world step owns one instance). */
export interface CordLifecycle {
  /**
   * Registers a cord. Default initial state: `carried` (a fresh spawn —
   * nothing seated). `{ seatedEnd }` marks one end pre-seated: the anchor
   * cord, whose pin is "seated by construction" → `awaiting-plug`. Re-binding
   * a LIVE id is rejected; a `gone` id may be registered again (a new cord
   * reusing the id).
   */
  register(cordId: number, options?: { seatedEnd?: number }): boolean;
  /**
   * Approved #1/#2/#5: the named end becomes seated. carried → awaiting-plug,
   * awaiting-plug → linked, popped(poppedEnd) → linked (cancels the grace).
   * Transport on an already-seated end is NOT a seat — callers check
   * `endMode` first. Anything else is a rejection. Returns applied?
   */
  seat(cordId: number, index: number): boolean;
  /**
   * The hand-pulled plug (approved #7/#8, INT-4's re-grab): the seated end
   * `index` is grabbed and leaves its socket into the hand. linked →
   * awaiting-plug (the other seat still holds), awaiting-plug → carried
   * (nothing seated anymore). While `vanishing` the pull is legal as
   * LIFE-2's choreography seam ONLY — mode bookkeeping, never a transition
   * (the lock holds). Anything else is a rejection: POPPED's surviving
   * socket (its exits are the re-seat and the grace — the pop must not be
   * dodgeable by hand), a non-seated end, an unknown cord. Returns applied?
   * Callers pair rope.unseat with acceptance.
   */
  unseat(cordId: number, index: number): boolean;
  /**
   * Approved #4: linked → popped. `index` is the seated end that pops (it
   * becomes free — the cord dangles from the other seat); the grace timer
   * starts. `reason` defaults to 'over-stretch'. Returns applied?
   */
  pop(cordId: number, index: number, reason?: string): boolean;
  /**
   * The release routing (approved #3 + popped's second trigger): the HELD
   * jack was released not over a cube. awaiting-plug/popped + end in hand →
   * vanishing. carried → the ordinary floor drop (defined non-transition —
   * the end's mode drops back to free, the cord survives). Everything else
   * is a rejection. Returns applied? (false for both rejections and the
   * carried drop — nothing transitioned.)
   */
  releaseCarriedJack(cordId: number, index: number): boolean;
  /**
   * Advisory per-end bookkeeping: a carry intent named this end (free →
   * carrying). NEVER a transition (cord state is seat-derived); a no-op on
   * unknown, seated, or locked cords.
   */
  noteCarrying(cordId: number, index: number): void;
  /**
   * Advances the sim clock by `dt` and runs every popped cord's grace
   * countdown; expiry fires approved #6 (popped → vanishing,
   * 'grace-expired'). Non-finite/non-positive dt is a no-op (clock garbage
   * can never fast-forward a grace window) — same discipline as rope.step.
   */
  advance(dt: number): void;
  /**
   * vanishing → gone (the completion contract): the vanish sequence
   * reported done; the caller (world step) removes the cord from the world.
   * Anything but `vanishing` is a rejection. Returns applied?
   */
  completeVanish(cordId: number): boolean;
  /** The cord's current state, or undefined once gone/never registered. */
  stateOf(cordId: number): LifecycleState | undefined;
  /** The end's mode ('free' for any unmarked end of a live cord). */
  endMode(cordId: number, index: number): EndMode | undefined;
  /** Seconds of grace left while popped; null in every other state. */
  graceRemaining(cordId: number): number | null;
  /** The machine sim clock (advanced only by advance). */
  now(): number;
}

/**
 * The read side of the machine, attached to the world step (`step.lifecycle`)
 * for the composition root — and through it the render/interaction lanes —
 * to query without mutating: REN-5 lights states, INT-6 reads grace, main.ts
 * refuses grabs of seated ends, A11Y-1 summarizes the scene. Plus LIFE-2's
 * one choreography seam.
 */
export interface CordLifecycleView {
  stateOf(cordId: number): LifecycleState | undefined;
  endMode(cordId: number, index: number): EndMode | undefined;
  /** Seconds of grace left while popped; null in every other state. */
  graceRemaining(cordId: number): number | null;
  /**
   * T-LIFE-2 — the vanish choreography's read side (REN-5 fades the cord on
   * `progress`; the e2e drives poll `phase`): the live phase and the 0..1
   * pull-window progress of cord `cordId`'s in-flight sequence, or null when
   * the cord is not vanishing (or the world runs without the choreography —
   * the interface lives on the machine's view for one-query ergonomics, but
   * the WORLD implements it from the sequencer, not the machine).
   */
  vanishInfo(cordId: number): VanishInfo | null;
  /**
   * LIFE-2 seam — the choreography's pull-out ("cord pulls out of the seated
   * cube"): the machine's vanishing-only unseat PAIRED with the world's
   * rope.unseat by the world step. Outside `vanishing` the seam is INERT
   * (nothing happens — the hand-pulled plug goes through the carry intent,
   * which applies the approved #7/#8 transitions instead).
   */
  pullOutDuringVanish(cordId: number, index: number): void;
}

interface CordRecord {
  state: LifecycleState;
  /** Sparse per-end modes — an unmarked end of a live cord reads 'free'. */
  readonly ends: Map<number, EndMode>;
  /** The end that popped (still set through vanishing, for REN-5 dimming). */
  poppedEnd: number | null;
  /** Grace countdown; meaningful only while popped. */
  graceRemaining: number;
}

/** Pseudo-state for rejections naming an unknown/already-gone cord. */
const GONE: LifecycleState = 'gone';

export function createCordLifecycle(options: CordLifecycleOptions = {}): CordLifecycle {
  const graceSeconds = options.graceSeconds ?? DEFAULT_GRACE_SECONDS;
  const strict = options.strict ?? false;
  const onTransition = options.onTransition;
  const onRejected = options.onRejected;
  if (!Number.isFinite(graceSeconds) || graceSeconds < 0) {
    throw new Error(`lifecycle: graceSeconds must be a finite number >= 0, got ${graceSeconds}`);
  }

  const cords = new Map<number, CordRecord>();
  /**
   * ONE-SHOT INTENT IDEMPOTENCE: the fixed-timestep driver replays a frame's
   * input across its substeps, so a pop/despawn/release intent RE-ARRIVES
   * after the transition it requested already fired. Those replays are
   * silent no-ops (never rejections — a strict world must not throw on the
   * driver's own replay semantics). A despawned id is tombstoned here until
   * the id is registered again.
   */
  const goneIds = new Set<number>();
  let clock = 0;

  const emit = (
    cordId: number,
    from: LifecycleState,
    to: LifecycleState,
    reason: TransitionReason,
    end: number | null,
  ): void => {
    if (onTransition !== undefined) {
      onTransition({ cordId, from, to, reason, end, time: clock });
    }
  };

  const reject = (
    cordId: number,
    action: LifecycleRejection['action'],
    detail: string,
  ): false => {
    const record = cords.get(cordId);
    if (strict) {
      throw new Error(
        `lifecycle: illegal ${action} on cord ${cordId} (from ${record?.state ?? GONE}): ${detail}`,
      );
    }
    if (onRejected !== undefined) {
      onRejected({ cordId, from: record?.state ?? GONE, action, detail, time: clock });
    }
    return false;
  };

  const modeOf = (record: CordRecord, index: number): EndMode => record.ends.get(index) ?? 'free';

  const toVanishing = (record: CordRecord, cordId: number, end: number | null): void => {
    const from = record.state;
    record.state = 'vanishing';
    emit(cordId, from, 'vanishing', 'released-off-cube', end);
  };

  return {
    register(cordId, opts) {
      if (cords.has(cordId)) {
        return reject(cordId, 'register', 'a live cord already holds this id');
      }
      const seatedEnd = opts?.seatedEnd;
      const record: CordRecord = {
        state: 'carried',
        ends: new Map(),
        poppedEnd: null,
        graceRemaining: 0,
      };
      if (seatedEnd !== undefined) {
        if (!Number.isFinite(seatedEnd)) {
          return reject(cordId, 'register', `seatedEnd must be finite, got ${seatedEnd}`);
        }
        record.state = 'awaiting-plug'; // the anchor: seated by construction
        record.ends.set(seatedEnd, 'seated');
      }
      cords.set(cordId, record);
      goneIds.delete(cordId); // a re-registered id is live again
      return true;
    },

    seat(cordId, index) {
      const record = cords.get(cordId);
      if (record === undefined) {
        return reject(cordId, 'seat', 'unknown cord');
      }
      if (!Number.isFinite(index)) {
        return reject(cordId, 'seat', `end index must be finite, got ${index}`);
      }
      switch (record.state) {
        case 'carried':
          record.state = 'awaiting-plug';
          record.ends.set(index, 'seated');
          emit(cordId, 'carried', 'awaiting-plug', 'seated', index);
          return true;
        case 'awaiting-plug':
          if (modeOf(record, index) === 'seated') {
            return reject(cordId, 'seat', 'that end is already seated (transport, not a seat)');
          }
          record.state = 'linked';
          record.ends.set(index, 'seated');
          emit(cordId, 'awaiting-plug', 'linked', 'second-seated', index);
          return true;
        case 'linked':
          return reject(cordId, 'seat', 'both ends are already seated');
        case 'popped':
          if (index !== record.poppedEnd || modeOf(record, index) === 'seated') {
            return reject(
              cordId,
              'seat',
              `only the popped end ${record.poppedEnd} can re-seat; end ${index} is ${modeOf(record, index)}`,
            );
          }
          record.state = 'linked';
          record.ends.set(index, 'seated');
          record.poppedEnd = null;
          record.graceRemaining = 0; // approved #5: the grace is cancelled
          emit(cordId, 'popped', 'linked', 're-seated', index);
          return true;
        case 'vanishing':
          return reject(cordId, 'seat', 'the cord is vanishing (FSM locked)');
        case 'gone':
          return reject(cordId, 'seat', 'unknown cord');
      }
    },

    unseat(cordId, index) {
      const record = cords.get(cordId);
      if (record === undefined) {
        return reject(cordId, 'unseat', 'unknown cord');
      }
      if (modeOf(record, index) !== 'seated') {
        return reject(
          cordId,
          'unseat',
          `no seat at end ${index} to pull out (its mode is ${modeOf(record, index)})`,
        );
      }
      if (record.state === 'linked' || record.state === 'awaiting-plug') {
        // The hand-pulled plug (#7/#8). The jack leaves its socket into the
        // hand: mode free (the carry intent's noteCarrying marks it carrying
        // right after). linked keeps the OTHER seat (awaiting-plug);
        // awaiting-plug leaves nothing seated (carried).
        const from = record.state;
        record.ends.set(index, 'free');
        record.state = from === 'linked' ? 'awaiting-plug' : 'carried';
        emit(cordId, from, record.state, 'unplugged', index);
        return true;
      }
      if (record.state === 'vanishing') {
        // LIFE-2's pull-out: the only vanishing-legal un-seat, and not a
        // transition — the vanish lock holds until the sequence reports
        // completion.
        record.ends.set(index, 'free');
        return true;
      }
      return reject(
        cordId,
        'unseat',
        `the seated end of a ${record.state} cord cannot be pulled by hand (popped's exits are the re-seat and the grace)`,
      );
    },

    pop(cordId, index, reason = 'over-stretch') {
      const record = cords.get(cordId);
      if (record === undefined) {
        return reject(cordId, 'pop', 'unknown cord');
      }
      if (record.state === 'popped' && record.poppedEnd === index) {
        // One-shot intent idempotence: the driver replays this frame's input
        // across its substeps and the pop already fired — a silent no-op.
        return false;
      }
      if (record.state !== 'linked') {
        return reject(
          cordId,
          'pop',
          `pop is the linked → popped transition, but the cord is ${record.state}`,
        );
      }
      if (modeOf(record, index) !== 'seated') {
        return reject(cordId, 'pop', `end ${index} holds no seat to pop`);
      }
      record.state = 'popped';
      record.ends.set(index, 'free'); // the far jack dangles
      record.poppedEnd = index;
      record.graceRemaining = graceSeconds; // approved #4: the window opens
      emit(cordId, 'linked', 'popped', reason, index);
      return true;
    },

    releaseCarriedJack(cordId, index) {
      const record = cords.get(cordId);
      if (record === undefined) {
        return reject(cordId, 'release-off-cube', 'unknown cord');
      }
      if (!Number.isFinite(index)) {
        return reject(cordId, 'release-off-cube', `end index must be finite, got ${index}`);
      }
      const mode = modeOf(record, index);
      switch (record.state) {
        case 'carried':
          // The ordinary floor drop (defined non-transition): nothing was
          // plugged, so nothing failed. IDEMPOTENT across the driver's
          // same-input substep replays: an already-free end was released on
          // an earlier substep — still a no-op, still silent.
          if (mode === 'carrying') {
            record.ends.set(index, 'free');
            return false;
          }
          if (mode === 'free') return false;
          return reject(cordId, 'release-off-cube', `end ${index} is ${mode}, not in hand`);
        case 'awaiting-plug':
        case 'popped':
          if (mode !== 'carrying') {
            return reject(
              cordId,
              'release-off-cube',
              `end ${index} is ${mode}, not in hand (release names the held jack)`,
            );
          }
          record.ends.set(index, 'free');
          toVanishing(record, cordId, index);
          return true;
        case 'linked':
          return reject(cordId, 'release-off-cube', 'nothing is carried while linked');
        case 'vanishing':
          // The cord's fate is already sealed; a re-arriving release (the
          // driver's substep replay, or a grace expiry that beat the pointer
          // to it) is a silent no-op, not a failure worth warning about.
          return false;
        case 'gone':
          return reject(cordId, 'release-off-cube', 'unknown cord');
      }
    },

    noteCarrying(cordId, index) {
      const record = cords.get(cordId);
      if (record === undefined || record.state === 'vanishing' || record.state === 'gone') {
        return; // advisory bookkeeping freezes once locked/gone
      }
      if (modeOf(record, index) === 'seated') {
        return; // a seated end cannot be carried (the world filters this)
      }
      record.ends.set(index, 'carrying');
    },

    advance(dt) {
      if (!(dt > 0) || !Number.isFinite(dt)) return; // clock garbage: no-op
      clock += dt;
      // Map iteration is insertion-ordered; advance never inserts/deletes.
      for (const [cordId, record] of cords) {
        if (record.state !== 'popped') continue;
        record.graceRemaining -= dt;
        if (record.graceRemaining <= 0) {
          // Approved #6: the window closed without a re-seat.
          record.state = 'vanishing';
          emit(cordId, 'popped', 'vanishing', 'grace-expired', record.poppedEnd);
        }
      }
    },

    completeVanish(cordId) {
      const record = cords.get(cordId);
      if (record === undefined) {
        // One-shot intent idempotence: a despawn replay after this frame's
        // earlier substep already removed the cord is a silent no-op; an id
        // the machine NEVER knew is still a loud unknown-cord rejection.
        if (goneIds.has(cordId)) return false;
        return reject(cordId, 'complete-vanish', 'unknown cord');
      }
      if (record.state !== 'vanishing') {
        return reject(
          cordId,
          'complete-vanish',
          `completion is only accepted while vanishing, not ${record.state}`,
        );
      }
      cords.delete(cordId); // gone: removed from the registry…
      goneIds.add(cordId); // …and tombstoned until the id is registered again
      emit(cordId, 'vanishing', 'gone', 'vanish-complete', null);
      return true;
    },

    stateOf(cordId) {
      return cords.get(cordId)?.state;
    },

    endMode(cordId, index) {
      const record = cords.get(cordId);
      if (record === undefined) return undefined;
      return modeOf(record, index);
    },

    graceRemaining(cordId) {
      const record = cords.get(cordId);
      if (record === undefined || record.state !== 'popped') return null;
      return record.graceRemaining;
    },

    now() {
      return clock;
    },
  };
}

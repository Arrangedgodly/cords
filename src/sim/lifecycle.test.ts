import { describe, expect, it } from 'vitest';
import { createCordLifecycle, DEFAULT_GRACE_SECONDS } from './lifecycle';
import type {
  CordLifecycle,
  LifecycleRejection,
  LifecycleState,
  LifecycleTransition,
} from './lifecycle';

/**
 * T-LIFE-1 — the cord lifecycle FSM, machine level (plan.md LIFE-1: "only
 * approved transitions legal; plug/unplug events emitted"; accept: exhaustive
 * transition-table unit tests; illegal transitions rejected).
 *
 * Pinned here:
 * - THE APPROVED TABLE (town-hall, restated in plan.md, + the coordinator
 *   amendment): carried → awaiting-plug (first seat); awaiting-plug →
 *   linked (second seat); awaiting-plug → vanishing (carried jack released
 *   off-cube); linked → popped (over-stretch); popped → linked (re-seat
 *   cancels the grace); popped → vanishing (grace expiry); linked →
 *   awaiting-plug + awaiting-plug → carried (the hand-pulled plug — INT-4's
 *   verified seated re-grab stands); vanishing → gone (completion).
 * - THE EXHAUSTIVE TABLE: every (state × action) cell — legal cells land in
 *   the named state, every other cell is rejected. Rejected twice over: in
 *   production mode the state is untouched + a rejection warning is emitted;
 *   in strict mode (tests) the same cells THROW.
 * - THE TWO UN-PULLABLE SEATS (amendment's edges, explicit): POPPED's
 *   surviving socket (its exits are the re-seat and the grace — the
 *   over-stretch pop must not be dodgeable by grabbing the socket that
 *   still holds) and anything while VANISHING (the lock; LIFE-2's seam is
 *   the only pull, mode-only).
 * - THE COMPOSED REMOVAL PATH: hand-unseat (linked → awaiting-plug, the
 *   other seat holding) then release the held jack off-cube → vanishing —
 *   manual unplug + release is an approved removal.
 * - THE DEFINED NON-TRANSITIONS: releasing a carried cord's held end
 *   off-cube is the ordinary floor drop (the cord survives, fuzz-pinned
 *   behavior); seat transports and noteCarrying never transition.
 * - GRACE: fires at ~3s of SIM time (configurable) and NOT before; a re-seat
 *   cancels it; clock garbage (NaN/≤0) never moves it.
 * - EVENTS: emitted in order, with from/to/reason/end and the machine clock.
 * - DETERMINISM + MULTI-CORD ISOLATION: identical call sequences produce
 *   identical event streams; per-cord records (grace included) never leak.
 */

const CORD = 7;
const END = 8; // the far end (a rope's segmentCount in the world tests)

type StateName = 'carried' | 'awaiting-plug' | 'linked' | 'popped' | 'vanishing' | 'gone';
type ActionName =
  | 'register'
  | 'seat0'
  | 'seat8'
  | 'pop0'
  | 'pop8'
  | 'unseat0'
  | 'unseat8'
  | 'rel0'
  | 'rel8'
  | 'complete';

const REJECTION_ACTION: Record<ActionName, LifecycleRejection['action']> = {
  register: 'register',
  seat0: 'seat',
  seat8: 'seat',
  pop0: 'pop',
  pop8: 'pop',
  unseat0: 'unseat',
  unseat8: 'unseat',
  rel0: 'release-off-cube',
  rel8: 'release-off-cube',
  complete: 'complete-vanish',
};

/** A fresh machine with cord CORD built up to the named state. */
function build(state: StateName, strict = false): {
  machine: CordLifecycle;
  transitions: LifecycleTransition[];
  rejections: LifecycleRejection[];
} {
  const transitions: LifecycleTransition[] = [];
  const rejections: LifecycleRejection[] = [];
  const machine = createCordLifecycle({
    strict,
    onTransition: (event) => transitions.push(event),
    onRejected: (rejection) => rejections.push(rejection),
  });
  if (state === 'vanishing' || state === 'gone') {
    // awaiting-plug (end 0 seated by the seat path) → carry the free end →
    // release it off-cube: the approved user-initiated failure.
    machine.register(CORD);
    machine.noteCarrying(CORD, 0);
    machine.seat(CORD, 0);
    machine.noteCarrying(CORD, END);
    machine.releaseCarriedJack(CORD, END);
    if (state === 'gone') machine.completeVanish(CORD);
  } else {
    machine.register(CORD); // carried
    if (state !== 'carried') {
      machine.noteCarrying(CORD, 0);
      machine.seat(CORD, 0); // awaiting-plug (end 0 seated)
      if (state !== 'awaiting-plug') {
        machine.seat(CORD, END); // linked
        if (state === 'popped') machine.pop(CORD, 0); // popped (end 0 dangling)
      }
    }
  }
  transitions.length = 0; // the builders' own events are not under test here
  rejections.length = 0;
  return { machine, transitions, rejections };
}

/** Fires ONE action on the machine. */
function fire(machine: CordLifecycle, action: ActionName): boolean {
  switch (action) {
    case 'register':
      return machine.register(CORD);
    case 'seat0':
      return machine.seat(CORD, 0);
    case 'seat8':
      return machine.seat(CORD, END);
    case 'pop0':
      return machine.pop(CORD, 0);
    case 'pop8':
      return machine.pop(CORD, END);
    case 'unseat0':
      return machine.unseat(CORD, 0);
    case 'unseat8':
      return machine.unseat(CORD, END);
    case 'rel0':
      return machine.releaseCarriedJack(CORD, 0);
    case 'rel8':
      return machine.releaseCarriedJack(CORD, END);
    case 'complete':
      return machine.completeVanish(CORD);
  }
}

/**
 * THE EXHAUSTIVE TABLE — one cell per (state, action). `to` is the expected
 * state after an applied action (applied actions that are NOT transitions —
 * the carried floor drop, the vanishing pull-out — carry the current state).
 */
const TABLE: Array<{ state: StateName; action: ActionName; applied: boolean; to?: LifecycleState }> = [
  // --- carried: the only exit is the first seat (#1) ---
  { state: 'carried', action: 'seat0', applied: true, to: 'awaiting-plug' },
  { state: 'carried', action: 'seat8', applied: true, to: 'awaiting-plug' },
  { state: 'carried', action: 'pop0', applied: false },
  { state: 'carried', action: 'pop8', applied: false },
  { state: 'carried', action: 'unseat0', applied: false },
  { state: 'carried', action: 'unseat8', applied: false },
  // the carried floor drop: a defined NON-transition, not a rejection
  { state: 'carried', action: 'rel0', applied: false },
  { state: 'carried', action: 'rel8', applied: false },
  { state: 'carried', action: 'complete', applied: false },
  { state: 'carried', action: 'register', applied: false },

  // --- awaiting-plug: the second seat (#2), the off-cube release (#3), or
  //     the hand-pulled plug (#8 — grab the remaining seat → carried). The
  //     release needs the end IN HAND, so the plain builder (free end)
  //     rejects both release cells; the carrying case has dedicated tests ---
  { state: 'awaiting-plug', action: 'seat0', applied: false },
  { state: 'awaiting-plug', action: 'seat8', applied: true, to: 'linked' },
  { state: 'awaiting-plug', action: 'pop0', applied: false },
  { state: 'awaiting-plug', action: 'pop8', applied: false },
  { state: 'awaiting-plug', action: 'unseat0', applied: true, to: 'carried' }, // #8 (end 0 is the seated one)
  { state: 'awaiting-plug', action: 'unseat8', applied: false }, // the free end holds no seat
  { state: 'awaiting-plug', action: 'rel0', applied: false }, // seated end: never released by hand
  { state: 'awaiting-plug', action: 'rel8', applied: false }, // free end: not in hand
  { state: 'awaiting-plug', action: 'complete', applied: false },
  { state: 'awaiting-plug', action: 'register', applied: false },

  // --- linked: the pop (#4) or the hand-pulled plug (#7 — grab either
  //     seated end → awaiting-plug, the other seat holds) ---
  { state: 'linked', action: 'seat0', applied: false },
  { state: 'linked', action: 'seat8', applied: false },
  { state: 'linked', action: 'pop0', applied: true, to: 'popped' },
  { state: 'linked', action: 'pop8', applied: true, to: 'popped' },
  { state: 'linked', action: 'unseat0', applied: true, to: 'awaiting-plug' }, // #7
  { state: 'linked', action: 'unseat8', applied: true, to: 'awaiting-plug' }, // #7
  { state: 'linked', action: 'rel0', applied: false },
  { state: 'linked', action: 'rel8', applied: false },
  { state: 'linked', action: 'complete', applied: false },
  { state: 'linked', action: 'register', applied: false },

  // --- popped: re-seat (#5), grace expiry (#6), or drop the held end
  //     off-cube (→ vanishing, the documented second trigger). The SURVIVING
  //     SOCKET is not hand-pullable — popped's exits are the re-seat and
  //     the grace (the over-stretch pop must not be dodgeable by hand) ---
  { state: 'popped', action: 'seat0', applied: true, to: 'linked' }, // re-seat the popped end
  { state: 'popped', action: 'seat8', applied: false }, // the seated end: transport, not a seat
  { state: 'popped', action: 'pop0', applied: false }, // silent: pop replay of the popped end
  { state: 'popped', action: 'pop8', applied: false },
  { state: 'popped', action: 'unseat0', applied: false }, // the popped end holds no seat
  { state: 'popped', action: 'unseat8', applied: false }, // the surviving socket: not hand-pullable
  { state: 'popped', action: 'rel0', applied: false }, // dangling end, not in hand
  { state: 'popped', action: 'rel8', applied: false }, // seated end
  { state: 'popped', action: 'complete', applied: false },
  { state: 'popped', action: 'register', applied: false },

  // --- vanishing: the FSM is LOCKED except the completion (+ the LIFE-2
  //     pull-out unseat, a mode change that is not a transition). Release
  //     intents are SILENT here (the fate is sealed; replays/late arrivals
  //     are noise, not warnings) ---
  { state: 'vanishing', action: 'seat0', applied: false },
  { state: 'vanishing', action: 'seat8', applied: false },
  { state: 'vanishing', action: 'pop0', applied: false },
  { state: 'vanishing', action: 'pop8', applied: false },
  { state: 'vanishing', action: 'unseat0', applied: true, to: 'vanishing' }, // LIFE-2 pull-out
  { state: 'vanishing', action: 'unseat8', applied: false }, // no seat at the free end
  { state: 'vanishing', action: 'rel0', applied: false }, // silent: already vanishing
  { state: 'vanishing', action: 'rel8', applied: false }, // silent: already vanishing
  { state: 'vanishing', action: 'complete', applied: true, to: 'gone' },
  { state: 'vanishing', action: 'register', applied: false },

  // --- gone: nothing is legal; re-registering the freed id is (a new cord).
  //     A completion replay is SILENT (the despawn tombstone) ---
  { state: 'gone', action: 'seat0', applied: false },
  { state: 'gone', action: 'seat8', applied: false },
  { state: 'gone', action: 'pop0', applied: false },
  { state: 'gone', action: 'pop8', applied: false },
  { state: 'gone', action: 'unseat0', applied: false },
  { state: 'gone', action: 'unseat8', applied: false },
  { state: 'gone', action: 'rel0', applied: false },
  { state: 'gone', action: 'rel8', applied: false },
  { state: 'gone', action: 'complete', applied: false }, // silent replay (tombstoned)
  { state: 'gone', action: 'register', applied: true, to: 'carried' },
];

/** Cells that are no-ops WITHOUT a rejection warning (defined
 *  non-transitions and one-shot-intent replays — see the machine docs). */
const SILENT_CELLS = new Set<string>(
  TABLE.filter(
    (c) =>
      // the carried floor drop (an ordinary release, idempotent)
      (c.state === 'carried' && (c.action === 'rel0' || c.action === 'rel8')) ||
      // release intents on a vanishing cord (fate sealed; replays are noise)
      (c.state === 'vanishing' && (c.action === 'rel0' || c.action === 'rel8')) ||
      // a completion replay after the despawn tombstone
      (c.state === 'gone' && c.action === 'complete') ||
      // a pop replay of the end this frame already popped
      (c.state === 'popped' && c.action === 'pop0'),
  ).map((c) => `${c.state}|${c.action}`),
);

describe('T-LIFE-1 — lifecycle FSM: the exhaustive transition table', () => {
  it('every legal transition fires and lands in the right state; every illegal one is rejected with a warning (production mode)', () => {
    for (const cell of TABLE) {
      const { machine, transitions, rejections } = build(cell.state);
      const before = machine.stateOf(CORD);
      const applied = fire(machine, cell.action);
      expect(applied, `${cell.state} × ${cell.action}: applied`).toBe(cell.applied);
      // 'gone' removes the record — the queryable state becomes undefined.
      const expected: LifecycleState | undefined =
        cell.applied && cell.to === 'gone' ? undefined : cell.applied ? cell.to ?? before : before;
      expect(machine.stateOf(CORD), `${cell.state} × ${cell.action}: final state`).toBe(expected);
      if (cell.applied) {
        expect(rejections, `${cell.state} × ${cell.action}: no rejection`).toHaveLength(0);
        if (cell.to !== undefined && cell.to !== cell.state && cell.action !== 'register') {
          // register is not a transition — it emits no event.
          expect(transitions, `${cell.state} × ${cell.action}: one transition`).toHaveLength(1);
          expect(transitions[0]?.from).toBe(cell.state);
          expect(transitions[0]?.to).toBe(cell.to);
        }
      } else if (SILENT_CELLS.has(`${cell.state}|${cell.action}`)) {
        // Defined non-transitions and one-shot-intent replays: silent no-ops,
        // no rejection warning (the driver's substep replay must never be an
        // error), and nothing transitioned.
        expect(rejections, `${cell.state} × ${cell.action}: silent no-op`).toHaveLength(0);
        expect(machine.stateOf(CORD)).toBe(before);
      } else {
        expect(rejections, `${cell.state} × ${cell.action}: one rejection`).toHaveLength(1);
        expect(rejections[0]?.action).toBe(REJECTION_ACTION[cell.action]);
        expect(rejections[0]?.from).toBe(cell.state);
      }
    }
  });

  it('the defined NON-transition: a carried cord\u2019s HELD end released off-cube is the ordinary floor drop', () => {
    const runs = [build('carried'), build('carried', true)]; // production + strict agree
    for (const { machine, transitions, rejections } of runs) {
      machine.noteCarrying(CORD, 0); // the red end is in hand
      const applied = machine.releaseCarriedJack(CORD, 0);
      expect(applied).toBe(false); // nothing transitioned…
      expect(machine.stateOf(CORD)).toBe('carried'); // …the cord survives (re-grabbable, seatable)
      expect(machine.endMode(CORD, 0)).toBe('free'); // …the end left the hand
      expect(transitions).toHaveLength(0);
      expect(rejections).toHaveLength(0); // not a rejection either — the approved spawn/drop churn
    }
  });

  it('the same cells THROW in strict mode (tests are loud); legal cells do not', () => {
    for (const cell of TABLE) {
      const { machine } = build(cell.state, true);
      const run = (): void => {
        fire(machine, cell.action);
      };
      if (cell.applied) {
        expect(run, `${cell.state} × ${cell.action}: legal in strict too`).not.toThrow();
      } else if (SILENT_CELLS.has(`${cell.state}|${cell.action}`)) {
        expect(run, `${cell.state} × ${cell.action}: silent cells are silent in strict too`).not.toThrow();
      } else {
        expect(run, `${cell.state} × ${cell.action}: strict is loud`).toThrow(/illegal/);
      }
    }
  });

  it('the APPROVED transitions, end to end, emit the plug/unplug events in order', () => {
    const { machine, transitions } = build('carried');
    machine.noteCarrying(CORD, 0);
    machine.advance(0.5); // some sim time passes between beats
    machine.seat(CORD, 0); // #1
    machine.advance(0.25);
    machine.seat(CORD, END); // #2
    machine.advance(0.25);
    machine.noteCarrying(CORD, 0);
    machine.unseat(CORD, 0); // #7 — the hand-pulled plug (the other seat holds)
    machine.advance(0.25);
    machine.seat(CORD, 0); // #2 again (re-plug)
    machine.advance(0.25);
    machine.unseat(CORD, 0); // #7 again
    machine.advance(0.25);
    machine.unseat(CORD, END); // #8 — the remaining seat pulled: nothing seated
    machine.advance(0.25);
    machine.seat(CORD, 0); // #1 again (a fully-pulled cord re-plugs anywhere)
    machine.advance(0.25);
    machine.seat(CORD, END); // #2 — linked again
    machine.advance(0.25);
    machine.pop(CORD, END, 'over-stretch'); // #4
    machine.advance(1);
    machine.seat(CORD, END); // #5 (re-seat cancels the grace)
    machine.advance(0.5);
    machine.pop(CORD, 0); // #4 again, the other end
    // #6: burn the remaining grace in 1/60 s slices (181 frames > 3s, so the
    // crossing is guaranteed regardless of float accumulation).
    for (let i = 0; i < 181; i += 1) machine.advance(1 / 60);
    const atExpiry = machine.now();
    machine.completeVanish(CORD); // the completion (vanishing → gone)
    expect(transitions.map((t) => `${t.from}->${t.to}:${t.reason}@${t.end}`).join(' ')).toBe(
      [
        'carried->awaiting-plug:seated@0',
        'awaiting-plug->linked:second-seated@8',
        'linked->awaiting-plug:unplugged@0',
        'awaiting-plug->linked:second-seated@0',
        'linked->awaiting-plug:unplugged@0',
        'awaiting-plug->carried:unplugged@8',
        'carried->awaiting-plug:seated@0',
        'awaiting-plug->linked:second-seated@8',
        'linked->popped:over-stretch@8',
        'popped->linked:re-seated@8',
        'linked->popped:over-stretch@0',
        'popped->vanishing:grace-expired@0',
        'vanishing->gone:vanish-complete@null',
      ].join(' '),
    );
    expect(transitions[transitions.length - 1]?.time).toBe(atExpiry);
  });
});

describe('T-LIFE-1 — the release routing (machine level)', () => {
  it('awaiting-plug + the held end released off-cube → vanishing (#3), the end leaves the hand', () => {
    const { machine, transitions } = build('awaiting-plug');
    machine.noteCarrying(CORD, END); // the free end is grabbed (blue in hand)
    const applied = machine.releaseCarriedJack(CORD, END);
    expect(applied).toBe(true);
    expect(machine.stateOf(CORD)).toBe('vanishing');
    expect(machine.endMode(CORD, END)).toBe('free');
    const event = transitions[transitions.length - 1];
    expect(event).toMatchObject({
      cordId: CORD,
      from: 'awaiting-plug',
      to: 'vanishing',
      reason: 'released-off-cube',
      end: END,
    });
  });

  it('popped + the held dangling end released off-cube → vanishing (the documented second trigger)', () => {
    const { machine, transitions } = build('popped');
    machine.noteCarrying(CORD, 0); // the freed end was grabbed inside the window
    const applied = machine.releaseCarriedJack(CORD, 0);
    expect(applied).toBe(true);
    expect(machine.stateOf(CORD)).toBe('vanishing');
    expect(transitions[transitions.length - 1]).toMatchObject({
      from: 'popped',
      to: 'vanishing',
      reason: 'released-off-cube',
      end: 0,
    });
  });

  it('AMENDMENT #7: grab one seated end of a LINKED cord → awaiting-plug; the OTHER end stays seated', () => {
    const { machine, transitions, rejections } = build('linked');
    const applied = machine.unseat(CORD, 0); // the red plug is pulled by hand
    expect(applied).toBe(true);
    expect(machine.stateOf(CORD)).toBe('awaiting-plug');
    expect(machine.endMode(CORD, 0)).toBe('free'); // the pulled jack (carrying follows via noteCarrying)
    expect(machine.endMode(CORD, END)).toBe('seated'); // the other seat still holds
    expect(rejections).toHaveLength(0);
    expect(transitions[transitions.length - 1]).toMatchObject({
      cordId: CORD,
      from: 'linked',
      to: 'awaiting-plug',
      reason: 'unplugged',
      end: 0,
    });
    // Symmetric: pulling the OTHER end is the same transition, tagged for it.
    const mirror = build('linked');
    mirror.machine.unseat(CORD, END);
    expect(mirror.machine.endMode(CORD, 0)).toBe('seated');
    expect(transitionsLike(mirror, 'unplugged', END)).toBe(true);
  });

  it('AMENDMENT #8: grab the REMAINING seated end (awaiting-plug) → carried; both ends free', () => {
    const { machine, transitions } = build('awaiting-plug'); // end 0 seated
    const applied = machine.unseat(CORD, 0);
    expect(applied).toBe(true);
    expect(machine.stateOf(CORD)).toBe('carried'); // nothing seated anymore
    expect(machine.endMode(CORD, 0)).toBe('free');
    expect(machine.endMode(CORD, END)).toBe('free');
    expect(transitions[transitions.length - 1]).toMatchObject({
      from: 'awaiting-plug',
      to: 'carried',
      reason: 'unplugged',
      end: 0,
    });
    // The fully-pulled cord re-plugs anywhere: carried → awaiting-plug again.
    expect(machine.seat(CORD, END)).toBe(true);
    expect(machine.stateOf(CORD)).toBe('awaiting-plug');
  });

  it('AMENDMENT — the COMPOSED REMOVAL PATH: hand-unseat then release the held jack off-cube → vanishing', () => {
    const { machine, transitions } = build('linked');
    machine.unseat(CORD, 0); // #7: the pulled plug, other seat holding
    machine.noteCarrying(CORD, 0); // the carry intent books the hand
    const applied = machine.releaseCarriedJack(CORD, 0); // released NOT over a cube
    expect(applied).toBe(true);
    expect(machine.stateOf(CORD)).toBe('vanishing'); // #3 on the unseated cord
    const events = transitions.map((t) => `${t.from}->${t.to}:${t.reason}@${t.end}`);
    expect(events.slice(-2)).toEqual([
      'linked->awaiting-plug:unplugged@0',
      'awaiting-plug->vanishing:released-off-cube@0',
    ]);
    expect(machine.endMode(CORD, END)).toBe('seated'); // the seated plug survives to LIFE-2's pull-out
  });

  it('the two UN-PULLABLE seats: popped\u2019s surviving socket rejects; the vanishing pull-out stays seam-only', () => {
    // POPPED's surviving socket: its exits are the re-seat and the grace —
    // the over-stretch pop must not be dodgeable by grabbing it.
    const popped = build('popped'); // end 0 popped (free), end 8 the socket
    expect(popped.machine.unseat(CORD, 8)).toBe(false);
    expect(popped.machine.stateOf(CORD)).toBe('popped');
    expect(popped.machine.endMode(CORD, 8)).toBe('seated');
    expect(popped.rejections[0]?.action).toBe('unseat');

    // VANISHING: the pull-out is legal as LIFE-2's seam ONLY — mode
    // bookkeeping, never a transition; the lock holds until completion.
    const vanishing = build('vanishing'); // end 0 seated, end 8 free
    expect(vanishing.machine.unseat(CORD, 0)).toBe(true);
    expect(vanishing.machine.stateOf(CORD)).toBe('vanishing');
    expect(vanishing.machine.endMode(CORD, 0)).toBe('free');
    expect(vanishing.transitions).toHaveLength(0);
    expect(vanishing.machine.completeVanish(CORD)).toBe(true);
  });
});

/** Tiny helper: did a transition with this reason+end fire? */
function transitionsLike(
  harness: { transitions: LifecycleTransition[] },
  reason: string,
  end: number,
): boolean {
  return harness.transitions.some((t) => t.reason === reason && t.end === end);
}

describe('T-LIFE-1 — the grace timer (sim time, ~3s, cancellable)', () => {
  it('fires at ~3s of sim time and NOT before; the default is DEFAULT_GRACE_SECONDS', () => {
    const { machine } = build('linked');
    machine.pop(CORD, 0);
    expect(machine.graceRemaining(CORD)).toBe(DEFAULT_GRACE_SECONDS);
    let simTime = 0;
    while (simTime < 2.9) {
      machine.advance(1 / 120);
      simTime += 1 / 120;
      expect(machine.stateOf(CORD)).toBe('popped'); // not before
    }
    // 2.9s in: still popped with ~0.1s left.
    expect(machine.stateOf(CORD)).toBe('popped');
    expect(machine.graceRemaining(CORD)).toBeGreaterThan(0);
    expect(machine.graceRemaining(CORD)).toBeLessThan(0.101);
    while (simTime < 3.0001) {
      machine.advance(1 / 120);
      simTime += 1 / 120;
    }
    expect(machine.stateOf(CORD)).toBe('vanishing'); // expired on the crossing step
    expect(machine.graceRemaining(CORD)).toBeNull();
  });

  it('a re-seat before expiry cancels the grace — the cord stays linked forever', () => {
    const { machine, transitions } = build('linked');
    machine.pop(CORD, 0);
    // 170 × 1/60 = 2.83s of sim time — inside the window, close to its edge.
    for (let i = 0; i < 170; i += 1) machine.advance(1 / 60);
    expect(machine.stateOf(CORD)).toBe('popped');
    expect(machine.graceRemaining(CORD)).toBeGreaterThan(0);
    machine.seat(CORD, 0); // #5: the re-seat
    expect(machine.stateOf(CORD)).toBe('linked');
    expect(machine.graceRemaining(CORD)).toBeNull();
    for (let i = 0; i < 1200; i += 1) machine.advance(1 / 60); // 20 more seconds
    expect(machine.stateOf(CORD)).toBe('linked'); // never vanishes
    expect(transitions.some((t) => t.reason === 'grace-expired')).toBe(false);
  });

  it('a configurable window is honored (graceSeconds 0.5)', () => {
    const transitions: LifecycleTransition[] = [];
    const machine = createCordLifecycle({
      graceSeconds: 0.5,
      onTransition: (t) => transitions.push(t),
    });
    machine.register(CORD);
    machine.seat(CORD, 0);
    machine.seat(CORD, END);
    machine.pop(CORD, 0);
    machine.advance(0.4);
    expect(machine.stateOf(CORD)).toBe('popped');
    machine.advance(0.1);
    expect(machine.stateOf(CORD)).toBe('vanishing');
    const expiry = transitions.find((t) => t.reason === 'grace-expired');
    expect(expiry?.time).toBeCloseTo(0.5, 12);
  });

  it('clock garbage never moves the clock or the grace window', () => {
    const { machine } = build('linked');
    machine.pop(CORD, 0);
    const t0 = machine.now();
    machine.advance(Number.NaN);
    machine.advance(0);
    machine.advance(-1);
    machine.advance(Number.POSITIVE_INFINITY);
    expect(machine.now()).toBe(t0);
    expect(machine.stateOf(CORD)).toBe('popped');
    expect(machine.graceRemaining(CORD)).toBe(DEFAULT_GRACE_SECONDS);
  });

  it('pop reasons are caller-owned and ride the event', () => {
    const { machine, transitions } = build('linked');
    machine.pop(CORD, 8, 'sustained-over-pull');
    expect(transitions[0]?.reason).toBe('sustained-over-pull');
    expect(transitions[0]?.end).toBe(8);
  });
});

describe('T-LIFE-1 — determinism + multi-cord isolation', () => {
  const SCRIPT = (machine: CordLifecycle): void => {
    machine.register(1);
    machine.register(2, { seatedEnd: 0 }); // an anchor-style cord
    machine.noteCarrying(1, 0);
    machine.advance(1 / 120);
    machine.seat(1, 0);
    machine.advance(1 / 120);
    machine.seat(1, 16);
    machine.advance(1 / 120);
    machine.pop(1, 0);
    machine.advance(1 / 120);
    machine.seat(1, 0); // re-seat cancels
    machine.advance(1 / 120);
    machine.pop(1, 16);
    for (let i = 0; i < 200; i += 1) machine.advance(1 / 60); // past the grace
    machine.completeVanish(1);
    machine.register(1); // the freed id is reusable
  };

  it('identical call sequences produce identical event streams (bitwise)', () => {
    const run = (): string[] => {
      const events: string[] = [];
      const machine = createCordLifecycle({
        onTransition: (t) => events.push(JSON.stringify(t)),
        onRejected: (r) => events.push(JSON.stringify(r)),
      });
      SCRIPT(machine);
      return events;
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(5);
  });

  it('per-cord grace clocks are independent; one cord vanishing leaves another linked bitwise-in-state', () => {
    const transitions: LifecycleTransition[] = [];
    const machine = createCordLifecycle({ onTransition: (t) => transitions.push(t) });
    machine.register(1);
    machine.register(2);
    machine.seat(1, 0);
    machine.seat(1, 8);
    machine.seat(2, 0);
    machine.seat(2, 8);
    machine.pop(1, 0);
    machine.pop(2, 0);
    machine.advance(1);
    expect(machine.graceRemaining(1)).toBeCloseTo(2, 12);
    expect(machine.graceRemaining(2)).toBeCloseTo(2, 12);
    machine.seat(1, 0); // cord 1 re-seats; cord 2's window keeps burning
    for (let i = 0; i < 250; i += 1) machine.advance(1 / 60); // > 4s
    expect(machine.stateOf(1)).toBe('linked'); // cancelled forever
    expect(machine.stateOf(2)).toBe('vanishing'); // expired on its own clock
    // cord 1's re-seat and cord 2's expiry both landed, tagged correctly.
    expect(transitions.some((t) => t.cordId === 1 && t.to === 'linked' && t.reason === 're-seated')).toBe(true);
    expect(transitions.some((t) => t.cordId === 2 && t.to === 'vanishing' && t.reason === 'grace-expired')).toBe(true);
    expect(machine.endMode(1, 0)).toBe('seated');
    // the POP of cord 2's end 0 freed exactly that end; its other seat survives
    expect(machine.endMode(2, 0)).toBe('free');
    expect(machine.endMode(2, 8)).toBe('seated');
  });

  it('noteCarrying is advisory bookkeeping — it never transitions anything', () => {
    const { machine, transitions } = build('awaiting-plug');
    machine.noteCarrying(CORD, END); // the free end is grabbed
    expect(machine.endMode(CORD, END)).toBe('carrying');
    expect(machine.stateOf(CORD)).toBe('awaiting-plug');
    expect(transitions).toHaveLength(0);
    machine.noteCarrying(CORD, 0); // a seated end cannot be carried
    expect(machine.endMode(CORD, 0)).toBe('seated');
  });

  it('query totality: unknown cords read as undefined state / null grace / undefined mode', () => {
    const machine = createCordLifecycle();
    expect(machine.stateOf(99)).toBeUndefined();
    expect(machine.endMode(99, 0)).toBeUndefined();
    expect(machine.graceRemaining(99)).toBeNull();
    machine.register(99);
    expect(machine.stateOf(99)).toBe('carried');
    expect(machine.endMode(99, 0)).toBe('free'); // an unmarked end reads free
    expect(machine.graceRemaining(99)).toBeNull();
  });

  it('a bad config fails fast at construction (programmer error)', () => {
    expect(() => createCordLifecycle({ graceSeconds: Number.NaN })).toThrow(/graceSeconds/);
    expect(() => createCordLifecycle({ graceSeconds: -1 })).toThrow(/graceSeconds/);
  });
});

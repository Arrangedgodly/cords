/**
 * T-REN-3 — HUD tests (Professor X + Daredevil, REN lane).
 *
 * Two layers, the repo's direct-function approach (node, no jsdom):
 *
 * 1. THE MODEL THROUGH THE REAL WORLD — every count the faceplate shows is
 *    driven through the production seams (createCordWorldStep + the
 *    fixed-timestep driver, spawn/seat/pop/release/despawn intents): spawn,
 *    seat → linked, pop, grace expiry → vanishing, despawn, and the RESET
 *    construction (a fresh no-anchor world) reading all zeros.
 * 2. THE PANEL against a ~60-line structural stub of the DOM seam the
 *    module declares (HudElementLike/HudDocumentLike): structure, button
 *    wiring, meter painting, the update gate, the aria-live summary.
 */
import { describe, expect, it } from 'vitest';
import { createCordWorldStep } from '../sim/cordWorld';
import { createFixedTimestepDriver } from '../sim/fixedTimestep';
import type { CordWorldStep } from '../sim/cordWorld';
import type { SimInput, SimState, Vec2 } from '../sim';
import { createHudPanel } from './panel';
import type { HudElementLike } from './panel';
import {
  HUD_SEGMENTS,
  createHudCounts,
  litSegments,
  putAwayNotice,
  readHudCounts,
  readHudCountsInto,
  sameHudCounts,
  sceneSummary,
  vanishNotice,
} from './model';

// --- Part 1 — the model through the real world --------------------------------

const DT = 1 / 120;
const FRAME = 1 / 60;
const SEGMENTS = 8;
const END = SEGMENTS;
const PIN: Vec2 = { x: 0, y: 1.6};
const A: Vec2 = { x: 0.9, y: 0.42};
const B: Vec2 = { x: 0.35, y: 0.42};

interface World {
  advance(frames: number, input: SimInput): SimState;
  step: CordWorldStep;
}

/** The production shape: anchor + spawn template, driver at 120 Hz. */
function makeWorld(withAnchor = true): World {
  const step = createCordWorldStep({
    ...(withAnchor ? { anchor: { pin: PIN, segmentCount: SEGMENTS, floorY: 0 } } : {}),
    cord: { segmentCount: SEGMENTS, floorY: 0 },
  });
  const driver = createFixedTimestepDriver(step, { timestep: DT, maxSubsteps: 2 });
  let state: SimState = { time: 0, cords: [] };
  return {
    step,
    advance(frames, input) {
      for (let f = 0; f < frames; f += 1) state = driver.advance(state, FRAME, input).state;
      return state;
    },
  };
}

/** The HUD's own read: the live cord list + each cord's lifecycle state. */
const countsOf = (world: World) =>
  readHudCounts(world.advance(0, { pointerPoint: null }).cords, world.step.lifecycle.stateOf);

describe('T-REN-3 — HUD counts through the world seams (the model)', () => {
  it('names the anchor-only scene: 1 cord, nothing linked', () => {
    const world = makeWorld();
    world.advance(10, { pointerPoint: null });
    expect(countsOf(world)).toEqual({ cords: 1, awaitingPlug: 1, linked: 0, popped: 0, vanishing: 0 });
    // The anchor's pin IS a seat (LIFE-1): the cord awaits its other plug,
    // and A11Y-1's summary says so instead of a bare "1 cord."
    expect(sceneSummary(countsOf(world)))
      .toBe('1 cord, 1 awaiting plug. Press N for a new cord, R to reset.');
  });

  it('counts spawns (carried cords are cords)', () => {
    const world = makeWorld();
    world.advance(1, { pointerPoint: null, spawnCord: { cordId: 1, at: { x: 0.5, y: 1} } });
    world.advance(1, { pointerPoint: null, spawnCord: { cordId: 2, at: { x: -0.5, y: 1} } });
    expect(countsOf(world)).toEqual({ cords: 3, awaitingPlug: 1, linked: 0, popped: 0, vanishing: 0 });
    expect(sceneSummary(countsOf(world)))
      .toBe('3 cords, 1 awaiting plug. Press N for a new cord, R to reset.');
  });

  it('counts LINKED on the second seat (the first seat stays awaiting-plug)', () => {
    const world = makeWorld();
    world.advance(1, { pointerPoint: null, spawnCord: { cordId: 1, at: { x: 0.5, y: 1} } });
    world.advance(3, { pointerPoint: null, seatTargets: [{ cordId: 1, index: 0, position: A }] });
    expect(world.step.lifecycle.stateOf(1)).toBe('awaiting-plug');
    expect(countsOf(world)).toEqual({ cords: 2, awaitingPlug: 2, linked: 0, popped: 0, vanishing: 0 });
    world.advance(3, { pointerPoint: null,
      seatTargets: [
        { cordId: 1, index: 0, position: A },
        { cordId: 1, index: END, position: B },
      ],
    });
    expect(world.step.lifecycle.stateOf(1)).toBe('linked');
    expect(countsOf(world)).toEqual({ cords: 2, awaitingPlug: 1, linked: 1, popped: 0, vanishing: 0 });
    expect(sceneSummary(countsOf(world)))
      .toBe('2 cords, 1 awaiting plug, 1 linked. Press N for a new cord, R to reset.');
  });

  it('counts POPPED and follows the grace expiry into VANISHING', () => {
    const world = makeWorld();
    world.advance(1, { pointerPoint: null, spawnCord: { cordId: 1, at: { x: 0.5, y: 1} } });
    world.advance(3, { pointerPoint: null,
      seatTargets: [
        { cordId: 1, index: 0, position: A },
        { cordId: 1, index: END, position: B },
      ],
    });
    world.advance(1, { pointerPoint: null, popCords: [{ cordId: 1, index: 0 }] });
    expect(countsOf(world)).toEqual({ cords: 2, awaitingPlug: 1, linked: 0, popped: 1, vanishing: 0 });
    expect(sceneSummary(countsOf(world)))
      .toBe('2 cords, 1 awaiting plug, 1 popped. Press N for a new cord, R to reset.');
    world.advance(400, { pointerPoint: null }); // ~3.33 s of sim time — past the ~3 s grace
    expect(countsOf(world)).toEqual({ cords: 2, awaitingPlug: 1, linked: 0, popped: 0, vanishing: 1 });
    expect(sceneSummary(countsOf(world)))
      .toBe('2 cords, 1 awaiting plug, 1 vanishing. Press N for a new cord, R to reset.');
  });

  it('drops the count when the despawn removes the cord (vanish completed)', () => {
    const world = makeWorld();
    world.advance(1, { pointerPoint: null, spawnCord: { cordId: 1, at: { x: 0.5, y: 1} } });
    world.advance(3, { pointerPoint: null, seatTargets: [{ cordId: 1, index: 0, position: A }] });
    // The held jack: a carry intent names the blue end (the grab), then the
    // user-initiated failure — released off-cube.
    world.advance(2, {
      pointerPoint: null,
      pinTargets: [{ cordId: 1, index: END, position: { x: 0.5, y: 0.9} }],
    });
    world.advance(1, { pointerPoint: null, releaseJack: { cordId: 1, index: END } });
    expect(countsOf(world)).toEqual({ cords: 2, awaitingPlug: 1, linked: 0, popped: 0, vanishing: 1 });
    world.advance(1, { pointerPoint: null, despawnCords: [{ cordId: 1 }] });
    expect(countsOf(world)).toEqual({ cords: 1, awaitingPlug: 1, linked: 0, popped: 0, vanishing: 0 });
    expect(sceneSummary(countsOf(world)))
      .toBe('1 cord, 1 awaiting plug. Press N for a new cord, R to reset.');
  });

  it('RESET reads the empty scene: a fresh no-anchor world is all zeros', () => {
    // main.ts's resetScene rebuilds the world WITHOUT the anchor — the
    // config's own spawn-only mode. The HUD's read of that world:
    const world = makeWorld(false);
    const counts = countsOf(world);
    expect(counts).toEqual({ cords: 0, awaitingPlug: 0, linked: 0, popped: 0, vanishing: 0 });
    expect(sceneSummary(counts)).toBe('No cords on the bench. Press N for a new cord.');
    // And the ids RESET reuses are legal there: id 0 is an ordinary spawn id
    // in a no-anchor world (the render layer revives view 0 on reuse).
    world.advance(1, { pointerPoint: null, spawnCord: { cordId: 0, at: { x: 0.2, y: 1} } });
    expect(countsOf(world)).toEqual({ cords: 1, awaitingPlug: 0, linked: 0, popped: 0, vanishing: 0 });
    expect(world.step.lifecycle.stateOf(0)).toBe('carried');
  });

  it('full reset cycle: a busy scene, then the no-anchor rebuild reads zero', () => {
    const busy = makeWorld();
    busy.advance(1, { pointerPoint: null, spawnCord: { cordId: 1, at: { x: 0.5, y: 1} } });
    busy.advance(3, { pointerPoint: null,
      seatTargets: [
        { cordId: 1, index: 0, position: A },
        { cordId: 1, index: END, position: B },
      ],
    });
    busy.advance(1, { pointerPoint: null, spawnCord: { cordId: 2, at: { x: -0.5, y: 1} } });
    expect(countsOf(busy)).toEqual({ cords: 3, awaitingPlug: 1, linked: 1, popped: 0, vanishing: 0 });
    const afterReset = countsOf(makeWorld(false));
    expect(afterReset).toEqual({ cords: 0, awaitingPlug: 0, linked: 0, popped: 0, vanishing: 0 });
  });

  it('readHudCountsInto reuses the shell (no fresh objects) and stays total over unknown ids', () => {
    const world = makeWorld();
    world.advance(1, { pointerPoint: null, spawnCord: { cordId: 1, at: { x: 0.5, y: 1} } });
    const shell = createHudCounts();
    const a = readHudCountsInto(world.advance(0, { pointerPoint: null }).cords, world.step.lifecycle.stateOf, shell);
    const b = readHudCountsInto(world.advance(0, { pointerPoint: null }).cords, world.step.lifecycle.stateOf, shell);
    expect(a).toBe(b); // same shell, mutated in place
    expect(a).toEqual({ cords: 2, awaitingPlug: 1, linked: 0, popped: 0, vanishing: 0 });
    // Totality: a stateOf that knows nothing still counts the cord on the bench.
    const mystery = readHudCounts([{ id: 42 }, { id: 43 }], () => undefined);
    expect(mystery).toEqual({ cords: 2, awaitingPlug: 0, linked: 0, popped: 0, vanishing: 0 });
  });
});

describe('T-REN-3 — the pure meter/summary primitives', () => {
  it('litSegments fills one segment per cord and PEGS past the row', () => {
    expect(litSegments(0)).toBe(0);
    expect(litSegments(1)).toBe(1);
    expect(litSegments(5)).toBe(5);
    expect(litSegments(HUD_SEGMENTS)).toBe(HUD_SEGMENTS);
    expect(litSegments(HUD_SEGMENTS + 4)).toBe(HUD_SEGMENTS); // pegged: the numeral carries the value
    expect(litSegments(4, 4)).toBe(4);
    expect(litSegments(9, 4)).toBe(4);
    // 2D-7 — the raised ceiling (48) pegs the 12-segment meter from 13 up;
    // the numeral is the tally (verified live in the drives at 13+, 20+, 40+).
    expect(litSegments(13)).toBe(12);
    expect(litSegments(20)).toBe(12);
    expect(litSegments(48)).toBe(12);
  });

  it('litSegments is total over garbage', () => {
    expect(litSegments(Number.NaN)).toBe(0);
    expect(litSegments(-3)).toBe(0);
    expect(litSegments(Number.POSITIVE_INFINITY)).toBe(0); // garbage lights nothing (the doc'd law)
  });

  it('sameHudCounts is structural equality (the update gate)', () => {
    const a = { cords: 3, awaitingPlug: 0, linked: 1, popped: 0, vanishing: 0 };
    expect(sameHudCounts(a, { cords: 3, awaitingPlug: 0, linked: 1, popped: 0, vanishing: 0 })).toBe(true);
    expect(sameHudCounts(a, { cords: 3, awaitingPlug: 0, linked: 2, popped: 0, vanishing: 0 })).toBe(false);
    expect(sameHudCounts(a, { cords: 2, awaitingPlug: 0, linked: 1, popped: 0, vanishing: 0 })).toBe(false);
    expect(sameHudCounts(a, { cords: 3, awaitingPlug: 0, linked: 1, popped: 1, vanishing: 0 })).toBe(false);
    expect(sameHudCounts(a, { cords: 3, awaitingPlug: 0, linked: 1, popped: 0, vanishing: 1 })).toBe(false);
    // A11Y-1 — the awaiting-plug count gates too: a first seat must repaint
    // the summary even though every METER-visible number is unchanged.
    expect(sameHudCounts(a, { cords: 3, awaitingPlug: 1, linked: 1, popped: 0, vanishing: 0 })).toBe(false);
  });

  it('sceneSummary names only non-zero states and pluralizes honestly', () => {
    expect(sceneSummary({ cords: 1, awaitingPlug: 0, linked: 0, popped: 0, vanishing: 0 }))
      .toBe('1 cord. Press N for a new cord, R to reset.');
    expect(sceneSummary({ cords: 3, awaitingPlug: 0, linked: 2, popped: 0, vanishing: 0 }))
      .toBe('3 cords, 2 linked. Press N for a new cord, R to reset.');
    expect(sceneSummary({ cords: 3, awaitingPlug: 0, linked: 2, popped: 1, vanishing: 0 }))
      .toBe('3 cords, 2 linked, 1 popped. Press N for a new cord, R to reset.');
    expect(sceneSummary({ cords: 3, awaitingPlug: 0, linked: 0, popped: 1, vanishing: 1 }))
      .toBe('3 cords, 1 popped, 1 vanishing. Press N for a new cord, R to reset.');
    // A11Y-1 — awaiting plugs are named (the first seat is a transition the
    // summary must speak), pluralized honestly, and ordered by lifecycle
    // progression (awaiting → linked → popped → vanishing).
    expect(sceneSummary({ cords: 1, awaitingPlug: 1, linked: 0, popped: 0, vanishing: 0 }))
      .toBe('1 cord, 1 awaiting plug. Press N for a new cord, R to reset.');
    expect(sceneSummary({ cords: 2, awaitingPlug: 2, linked: 0, popped: 0, vanishing: 0 }))
      .toBe('2 cords, 2 awaiting plugs. Press N for a new cord, R to reset.');
    expect(sceneSummary({ cords: 4, awaitingPlug: 1, linked: 1, popped: 1, vanishing: 1 }))
      .toBe('4 cords, 1 awaiting plug, 1 linked, 1 popped, 1 vanishing. Press N for a new cord, R to reset.');
    // The empty scene names the ONE honest action (R on an empty bench is a
    // no-op — the summary does not advertise no-ops).
    expect(sceneSummary({ cords: 0, awaitingPlug: 0, linked: 0, popped: 0, vanishing: 0 }))
      .toBe('No cords on the bench. Press N for a new cord.');
  });
});

// --- A11Y-1 — the summary is TOTAL over the lifecycle (nothing silent) ----------

describe('A11Y-1 — the scene summary speaks EVERY lifecycle transition', () => {
  it('each approved transition changes the sentence (the live region never falls silent)', () => {
    // Driven through the real world + driver, one summary per stage. Every
    // APPROVED transition (LIFE-1's eight + despawn + spawn) moves at least
    // one named count — the audit that motivated the awaiting-plug count:
    // without it, the FIRST SEAT (#1) and the hand-pull-back (#8) changed
    // nothing the summary named.
    const world = makeWorld();
    const summaries: string[] = [];
    const snap = () => summaries.push(sceneSummary(countsOf(world)));
    world.advance(10, { pointerPoint: null });
    snap(); // anchor: awaiting-plug
    world.advance(1, { pointerPoint: null, spawnCord: { cordId: 1, at: { x: 0.5, y: 1} } });
    snap(); // spawn: carried (#0 — the cord count moves)
    world.advance(3, { pointerPoint: null, seatTargets: [{ cordId: 1, index: 0, position: A }] });
    snap(); // #1 carried → awaiting-plug (first seat)
    world.advance(3, { pointerPoint: null,
      seatTargets: [
        { cordId: 1, index: 0, position: A },
        { cordId: 1, index: END, position: B },
      ],
    });
    snap(); // #2 awaiting-plug → linked (second seat)
    world.advance(2, {
      pointerPoint: null,
      pinTargets: [{ cordId: 1, index: END, position: { x: 0.5, y: 1.0} }],
    });
    snap(); // #7 linked → awaiting-plug (the hand-pulled plug)
    world.advance(3, { pointerPoint: null,
      seatTargets: [
        { cordId: 1, index: 0, position: A },
        { cordId: 1, index: END, position: B },
      ],
    });
    snap(); // #2 again: the pulled end re-seats → linked
    world.advance(1, { pointerPoint: null, popCords: [{ cordId: 1, index: 0 }] });
    snap(); // #4 linked → popped
    world.advance(400, { pointerPoint: null }); // past the ~3 s grace
    snap(); // #6 popped → vanishing (expiry)
    world.advance(1, { pointerPoint: null, despawnCords: [{ cordId: 1 }] });
    snap(); // vanish completion → the cord leaves the world
    // The states the walk actually visited (the world's own truth):
    expect(world.step.lifecycle.stateOf(0)).toBe('awaiting-plug');
    // Every consecutive pair differs — no transition is silent.
    for (let i = 1; i < summaries.length; i += 1) {
      expect(summaries[i]).not.toBe(summaries[i - 1]);
    }
    expect(summaries).toHaveLength(9);
  });

  it('the #8 grab-back (awaiting-plug → carried) also moves the sentence', () => {
    // The one transition that only REMOVES a named count: the first seat's
    // jack is grabbed back off its socket before the second seat ever lands.
    const world = makeWorld();
    world.advance(1, { pointerPoint: null, spawnCord: { cordId: 1, at: { x: 0.5, y: 1} } });
    world.advance(3, { pointerPoint: null, seatTargets: [{ cordId: 1, index: 0, position: A }] });
    expect(world.step.lifecycle.stateOf(1)).toBe('awaiting-plug');
    const before = sceneSummary(countsOf(world));
    world.advance(2, {
      pointerPoint: null,
      pinTargets: [{ cordId: 1, index: 0, position: { x: 0.4, y: 1.0} }],
    });
    expect(world.step.lifecycle.stateOf(1)).toBe('carried'); // transition #8
    const after = sceneSummary(countsOf(world));
    expect(after).not.toBe(before);
    expect(after).toBe('2 cords, 1 awaiting plug. Press N for a new cord, R to reset.');
    expect(before).toBe('2 cords, 2 awaiting plugs. Press N for a new cord, R to reset.');
  });
});

// --- REFINE-1 — the failure's one spoken line (the "why did it die") ----------

describe('REFINE-1 — vanishNotice + the notice-led summary (the death is NAMED once)', () => {
  it('names the death in the panel\'s own voice: shattered, unplugged — honest for BOTH entry paths', () => {
    // Grace expiry and the off-cube release both shatter the jack of a cord
    // that was unplugged; one sentence covers every death the lifecycle owns.
    expect(vanishNotice(1)).toBe('Cord shattered — unplugged.');
    expect(vanishNotice(2)).toBe('2 cords shattered — unplugged.'); // one frame, two deaths: one line
    expect(vanishNotice(5)).toBe('5 cords shattered — unplugged.');
    // Garbage fails to the singular (a broken count must not invent a plural).
    expect(vanishNotice(Number.NaN)).toBe('Cord shattered — unplugged.');
    expect(vanishNotice(0)).toBe('Cord shattered — unplugged.');
    expect(vanishNotice(-3)).toBe('Cord shattered — unplugged.');
  });

  it('sceneSummary leads with the notice, ahead of the counts, exactly as composed at vanish start', () => {
    // What main.ts composes the frame a popped cord's grace expires:
    expect(
      sceneSummary({ cords: 2, awaitingPlug: 1, linked: 0, popped: 0, vanishing: 1 }, vanishNotice(1)),
    ).toBe('Cord shattered — unplugged. 2 cords, 1 awaiting plug, 1 vanishing. Press N for a new cord, R to reset.');
    // Without a notice the sentence is the ordinary counts (the retired state).
    expect(sceneSummary({ cords: 2, awaitingPlug: 1, linked: 0, popped: 0, vanishing: 1 }))
      .toBe('2 cords, 1 awaiting plug, 1 vanishing. Press N for a new cord, R to reset.');
    // An empty/whitespace notice is no notice (composition garbage stays silent).
    expect(sceneSummary({ cords: 1, awaitingPlug: 0, linked: 0, popped: 0, vanishing: 0 }, ''))
      .toBe('1 cord. Press N for a new cord, R to reset.');
    expect(sceneSummary({ cords: 1, awaitingPlug: 0, linked: 0, popped: 0, vanishing: 0 }, null))
      .toBe('1 cord. Press N for a new cord, R to reset.');
  });

  it('through the REAL world: the expiry frame is exactly where the notice rides (the counts move with it)', () => {
    // The composition's law: popped → vanishing always changes the counts,
    // so the one-shot notice is consumed by the very update that follows it.
    const world = makeWorld();
    world.advance(1, { pointerPoint: null, spawnCord: { cordId: 1, at: { x: 0.5, y: 1} } });
    world.advance(3, { pointerPoint: null,
      seatTargets: [
        { cordId: 1, index: 0, position: A },
        { cordId: 1, index: END, position: B },
      ],
    });
    world.advance(1, { pointerPoint: null, popCords: [{ cordId: 1, index: 0 }] });
    world.advance(400, { pointerPoint: null }); // past the ~3s grace → vanishing
    const atExpiry = countsOf(world);
    expect(atExpiry).toEqual({ cords: 2, awaitingPlug: 1, linked: 0, popped: 0, vanishing: 1 });
    const withNotice = sceneSummary(atExpiry, vanishNotice(1));
    expect(withNotice.startsWith('Cord shattered — unplugged. ')).toBe(true);
    // And the despawn retires it: the next sentence never speaks the death again.
    world.advance(1, { pointerPoint: null, despawnCords: [{ cordId: 1 }] });
    expect(sceneSummary(countsOf(world)).includes('shattered')).toBe(false);
  });
});

// --- REFINE-4 — the abandonment death's own honest line ------------------------

describe('REFINE-4 — putAwayNotice: the self-clean line (distinct vocabulary)', () => {
  it('names abandonment in its OWN words — put away, never shattered (nothing failed)', () => {
    expect(putAwayNotice(1)).toBe('Cord put away.');
    expect(putAwayNotice(2)).toBe('2 cords put away.');
    expect(putAwayNotice(4)).toBe('4 cords put away.');
    // Garbage fails to the singular, same law as vanishNotice.
    expect(putAwayNotice(Number.NaN)).toBe('Cord put away.');
    expect(putAwayNotice(0)).toBe('Cord put away.');
    // The vocabulary is DISJOINT from the failure line (the critique's ask:
    // the summary names why a cord left, honestly, once).
    expect(putAwayNotice(1)).not.toContain('shatter');
    expect(vanishNotice(1)).not.toContain('put away');
  });

  it('the composed put-away sentence rides the summary once, ahead of the counts', () => {
    // What main.ts composes the frame an idle coil abandons (window expires,
    // counts still show the cord while it vanishes):
    expect(
      sceneSummary({ cords: 1, awaitingPlug: 0, linked: 0, popped: 0, vanishing: 1 }, putAwayNotice(1)),
    ).toBe('Cord put away. 1 cord, 1 vanishing. Press N for a new cord, R to reset.');
    // Both death kinds in ONE frame speak both lines, in stability order.
    expect(
      sceneSummary(
        { cords: 3, awaitingPlug: 0, linked: 1, popped: 0, vanishing: 2 },
        `${vanishNotice(1)} ${putAwayNotice(1)}`,
      ),
    ).toBe(
      'Cord shattered — unplugged. Cord put away. 3 cords, 1 linked, 2 vanishing. Press N for a new cord, R to reset.',
    );
  });

  it('through the REAL world: the abandoned coil\u2019s frame is where the line rides', () => {
    const world = makeWorld();
    // A dropped coil (no end driven) counts down the idle window and leaves
    // through the same vanishing state — the counts move, the line rides.
    world.advance(1, { pointerPoint: null, spawnCord: { cordId: 1, at: { x: 0.5, y: 1} } });
    // No carry targets ever flow: the sweep retires the spawn's carry the
    // first target-less step, the window counts, expiry → vanishing.
    world.advance(1, { pointerPoint: null, releaseJack: { cordId: 1, index: 0 } });
    world.advance(1260, { pointerPoint: null }); // 10.5 s > the ~10 s default window
    const atAbandon = countsOf(world);
    expect(atAbandon).toEqual({ cords: 2, awaitingPlug: 1, linked: 0, popped: 0, vanishing: 1 });
    expect(sceneSummary(atAbandon, putAwayNotice(1)).startsWith('Cord put away. ')).toBe(true);
    // The despawn retires the line like every death.
    world.advance(1, { pointerPoint: null, despawnCords: [{ cordId: 1 }] });
    expect(sceneSummary(countsOf(world)).includes('put away')).toBe(false);
  });
});

describe('REFINE-1 — the panel speaks the notice ONCE (no spam, no swallowed line)', () => {
  it('a notice forces the repaint the gate would have swallowed, then retires on the next change', () => {
    const { panel, fixture } = makePanel();
    const f = fixture();
    const counts = { cords: 2, awaitingPlug: 1, linked: 0, popped: 0, vanishing: 1 };
    panel.update(counts);
    expect(f.summary.textContent)
      .toBe('2 cords, 1 awaiting plug, 1 vanishing. Press N for a new cord, R to reset.');
    // The death line lands even though the counts did NOT change this frame
    // (the gate must not swallow a spoken event).
    panel.update(counts, vanishNotice(1));
    expect(f.summary.textContent)
      .toBe('Cord shattered — unplugged. 2 cords, 1 awaiting plug, 1 vanishing. Press N for a new cord, R to reset.');
    // Identical counts and no notice: gated — the line is NOT repeated.
    const spoken = f.summary.textContent;
    panel.update(counts);
    expect(f.summary.textContent).toBe(spoken);
    // The next real change (the despawn) rewrites the sentence WITHOUT the
    // death line — it fired exactly once.
    panel.update({ cords: 1, awaitingPlug: 1, linked: 0, popped: 0, vanishing: 0 });
    expect(f.summary.textContent)
      .toBe('1 cord, 1 awaiting plug. Press N for a new cord, R to reset.');
  });

  it('a notice-led repaint leaves the meters exactly what the counts say (the line is speech, not state)', () => {
    const { panel, fixture } = makePanel();
    const f = fixture();
    panel.update({ cords: 2, awaitingPlug: 1, linked: 0, popped: 0, vanishing: 0 });
    panel.update({ cords: 2, awaitingPlug: 1, linked: 0, popped: 0, vanishing: 1 }, vanishNotice(1));
    expect(f.litCords()).toBe(2); // meters still honest — no phantom segment
    expect(f.litLinked()).toBe(0);
    expect(f.countText('cords')).toBe('2');
    expect(f.countText('linked')).toBe('0');
    // The notice is not state: an identical frame WITHOUT it gates shut again.
    const spoken = f.summary.textContent;
    panel.update({ cords: 2, awaitingPlug: 1, linked: 0, popped: 0, vanishing: 1 });
    expect(f.summary.textContent).toBe(spoken);
  });
});

// --- 2D-7 — the module count rides the summary (honest world state) ----------

describe('2D-7 — the summary speaks the module roster ahead of the cord counts', () => {
  it('the counts clause gains the module lead ("9 modules, 3 cords, 1 linked")', () => {
    expect(sceneSummary({ cords: 3, awaitingPlug: 0, linked: 1, popped: 0, vanishing: 0, modules: 9 }))
      .toBe('9 modules, 3 cords, 1 linked. Press N for a new cord, R to reset.');
    expect(sceneSummary({ cords: 1, awaitingPlug: 1, linked: 0, popped: 0, vanishing: 0, modules: 12 }))
      .toBe('12 modules, 1 cord, 1 awaiting plug. Press N for a new cord, R to reset.');
    // Pluralized honestly (a one-module world is legal).
    expect(sceneSummary({ cords: 1, awaitingPlug: 0, linked: 0, popped: 0, vanishing: 0, modules: 1 }))
      .toBe('1 module, 1 cord. Press N for a new cord, R to reset.');
    // Without the field the sentence is exactly its pre-2D-7 shape (the
    // pure primitive stays total over absence).
    expect(sceneSummary({ cords: 3, awaitingPlug: 0, linked: 1, popped: 0, vanishing: 0 }))
      .toBe('3 cords, 1 linked. Press N for a new cord, R to reset.');
  });

  it('the empty bench still names itself, then the standing modules (B on an empty bench is spoken)', () => {
    expect(sceneSummary({ cords: 0, awaitingPlug: 0, linked: 0, popped: 0, vanishing: 0, modules: 8 }))
      .toBe('No cords on the bench. 8 modules standing. Press N for a new cord.');
    expect(sceneSummary({ cords: 0, awaitingPlug: 0, linked: 0, popped: 0, vanishing: 0 }))
      .toBe('No cords on the bench. Press N for a new cord.');
    // No reset advertised on the empty bench, modules or not.
    expect(sceneSummary({ cords: 0, awaitingPlug: 0, linked: 0, popped: 0, vanishing: 0, modules: 9 }))
      .not.toContain('R to reset');
  });

  it('sameHudCounts gates on modules too: a B-press repaints the summary', () => {
    const a = { cords: 3, awaitingPlug: 0, linked: 1, popped: 0, vanishing: 0, modules: 8 };
    expect(sameHudCounts(a, { cords: 3, awaitingPlug: 0, linked: 1, popped: 0, vanishing: 0, modules: 8 }))
      .toBe(true);
    // The module count alone opens the gate (the roster IS world state).
    expect(sameHudCounts(a, { cords: 3, awaitingPlug: 0, linked: 1, popped: 0, vanishing: 0, modules: 9 }))
      .toBe(false);
    // Absence is absence (legacy shapes compare as before).
    expect(sameHudCounts(a, { cords: 3, awaitingPlug: 0, linked: 1, popped: 0, vanishing: 0 }))
      .toBe(false);
  });

  it('the panel speaks the module clause and repaints when only the roster grows', () => {
    const { panel, fixture } = makePanel();
    const f = fixture();
    panel.update({ cords: 2, awaitingPlug: 1, linked: 0, popped: 0, vanishing: 0, modules: 8 });
    expect(f.summary.textContent)
      .toBe('8 modules, 2 cords, 1 awaiting plug. Press N for a new cord, R to reset.');
    // The gate CLOSES on identical counts that carry the module clause (the
    // snapshot must store modules — else every frame rewrites the region and
    // a one-shot notice retires immediately; pinned 2D-7 after it bit the
    // putaway drive first-hand).
    const writes = classListWritesIn(f.root);
    panel.update({ cords: 2, awaitingPlug: 1, linked: 0, popped: 0, vanishing: 0, modules: 8 });
    expect(classListWritesIn(f.root)).toBe(writes); // nothing repainted
    expect(f.summary.textContent)
      .toBe('8 modules, 2 cords, 1 awaiting plug. Press N for a new cord, R to reset.');
    // …and a module spawn rewrites the sentence with every cord count fixed.
    panel.update({ cords: 2, awaitingPlug: 1, linked: 0, popped: 0, vanishing: 0, modules: 9 });
    expect(f.summary.textContent)
      .toBe('9 modules, 2 cords, 1 awaiting plug. Press N for a new cord, R to reset.');
    // Meters are untouched by the module clause (there is no module meter).
    expect(f.litCords()).toBe(2);
    expect(f.countText('cords')).toBe('2');
  });

  it('the notice still leads, ahead of modules and cords alike', () => {
    expect(
      sceneSummary(
        { cords: 2, awaitingPlug: 1, linked: 0, popped: 0, vanishing: 1, modules: 8 },
        vanishNotice(1),
      ),
    ).toBe(
      'Cord shattered — unplugged. 8 modules, 2 cords, 1 awaiting plug, 1 vanishing. Press N for a new cord, R to reset.',
    );
  });
});

// --- Part 2 — the panel against the structural DOM stub ------------------------

/** The whole stub DOM seam the panel declares (see panel.ts). */
class StubElement {
  readonly tagName: string;
  className = '';
  textContent: string | null = null;
  readonly children: StubElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Array<(event: { type: string }) => void>>();
  private readonly classes = new Set<string>();
  classListWrites = 0;
  readonly classList = {
    add: (...tokens: string[]) => {
      this.classListWrites += 1;
      for (const t of tokens) this.classes.add(t);
    },
    remove: (...tokens: string[]) => {
      this.classListWrites += 1;
      for (const t of tokens) this.classes.delete(t);
    },
  };

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  appendChild(child: unknown): void {
    this.children.push(child as StubElement);
  }

  addEventListener(type: string, listener: (event: { type: string }) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  hasClass(token: string): boolean {
    return this.classes.has(token);
  }

  click(): void {
    for (const listener of this.listeners.get('click') ?? []) listener({ type: 'click' });
  }
}

const stubDoc = { createElement: (tag: string) => new StubElement(tag) };

function findAll(node: StubElement, pred: (el: StubElement) => boolean): StubElement[] {
  const out: StubElement[] = [];
  const walk = (el: StubElement): void => {
    if (pred(el)) out.push(el);
    for (const child of el.children) walk(child);
  };
  walk(node);
  return out;
}

const byAttr = (node: StubElement, name: string, value: string): StubElement[] =>
  findAll(node, (el) => el.attributes.get(name) === value);

const byClass = (node: StubElement, cls: string): StubElement[] =>
  findAll(node, (el) => el.className.split(/\s+/).includes(cls));

const classListWritesIn = (node: StubElement): number => {
  let total = node.classListWrites;
  for (const child of node.children) total += classListWritesIn(child);
  return total;
};

interface PanelFixture {
  root: StubElement;
  litCords: () => number;
  litLinked: () => number;
  countText: (readout: string) => string;
  summary: StubElement;
}

function makePanel(options?: { segments?: number }): {
  panel: ReturnType<typeof createHudPanel>;
  commands: { newCord: number; newModule: number; reset: number };
  host: StubElement;
  fixture(): PanelFixture;
} {
  const commands = { newCord: 0, newModule: 0, reset: 0 };
  const host = new StubElement('body');
  const panel = createHudPanel(host as unknown as HudElementLike, stubDoc, {
    onNewCord: () => {
      commands.newCord += 1;
    },
    onNewModule: () => {
      commands.newModule += 1;
    },
    onReset: () => {
      commands.reset += 1;
    },
    ...(options?.segments === undefined ? {} : { segments: options.segments }),
  });
  const root = host.children[0];
  return {
    panel,
    commands,
    host,
    fixture: () => ({
      root,
      litCords: () => byAttr(root, 'data-readout', 'cords')[0]
        ? byAttr(root, 'data-readout', 'cords')[0].children[1].children
          .filter((s) => s.hasClass('lit')).length
        : -1,
      litLinked: () => byAttr(root, 'data-readout', 'linked')[0].children[1].children
        .filter((s) => s.hasClass('lit')).length,
      countText: (readout) => byAttr(root, 'data-readout', readout)[0].children[2].textContent ?? '',
      summary: byClass(root, 'hud-summary')[0],
    }),
  };
}

describe('T-REN-3 — the panel: structure (labels name real things)', () => {
  it('builds the strip with nameplate, both readouts, both controls, summary', () => {
    const { fixture } = makePanel();
    const f = fixture();
    expect(f.root.tagName).toBe('div');
    expect(f.root.className).toBe('hud');
    // Nameplate — the product's own name.
    const word = byClass(f.root, 'hud-name-word')[0];
    expect(word.textContent).toBe('CORDS');
    // Readouts: labels + HUD_SEGMENTS slots each.
    for (const name of ['cords', 'linked'] as const) {
      const block = byAttr(f.root, 'data-readout', name)[0];
      expect(block.attributes.get('aria-hidden')).toBe('true'); // the summary speaks the counts
      expect(block.children[0].textContent).toBe(name === 'cords' ? 'CORDS' : 'LINKED');
      expect(block.children[1].children).toHaveLength(HUD_SEGMENTS);
    }
    // Controls: real buttons, honest labels, keycap chips aria-hidden.
    const newCord = byAttr(f.root, 'data-hud', 'new-cord')[0];
    const newModule = byAttr(f.root, 'data-hud', 'new-module')[0];
    const reset = byAttr(f.root, 'data-hud', 'reset')[0];
    for (const btn of [newCord, newModule, reset]) {
      expect(btn.tagName).toBe('button');
      expect(btn.attributes.get('type')).toBe('button');
    }
    expect(newCord.children[0].textContent).toBe('NEW CORD');
    expect(newCord.children[1].textContent).toBe('N');
    expect(newCord.children[1].attributes.get('aria-hidden')).toBe('true');
    // 2D-6 — the module spawn control rides the same grammar (key B).
    expect(newModule.children[0].textContent).toBe('NEW MODULE');
    expect(newModule.children[1].textContent).toBe('B');
    expect(newModule.children[1].attributes.get('aria-hidden')).toBe('true');
    expect(reset.children[0].textContent).toBe('RESET');
    expect(reset.children[1].textContent).toBe('R');
    expect(reset.children[1].attributes.get('aria-hidden')).toBe('true');
    // Summary: the aria-live polite region (A11Y-1's floor, wired now).
    expect(f.summary.tagName).toBe('p');
    expect(f.summary.attributes.get('role')).toBe('status');
    expect(f.summary.attributes.get('aria-live')).toBe('polite');
    // The empty-scene hint names the one honest action.
    expect(byClass(f.root, 'hud-hint')[0].textContent).toBe('PRESS N FOR A NEW CORD');
    expect(byClass(f.root, 'hud-hint')[0].attributes.get('aria-hidden')).toBe('true');
  });

  it('honors a custom segment count and fails fast on a bad one', () => {
    const { fixture } = makePanel({ segments: 4 });
    const f = fixture();
    expect(f.root ? byAttr(f.root, 'data-readout', 'cords')[0].children[1].children : [])
      .toHaveLength(4);
    expect(() => makePanel({ segments: 0 })).toThrow();
    expect(() => makePanel({ segments: 3.5 })).toThrow();
  });
});

describe('T-REN-3 — the panel: wiring (buttons fire the commands)', () => {
  it('clicking NEW CORD calls onNewCord; clicking RESET calls onReset — nothing else', () => {
    const { commands, fixture } = makePanel();
    const f = fixture();
    byAttr(f.root, 'data-hud', 'new-cord')[0].click();
    expect(commands).toEqual({ newCord: 1, newModule: 0, reset: 0 });
    byAttr(f.root, 'data-hud', 'reset')[0].click();
    byAttr(f.root, 'data-hud', 'reset')[0].click();
    expect(commands).toEqual({ newCord: 1, newModule: 0, reset: 2 });
  });

  it('2D-6 — clicking NEW MODULE calls onNewModule (the B key\'s own seam)', () => {
    const { commands, fixture } = makePanel();
    const f = fixture();
    byAttr(f.root, 'data-hud', 'new-module')[0].click();
    byAttr(f.root, 'data-hud', 'new-module')[0].click();
    expect(commands).toEqual({ newCord: 0, newModule: 2, reset: 0 });
  });
});

describe('T-REN-3 — the panel: honest painting + the update gate', () => {
  it('lights segments to the counts and writes the exact numerals + summary', () => {
    const { panel, fixture } = makePanel();
    const f = fixture();
    panel.update({ cords: 3, awaitingPlug: 1, linked: 1, popped: 0, vanishing: 0 });
    expect(f.litCords()).toBe(3);
    expect(f.litLinked()).toBe(1);
    expect(f.countText('cords')).toBe('3');
    expect(f.countText('linked')).toBe('1');
    expect(f.summary.textContent)
      .toBe('3 cords, 1 awaiting plug, 1 linked. Press N for a new cord, R to reset.');
    expect(f.root.hasClass('is-empty')).toBe(false); // hint hidden
  });

  it('an identical update touches NO DOM (the gate) — a new one does', () => {
    const { panel, fixture } = makePanel();
    const f = fixture();
    panel.update({ cords: 2, awaitingPlug: 0, linked: 1, popped: 0, vanishing: 0 });
    const writes = classListWritesIn(f.root);
    const summaryText = f.summary.textContent;
    panel.update({ cords: 2, awaitingPlug: 0, linked: 1, popped: 0, vanishing: 0 });
    expect(classListWritesIn(f.root)).toBe(writes); // nothing repainted
    expect(f.summary.textContent).toBe(summaryText);
    panel.update({ cords: 2, awaitingPlug: 0, linked: 2, popped: 0, vanishing: 0 });
    expect(classListWritesIn(f.root)).toBeGreaterThan(writes);
    expect(f.litLinked()).toBe(2);
  });

  it('A11Y-1: an awaiting-plug change repaints the SUMMARY though the meters are identical', () => {
    // The first seat moves no meter-visible number — CORDS and LINKED are
    // unchanged — yet the live region must speak. The gate keys on the full
    // counts (sameHudCounts incl. awaitingPlug), so the summary rewrites.
    const { panel, fixture } = makePanel();
    const f = fixture();
    panel.update({ cords: 2, awaitingPlug: 0, linked: 0, popped: 0, vanishing: 0 });
    expect(f.summary.textContent).toBe('2 cords. Press N for a new cord, R to reset.');
    panel.update({ cords: 2, awaitingPlug: 1, linked: 0, popped: 0, vanishing: 0 });
    expect(f.summary.textContent)
      .toBe('2 cords, 1 awaiting plug. Press N for a new cord, R to reset.');
    // ...and the meters really were untouched by that transition: same lit
    // counts, same numerals (already asserted above via the stub state).
    expect(f.litCords()).toBe(2);
    expect(f.litLinked()).toBe(0);
  });

  it('the empty scene: zero lit, dim numerals, hint visible, honest summary', () => {
    const { panel, fixture } = makePanel();
    const f = fixture();
    panel.update({ cords: 0, awaitingPlug: 0, linked: 0, popped: 0, vanishing: 0 });
    expect(f.litCords()).toBe(0);
    expect(f.litLinked()).toBe(0);
    expect(f.countText('cords')).toBe('0');
    expect(byAttr(f.root, 'data-readout', 'cords')[0].children[2].hasClass('is-zero')).toBe(true);
    expect(f.root.hasClass('is-empty')).toBe(true); // the silkscreen hint shows
    expect(f.summary.textContent).toBe('No cords on the bench. Press N for a new cord.');
  });

  it('pegs the meter past its row while the numeral tells the truth', () => {
    const { panel, fixture } = makePanel();
    const f = fixture();
    panel.update({ cords: HUD_SEGMENTS + 4, awaitingPlug: 0, linked: 0, popped: 0, vanishing: 0 });
    expect(f.litCords()).toBe(HUD_SEGMENTS);
    expect(f.countText('cords')).toBe(String(HUD_SEGMENTS + 4));
    // 2D-7 — the tally at the raised boundary: 13, 20, and a full 48-cord
    // bench all PEG the row at 12 while the numeral reads the exact count.
    for (const n of [13, 20, 48]) {
      panel.update({ cords: n, awaitingPlug: 0, linked: 0, popped: 0, vanishing: 0 });
      expect(f.litCords()).toBe(12);
      expect(f.countText('cords')).toBe(String(n));
    }
    // Below the peg the meter still fills one segment per cord.
    panel.update({ cords: 9, awaitingPlug: 9, linked: 0, popped: 0, vanishing: 0 });
    expect(f.litCords()).toBe(9);
    expect(f.countText('cords')).toBe('9');
  });

  it('paints counts derived from the REAL world end to end (spawn → link)', () => {
    const world = makeWorld();
    world.advance(1, { pointerPoint: null, spawnCord: { cordId: 1, at: { x: 0.5, y: 1} } });
    world.advance(3, { pointerPoint: null,
      seatTargets: [
        { cordId: 1, index: 0, position: A },
        { cordId: 1, index: END, position: B },
      ],
    });
    world.advance(1, { pointerPoint: null, spawnCord: { cordId: 2, at: { x: -0.5, y: 1} } });
    const { panel, fixture } = makePanel();
    const f = fixture();
    panel.update(readHudCounts(world.advance(0, { pointerPoint: null }).cords, world.step.lifecycle.stateOf));
    expect(f.litCords()).toBe(3); // anchor + linked cord + carried cord
    expect(f.litLinked()).toBe(1);
    expect(f.summary.textContent)
      .toBe('3 cords, 1 awaiting plug, 1 linked. Press N for a new cord, R to reset.');
    // RESET's read: the no-anchor rebuild drives the same panel to empty.
    const afterReset = makeWorld(false);
    panel.update(readHudCounts(afterReset.advance(0, { pointerPoint: null }).cords, afterReset.step.lifecycle.stateOf));
    expect(f.litCords()).toBe(0);
    expect(f.root.hasClass('is-empty')).toBe(true);
    expect(f.summary.textContent).toBe('No cords on the bench. Press N for a new cord.');
  });
});

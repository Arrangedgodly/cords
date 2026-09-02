/**
 * T-REN-3 — the HUD's pure read model (Professor X + Thor, REN lane).
 *
 * The faceplate's law (surface brief): "silkscreen legends name real state
 * only" and "lit LEDs as the only glow". Every number this module produces
 * is therefore DERIVED from the sim's own lifecycle state — never eyeballed,
 * never cached beyond the caller's own gating — and every derived string is
 * a plain function of those counts, so the panel (DOM) stays a dumb view:
 *
 *   readHudCountsInto(cords, stateOf, out) — the counts behind the CORDS /
 *     LINKED segmented readouts and the scene summary.
 *   litSegments(count, segments) — how many meter segments light (a level
 *     meter pegs at its last segment; the numeral carries the exact value).
 *   sceneSummary(counts, notice?) — the aria-live sentence ("3 cords, 1
 *     awaiting plug, 2 linked" + the N/R action hint; total over every
 *     lifecycle transition — the A11Y-1 audit), optionally led by the
 *     one-shot failure line (REFINE-1, see vanishNotice).
 *   vanishNotice(count) — the failure's one spoken line ("Cord shattered —
 *     unplugged."), prepended to exactly one summary repaint per death.
 *
 * Pure TypeScript plain data: no three.js, no DOM, no wall-clock, no RNG
 * (the sim's house rules — this module is unit-testable headless and stays
 * honest by construction: there is nothing here to tune or fake).
 */
import type { LifecycleState } from '../sim';

/**
 * The live-cord readout's segment count. 12 is the DoD's live-cord floor
 * ("60fps with 8 cubes + 12 live cords"), so the meter spans the approved
 * operating range exactly; the world's hard cap (16) pegs the meter and the
 * numeral tells the truth.
 */
export const HUD_SEGMENTS = 12;

/** What the faceplate needs to know about the scene, derived per frame. */
export interface HudCounts {
  /** Every cord alive in the world (any lifecycle state incl. vanishing). */
  cords: number;
  /**
   * A11Y-1 — cords with EXACTLY ONE end seated (the awaiting-plug state).
   * The meters do not show it (the panel's two rows are CORDS/LINKED), but
   * the scene summary speaks it: without this count, the first seat — a real
   * lifecycle transition — would change NO number the summary names and a
   * screen reader would hear silence at the exact moment a plug lands. With
   * it, EVERY approved transition moves at least one count (see
   * sceneSummary).
   */
  awaitingPlug: number;
  /** Cords with BOTH ends seated — the linked state, the chase pulse's. */
  linked: number;
  /** Cords in the popped grace window. */
  popped: number;
  /** Cords mid vanish sequence (still on the bench, already leaving). */
  vanishing: number;
}

/** A zeroed counts shell for callers that reuse one object per frame. */
export function createHudCounts(): HudCounts {
  return { cords: 0, awaitingPlug: 0, linked: 0, popped: 0, vanishing: 0 };
}

/**
 * Counts the sim's real state. `cords` is the world's live cord list (the
 * same enumeration the render loop draws from); `stateOf` is the world
 * step's lifecycle view (`step.lifecycle.stateOf`). Mutates and returns
 * `out` — the per-frame path allocates nothing. Total over upstream truth:
 * an unknown/unregistered id simply is not counted as a lifecycle state
 * (its cord still counts toward CORDS — it IS on the bench).
 */
export function readHudCountsInto(
  cords: ReadonlyArray<{ readonly id: number }>,
  stateOf: (cordId: number) => LifecycleState | undefined,
  out: HudCounts,
): HudCounts {
  out.cords = 0;
  out.awaitingPlug = 0;
  out.linked = 0;
  out.popped = 0;
  out.vanishing = 0;
  for (let i = 0; i < cords.length; i += 1) {
    out.cords += 1;
    switch (stateOf(cords[i].id)) {
      case 'awaiting-plug':
        out.awaitingPlug += 1;
        break;
      case 'linked':
        out.linked += 1;
        break;
      case 'popped':
        out.popped += 1;
        break;
      case 'vanishing':
        out.vanishing += 1;
        break;
      default:
        break; // carried: the unlabeled remainder
    }
  }
  return out;
}

/** Fresh-counts convenience for tests and one-shot readers. */
export function readHudCounts(
  cords: ReadonlyArray<{ readonly id: number }>,
  stateOf: (cordId: number) => LifecycleState | undefined,
): HudCounts {
  return readHudCountsInto(cords, stateOf, createHudCounts());
}

/** Structural equality — the panel's "nothing changed, touch nothing" gate. */
export function sameHudCounts(a: Readonly<HudCounts>, b: Readonly<HudCounts>): boolean {
  return a.cords === b.cords && a.awaitingPlug === b.awaitingPlug && a.linked === b.linked
    && a.popped === b.popped && a.vanishing === b.vanishing;
}

/**
 * How many segments light for `count`: a level meter — 0 lights nothing,
 * the row fills one segment per cord, and anything past the row's length
 * PEGS the last segment (hardware behavior; the numeral beside the meter
 * carries the exact value). Total over garbage: a non-finite or negative
 * count lights nothing.
 */
export function litSegments(count: number, segments: number = HUD_SEGMENTS): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  const lit = Math.floor(count);
  return Math.min(lit, segments);
}

/**
 * The scene summary sentence (aria-live, Daredevil's floor; A11Y-1's audit
 * made it total over the lifecycle): counts in the task's own grammar —
 * "3 cords, 1 awaiting plug, 2 linked, 1 popped" — naming only the non-zero
 * states, in lifecycle-progression order, pluralized honestly, plus the
 * ONE-LINE HINT of the actions the page owns (N/R). Every approved
 * transition moves at least one named count, so the live region speaks at
 * every lifecycle change: spawn (cords), first seat (awaiting plug), second
 * seat (linked), hand-pulled plug (linked→awaiting), pop (popped), grace
 * expiry / off-cube release (vanishing), and the vanish completion's despawn
 * (cords drop). The empty scene states itself and the one honest action —
 * R is omitted there on purpose: resetting an empty bench does nothing, and
 * the summary does not advertise no-ops.
 *
 * REFINE-1 — `notice` (the critique's "why did it die"): a ONE-SHOT event
 * line the composition prepends when a cord's vanish BEGINS (see
 * vanishNotice). It rides exactly ONE repaint of the region — the death is
 * named once, ahead of the counts, and the despawn's own counts rewrite
 * retires it — so the failure is explained without spamming the channel.
 *
 * BOUNDARY (A11Y-1, documented): the keyboard floor is SPAWN + RESET +
 * summary. Plugging a jack needs pointer aiming (no approved keyboard plug
 * path exists), so the hint names only the actions a keyboard alone can
 * actually complete.
 */
export function sceneSummary(counts: Readonly<HudCounts>, notice?: string | null): string {
  const body =
    counts.cords <= 0
      ? 'No cords on the bench. Press N for a new cord.'
      : `${summaryParts(counts).join(', ')}. Press N for a new cord, R to reset.`;
  return typeof notice === 'string' && notice.length > 0 ? `${notice} ${body}` : body;
}

/** The counts clause shared by every non-empty summary sentence. */
function summaryParts(counts: Readonly<HudCounts>): string[] {
  const parts: string[] = [`${counts.cords} cord${counts.cords === 1 ? '' : 's'}`];
  if (counts.awaitingPlug > 0) {
    parts.push(`${counts.awaitingPlug} awaiting plug${counts.awaitingPlug === 1 ? '' : 's'}`);
  }
  if (counts.linked > 0) parts.push(`${counts.linked} linked`);
  if (counts.popped > 0) parts.push(`${counts.popped} popped`);
  if (counts.vanishing > 0) parts.push(`${counts.vanishing} vanishing`);
  return parts;
}

/**
 * REFINE-1 — the failure's one spoken line, for the live region's `notice`:
 * when a cord's vanish begins (either entry path — the popped grace
 * expiring, or the off-cube release of a half-plugged cord), the jack
 * shatters and the cord was unplugged, so ONE sentence names every death
 * the lifecycle owns. `count` deaths beginning in the same frame speak as
 * one pluralized line (no spam); garbage counts fail to the singular.
 */
export function vanishNotice(count: number): string {
  const n = Number.isFinite(count) && count > 1 ? Math.floor(count) : 1;
  return n === 1 ? 'Cord shattered — unplugged.' : `${n} cords shattered — unplugged.`;
}

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
 *   sceneSummary(counts) — the aria-live sentence ("3 cords, 1 linked").
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
  /** Cords with BOTH ends seated — the linked state, the chase pulse's. */
  linked: number;
  /** Cords in the popped grace window. */
  popped: number;
  /** Cords mid vanish sequence (still on the bench, already leaving). */
  vanishing: number;
}

/** A zeroed counts shell for callers that reuse one object per frame. */
export function createHudCounts(): HudCounts {
  return { cords: 0, linked: 0, popped: 0, vanishing: 0 };
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
  out.linked = 0;
  out.popped = 0;
  out.vanishing = 0;
  for (let i = 0; i < cords.length; i += 1) {
    out.cords += 1;
    switch (stateOf(cords[i].id)) {
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
        break; // carried / awaiting-plug: the unlabeled remainder
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
  return a.cords === b.cords && a.linked === b.linked
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
 * The scene summary sentence (aria-live, Daredevil's floor): counts in the
 * task's own grammar — "3 cords, 2 linked, 1 popped" — naming only the
 * non-zero states. Pluralization is honest; the empty scene states itself
 * and the one honest next action (the same words the faceplate's silkscreen
 * hint carries, so ears and eyes are told the same thing).
 */
export function sceneSummary(counts: Readonly<HudCounts>): string {
  if (counts.cords <= 0) return 'No cords on the bench. Press N for a new cord.';
  const parts: string[] = [`${counts.cords} cord${counts.cords === 1 ? '' : 's'}`];
  if (counts.linked > 0) parts.push(`${counts.linked} linked`);
  if (counts.popped > 0) parts.push(`${counts.popped} popped`);
  if (counts.vanishing > 0) parts.push(`${counts.vanishing} vanishing`);
  return `${parts.join(', ')}.`;
}

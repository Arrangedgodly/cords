/**
 * T-REN-3 — the Drum Machine Panel faceplate strip (Professor X + Thor,
 * REN lane). A DOM strip laid over the canvas along the bottom edge — DOM
 * because the HUD is text, focus, and live regions: crisp, testable, and
 * keyboard-native, none of which belong in the WebGL scene. The LOOK is
 * the committed world's (silkscreen styling in index.html — machined
 * charcoal, small-caps tracked legends, segmented readouts, squared meter
 * slots); this module owns STRUCTURE, WIRING, and HONEST STATE:
 *
 * - SEGMENTED READOUTS — CORDS and LINKED, `HUD_SEGMENTS` slots each, lit
 *   segments = the live count (a level meter; pegs past the row, the
 *   numeral carries the exact value). Lit = live state only — nothing on
 *   this panel glows unless the sim says so.
 * - CONTROLS — NEW CORD and RESET are real <button>s (keyboard-reachable,
 *   Enter/Space, visible focus in the panel grammar via :focus-visible —
 *   index.html draws the lit bracket). The keycap chips surface the N/R
 *   shortcuts the page already owns. Click routes through the SAME seams
 *   the keys use (the spawn seam; the reset below).
 * - SCENE SUMMARY — an aria-live polite region (Daredevil's floor; A11Y-1
 *   formalizes) whose sentence comes from the pure model's `sceneSummary`.
 *   The meters/numerals are aria-hidden: the summary already speaks the
 *   counts, and a screen reader has no use for "12 segments" of chrome.
 *   REFINE-1: the sentence may be LED by a one-shot failure notice
 *   (`vanishNotice`) — a cord's death is NAMED ("Cord shattered —
 *   unplugged.") exactly once, in the region the counts already own.
 * - EMPTY-SCENE HINT — the surface brief's invitation state: one readable
 *   silkscreen line (12px/700 Legend Ink — REFINE-1's legibility fix),
 *   visible only while the bench holds no cords (it names real state, so
 *   it disappears the moment one exists).
 *
 * The element/document seams below are deliberately narrow structural
 * interfaces: the real DOM satisfies them, and so does a ~40-line test
 * stub — the wiring is unit-testable without jsdom, matching the repo's
 * direct-function test approach. All state arrives via `update(counts)`
 * from the sim's own lifecycle reads (see model.ts); this panel never
 * counts anything itself.
 */
import {
  HUD_SEGMENTS,
  createHudCounts,
  litSegments,
  sameHudCounts,
  sceneSummary,
} from './model';
import type { HudCounts } from './model';

/**
 * The narrow DOM seam (see header). `appendChild` takes `unknown` and
 * returns nothing: the real DOM's generic `<T extends Node>(node: T): T`
 * is otherwise structurally incompatible, and the panel never needs the
 * return. Everything else is satisfied by HTMLElement verbatim.
 */
export interface HudElementLike {
  readonly tagName: string;
  className: string;
  textContent: string | null;
  setAttribute(qualifiedName: string, value: string): void;
  appendChild(child: unknown): void;
  addEventListener(type: string, listener: (event: { type: string }) => void): void;
  readonly classList: {
    add(...tokens: string[]): void;
    remove(...tokens: string[]): void;
  };
}

/** `document` as the panel uses it (createElement only). */
export interface HudDocumentLike {
  createElement(tagName: string): HudElementLike;
}

/** The commands the faceplate can issue (main.ts passes the page's seams). */
export interface HudOptions {
  /** NEW CORD — routes through the spawn seam (the N key's own function). */
  onNewCord(): void;
  /** RESET — clears every cord to the empty scene (the R key's own function). */
  onReset(): void;
  /** Meter segment count per readout. Default HUD_SEGMENTS. */
  segments?: number;
}

/** The panel's live side: one honest update per frame, DOM touched only on change. */
export interface HudPanel {
  /**
   * Paints `counts`. Gated: identical counts leave the DOM untouched —
   * UNLESS a `notice` arrived (REFINE-1: the failure line must be spoken
   * even in the frames the counts alone would gate the repaint away).
   */
  update(counts: Readonly<HudCounts>, notice?: string | null): void;
  /** The strip's root element (appended to the host at construction). */
  readonly root: HudElementLike;
}

/**
 * Builds the faceplate into `host` (document.body in the app). Wires the
 * two buttons to their commands and returns the per-frame `update` handle.
 */
export function createHudPanel(
  host: HudElementLike,
  doc: HudDocumentLike,
  options: HudOptions,
): HudPanel {
  const segments = options.segments ?? HUD_SEGMENTS;
  if (!Number.isInteger(segments) || segments < 1 || segments > 64) {
    throw new Error(`hud: segments must be an integer in [1, 64], got ${segments}`);
  }

  const el = (tag: string, className?: string): HudElementLike => {
    const node = doc.createElement(tag);
    if (className !== undefined) node.className = className;
    return node;
  };

  // --- Root strip -----------------------------------------------------------
  const root = el('div', 'hud');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Cords faceplate');
  host.appendChild(root);

  // --- Nameplate (the product's name — the panel's own silkscreen) ----------
  const name = el('div', 'hud-name');
  const nameWord = el('span', 'hud-name-word');
  nameWord.textContent = 'CORDS';
  const nameSub = el('span', 'hud-name-sub');
  nameSub.textContent = 'CABLE PATCH SANDBOX';
  name.appendChild(nameWord);
  name.appendChild(nameSub);
  root.appendChild(name);

  // --- Segmented readouts (the tempo-readout grammar) ------------------------
  interface Meter {
    readonly segs: HudElementLike[];
    readonly count: HudElementLike;
  }
  const makeReadout = (label: string, ledClass: string, dataName: string): Meter => {
    const block = el('div', `hud-readout ${ledClass}`);
    // The meters are visual chrome; the summary region speaks the counts.
    block.setAttribute('aria-hidden', 'true');
    block.setAttribute('data-readout', dataName);
    const labelEl = el('span', 'hud-label');
    labelEl.textContent = label;
    const meter = el('span', 'hud-meter');
    const segs: HudElementLike[] = [];
    for (let i = 0; i < segments; i += 1) {
      const seg = el('span', 'hud-seg');
      seg.setAttribute('data-i', String(i));
      meter.appendChild(seg);
      segs.push(seg);
    }
    const count = el('span', 'hud-count is-zero');
    count.textContent = '0';
    block.appendChild(labelEl);
    block.appendChild(meter);
    block.appendChild(count);
    root.appendChild(block);
    return { segs, count };
  };
  const cordsMeter = makeReadout('CORDS', 'led-amber', 'cords');
  const linkedMeter = makeReadout('LINKED', 'led-jade', 'linked');

  // --- Empty-scene hint (the brief's invitation state) -----------------------
  const hint = el('p', 'hud-hint');
  hint.setAttribute('aria-hidden', 'true');
  hint.textContent = 'PRESS N FOR A NEW CORD';
  root.appendChild(hint);

  // --- Controls --------------------------------------------------------------
  const actions = el('div', 'hud-actions');
  const makeButton = (dataName: string, label: string, key: string, command: () => void): void => {
    const btn = el('button', 'hud-btn');
    btn.setAttribute('type', 'button');
    btn.setAttribute('data-hud', dataName);
    const text = el('span', 'hud-btn-label');
    text.textContent = label;
    const chip = el('span', 'hud-key');
    chip.setAttribute('aria-hidden', 'true');
    chip.textContent = key;
    btn.appendChild(text);
    btn.appendChild(chip);
    btn.addEventListener('click', () => command());
    actions.appendChild(btn);
  };
  makeButton('new-cord', 'NEW CORD', 'N', options.onNewCord);
  makeButton('reset', 'RESET', 'R', options.onReset);
  root.appendChild(actions);

  // --- Scene summary (aria-live; A11Y-1's floor, wired early) ----------------
  const summary = el('p', 'hud-summary');
  summary.setAttribute('role', 'status');
  summary.setAttribute('aria-live', 'polite');
  summary.textContent = '';
  root.appendChild(summary);

  // --- The honest update -----------------------------------------------------
  const last = createHudCounts();
  const lastInitialized = { value: false };
  const setMeter = (meter: Meter, count: number): void => {
    const lit = litSegments(count, segments);
    for (let i = 0; i < meter.segs.length; i += 1) {
      const seg = meter.segs[i];
      if (i < lit) seg.classList.add('lit');
      else seg.classList.remove('lit');
    }
    meter.count.textContent = String(Math.max(0, Math.floor(Number.isFinite(count) ? count : 0)));
    if (count > 0) meter.count.classList.remove('is-zero');
    else meter.count.classList.add('is-zero');
  };

  return {
    root,
    update(counts: Readonly<HudCounts>, notice?: string | null): void {
      const spoken = typeof notice === 'string' && notice.length > 0 ? notice : null;
      if (lastInitialized.value && spoken === null && sameHudCounts(last, counts)) {
        return; // nothing changed
      }
      last.cords = counts.cords;
      last.awaitingPlug = counts.awaitingPlug;
      last.linked = counts.linked;
      last.popped = counts.popped;
      last.vanishing = counts.vanishing;
      lastInitialized.value = true;
      setMeter(cordsMeter, counts.cords);
      setMeter(linkedMeter, counts.linked);
      if (counts.cords === 0) root.classList.add('is-empty');
      else root.classList.remove('is-empty');
      // REFINE-1 — a notice rides exactly this one repaint: the region's
      // text changes once (one announcement), and the next counts change —
      // at the latest the despawn — rewrites the sentence without it.
      summary.textContent = sceneSummary(counts, spoken);
    },
  };
}

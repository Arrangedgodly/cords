/**
 * 2D-8 — THE MOBILE SURFACE CONTRACT (index.html assertions). The shell
 * file is product code too: the viewport meta and the canvas's touch-action
 * are what keep a phone from scrolling/pinch-fighting the sandbox, and the
 * narrow-bench media query is what keeps the faceplate honest at 390-px
 * class widths. These tests read the SHIPPED index.html and pin each rule's
 * presence — a regression here is a regression on every phone, invisible
 * to the sim/render suites.
 */
import { describe, expect, it } from 'vitest';
import html from '../index.html?raw';

/** All CSS comments are stripped so commented-out rules cannot pass. */
const css = html.replace(/\/\*[\s\S]*?\*\//g, '');

describe('2D-8 mobile surface — the viewport meta (honest, no zoom games)', () => {
  it('declares width=device-width, initial-scale=1, viewport-fit=cover', () => {
    const meta = html.match(/<meta\s+name="viewport"\s+content="([^"]*)"/);
    expect(meta).not.toBeNull();
    const content = meta![1];
    expect(content).toMatch(/(^|,\s*)width=device-width(,|$)/);
    expect(content).toMatch(/(^|,\s*)initial-scale=1(\.0)?(,|$)/);
    expect(content).toMatch(/(^|,\s*)viewport-fit=cover(,|$)/);
  });

  it('NEVER plays maximum-scale / user-scalable games (pinch stays the OS\'s)', () => {
    const meta = html.match(/<meta\s+name="viewport"\s+content="([^"]*)"/);
    expect(meta).not.toBeNull();
    expect(meta![1]).not.toMatch(/maximum-scale/i);
    expect(meta![1]).not.toMatch(/user-scalable/i);
  });
});

describe('2D-8 mobile surface — the canvas owns its gestures (touch-action)', () => {
  it('#stage and canvas carry touch-action: none', () => {
    expect(css).toMatch(/#stage,\s*\n?\s*canvas\s*\{\s*touch-action:\s*none;?\s*\}/);
  });

  it('the page never scroll-fights: html/body stay overflow-hidden', () => {
    expect(css).toMatch(/html,\s*\n?\s*body\s*\{[^}]*overflow:\s*hidden/);
  });
});

describe('2D-8 mobile surface — the narrow-bench faceplate (media query)', () => {
  it('has a max-width media query (the wrap breakpoint)', () => {
    expect(css).toMatch(/@media\s*\(max-width:\s*1020px\)/);
  });

  it('the strip wraps instead of overflowing inside the query', () => {
    const query = css.match(/@media\s*\(max-width:\s*1020px\)\s*\{([\s\S]*)\}\s*<\/style>/);
    expect(query).not.toBeNull();
    const block = query![1];
    expect(block).toMatch(/\.hud\s*\{[^}]*flex-wrap:\s*wrap/);
  });

  it('buttons are 44-px-class touch targets inside the query (min-height: 44px)', () => {
    const query = css.match(/@media\s*\(max-width:\s*1020px\)\s*\{([\s\S]*)\}\s*<\/style>/);
    const block = query![1];
    const btn = block.match(/\.hud-btn\s*\{([^}]*)\}/);
    expect(btn).not.toBeNull();
    expect(btn![1]).toMatch(/min-height:\s*44px/);
  });

  it('meters stay readable inside the query (segments shrink, never vanish)', () => {
    const query = css.match(/@media\s*\(max-width:\s*1020px\)\s*\{([\s\S]*)\}\s*<\/style>/);
    const block = query![1];
    expect(block).toMatch(/\.hud-seg\s*\{[^}]*width:\s*6px/); // smaller, still lit slots
    expect(block).not.toMatch(/\.hud-seg\s*\{[^}]*display:\s*none/); // never hidden
    expect(block).toMatch(/\.hud-count\s*\{[^}]*font-size:\s*12px/); // numerals readable
  });

  it('the empty-scene hint keeps its row reserved (a stable strip height)', () => {
    const query = css.match(/@media\s*\(max-width:\s*1020px\)\s*\{([\s\S]*)\}\s*<\/style>/);
    const block = query![1];
    expect(block).toMatch(/\.hud-hint\s*\{[^}]*flex-basis:\s*100%/);
    expect(block).toMatch(/\.hud-hint\s*\{[^}]*visibility:\s*hidden/);
  });

  it('buttons opt into instant taps (touch-action: manipulation, not scroll territory)', () => {
    expect(css).toMatch(/\.hud-btn\s*\{[^}]*touch-action:\s*manipulation/);
  });
});

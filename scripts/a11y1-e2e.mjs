#!/usr/bin/env node
/**
 * T-A11Y-1 end-to-end accessibility drive — real input, real app, real DOM,
 * real Chrome accessibility tree. Serves the BUILT bundle (vite preview),
 * opens the production page in headless Chrome + swiftshader over CDP, and
 * proves the approved floor:
 *
 *   1. STRUCTURE — the page's title/landmark shape (one <main>, the HUD
 *      inside it), the canvas's accessible name (role=img + aria-label),
 *      the aria-live scene summary's role/live-ness — and the same three
 *      facts re-read from Chrome's ACCESSIBILITY TREE (what a screen
 *      reader consumes), not just the DOM.
 *   2. KEYBOARD FLOOR (zero mouse) — Tab order = the two HUD buttons and
 *      nothing else (no trap: Tab/Shift+Tab traverse and wrap), the lit
 *      amber focus bracket (:focus-visible), Enter/Space on both buttons,
 *      N/R working wherever focus sits, and the modifier guard probed with
 *      SYNTHETIC events (Cmd+R must not reset — a real CDP Cmd+R would
 *      reload the page). Keyboard-only spawn → reset → spawn completes.
 *      BOUNDARY (documented): plugging needs pointer aiming — covered by
 *      the pointer below, not by the keyboard.
 *   3. THE SUMMARY ACROSS TRANSITIONS — the aria-live region's content at
 *      every lifecycle step of a real cord (spawn → first seat → linked →
 *      over-stretch pop → grace expiry → vanish → gone), each checked
 *      against the sim's own lifecycle() seam, and RESET's empty sentence.
 *   4. REDUCED MOTION (CDP Emulation.setEmulatedMedia) — every seam live:
 *      the chase pulse ×0.5 (speed 0.3, phase ≡ t·speed mod 1, the linked
 *      gain still ON — the "linked" reading survives), the popped band
 *      STEADY through the final second (ren5's rAF sampler), the shatter
 *      fragments SKIPPED (max fragments 0 while the sequence still
 *      completes; a control run with media cleared saw fragments > 0), the
 *      brush amplitude HALVED (motion-probe A/B, same sweep), and the
 *      stretch ticks UNCHANGED (still full ink on a taut cord — static
 *      furniture has no motion to reduce).
 *
 * Captures of record: .impeccable/review/a11y1-focus.png (the lit bracket)
 * and a11y1-reduced.png (the reduced-motion state). Exits 0 when every
 * assertion held with zero page errors.
 *
 * Usage: node scripts/a11y1-e2e.mjs [focus-shot] [reduced-shot]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const CHROME =
  process.env.CORDS_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = 9349;
const PORT = 5223;
const APP_URL = `http://localhost:${PORT}/`;
const FOCUS_SHOT = process.argv[2] ?? '.impeccable/review/a11y1-focus.png';
const REDUCED_SHOT = process.argv[3] ?? '.impeccable/review/a11y1-reduced.png';

// The fixed production camera waypoints (pop-e2e/ren5-e2e's proven spots).
const SPAWN_AT = { x: 789, y: 391 };     // world (0.4, 0.9, 0)
const CUBE04_TOP = { x: 906, y: 506 };   // world (0.85, 0.5, 1.05)
const CUBE05_TOP = { x: 1018, y: 464 };  // world (1.7, 0.5, 0.15)
const CUBE05_GRAB = { x: 1058, y: 527 };
const CUBE05_DRAG_TO = { x: 1304, y: 336 }; // pops the far (red, cube-04) jack
const CUBE02_TOP = { x: 539, y: 500 };   // reduced-run blue seat (cube 05 moved)
const CUBE04_GRAB = { x: 966, y: 585 };  // cube 04's low front, clear of 08
const CUBE04_DRAG_TO = { x: 1250, y: 430 };
// The taut-pull waypoint (ren5's ticks geometry: ~2.2 u of span from cube
// 04's socket) — the ticks probe under reduced motion.
const TAUT_DRAG_TO = { x: 560, y: 470 };
const NEUTRAL = { x: 640, y: 700 };
const SCAN = { x0: 735, x1: 830, y0: 490, y1: 546, step: 10 };
const CUBE_BOXES = [
  [405, 514, 440, 534], [469, 603, 487, 622], [521, 599, 413, 487],
  [840, 978, 492, 631], [956, 1081, 455, 562], [844, 926, 417, 494],
  [641, 703, 404, 471], [771, 943, 552, 748],
];
const inCubeBox = (x, y) =>
  CUBE_BOXES.some(([x0, x1, y0, y1]) => x >= x0 - 8 && x <= x1 + 8 && y >= y0 - 8 && y <= y1 + 8);
// The brush sweep (pure hover, buttons NEVER held) across the pooled drape
// at the spawn column.
const BRUSH_SWEEP = { x0: 700, x1: 880, y: 540, steps: 10, holdMs: 60 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(desc, fn, timeoutMs = 30000, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw new Error(`a11y1-e2e: timed out waiting for ${desc}${lastError ? ` (${lastError.message})` : ''}`);
}

// --- CDP over WebSocket (same plumbing as hud-e2e.mjs) ------------------------

let messageId = 0;
const pending = new Map();

function send(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++messageId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

function bindWebSocket(ws) {
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(String(event.data));
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error !== undefined) reject(new Error(`${msg.error.message} (${msg.id})`));
      else resolve(msg.result);
    }
  });
}

const pressKey = async (ws, k) => {
  await send(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', ...k });
  await sleep(50);
  await send(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', key: k.key, code: k.code, windowsVirtualKeyCode: k.windowsVirtualKeyCode });
  await sleep(150);
};
const pressN = (ws) => pressKey(ws, { key: 'n', code: 'KeyN', windowsVirtualKeyCode: 78, text: 'n', unmodifiedText: 'n' });
const pressR = (ws) => pressKey(ws, { key: 'r', code: 'KeyR', windowsVirtualKeyCode: 82, text: 'r', unmodifiedText: 'r' });
const pressTab = (ws) => pressKey(ws, { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
const pressShiftTab = (ws) => pressKey(ws, { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8 });
// Enter/Space MUST dispatch as keyDown WITH text — Chrome runs button
// activation only then (hud-e2e's probed note).
const pressEnter = (ws) => pressKey(ws, { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
const pressSpace = (ws) => pressKey(ws, { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ', unmodifiedText: ' ' });

const shoot = async (ws, path, clip) => {
  const shot = await send(ws, 'Page.captureScreenshot', {
    format: 'png',
    ...(clip === undefined ? {} : { clip: { ...clip, scale: 2 } }),
  });
  writeFileSync(path, Buffer.from(shot.data, 'base64'));
};

const evalJson = async (ws, expression) => {
  const res = await send(ws, 'Runtime.evaluate', { expression, returnByValue: true });
  return res.result?.value;
};
const summaryText = (ws) => evalJson(ws, `document.querySelector('.hud-summary')?.textContent ?? '<missing>'`);
const litSegs = (ws, name) =>
  evalJson(ws, `document.querySelectorAll('.hud-readout[data-readout="${name}"] .hud-seg.lit').length`);
const activeDesc = (ws) =>
  evalJson(ws, `document.activeElement === document.body ? 'body'
    : document.activeElement?.getAttribute('data-hud') ?? document.activeElement?.tagName ?? '<none>'`);
const lifecycleNow = (ws) =>
  evalJson(ws, 'JSON.stringify(window.cords.lifecycle())').then((s) => JSON.parse(String(s ?? '[]')));
const statePaintNow = (ws) =>
  evalJson(ws, 'JSON.stringify(window.cords.statePaint())').then((s) => JSON.parse(String(s ?? 'null')));
const pulseNow = (ws) =>
  evalJson(ws, 'JSON.stringify(window.cords.pulse())').then((s) => JSON.parse(String(s ?? 'null')));

const mouseMove = (ws, x, y, buttons = 0) =>
  send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons });
const pressAt = (ws, at) =>
  send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', buttons: 1, clickCount: 1 });
const releaseAt = (ws, at) =>
  send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', buttons: 0, clickCount: 1 });
async function drag(ws, from, to, steps = 14, holdMs = 55) {
  for (let i = 1; i <= steps; i += 1) {
    await mouseMove(ws, from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps, 1);
    await sleep(holdMs);
  }
}

const cursorNow = async (ws) => {
  const res = await send(ws, 'Runtime.evaluate', {
    expression: 'document.querySelector("canvas")?.style.cursor ?? ""',
    returnByValue: true,
  });
  return String(res.result?.value ?? '');
};

/** Find and GRAB the resting blue jack (ren5's jack-only scan, press-at-once). */
async function findAndGrabJack(ws) {
  for (let y = SCAN.y0; y <= SCAN.y1; y += SCAN.step) {
    for (let x = SCAN.x0; x <= SCAN.x1; x += SCAN.step) {
      if (inCubeBox(x, y)) continue;
      await mouseMove(ws, x, y);
      await sleep(60);
      if ((await cursorNow(ws)) !== 'grab') continue;
      await sleep(60);
      if ((await cursorNow(ws)) !== 'grab') continue;
      await pressAt(ws, { x, y });
      await sleep(150);
      if ((await cursorNow(ws)) === 'grabbing') return { x, y };
      await releaseAt(ws, { x, y });
      await sleep(60);
    }
  }
  return null;
}

const assertEq = (actual, expected, what) => {
  if (String(actual) !== String(expected)) {
    throw new Error(`${what}: expected ${JSON.stringify(String(expected))}, got ${JSON.stringify(String(actual))}`);
  }
};

// --- Main --------------------------------------------------------------------

const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'ignore',
  detached: true,
});
const profileDir = mkdtempSync(join(tmpdir(), 'cords-a11y1-'));
let chrome;
const pageErrors = [];

try {
  await waitFor('vite preview server', async () => {
    const res = await fetch(APP_URL);
    return res.ok;
  });

  chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profileDir}`,
      '--window-size=1440,900',
      '--no-first-run',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  const list = await waitFor('chrome devtools endpoint', async () => {
    const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
    const targets = await res.json();
    return targets.find((t) => t.type === 'page') ?? null;
  });

  const ws = new WebSocket(list.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', () => reject(new Error('ws error')));
  });
  bindWebSocket(ws);

  await send(ws, 'Page.enable');
  await send(ws, 'Runtime.enable');
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(String(event.data));
    if (msg.method === 'Runtime.exceptionThrown') {
      pageErrors.push(JSON.stringify(msg.params?.exceptionDetails ?? {}).slice(0, 400));
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
      pageErrors.push(`console.error: ${JSON.stringify(msg.params.args ?? []).slice(0, 380)}`);
    }
  });
  await send(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send(ws, 'Page.navigate', { url: APP_URL });
  await sleep(3500); // the M1 intro converge (~2 s) + margin

  // --- 1. STRUCTURE: title, landmark, canvas name, live region ----------------
  assertEq(await evalJson(ws, 'document.title'), 'Cords — cable patch sandbox', 'document title');
  assertEq(await evalJson(ws, 'document.querySelectorAll("main").length'), 1, 'exactly one <main>');
  assertEq(await evalJson(ws, 'document.querySelector("main")?.contains(document.querySelector(".hud"))'), true, 'the HUD strip lives inside <main>');
  const canvasRole = await evalJson(ws, 'document.querySelector("main canvas")?.getAttribute("role")');
  const canvasLabel = await evalJson(ws, 'document.querySelector("main canvas")?.getAttribute("aria-label") ?? ""');
  assertEq(canvasRole, 'img', 'the stage canvas role');
  if (typeof canvasLabel !== 'string' || canvasLabel.length < 40 || !canvasLabel.includes('bench')) {
    throw new Error(`canvas aria-label is not a real description: ${JSON.stringify(canvasLabel)}`);
  }
  assertEq(await evalJson(ws, 'document.querySelector("canvas")?.hasAttribute("tabindex")'), false, 'the canvas is not a tab stop (nothing keyboard-operable lives in it)');
  assertEq(await evalJson(ws, 'document.querySelector(".hud-summary")?.getAttribute("role")'), 'status', 'summary role=status');
  assertEq(await evalJson(ws, 'document.querySelector(".hud-summary")?.getAttribute("aria-live")'), 'polite', 'summary aria-live=polite');
  assertEq(await evalJson(ws, 'document.querySelectorAll("button").length'), 2, 'exactly two buttons on the page');
  process.stdout.write('a11y1-e2e: structure — title, one <main> holding HUD + canvas (role=img, named), summary role=status polite\n');

  // The same facts from Chrome's ACCESSIBILITY TREE (what AT consumes).
  try {
    await send(ws, 'Accessibility.enable');
    const tree = await send(ws, 'Accessibility.getFullAXTree');
    const nodes = (tree?.nodes ?? []).map((n) => ({
      role: n.role?.value ?? '',
      name: n.name?.value ?? '',
    }));
    const find = (role, namePart) =>
      nodes.find((n) => n.role === role && String(n.name).includes(namePart)) ?? null;
    const axCanvas = find('image', 'Interactive cable patch bench');
    const axNew = find('button', 'NEW CORD');
    const axReset = find('button', 'RESET');
    const axStatus = nodes.find((n) => n.role === 'status') ?? null;
    const axMain = nodes.find((n) => n.role === 'main') ?? null;
    if (!axCanvas) throw new Error('AX tree: no image node named for the bench canvas');
    if (!axNew || !axReset) throw new Error('AX tree: the NEW CORD/RESET buttons are not exposed');
    if (!axStatus) throw new Error('AX tree: no status (live region) node');
    if (!axMain) throw new Error('AX tree: no main landmark');
    process.stdout.write(`a11y1-e2e: AX tree — image "${String(axCanvas.name).slice(0, 46)}…", buttons + status + main all exposed\n`);
    // Leave AX OFF for the rest of the drive: a live a11y tree makes Chrome
    // recompute accessibility every frame and rAF crawls (measured: the
    // drive stalled with it on). The tree was the read we needed.
    await send(ws, 'Accessibility.disable');
  } catch (axError) {
    throw new Error(`AX tree read failed (the screen-reader view is part of the floor): ${axError.message}`);
  }

  // --- 2. THE KEYBOARD FLOOR (zero mouse so far) -------------------------------
  // Opening scene: the staged cord (awaiting-plug — its red end is seated).
  await waitFor('opening summary', async () => (await summaryText(ws)) !== '<missing>');
  assertEq(await summaryText(ws), '1 cord, 1 awaiting plug. Press N for a new cord, R to reset.', 'opening summary (the staged cord names itself)');
  assertEq(await litSegs(ws, 'cords'), 1, 'opening CORDS segments');

  // Tab order: body → NEW CORD → RESET → wraps to body. No trap.
  assertEq(await activeDesc(ws), 'body', 'focus starts on the body');
  await pressTab(ws);
  assertEq(await activeDesc(ws), 'new-cord', 'Tab 1 → NEW CORD');
  const focusStyle = await evalJson(ws, `(() => {
    const el = document.activeElement;
    const s = getComputedStyle(el);
    return JSON.stringify({ style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor });
  })()`);
  const fs = JSON.parse(String(focusStyle));
  assertEq(fs.style, 'solid', 'focus outline style');
  assertEq(fs.width, '2px', 'focus outline width');
  assertEq(fs.color, 'rgb(242, 212, 58)', 'focus bracket is the amber LED (not the default blue ring)');
  await shoot(ws, FOCUS_SHOT); // the lit bracket, captured while focused
  await pressTab(ws);
  assertEq(await activeDesc(ws), 'reset', 'Tab 2 → RESET');
  // Tab from the LAST focusable wraps to the FIRST (headless Chrome has no
  // browser chrome to hand focus to — the page cycle is the whole ring).
  await pressTab(ws);
  assertEq(await activeDesc(ws), 'new-cord', 'Tab 3 wraps to the first control — the ring is closed, no trap');
  // Trap-freedom is ESCAPE: Shift+Tab from the first control must leave it
  // (Chrome's reverse navigation lands on the body or the previous control —
  // either way the button released focus; a trap would hold it).
  await pressShiftTab(ws);
  const afterShift = await activeDesc(ws);
  if (afterShift === 'new-cord') throw new Error('Shift+Tab did not escape NEW CORD — a trap');
  process.stdout.write(`a11y1-e2e: keyboard ring — body → NEW CORD → RESET → wrap; Shift+Tab escapes (${afterShift})\n`);
  // Return to NEW CORD for the activation checks below.
  if (afterShift !== 'new-cord') {
    await pressTab(ws);
    assertEq(await activeDesc(ws), 'new-cord', 'Tab reaches NEW CORD again');
  }

  // Enter on NEW CORD spawns through the BUTTON path.
  await pressEnter(ws);
  await sleep(1000); // headless swiftshader rAF is slow — give the spawn its frame
  let cords = await lifecycleNow(ws);
  assertEq(cords.length, 2, 'Enter on NEW CORD spawned (opening cord + 1)');
  assertEq(await summaryText(ws), '2 cords, 1 awaiting plug. Press N for a new cord, R to reset.', 'summary after the button spawn');

  // N works while a BUTTON is focused (the keys are the page's, window-level).
  await pressN(ws);
  await sleep(1000);
  cords = await lifecycleNow(ws);
  assertEq(cords.length, 3, 'N spawns while a button holds focus');
  assertEq(await summaryText(ws), '3 cords, 1 awaiting plug. Press N for a new cord, R to reset.', 'summary after N');

  // The modifier guard, probed with SYNTHETIC events (a real CDP Cmd+R would
  // reload the page — the listener is what must ignore the chord).
  const modifierProbe = await evalJson(ws, `(() => {
    const counts = [];
    const before = window.cords.lifecycle().length;
    const fire = (init) => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true, ...init }));
    fire({ metaKey: true }); fire({ ctrlKey: true }); fire({ altKey: true });
    const afterModifiers = window.cords.lifecycle().length;
    fire({});
    const afterBare = window.cords.lifecycle().length;
    counts.push(before, afterModifiers, afterBare);
    return JSON.stringify(counts);
  })()`);
  const [before, afterModifiers, afterBare] = JSON.parse(String(modifierProbe));
  assertEq(afterModifiers, before, 'Cmd/Ctrl/Alt+R did NOT reset (the browser keeps its chords)');
  assertEq(afterBare, 0, 'bare r DID reset');

  // The empty scene after the real key, then the bench still works.
  assertEq(await summaryText(ws), 'No cords on the bench. Press N for a new cord.', 'summary after the bare-R reset');
  assertEq(await lifecycleNow(ws).then((c) => c.length), 0, 'lifecycle empty after reset');
  await pressN(ws);
  await sleep(1000);
  assertEq(await lifecycleNow(ws).then((c) => c.length), 1, 'N works after reset (id-0 revive)');
  assertEq(await summaryText(ws), '1 cord. Press N for a new cord, R to reset.', 'summary for a lone carried cord');
  process.stdout.write('a11y1-e2e: keyboard floor — Tab order/bracket, Enter/Space paths, N-anywhere, modifier guard, spawn→reset→spawn\n');

  // --- 3. THE SUMMARY ACROSS TRANSITIONS (pointer for the aiming acts) --------
  // A clean bench; one cord driven through its whole life.
  await pressR(ws);
  await sleep(700);
  assertEq(await summaryText(ws), 'No cords on the bench. Press N for a new cord.', 'reset before the lifecycle walk');

  await mouseMove(ws, SPAWN_AT.x, SPAWN_AT.y);
  await sleep(150);
  await pressN(ws);
  await sleep(2400); // uncoil; red carried at the cursor
  assertEq(await summaryText(ws), '1 cord. Press N for a new cord, R to reset.', 'spawn → carried');
  await drag(ws, SPAWN_AT, CUBE04_TOP);
  await sleep(600);
  await releaseAt(ws, CUBE04_TOP);
  await sleep(2400); // red's settle; blue rests at the spawn column
  await waitFor('first seat → awaiting-plug', async () => {
    const c = await lifecycleNow(ws);
    return c.some((x) => x.state === 'awaiting-plug') ? c : null;
  }, 8000, 100);
  assertEq(await summaryText(ws), '1 cord, 1 awaiting plug. Press N for a new cord, R to reset.', 'first seat → awaiting plug SPOKEN (the A11Y-1 count)');

  const blue = await findAndGrabJack(ws);
  if (blue === null) throw new Error('blue jack not found/grabbed in the scan window');
  await drag(ws, blue, CUBE05_TOP);
  await sleep(600);
  await releaseAt(ws, CUBE05_TOP);
  await sleep(2600); // the linked settle
  await waitFor('second seat → linked', async () => {
    const c = await lifecycleNow(ws);
    return c.some((x) => x.state === 'linked') ? c : null;
  }, 8000, 100);
  assertEq(await summaryText(ws), '1 cord, 1 linked. Press N for a new cord, R to reset.', 'second seat → linked');
  assertEq(await litSegs(ws, 'linked'), 1, 'LINKED meter lit 1');

  // Over-stretch pop: grab cube 05's front and drag past the cord's length.
  await mouseMove(ws, CUBE05_GRAB.x, CUBE05_GRAB.y);
  await sleep(150);
  await pressAt(ws, CUBE05_GRAB);
  await sleep(200);
  if ((await cursorNow(ws)) !== 'grabbing') throw new Error('cube-05 grab did not engage');
  let popped = false;
  for (let i = 1; i <= 16 && !popped; i += 1) {
    await mouseMove(ws, CUBE05_GRAB.x + ((CUBE05_DRAG_TO.x - CUBE05_GRAB.x) * i) / 16,
      CUBE05_GRAB.y + ((CUBE05_DRAG_TO.y - CUBE05_GRAB.y) * i) / 16, 1);
    await sleep(45);
    const c = await lifecycleNow(ws);
    if (c.some((x) => x.state === 'popped')) popped = true;
  }
  if (!popped) throw new Error('the over-stretch pop never fired on the cube-05 drag');
  await releaseAt(ws, CUBE05_DRAG_TO);
  assertEq(await summaryText(ws), '1 cord, 1 popped. Press N for a new cord, R to reset.', 'pop → popped SPOKEN');
  process.stdout.write('a11y1-e2e: summary — spawn/seat/link/pop each changed the live sentence\n');

  // Grace expiry → vanishing → gone, with the CONTROL fragment count (media
  // still unset: the shatter burst must be live here so the reduced run's
  // skip is a real difference).
  const fragmentsControl = await send(ws, 'Runtime.evaluate', {
    expression: `(async () => {
      let maxFragments = 0, sawVanishing = false, drained = false;
      const t0 = performance.now();
      await new Promise((resolve) => {
        const tick = () => {
          const s = window.cords.statePaint();
          const c = window.cords.lifecycle();
          if (s && Number.isFinite(s.fragments) && s.fragments > maxFragments) maxFragments = s.fragments;
          if (c.some((x) => x.state === 'vanishing')) sawVanishing = true;
          if (sawVanishing && c.length === 0) { drained = true; resolve(); return; }
          if (performance.now() - t0 > 9000) resolve(); else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return JSON.stringify({ maxFragments, sawVanishing, drained });
    })()`,
    returnByValue: true,
    awaitPromise: true,
  });
  const control = JSON.parse(String(fragmentsControl.result?.value ?? '{}'));
  if (!control.sawVanishing || !control.drained) {
    throw new Error(`the control vanish did not complete: ${JSON.stringify(control)}`);
  }
  if (!(control.maxFragments > 0)) {
    throw new Error(`the CONTROL run saw 0 live fragments — the reduced-run skip below would prove nothing (${JSON.stringify(control)})`);
  }
  await waitFor('vanish drained from the summary', async () =>
    (await summaryText(ws)) === 'No cords on the bench. Press N for a new cord.' ? true : null, 8000, 100);
  assertEq(await summaryText(ws), 'No cords on the bench. Press N for a new cord.', 'vanish complete → the empty sentence');
  process.stdout.write(`a11y1-e2e: control run — fragments peaked at ${control.maxFragments}, sequence drained, empty sentence\n`);

  // --- 4. REDUCED MOTION (CDP emulated media) ---------------------------------
  await send(ws, 'Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  await waitFor('the seam reads reduced', async () => (await statePaintNow(ws))?.reduced === true);

  // 4a. Link a cord 04↔02 (cube 05 is still moved from the pop above), with a
  // TAUT waypoint first: the stretch ticks must STILL paint under reduced
  // motion (static furniture has no motion to reduce).
  await mouseMove(ws, SPAWN_AT.x, SPAWN_AT.y);
  await sleep(150);
  await pressN(ws);
  await sleep(2400);
  await drag(ws, SPAWN_AT, CUBE04_TOP);
  await sleep(600);
  await releaseAt(ws, CUBE04_TOP);
  await sleep(2400);
  await waitFor('reduced-run first seat', async () => {
    const c = await lifecycleNow(ws);
    return c.some((x) => x.state === 'awaiting-plug') ? c : null;
  }, 8000, 100);
  const redId = (await lifecycleNow(ws)).find((x) => x.state === 'awaiting-plug').id;
  const blue2 = await findAndGrabJack(ws);
  if (blue2 === null) throw new Error('blue jack not found/grabbed (reduced run)');
  await drag(ws, blue2, TAUT_DRAG_TO, 16, 60);
  await sleep(500);
  // Pull taut STEPWISE, the seam's stretch read adjudicating (ren5's
  // discipline): keep extending left until the ticks actually paint.
  let tautPaint = (await statePaintNow(ws))?.cords?.find((c) => c.id === redId);
  const extensions = [TAUT_DRAG_TO, { x: 510, y: 478 }, { x: 470, y: 486 }, { x: 440, y: 490 }];
  for (let e = 1; e < extensions.length && !(tautPaint && tautPaint.tickGain > 0.5); e += 1) {
    await drag(ws, extensions[e - 1], extensions[e], 8, 60);
    await sleep(400);
    tautPaint = (await statePaintNow(ws))?.cords?.find((c) => c.id === redId);
  }
  if (!tautPaint || !(tautPaint.tickGain > 0.5)) {
    throw new Error(`stretch ticks did NOT paint under reduced motion: ${JSON.stringify(tautPaint)}`);
  }
  process.stdout.write(`a11y1-e2e: reduced — ticks UNCHANGED (tickGain ${tautPaint.tickGain.toFixed(3)} at stretch ${tautPaint.stretch.toFixed(3)})\n`);
  await drag(ws, extensions[extensions.length - 1], CUBE02_TOP, 18, 60);
  await sleep(600);
  await releaseAt(ws, CUBE02_TOP);
  await sleep(2600);
  await waitFor('reduced-run link', async () => {
    const c = await lifecycleNow(ws);
    return c.some((x) => x.state === 'linked') ? c : null;
  }, 8000, 100);

  // 4b. The chase pulse: ×0.5 (0.6 → 0.3), phase ≡ t·speed mod 1, the linked
  // gain still ON (the "linked" reading survives reduced motion).
  const pulse1 = await pulseNow(ws);
  assertEq(pulse1.reduced, true, 'pulse seam reports reduced');
  assertEq(pulse1.baseSpeed, 0.6, 'pulse base speed');
  assertEq(pulse1.speed, 0.3, 'pulse speed ×0.5 under reduced motion');
  assertEq(pulse1.linked.includes(redId), true, 'the linked cord is gated ON');
  const gain = (pulse1.renderGains ?? []).find((g) => g.id === redId)?.gain ?? 0;
  if (!(gain >= 0.99)) throw new Error(`the linked cord's pulse gain must stay ON under reduced motion, got ${gain}`);
  const phaseLaw = (t) => {
    const raw = t * 0.3;
    return raw - Math.floor(raw);
  };
  if (Math.abs(pulse1.phase - phaseLaw(pulse1.time)) > 1e-9) {
    throw new Error(`reduced phase broke the clock law: ${pulse1.phase} vs ${phaseLaw(pulse1.time)}`);
  }
  await sleep(700);
  const pulse2 = await pulseNow(ws);
  if (Math.abs(pulse2.phase - phaseLaw(pulse2.time)) > 1e-9) {
    throw new Error(`reduced phase broke the clock law (2nd sample): ${pulse2.phase} vs ${phaseLaw(pulse2.time)}`);
  }
  const dtSim = pulse2.time - pulse1.time;
  let adv = pulse2.phase - pulse1.phase;
  if (adv < 0) adv += 1;
  if (Math.abs(adv - 0.3 * dtSim) > 1e-6) {
    throw new Error(`reduced cadence wrong: advanced ${adv} over ${dtSim}s (expect ${0.3 * dtSim})`);
  }
  process.stdout.write(`a11y1-e2e: reduced — pulse speed 0.3, cadence exact over ${dtSim.toFixed(2)}s, linked gain ${gain}\n`);

  // 4c. The popped band STEADY through the final second (ren5's sampler).
  await mouseMove(ws, CUBE04_GRAB.x, CUBE04_GRAB.y);
  await sleep(150);
  await pressAt(ws, CUBE04_GRAB);
  await sleep(200);
  if ((await cursorNow(ws)) !== 'grabbing') throw new Error('cube-04 grab did not engage (reduced run)');
  let popped2 = false;
  for (let i = 1; i <= 16 && !popped2; i += 1) {
    await mouseMove(ws, CUBE04_GRAB.x + ((CUBE04_DRAG_TO.x - CUBE04_GRAB.x) * i) / 16,
      CUBE04_GRAB.y + ((CUBE04_DRAG_TO.y - CUBE04_GRAB.y) * i) / 16, 1);
    await sleep(45);
    const c = await lifecycleNow(ws);
    if (c.some((x) => x.id === redId && x.state === 'popped')) popped2 = true;
  }
  if (!popped2) throw new Error('the over-stretch pop never fired (reduced run)');
  await releaseAt(ws, CUBE04_DRAG_TO);
  await sleep(2300); // deep into the grace (~0.5-1.0 s left): the dim reads
  // visibly (factor ≈ 0.35-0.48) instead of the near-full first half.
  await shoot(ws, REDUCED_SHOT); // the popped cord: dimmed tube, steady band, no shards
  // One rAF sampler across the WHOLE remaining life (the grace, the expiry,
  // the vanish): the band's lit/off duty + the dim's floor + the fragment
  // skip + the sequence's completion — all in the same window, because at
  // headless rAF rates a sampler cannot be restarted between phases without
  // missing the expiry.
  const bandRes = await send(ws, 'Runtime.evaluate', {
    expression: `(async () => {
      let lit = 0, off = 0, n = 0, minRemaining = Infinity, minGraceFactor = Infinity;
      let maxFragments = 0, sawVanishing = false, drained = false;
      const t0 = performance.now();
      await new Promise((resolve) => {
        const tick = () => {
          const s = window.cords.statePaint();
          const c = window.cords.lifecycle();
          const paint = s?.cords?.find((x) => x.id === ${redId});
          if (s && Number.isFinite(s.fragments) && s.fragments > maxFragments) maxFragments = s.fragments;
          if (c.some((x) => x.id === ${redId} && x.state === 'vanishing')) sawVanishing = true;
          if (paint && paint.grace) {
            n += 1;
            if (paint.grace.bandLit) lit += 1; else off += 1;
            if (paint.grace.remaining < minRemaining) minRemaining = paint.grace.remaining;
            if (paint.graceFactor < minGraceFactor) minGraceFactor = paint.graceFactor;
          }
          if (sawVanishing && c.length === 0) { drained = true; resolve(); return; }
          if (n >= 240 || performance.now() - t0 > 14000) resolve(); else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return JSON.stringify({ lit, off, n, minRemaining, minGraceFactor, maxFragments, sawVanishing, drained });
    })()`,
    returnByValue: true,
    awaitPromise: true,
  });
  const band = JSON.parse(String(bandRes.result?.value ?? '{}'));
  if (band.minRemaining === undefined || band.minRemaining === Infinity || band.minRemaining > 1.05) {
    throw new Error(`the band sampler never reached the final second (min ${band.minRemaining})`);
  }
  if (band.off > 0) throw new Error(`the band BLINKED under reduced motion: ${JSON.stringify(band)}`);
  // The dim still counts down while the band holds steady (state, not motion).
  if (!(band.minGraceFactor < 1)) {
    throw new Error(`the grace dim must stay live under reduced motion: ${JSON.stringify(band)}`);
  }
  process.stdout.write(`a11y1-e2e: reduced — band STEADY (lit ${band.lit}/off ${band.off} to remaining ${band.minRemaining?.toFixed(2)}s), dim live (min ${band.minGraceFactor.toFixed(3)})\n`);
  if (!band.sawVanishing || !band.drained) {
    throw new Error(`the reduced vanish did not complete: ${JSON.stringify(band)}`);
  }
  if (band.maxFragments !== 0) {
    throw new Error(`fragments appeared under reduced motion (max ${band.maxFragments}; control saw ${control.maxFragments})`);
  }
  process.stdout.write(`a11y1-e2e: reduced — shatter fragments SKIPPED (0 vs control ${control.maxFragments}), sequence still completed\n`);

  // --- 4e. The brush dampening: A/B the SAME hover sweep over a FRESH pooled
  // drape at the spawn column, reduced first, then the preference cleared
  // (media off also re-checks the pulse speed back at 0.6). A FRESH drape per
  // side: the sweep itself pushes the pool out of the corridor, so a second
  // pass over the SAME displaced drape would brush nothing (measured).
  const dropFreshDrape = async () => {
    await mouseMove(ws, SPAWN_AT.x, SPAWN_AT.y);
    await sleep(150);
    await pressN(ws);
    await sleep(2400); // the uncoil; red carried at the cursor
    await pressAt(ws, SPAWN_AT);   // pointerdown is ignored while the carry holds;
    await sleep(120);              // the pointer-up then releases the red end…
    await releaseAt(ws, SPAWN_AT); // …a plain carried cord takes the ordinary drop
    await sleep(2600);             // the pooled drape settles at the column
  };
  const sweep = async () => {
    await mouseMove(ws, BRUSH_SWEEP.x0 - 40, BRUSH_SWEEP.y);
    await sleep(250);
    for (let i = 0; i <= BRUSH_SWEEP.steps; i += 1) {
      await mouseMove(ws, BRUSH_SWEEP.x0 + ((BRUSH_SWEEP.x1 - BRUSH_SWEEP.x0) * i) / BRUSH_SWEEP.steps, BRUSH_SWEEP.y);
      await sleep(BRUSH_SWEEP.holdMs);
    }
    await sleep(350);
    return evalJson(ws, 'JSON.stringify(window.cords.readMotionProbe())').then((s) => JSON.parse(String(s ?? '[]')));
  };

  await dropFreshDrape();
  await evalJson(ws, 'window.cords.setMotionProbe(true)');
  const reducedSweep = await sweep();
  const reducedSpeed = Math.max(...reducedSweep.map((c) => c.maxSpeed), 0);

  await send(ws, 'Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: '' }],
  });
  await waitFor('the seam reads full motion again', async () => (await statePaintNow(ws))?.reduced === false);
  const pulseBack = await pulseNow(ws);
  assertEq(pulseBack.speed, 0.6, 'pulse speed restored to 0.6 with the preference cleared');

  await dropFreshDrape();
  await evalJson(ws, 'window.cords.setMotionProbe(true)');
  const fullSweep = await sweep();
  const fullSpeed = Math.max(...fullSweep.map((c) => c.maxSpeed), 0);
  if (!(fullSpeed > 0.05)) throw new Error(`the full-motion sweep barely brushed (${fullSpeed}) — the A/B is meaningless`);
  if (!(reducedSpeed > 0.03)) throw new Error(`the reduced sweep barely brushed (${reducedSpeed}) — the A/B is meaningless`);
  const brushRatio = reducedSpeed / fullSpeed;
  if (!(brushRatio < 0.8) || !(brushRatio > 0.15)) {
    throw new Error(`brush dampening out of band: reduced ${reducedSpeed} vs full ${fullSpeed} (ratio ${brushRatio})`);
  }
  process.stdout.write(`a11y1-e2e: reduced — brush amplitude dampened (${reducedSpeed.toFixed(3)} vs ${fullSpeed.toFixed(3)} u/s, ratio ${brushRatio.toFixed(2)})\n`);

  if (pageErrors.length > 0) {
    throw new Error(`page errors during the drive: ${pageErrors.join(' | ')}`);
  }

  process.stdout.write(`A11Y1_E2E_OK ${FOCUS_SHOT} + ${REDUCED_SHOT} (0 page errors)\n`);
  ws.close();
} catch (error) {
  process.exitCode = 1;
  process.stdout.write(`A11Y1_E2E_FAILED ${error.message}\n`);
} finally {
  chrome?.kill('SIGKILL');
  if (preview.pid !== undefined) {
    try {
      process.kill(-preview.pid, 'SIGKILL');
    } catch {
      // already gone — the server exiting first is fine
    }
  }
  await sleep(300);
  rmSync(profileDir, { recursive: true, force: true });
}

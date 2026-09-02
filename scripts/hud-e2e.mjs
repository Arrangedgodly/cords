#!/usr/bin/env node
/**
 * T-REN-3 end-to-end HUD drive — real input, real app, real DOM. Serves the
 * BUILT bundle (vite preview), opens the production page in headless Chrome
 * + swiftshader over CDP, and proves the faceplate end to end with trusted
 * browser input:
 *
 *   1. wait out the M1 intro; assert the HUD names the real opening scene
 *      (CORDS 1 — the anchor; LINKED 0; the summary sentence)
 *   2. spawn a cord (the real N key), seat RED on cube 04, find + seat BLUE
 *      on cube 05 → LINKED (same trusted-mouse flow as linked-e2e.mjs),
 *      spawn one more cord — a busy bench
 *   3. assert the DOM meters agree with the sim seam (`window.cords.
 *      lifecycle()`): 3 CORDS segments lit, 1 LINKED segment lit, numeral
 *      text 3/1, summary "3 cords, 1 awaiting plug, 1 linked. Press N for a
 *      new cord, R to reset." — screenshot of record
 *      `.impeccable/review/ren3-hud.png`
 *   4. KEYBOARD-ONLY operability: Tab reaches NEW CORD (focus capture of
 *      record `.impeccable/review/ren3-hud-focus.png` — the lit bracket),
 *      Enter clicks it (CORDS 4 through the BUTTON path, not the key);
 *      Tab reaches RESET, Space clicks it → the empty scene: 0 segments,
 *      count 0, lifecycle() empty, summary "No cords...", the silkscreen
 *      hint visible — screenshot `.impeccable/review/ren3-hud-reset.png`
 *   5. the bench still works after RESET: N spawns again (id-reuse/revive
 *      path) — CORDS 1
 *
 * Exits 0 when every assertion held with zero page errors.
 *
 * Usage: node scripts/hud-e2e.mjs [hud-shot] [focus-shot] [reset-shot] [closeup-shot]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const CHROME =
  process.env.CORDS_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = 9347;
const PORT = 5221;
const APP_URL = `http://localhost:${PORT}/`;
const HUD_SHOT = process.argv[2] ?? '.impeccable/review/ren3-hud.png';
const FOCUS_SHOT = process.argv[3] ?? '.impeccable/review/ren3-hud-focus.png';
const RESET_SHOT = process.argv[4] ?? '.impeccable/review/ren3-hud-reset.png';
const CLOSEUP_SHOT = process.argv[5] ?? '.impeccable/review/ren3-hud-closeup.png';

// World → screen waypoints (the fixed production camera; same derivation as
// linked-e2e.mjs — the seating flow reuses its proven geometry):
const SPAWN_AT = { x: 789, y: 391 };     // world (0.4, 0.9, 0)
const CUBE04_TOP = { x: 906, y: 506 };   // world (0.85, 0.5, 1.05) — red seats here
const CUBE05_TOP = { x: 1018, y: 464 };  // world (1.7, 0.5, 0.15) — blue seats here
const SCAN = { x0: 680, x1: 772, y0: 480, y1: 600, step: 12 };
const NEUTRAL = { x: 640, y: 700 };

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
  throw new Error(`hud-e2e: timed out waiting for ${desc}${lastError ? ` (${lastError.message})` : ''}`);
}

// --- CDP over WebSocket (same plumbing as linked-e2e.mjs) ---------------------

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

const key = (k) => ({
  key: k.key,
  code: k.code,
  windowsVirtualKeyCode: k.vk,
  nativeVirtualKeyCode: k.vk,
  ...(k.text === undefined ? {} : { text: k.text, unmodifiedText: k.text }),
});

// NOTE: Enter/Space MUST dispatch as `keyDown` WITH text — a `rawKeyDown`
// fires the DOM event but Chrome runs no default button activation on it
// (probed: rawKeyDown Enter → 0 clicks; keyDown Enter '\r' → click). That
// is the browser's own activation path, which is exactly what this drive
// set out to prove.
const pressKey = async (ws, k) => {
  await send(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', ...key(k) });
  await sleep(50);
  await send(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk });
  await sleep(150);
};
const pressN = (ws) => pressKey(ws, { key: 'n', code: 'KeyN', vk: 78, text: 'n' });
const pressTab = (ws) => pressKey(ws, { key: 'Tab', code: 'Tab', vk: 9 });
const pressEnter = (ws) => pressKey(ws, { key: 'Enter', code: 'Enter', vk: 13, text: '\r' });
const pressSpace = (ws) => pressKey(ws, { key: ' ', code: 'Space', vk: 32, text: ' ' });

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
const lit = (ws, name) =>
  evalJson(ws, `document.querySelectorAll('.hud-readout[data-readout="${name}"] .hud-seg.lit').length`);
const numeral = (ws, name) =>
  evalJson(ws, `document.querySelector('.hud-readout[data-readout="${name}"] .hud-count')?.textContent ?? '<missing>'`);
const summaryText = (ws) => evalJson(ws, `document.querySelector('.hud-summary')?.textContent ?? '<missing>'`);
const activeHud = (ws) =>
  evalJson(ws, `document.activeElement?.getAttribute('data-hud') ?? document.activeElement?.tagName ?? '<none>'`);
const lifecycleStates = (ws) =>
  evalJson(ws, `JSON.stringify((window.cords?.lifecycle?.() ?? []).map((c) => c.state))`);
const hintVisible = (ws) =>
  evalJson(ws, `getComputedStyle(document.querySelector('.hud-hint')).visibility`);

const cursorNow = async (ws) => {
  const res = await send(ws, 'Runtime.evaluate', {
    expression: 'document.querySelector("canvas")?.style.cursor ?? ""',
    returnByValue: true,
  });
  return String(res.result?.value ?? '');
};

const mouseMove = (ws, x, y) =>
  send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 1 });

async function drag(ws, from, to, steps = 14, holdMs = 55) {
  for (let i = 1; i <= steps; i += 1) {
    await mouseMove(ws, from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    await sleep(holdMs);
  }
}

async function findJack(ws) {
  for (let y = SCAN.y0; y <= SCAN.y1; y += SCAN.step) {
    for (let x = SCAN.x0; x <= SCAN.x1; x += SCAN.step) {
      await mouseMove(ws, x, y);
      await sleep(70);
      if ((await cursorNow(ws)) !== 'grab') continue;
      await sleep(80);
      if ((await cursorNow(ws)) !== 'grab') continue;
      await mouseMove(ws, NEUTRAL.x, NEUTRAL.y);
      await sleep(140);
      if ((await cursorNow(ws)) !== 'default') continue;
      await mouseMove(ws, x, y);
      await sleep(140);
      if ((await cursorNow(ws)) === 'grab') return { x, y };
    }
  }
  return null;
}

async function grabJack(ws, at) {
  await send(ws, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x: at.x, y: at.y, button: 'left', buttons: 1, clickCount: 1,
  });
  await sleep(180);
  if ((await cursorNow(ws)) !== 'grabbing') {
    throw new Error(`grab at ${JSON.stringify(at)} did not engage a carry`);
  }
}

const releaseAt = async (ws, at) => {
  await send(ws, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: at.x, y: at.y, button: 'left', buttons: 0, clickCount: 1,
  });
};

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
const profileDir = mkdtempSync(join(tmpdir(), 'cords-hud-'));
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

  // 1. The opening scene, named honestly by the faceplate.
  await waitFor('hud in the DOM', async () => (await lit(ws, 'cords')) !== undefined);
  assertEq(await lit(ws, 'cords'), 1, 'opening CORDS segments (the anchor cord)');
  assertEq(await numeral(ws, 'cords'), '1', 'opening CORDS numeral');
  assertEq(await lit(ws, 'linked'), 0, 'opening LINKED segments');
  assertEq(await summaryText(ws), '1 cord, 1 awaiting plug. Press N for a new cord, R to reset.', 'opening summary');
  assertEq(await hintVisible(ws), 'hidden', 'hint hidden while a cord exists');
  process.stdout.write('hud-e2e: opening scene named honestly (CORDS 1, LINKED 0)\n');

  // 2. A busy bench: spawn → seat red on 04 → find + seat blue on 05 → spawn one more.
  await mouseMove(ws, SPAWN_AT.x, SPAWN_AT.y);
  await sleep(150);
  await pressN(ws);
  await sleep(2400); // the uncoil settles; red stays carried at the cursor
  await drag(ws, SPAWN_AT, CUBE04_TOP);
  await sleep(600);
  await releaseAt(ws, CUBE04_TOP);
  await sleep(2400); // red's settle; blue rests at the spawn column
  assertEq(await lit(ws, 'cords'), 2, 'CORDS after the first seat');
  assertEq(await summaryText(ws), '2 cords, 2 awaiting plugs. Press N for a new cord, R to reset.', 'summary after the first seat');

  const blue = await findJack(ws);
  if (blue === null) throw new Error('blue jack not found in the scan window');
  await grabJack(ws, blue);
  await drag(ws, blue, CUBE05_TOP);
  await sleep(600);
  await releaseAt(ws, CUBE05_TOP);
  await sleep(2600); // the linked settle
  await pressN(ws); // a third cord, carried — the busy bench
  await sleep(1200);

  // 3. The meters agree with the sim seam, exactly.
  assertEq(await lifecycleStates(ws), JSON.stringify(['awaiting-plug', 'linked', 'carried']),
    'lifecycle states through the read-only seam');
  assertEq(await lit(ws, 'cords'), 3, 'CORDS segments (3 lit)');
  assertEq(await numeral(ws, 'cords'), '3', 'CORDS numeral');
  assertEq(await lit(ws, 'linked'), 1, 'LINKED segments (1 lit)');
  assertEq(await numeral(ws, 'linked'), '1', 'LINKED numeral');
  assertEq(await summaryText(ws), '3 cords, 1 awaiting plug, 1 linked. Press N for a new cord, R to reset.', 'summary sentence');
  await shoot(ws, HUD_SHOT);
  // Closeup of record: cubes 04 + 05 with the LINKED cord strung between
  // them (both jacks seated) — the state the green meter names.
  await shoot(ws, CLOSEUP_SHOT, { x: 760, y: 320, width: 420, height: 300 });
  process.stdout.write('hud-e2e: busy bench — CORDS 3 / LINKED 1 lit, meters === seam\n');

  // 4. KEYBOARD-ONLY: Tab → NEW CORD (Enter) → Tab → RESET (Space).
  await send(ws, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await sleep(60);
  await send(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await sleep(200);
  assertEq(await activeHud(ws), 'new-cord', 'Tab focuses NEW CORD');
  await shoot(ws, FOCUS_SHOT); // the lit bracket, captured while focused

  await pressEnter(ws);
  await sleep(1000); // headless swiftshader rAF is slow (~9 fps) — give the spawn its frame
  assertEq(await lit(ws, 'cords'), 4, 'CORDS after Enter on the NEW CORD button');
  assertEq(await summaryText(ws), '4 cords, 1 awaiting plug, 1 linked. Press N for a new cord, R to reset.', 'summary after the button spawn');
  process.stdout.write('hud-e2e: Enter on NEW CORD spawned through the BUTTON path\n');

  await pressTab(ws);
  assertEq(await activeHud(ws), 'reset', 'Tab reaches RESET');
  await pressSpace(ws);
  await sleep(300);

  // 5. The empty scene: nothing lit, nothing linked, nothing anywhere.
  assertEq(await lit(ws, 'cords'), 0, 'CORDS segments after RESET');
  assertEq(await numeral(ws, 'cords'), '0', 'CORDS numeral after RESET');
  assertEq(await lit(ws, 'linked'), 0, 'LINKED segments after RESET');
  assertEq(await lifecycleStates(ws), '[]', 'lifecycle empty after RESET');
  assertEq(await summaryText(ws), 'No cords on the bench. Press N for a new cord.', 'summary after RESET');
  assertEq(await hintVisible(ws), 'visible', 'the silkscreen hint shows on the empty bench');
  await shoot(ws, RESET_SHOT);
  process.stdout.write('hud-e2e: RESET — empty scene, empty seam, hint visible\n');

  // 6. The bench still works after RESET (id reuse → render revive).
  await pressN(ws);
  await sleep(1100);
  assertEq(await lit(ws, 'cords'), 1, 'CORDS after the post-reset N');
  assertEq(await lifecycleStates(ws), JSON.stringify(['carried']), 'post-reset lifecycle');

  if (pageErrors.length > 0) {
    throw new Error(`page errors during the drive: ${pageErrors.join(' | ')}`);
  }

  process.stdout.write(`HUD_E2E_OK ${HUD_SHOT} + ${FOCUS_SHOT} + ${RESET_SHOT} + ${CLOSEUP_SHOT} (0 page errors)\n`);
  ws.close();
} catch (error) {
  process.exitCode = 1;
  process.stdout.write(`HUD_E2E_FAILED ${error.message}\n`);
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

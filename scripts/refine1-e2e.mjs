#!/usr/bin/env node
/**
 * REFINE-1 end-to-end drive — the critique's two P1 fixes, proven in the
 * BUILT page with trusted browser input (same CDP plumbing as pop-e2e.mjs):
 *
 *   1. HINT LEGIBILITY + LIFECYCLE — reset to the empty scene and read the
 *      hint's real computed style (12px / 700 / legend ink #c3c8d1, the
 *      labels' class), capture refine1-hint.png, then press N and prove the
 *      line retires the frame a cord exists (visibility:hidden, .is-empty
 *      dropped) — the honesty rule intact after the promotion.
 *   2. EARLY GRACE BLINK — link a cord across cubes 04/05, over-stretch pop
 *      it (INT-6), then hold mid-grace INSIDE the widened blink window
 *      (remaining ~0.9–1.35s of 3 — previously steady: the old law blinked
 *      only under 1.0s). Sample window.cords.statePaint() and require BOTH
 *      band phases (lit + off) at that early remaining; capture
 *      refine1-grace.png at a blinked-OFF read with the remaining logged.
 *   3. THE FAILURE'S ONE SPOKEN LINE — poll the aria-live region's text
 *      across the expiry: exactly ONE distinct sentence leads with "Cord
 *      shattered — unplugged." (naming why it died, ahead of the counts),
 *      the shatter burst reads 18 shards through the seam (REFINE-1's
 *      legibility bump), and after the despawn the sentence never speaks
 *      the death again (no spam: one contiguous window).
 *
 * Exits 0 when every assertion held with zero page errors.
 *
 * Usage: node scripts/refine1-e2e.mjs [hint-shot] [grace-shot]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const CHROME =
  process.env.CORDS_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = 9346;
const PORT = 5210;
const APP_URL = `http://localhost:${PORT}/`;
const HINT_SHOT = process.argv[2] ?? '.impeccable/review/refine1-hint.png';
const GRACE_SHOT = process.argv[3] ?? '.impeccable/review/refine1-grace.png';
const NOTICE_LINE = 'Cord shattered — unplugged.';

// World → screen waypoints (pop-e2e.mjs's proven derivation, fixed camera).
const SPAWN_AT = { x: 789, y: 391 };
const CUBE04_TOP = { x: 906, y: 506 };
const CUBE05_TOP = { x: 1018, y: 464 };
const CUBE05_GRAB = { x: 1058, y: 527 };
const CUBE05_DRAG_TO = { x: 1304, y: 336 };
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
  throw new Error(`refine1-e2e: timed out waiting for ${desc}${lastError ? ` (${lastError.message})` : ''}`);
}

// --- CDP over WebSocket (same plumbing as pop-e2e.mjs) ------------------------

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

const pressKey = async (ws, key, code, vk) => {
  await send(ws, 'Input.dispatchKeyEvent', {
    type: 'rawKeyDown', key, code,
    windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
    ...(key === key.toLowerCase() ? { text: key, unmodifiedText: key } : {}),
  });
  await sleep(30);
  await send(ws, 'Input.dispatchKeyEvent', {
    type: 'keyUp', key, code,
    windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
  });
};
const pressN = (ws) => pressKey(ws, 'n', 'KeyN', 78);
const pressR = (ws) => pressKey(ws, 'r', 'KeyR', 82);

const shoot = async (ws, path) => {
  const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
  writeFileSync(path, Buffer.from(shot.data, 'base64'));
};

const evaluate = async (ws, expression) => {
  const res = await send(ws, 'Runtime.evaluate', { expression, returnByValue: true });
  return res.result?.value;
};

const cursorNow = async (ws) =>
  String(await evaluate(ws, 'document.querySelector("canvas")?.style.cursor ?? ""'));

const lifecycleNow = async (ws) =>
  JSON.parse(String(await evaluate(ws, 'JSON.stringify(window.cords.lifecycle())') ?? '[]'));

const summaryNow = async (ws) =>
  String(await evaluate(ws, 'document.querySelector(".hud-summary")?.textContent ?? ""'));

const statePaintNow = async (ws) =>
  JSON.parse(String(await evaluate(ws, 'JSON.stringify(window.cords.statePaint())') ?? '{}'));

const mouseMove = (ws, x, y) =>
  send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 1 });

async function drag(ws, from, to, steps = 14, holdMs = 55) {
  for (let i = 1; i <= steps; i += 1) {
    await mouseMove(ws, from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    await sleep(holdMs);
  }
}

async function findJackIn(ws, window_) {
  for (let y = window_.y0; y <= window_.y1; y += window_.step) {
    for (let x = window_.x0; x <= window_.x1; x += window_.step) {
      await mouseMove(ws, x, y);
      await sleep(60);
      if ((await cursorNow(ws)) !== 'grab') continue;
      await sleep(60);
      if ((await cursorNow(ws)) !== 'grab') continue;
      await mouseMove(ws, NEUTRAL.x, NEUTRAL.y);
      await sleep(110);
      if ((await cursorNow(ws)) !== 'default') continue;
      await mouseMove(ws, x, y);
      await sleep(110);
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

// --- Main --------------------------------------------------------------------

const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'ignore',
  detached: true,
});
const profileDir = mkdtempSync(join(tmpdir(), 'cords-refine1-'));
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
      pageErrors.push(`console.error: ${JSON.stringify(msg.params?.args ?? []).slice(0, 380)}`);
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

  // --- ACT 1 — the hint: legible on the empty scene, gone once a cord exists --
  await pressR(ws);
  await sleep(400);
  const hintStyle = await evaluate(ws, `JSON.stringify((() => {
    const el = document.querySelector('.hud-hint');
    const cs = getComputedStyle(el);
    return {
      visible: cs.visibility,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      color: cs.color,
      text: el.textContent,
      stripEmpty: document.querySelector('.hud').classList.contains('is-empty'),
    };
  })())`);
  const hint = JSON.parse(String(hintStyle));
  process.stdout.write(`refine1-e2e: hint style after reset — ${JSON.stringify(hint)}\n`);
  if (hint.visible !== 'visible') throw new Error(`the hint is not visible on the empty scene (${hint.visible})`);
  if (hint.fontSize !== '12px') throw new Error(`hint font-size is ${hint.fontSize}, expected 12px`);
  if (hint.fontWeight !== '700') throw new Error(`hint weight is ${hint.fontWeight}, expected 700`);
  if (hint.color !== 'rgb(195, 200, 209)') throw new Error(`hint color is ${hint.color}, expected legend ink rgb(195, 200, 209)`);
  if (!hint.stripEmpty) throw new Error('the strip did not enter the empty state');
  await shoot(ws, HINT_SHOT); // the required capture: readable hint, empty bench

  await mouseMove(ws, SPAWN_AT.x, SPAWN_AT.y);
  await sleep(120);
  await pressN(ws);
  await sleep(700);
  const hintAfterSpawn = await evaluate(ws, `JSON.stringify((() => {
    return {
      visible: getComputedStyle(document.querySelector('.hud-hint')).visibility,
      stripEmpty: document.querySelector('.hud').classList.contains('is-empty'),
      cords: window.cords.lifecycle().length,
    };
  })())`);
  const retired = JSON.parse(String(hintAfterSpawn));
  process.stdout.write(`refine1-e2e: hint after N — ${JSON.stringify(retired)}\n`);
  if (retired.visible !== 'hidden') throw new Error('the hint did not retire once a cord exists');
  if (retired.stripEmpty) throw new Error('the strip still reports empty with a live cord');
  if (retired.cords !== 1) throw new Error(`expected 1 live cord after N, read ${retired.cords}`);

  // --- ACT 2 — the early grace blink ------------------------------------------
  // (The spawned cord 1 is already carried at the cursor; seat red on 04.)
  await drag(ws, SPAWN_AT, CUBE04_TOP);
  await sleep(600);
  await releaseAt(ws, CUBE04_TOP);
  await sleep(2400); // red's settle; blue rests at the spawn column

  const blue = await findJackIn(ws, SCAN);
  if (blue === null) throw new Error('blue jack not found in the scan window');
  await grabJack(ws, blue);
  process.stdout.write(`refine1-e2e: blue jack grabbed at ${JSON.stringify(blue)}\n`);

  await drag(ws, blue, CUBE05_TOP);
  await sleep(600);
  await releaseAt(ws, CUBE05_TOP);
  await sleep(2600); // the settle into the linked rest

  let cords = await lifecycleNow(ws);
  if (cords.find((c) => c.id === 0)?.state !== 'linked') {
    throw new Error(`cord 1 did not reach linked (${JSON.stringify(cords)})`);
  }

  // THE OVER-STRETCH (INT-6): grab cube 05 and drag it away from cube 04.
  await send(ws, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x: CUBE05_GRAB.x, y: CUBE05_GRAB.y, button: 'left', buttons: 1, clickCount: 1,
  });
  await sleep(180);
  await drag(ws, CUBE05_GRAB, CUBE05_DRAG_TO, 16, 60);
  await sleep(150);
  cords = await lifecycleNow(ws);
  const popped = cords.find((c) => c.id === 0);
  if (popped?.state !== 'popped') {
    throw new Error(`cord 1 did not pop (read ${popped?.state ?? 'gone'}) — over-stretch never fired`);
  }
  process.stdout.write(`refine1-e2e: popped, grace ${popped.grace?.toFixed(3)}s\n`);
  await releaseAt(ws, CUBE05_DRAG_TO);
  await sleep(250);

  // Hold INSIDE the widened window: wait for remaining < 1.35s (inside the
  // 1.5s blink window — under the OLD law this was steady until 1.0s), then
  // sample the band until both phases are seen.
  await waitFor('grace inside the early blink window (remaining 0.9–1.35s)', async () => {
    const me = (await lifecycleNow(ws)).find((c) => c.id === 0);
    return me?.state === 'popped' && typeof me.grace === 'number'
      && me.grace <= 1.35 && me.grace >= 0.9 ? me : null;
  }, 6000, 40);
  let sawLit = 0;
  let sawOff = 0;
  let shotRemaining = null;
  const windowStarted = Date.now();
  while (Date.now() - windowStarted < 16000) {
    const paint = await statePaintNow(ws);
    const me = paint?.cords?.find((c) => c.id === 0);
    const cordsNow = (await lifecycleNow(ws)).find((c) => c.id === 0);
    if (me && me.grace && typeof me.grace.remaining === 'number') {
      if (me.bandOff) sawOff += 1; else sawLit += 1;
      if (me.bandOff && shotRemaining === null && me.grace.remaining > 0.55) {
        shotRemaining = me.grace.remaining;
        await shoot(ws, GRACE_SHOT); // mid-grace, band in its blinked-OFF phase
      }
    }
    if (cordsNow?.state === 'vanishing') break; // the window closed — expiry
    await sleep(55);
  }
  process.stdout.write(
    `refine1-e2e: early-window band sampler — lit=${sawLit} off=${sawOff} (capture at remaining ${shotRemaining?.toFixed(3) ?? 'n/a'}s)\n`,
  );
  if (sawLit === 0 || sawOff === 0) {
    throw new Error(`the band did not blink inside the early window (lit=${sawLit}, off=${sawOff}) — the widened law is not live`);
  }
  if (shotRemaining === null) throw new Error('no blinked-OFF frame was captured mid-grace');

  // --- ACT 3 — the failure's ONE spoken line ----------------------------------
  // The cord is now vanishing (or about to): poll the live region until the
  // despawn completes, collecting every distinct sentence.
  const sentences = [];
  const record = (text) => {
    if (sentences[sentences.length - 1] !== text) sentences.push(text);
  };
  let maxFragments = 0;
  await waitFor('the vanish sequence completes (cord 0 gone)', async () => {
    record(await summaryNow(ws));
    const paint = await statePaintNow(ws);
    if (Number.isFinite(paint?.fragments) && paint.fragments > maxFragments) {
      maxFragments = paint.fragments; // the burst rides INSIDE the sequence
    }
    const me = (await lifecycleNow(ws)).find((c) => c.id === 0);
    return me === undefined && maxFragments > 0;
  }, 15000, 55);
  await sleep(400);
  record(await summaryNow(ws));
  process.stdout.write(`refine1-e2e: summary sentence stream —\n  ${sentences.join('\n  ')}\n`);

  const noticeSentences = sentences.filter((s) => s.startsWith(NOTICE_LINE));
  if (noticeSentences.length !== 1) {
    throw new Error(`expected exactly ONE notice-led sentence, saw ${noticeSentences.length}: ${JSON.stringify(noticeSentences)}`);
  }
  if (!noticeSentences[0].includes('1 vanishing')) {
    throw new Error(`the notice sentence does not carry the vanishing count: ${noticeSentences[0]}`);
  }
  const firstNoticeIndex = sentences.indexOf(noticeSentences[0]);
  const after = sentences.slice(firstNoticeIndex + 1);
  if (after.some((s) => s.includes('shattered'))) {
    throw new Error('the death line repeated after its one window (spam)');
  }
  if (after.length === 0) throw new Error('no sentence followed the notice — the despawn never retired it');

  process.stdout.write(`refine1-e2e: shatter burst observed at ${maxFragments} live shards\n`);
  if (maxFragments !== 18) {
    throw new Error(`the burst read ${maxFragments} shards, expected the REFINE-1 count 18`);
  }

  // The bench settles back to its post-reset truth: EMPTY (the reset world
  // carries no anchor) — the summary's own empty-scene line.
  const finalSummary = await summaryNow(ws);
  if (finalSummary !== 'No cords on the bench. Press N for a new cord.') {
    throw new Error(`unexpected final sentence: ${finalSummary}`);
  }

  if (pageErrors.length > 0) {
    throw new Error(`page errors during the drive: ${pageErrors.join(' | ')}`);
  }

  process.stdout.write(
    `REFINE1_E2E_OK ${HINT_SHOT} + ${GRACE_SHOT} (0 page errors; notice spoken once; band lit=${sawLit}/off=${sawOff}; shards 18)\n`,
  );
  ws.close();
} catch (error) {
  process.exitCode = 1;
  process.stdout.write(`REFINE1_E2E_FAILED ${error.message}\n`);
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

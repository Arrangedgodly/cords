#!/usr/bin/env node
/**
 * REFINE-4 end-to-end drive — the critique's P2 "never-seated dropped cords
 * never self-clean" (PRODUCT.md: "self-clean when abandoned"), proven in the
 * BUILT page with trusted browser input (same CDP plumbing as refine2-e2e):
 *
 *   1. THE OPENING CORD IS IMMUNE (guard first): at load cord 0 reads
 *      exactly awaiting-plug — a seated cord is never idle, and the whole
 *      drive below proves it STAYS that way while a coil self-cleans beside
 *      it.
 *   2. ABANDONMENT: spawn a cord (N), drop it off-cube, and leave it. The
 *      world's abandonment sweep opens the machine's ~10 s idle window the
 *      moment the drop's carry targets stop; expiry enters the LIFE-2
 *      sequence (reason 'abandoned'). The drive polls the `lifecycle()`
 *      seam's new `idle` read to pace itself (the sim clock may lag wall
 *      time under swiftshader), captures `.impeccable/review/
 *      refine4-decay.png` mid-decay (state 'vanishing'), and proves:
 *      the cord leaves the world, the aria-live summary spoke
 *      "Cord put away." (NOT the shattered line), and cord 0 is STILL
 *      awaiting-plug — seated never idles.
 *   3. GRAB-BEFORE-WINDOW RESCUE: spawn + drop again, wait ~half the
 *      window, then find and GRAB the idling jack (probe-press verified
 *      against the seam, by cord id). Assert the idle timer cancelled
 *      (idle back to the full window), seat the rescued cord on a cube
 *      (post-rescue normality: it behaves like any fresh cord), and prove
 *      it NEVER vanishes past the original window's edge.
 *
 * No sim-time fast-forward seam exists (the sim advances only through rAF
 * frames), so the window is waited out honestly in wall-clock (~10 s), paced
 * by the seam's own countdown.
 *
 * Exit 0 when every assertion held with zero page errors.
 *
 * Usage: node scripts/refine4-e2e.mjs [decay-shot]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const CHROME =
  process.env.CORDS_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = 9351;
const PORT = 5214;
const APP_URL = `http://localhost:${PORT}/`;
const DECAY_SHOT = process.argv[2] ?? '.impeccable/review/refine4-decay.png';

// World → screen waypoints (refine2/ren5-e2e's proven derivation, fixed camera).
const SPAWN_AT = { x: 789, y: 391 };
const CUBE05_TOP = { x: 1018, y: 464 };
const NEUTRAL = { x: 640, y: 700 }; // open floor
// The dropped coil's RED jack: the drop controller drives the held end to
// floor rest AT THE RELEASE POINT's column — the spawn-column rest ren5-e2e
// pinned at ≈ (789, 538). A tight neighborhood around it (clear of every
// projected cube box, below cube 08's y 552) is the rescue scan; a wider
// fallback covers the coil's uncoil drift.
const REST_SCAN = { x0: 765, x1: 815, y0: 522, y1: 554, step: 8 };
const REST_SCAN_WIDE = { x0: 735, x1: 870, y0: 480, y1: 560, step: 10 };
// ren5-e2e's projected cube boxes — a cube body also reads 'grab' (a press
// there grabs the CUBE), so scan cells are kept clear of every box (+8 px).
const CUBE_BOXES = [
  [405, 514, 440, 534], [469, 603, 487, 622], [521, 599, 413, 487],
  [840, 978, 492, 631], [956, 1081, 455, 562], [844, 926, 417, 494],
  [641, 703, 404, 471], [771, 943, 552, 748],
];
const inCubeBox = (x, y) =>
  CUBE_BOXES.some(([x0, x1, y0, y1]) => x >= x0 - 8 && x <= x1 + 8 && y >= y0 - 8 && y <= y1 + 8);

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
  throw new Error(`refine4-e2e: timed out waiting for ${desc}${lastError ? ` (${lastError.message})` : ''}`);
}

// --- CDP over WebSocket (same plumbing as refine2-e2e.mjs) --------------------

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

const mouseMove = (ws, x, y) =>
  send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 1 });

async function drag(ws, from, to, steps = 14, holdMs = 55) {
  for (let i = 1; i <= steps; i += 1) {
    await mouseMove(ws, from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    await sleep(holdMs);
  }
}

const grabJack = async (ws, at) => {
  await send(ws, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x: at.x, y: at.y, button: 'left', buttons: 1, clickCount: 1,
  });
  await sleep(180);
  if ((await cursorNow(ws)) !== 'grabbing') {
    throw new Error(`grab at ${JSON.stringify(at)} did not engage a carry`);
  }
};

const releaseAt = async (ws, at) => {
  await send(ws, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: at.x, y: at.y, button: 'left', buttons: 0, clickCount: 1,
  });
};

/**
 * Find and GRAB the idling coil's jack (ren5-e2e's fast single-read pattern,
 * box-excluded, tightened): a stable 'grab' read at a cube-free cell is a
 * JACK; the press is then verified against the seam BY CORD ID and BY THE
 * GRAB-CANCEL LAW — a real jack grab resets the idle window to full within a
 * frame or two. A miss is released and the scan continues.
 */
async function findAndGrabIdlingJack(ws, cordId, window_) {
  for (let y = window_.y0; y <= window_.y1; y += window_.step) {
    for (let x = window_.x0; x <= window_.x1; x += window_.step) {
      if (inCubeBox(x, y)) continue; // a cube body also reads 'grab' — never press one
      await mouseMove(ws, x, y);
      await sleep(70);
      if ((await cursorNow(ws)) !== 'grab') continue;
      await sleep(70);
      if ((await cursorNow(ws)) !== 'grab') continue; // stable read, no away trip
      await send(ws, 'Input.dispatchMouseEvent', {
        type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1,
      });
      await sleep(280); // a frame or two: the carry target flows, the window resets
      const cords = await lifecycleNow(ws);
      const target = cords.find((c) => c.id === cordId);
      const grabbedRight =
        target?.state === 'carried' &&
        typeof target.idle === 'number' &&
        target.idle > 9.0 && // THE GRAB-CANCEL PROOF: the timer restarted at full
        (await cursorNow(ws)) === 'grabbing';
      if (grabbedRight) return { x, y };
      await releaseAt(ws, { x, y });
      await sleep(200);
    }
  }
  return null;
}

// --- Main --------------------------------------------------------------------

const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'ignore',
  detached: true,
});
const profileDir = mkdtempSync(join(tmpdir(), 'cords-refine4-'));
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
  await sleep(3500); // the opening intro converge (~2 s) + margin

  // --- GUARD — the opening cord is seated, awaiting-plug, and never idles ---
  let cords = await lifecycleNow(ws);
  if (cords.length !== 1 || cords[0]?.id !== 0 || cords[0]?.state !== 'awaiting-plug') {
    throw new Error(`expected exactly the opening cord awaiting-plug at load, read ${JSON.stringify(cords)}`);
  }
  process.stdout.write(`refine4-e2e: load — ${JSON.stringify(cords)}\n`);

  // --- ACT 1 — abandonment: drop a coil, leave it, watch it self-clean ------
  await mouseMove(ws, SPAWN_AT.x, SPAWN_AT.y);
  await sleep(150);
  await pressN(ws); // cord 1, red carried at the cursor
  await sleep(700);
  await releaseAt(ws, SPAWN_AT); // off-cube: the ordinary drop → the idle window
  await sleep(2600); // the drop converges; the sweep opens the count

  cords = await lifecycleNow(ws);
  const dropped = cords.find((c) => c.id === 1);
  if (dropped?.state !== 'carried' || typeof dropped?.idle !== 'number') {
    throw new Error(`dropped cord 1 not idling after the drop: ${JSON.stringify(cords)}`);
  }
  if (dropped.idle > 10.01 || dropped.idle < 6) {
    throw new Error(`dropped cord 1's idle window should be mid-count (~6–10 s), read ${dropped.idle}`);
  }
  process.stdout.write(`refine4-e2e: cord 1 idling — idle ${dropped.idle.toFixed(3)} s\n`);

  // Pace by the seam's own countdown (sim clock, maybe < real time); fast
  // poll near the edge to catch the 'vanishing' frame for the decay capture.
  let sawVanishing = false;
  let sawPutAwayLine = false;
  const summarySamples = [];
  const abandonDeadline = Date.now() + 40000;
  while (Date.now() < abandonDeadline) {
    cords = await lifecycleNow(ws);
    const cord1 = cords.find((c) => c.id === 1);
    const summary = await summaryNow(ws);
    if (summary.includes('put away')) sawPutAwayLine = true;
    summarySamples.push(summary);
    if (cord1 === undefined) break; // gone: the world removed it
    if (cord1.state === 'vanishing') {
      if (!sawVanishing) {
        sawVanishing = true;
        await shoot(ws, DECAY_SHOT); // mid-decay: the coil dimming/fading out
      }
    }
    const near = typeof cord1.idle === 'number' ? cord1.idle <= 1.5 : true;
    await sleep(near ? 70 : 220);
  }
  const finalAct1 = await lifecycleNow(ws);
  if (finalAct1.some((c) => c.id === 1)) {
    throw new Error(`cord 1 never self-cleaned: ${JSON.stringify(finalAct1)}`);
  }
  process.stdout.write(`refine4-e2e: cord 1 abandoned → gone (vanishing seen: ${sawVanishing})\n`);

  // The summary spoke the put-away line — once, in its own vocabulary.
  if (!sawPutAwayLine) {
    throw new Error(`the aria-live summary never said "Cord put away." — samples: ${JSON.stringify(summarySamples.slice(-6))}`);
  }
  const anyShatterLine = summarySamples.some((s) => s.includes('shattered'));
  if (anyShatterLine) {
    throw new Error('the abandonment spoke the FAILURE line (shattered) — wrong vocabulary');
  }

  // THE OPENING CORD IS IMMUNE: it sat out the whole window beside the coil.
  const opening = finalAct1.find((c) => c.id === 0);
  if (opening?.state !== 'awaiting-plug') {
    throw new Error(`the opening cord did not survive the abandonment window: ${JSON.stringify(finalAct1)}`);
  }

  // --- ACT 2 — grab-before-window rescue + post-rescue normality -------------
  await mouseMove(ws, SPAWN_AT.x, SPAWN_AT.y);
  await sleep(150);
  await pressN(ws); // cord 2
  await sleep(700);
  await releaseAt(ws, SPAWN_AT); // dropped off-cube: the window opens again
  await sleep(2500); // converge

  // Wait for the drop to converge (the window opens when its targets stop),
  // then a beat — the scan starts with ~8 s of window left.
  const settleDeadline = Date.now() + 20000;
  for (;;) {
    cords = await lifecycleNow(ws);
    const c2 = cords.find((c) => c.id === 2);
    if (c2 === undefined) throw new Error(`cord 2 vanished before the rescue: ${JSON.stringify(cords)}`);
    if (typeof c2.idle === 'number' && c2.idle <= 8) break;
    if (Date.now() > settleDeadline) {
      throw new Error(`cord 2's idle window never opened: ${JSON.stringify(cords)}`);
    }
    await sleep(200);
  }

  // THE GRAB: find the idling jack and pick it up (id + grab-cancel verified).
  let rescue = await findAndGrabIdlingJack(ws, 2, REST_SCAN);
  if (rescue === null) rescue = await findAndGrabIdlingJack(ws, 2, REST_SCAN_WIDE);
  if (rescue === null) throw new Error('the idling cord 2 jack not found/grabbed (rest + wide scans)');
  process.stdout.write(`refine4-e2e: cord 2 rescued at ${JSON.stringify(rescue)}\n`);

  // The timer cancelled INSTANTLY: the window reads full again.
  await sleep(300);
  cords = await lifecycleNow(ws);
  const rescued = cords.find((c) => c.id === 2);
  if (rescued?.state !== 'carried') {
    throw new Error(`rescued cord 2 not carried: ${JSON.stringify(cords)}`);
  }
  if (typeof rescued.idle !== 'number' || rescued.idle < 9.5) {
    throw new Error(`the grab did not reset the idle window fully: ${JSON.stringify(rescued)}`);
  }

  // POST-RESCUE NORMALITY: the cord drags and seats like any fresh cord.
  await drag(ws, rescue, CUBE05_TOP, 16, 55);
  await sleep(400);
  await releaseAt(ws, CUBE05_TOP);
  await sleep(1800);
  cords = await lifecycleNow(ws);
  const seated = cords.find((c) => c.id === 2);
  if (seated?.state !== 'awaiting-plug') {
    throw new Error(`rescued cord 2 did not seat normally (expected awaiting-plug): ${JSON.stringify(cords)}`);
  }

  // Past the original window's edge: BOTH survivors hold (rescued + seated).
  await sleep(9000);
  cords = await lifecycleNow(ws);
  const held2 = cords.find((c) => c.id === 2);
  const held0 = cords.find((c) => c.id === 0);
  if (held2?.state !== 'awaiting-plug') {
    throw new Error(`the rescued cord did NOT hold past the window's edge: ${JSON.stringify(cords)}`);
  }
  if (held0?.state !== 'awaiting-plug') {
    throw new Error(`the opening cord did not hold: ${JSON.stringify(cords)}`);
  }
  process.stdout.write(`refine4-e2e: survivors hold — ${JSON.stringify(cords)}\n`);

  if (pageErrors.length > 0) {
    throw new Error(`page errors during the drive: ${pageErrors.join(' | ')}`);
  }

  process.stdout.write(
    `REFINE4_E2E_OK ${DECAY_SHOT} (0 page errors; abandoned coil gone with "Cord put away."; opening cord awaiting-plug throughout; rescue reset the window and seated normally)\n`,
  );
  ws.close();
} catch (error) {
  process.exitCode = 1;
  process.stdout.write(`REFINE4_E2E_FAILED ${error.message}\n`);
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

#!/usr/bin/env node
/**
 * REFINE-2 end-to-end drive — the critique's P2 "state inks drift in situ",
 * proven in the BUILT page with trusted browser input (same CDP plumbing as
 * refine1-e2e.mjs):
 *
 *   1. METER-INK SEPARATION — link one cord across cubes 04/05, then spawn
 *      a second (carried): the strip reads CORDS 2 (amber lit) / LINKED 1
 *      (jade lit) in one frame. Assert the LIT segments' real computed
 *      styles (amber unchanged rgb(242,212,58) — the control; jade now
 *      rgb(47,189,114) on the #1f7a4a keyline with the matching glow) and
 *      capture refine2-meters.png at the critique's full-frame distance.
 *   2. POLARITY AT DISTANCE — drop the carried cord, find its BLUE jack
 *      (the end the critique flagged as reading teal), grab it, and lift it
 *      mid-air at mid-screen: capture refine2-polarity.png full-frame with
 *      the blue jack in hand mid-air and the linked cord's red+blue seated
 *      jacks also in frame. Assert the carry engaged (cursor 'grabbing',
 *      lifecycle 'carried') at the moment of the shot.
 *
 * Exit 0 when every assertion held with zero page errors. Pixel-level hue
 * analysis of both captures (and the old-vs-new comparison against the
 * critique's captures) runs outside this drive and is logged in
 * docs/ultron/production-log.md.
 *
 * Usage: node scripts/refine2-e2e.mjs [meters-shot] [polarity-shot]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const CHROME =
  process.env.CORDS_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = 9347;
const PORT = 5212;
const APP_URL = `http://localhost:${PORT}/`;
const METERS_SHOT = process.argv[2] ?? '.impeccable/review/refine2-meters.png';
const POLARITY_SHOT = process.argv[3] ?? '.impeccable/review/refine2-polarity.png';
const POLARITY_B_SHOT =
  process.argv[4] ?? '.impeccable/review/refine2-polarity-b.png';

// REFINE-2's token targets (computed-style truth the drive pins).
const AMBER_RGB = 'rgb(242, 212, 58)';
const JADE_RGB = 'rgb(47, 189, 114)';
const JADE_KEYLINE_RGB = 'rgb(31, 122, 74)';

// World → screen waypoints (pop-e2e.mjs's proven derivation, fixed camera).
const SPAWN_AT = { x: 789, y: 391 };
const CUBE04_TOP = { x: 906, y: 506 };
const CUBE05_TOP = { x: 1018, y: 464 };
// Cube 02's top, derived by the same fixed-camera projection (world
// (-0.85, 0.5, 0.95) → (539, 500)) — outside every scan window below, and
// free of seated plugs (04/05 host cord 0's ends; a release onto an occupied
// face point hits the seated jack's proxy first, not the face).
const CUBE02_TOP = { x: 539, y: 500 };
const SCAN = { x0: 680, x1: 772, y0: 480, y1: 600, step: 12 };
const NEUTRAL = { x: 640, y: 700 };
const CARRY_LIFT = { x: 789, y: 380 }; // SPAWN_AT's own height — clear void background
const CRITIQUE_CARRY = { x: 758, y: 548 }; // the critique's exact blue-carry point (over the bench)

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
  throw new Error(`refine2-e2e: timed out waiting for ${desc}${lastError ? ` (${lastError.message})` : ''}`);
}

// --- CDP over WebSocket (same plumbing as refine1-e2e.mjs) --------------------

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

/**
 * REFINE-2 — scans like findJackIn but PROVES the press: cubes also show the
 * grab cursor (they drag), so a hover hit is pressed and verified against
 * `lifecycle()` — a real jack grab makes a cord read 'carried'; a cube press
 * does not and is released before the scan continues.
 */
async function findCarriableJackIn(ws, window_) {
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
      if ((await cursorNow(ws)) !== 'grab') continue;
      // Probe-press: a jack engages a carry; anything else is released.
      await send(ws, 'Input.dispatchMouseEvent', {
        type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1,
      });
      await sleep(200);
      const carried = (await lifecycleNow(ws)).filter((c) => c.state === 'carried').length;
      if ((await cursorNow(ws)) === 'grabbing' && carried === 1) return { x, y };
      await releaseAt(ws, { x, y });
      await sleep(350);
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
const profileDir = mkdtempSync(join(tmpdir(), 'cords-refine2-'));
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

  // --- ACT 1 — the meters: amber CORDS + jade LINKED lit in one frame -------
  await pressR(ws);
  await sleep(400);
  await mouseMove(ws, SPAWN_AT.x, SPAWN_AT.y);
  await sleep(120);
  await pressN(ws); // cord 0
  await sleep(700);

  // Seat red on 04, then find + seat blue on 05 → linked.
  await drag(ws, SPAWN_AT, CUBE04_TOP);
  await sleep(600);
  await releaseAt(ws, CUBE04_TOP);
  await sleep(2400); // red's settle; blue rests at the spawn column

  let blue = null;
  for (let attempt = 0; attempt < 3 && blue === null; attempt += 1) {
    blue = await findJackIn(ws, SCAN);
    if (blue === null) {
      await pressR(ws); // the documented rest-scan flake: reset and retry
      await sleep(500);
      await mouseMove(ws, SPAWN_AT.x, SPAWN_AT.y);
      await sleep(120);
      await pressN(ws);
      await sleep(700);
      await drag(ws, SPAWN_AT, CUBE04_TOP);
      await sleep(600);
      await releaseAt(ws, CUBE04_TOP);
      await sleep(2400);
    }
  }
  if (blue === null) throw new Error('blue jack not found in the scan window (3 attempts)');

  await grabJack(ws, blue);
  await drag(ws, blue, CUBE05_TOP);
  await sleep(600);
  await releaseAt(ws, CUBE05_TOP);
  await sleep(2600); // the settle into the linked rest

  let cords = await lifecycleNow(ws);
  if (cords.find((c) => c.id === 0)?.state !== 'linked') {
    throw new Error(`cord 0 did not reach linked (${JSON.stringify(cords)})`);
  }

  // A second live cord in hand: CORDS 2 lit amber, LINKED 1 lit jade.
  await mouseMove(ws, SPAWN_AT.x, SPAWN_AT.y);
  await sleep(120);
  await pressN(ws); // cord 1, red carried at the cursor
  await sleep(900);
  cords = await lifecycleNow(ws);
  const carriedCount = cords.filter((c) => c.state === 'carried').length;
  const linkedCount = cords.filter((c) => c.state === 'linked').length;
  process.stdout.write(`refine2-e2e: meters frame — ${JSON.stringify(cords)}\n`);
  if (cords.length !== 2 || carriedCount !== 1 || linkedCount !== 1) {
    throw new Error(`expected 2 cords (1 carried + 1 linked) at the meters shot, read ${JSON.stringify(cords)}`);
  }

  // The computed-style truth of both lit meter rows, read from the live DOM.
  const meterStyle = await evaluate(ws, `JSON.stringify((() => {
    const lit = (row) => document.querySelector('.' + row + ' .hud-seg.lit');
    const count = (row) => document.querySelector('.' + row + ' .hud-count');
    const cs = (el) => getComputedStyle(el);
    const amber = lit('led-amber'), jade = lit('led-jade');
    return {
      amberSegments: document.querySelectorAll('.led-amber .hud-seg.lit').length,
      jadeSegments: document.querySelectorAll('.led-jade .hud-seg.lit').length,
      amberBg: amber ? cs(amber).backgroundColor : null,
      amberBorder: amber ? cs(amber).borderColor : null,
      jadeBg: jade ? cs(jade).backgroundColor : null,
      jadeBorder: jade ? cs(jade).borderColor : null,
      jadeGlow: jade ? cs(jade).boxShadow : null,
      amberCountColor: cs(count('led-amber')).color,
      jadeCountColor: cs(count('led-jade')).color,
      amberCountText: count('led-amber').textContent,
      jadeCountText: count('led-jade').textContent,
    };
  })())`);
  const meters = JSON.parse(String(meterStyle));
  process.stdout.write(`refine2-e2e: meter computed styles — ${JSON.stringify(meters)}\n`);
  if (meters.amberSegments !== 2) throw new Error(`expected 2 lit amber segments, saw ${meters.amberSegments}`);
  if (meters.jadeSegments !== 1) throw new Error(`expected 1 lit jade segment, saw ${meters.jadeSegments}`);
  if (meters.amberBg !== AMBER_RGB) throw new Error(`amber lit segment bg is ${meters.amberBg}, expected the unchanged ${AMBER_RGB}`);
  if (meters.jadeBg !== JADE_RGB) throw new Error(`jade lit segment bg is ${meters.jadeBg}, expected ${JADE_RGB}`);
  if (meters.jadeBorder !== JADE_KEYLINE_RGB) throw new Error(`jade keyline is ${meters.jadeBorder}, expected ${JADE_KEYLINE_RGB}`);
  if (!String(meters.jadeGlow).includes('47, 189, 114')) {
    throw new Error(`jade glow does not carry the new ink: ${meters.jadeGlow}`);
  }
  if (meters.amberCountColor !== AMBER_RGB || meters.amberCountText !== '2') {
    throw new Error(`amber numeral wrong: ${meters.amberCountColor} "${meters.amberCountText}"`);
  }
  if (meters.jadeCountColor !== JADE_RGB || meters.jadeCountText !== '1') {
    throw new Error(`jade numeral wrong: ${meters.jadeCountColor} "${meters.jadeCountText}"`);
  }
  await shoot(ws, METERS_SHOT); // full frame, both meters lit, linked pulse live

  // --- ACT 2 — polarity at distance: the blue jack carried mid-air ----------
  // Drop the in-hand cord (a never-seated carried release is an ordinary
  // drop): the red reliably settles LEFT of the spawn column (grabbed at
  // x≈652 across every earlier run) and the blue settles at/right of it
  // (x≈806–860), so a right-side scan window can only ever carry the BLUE
  // end — the flagged one. The probe-press below skips cube faces (they
  // drag, they never carry), and cord 0's seated ends (x 906/1018) sit
  // outside the window.
  await releaseAt(ws, SPAWN_AT);
  await sleep(2600); // the drop settles

  const SCAN2 = { x0: 700, x1: 890, y0: 440, y1: 680, step: 12 };
  let blue2 = null;
  for (let attempt = 0; attempt < 3 && blue2 === null; attempt += 1) {
    blue2 = await findCarriableJackIn(ws, SCAN2);
    if (blue2 === null) await sleep(800);
  }
  if (blue2 === null) throw new Error('cord 1 blue jack not found in the scan window (3 attempts)');

  await mouseMove(ws, blue2.x, blue2.y); // the probe left it hovered
  await sleep(150);
  process.stdout.write(`refine2-e2e: blue jack grabbed at ${JSON.stringify(blue2)}\n`);

  // Hold 1 — the critique's own carry point (blue-in-hand over the bench,
  // critique-a-blue-carried.png's exact scenario): the deliverable
  // full-frame polarity shot, the matched old-vs-new pair.
  await drag(ws, blue2, CRITIQUE_CARRY, 12, 55);
  await sleep(700);

  cords = await lifecycleNow(ws);
  if (cords.filter((c) => c.state === 'carried').length !== 1) {
    throw new Error(`expected exactly 1 carried cord at the polarity shot, read ${JSON.stringify(cords)}`);
  }
  if ((await cursorNow(ws)) !== 'grabbing') {
    throw new Error('the carry disengaged before the polarity shot');
  }
  await shoot(ws, POLARITY_SHOT); // full frame: blue in hand at carry distance + seated red/blue on 04/05

  // Hold 2 — lifted to the void-clear carry height (SPAWN_AT's own
  // background): the mid-air documentary companion shot.
  await drag(ws, CRITIQUE_CARRY, CARRY_LIFT, 10, 55);
  await sleep(700);
  if ((await cursorNow(ws)) !== 'grabbing') {
    throw new Error('the carry disengaged before the matched-polarity shot');
  }
  await shoot(ws, POLARITY_B_SHOT);
  cords = await lifecycleNow(ws);
  if (cords.filter((c) => c.state === 'carried').length !== 1) {
    throw new Error(`carry lost before the matched shot, read ${JSON.stringify(cords)}`);
  }

  if (pageErrors.length > 0) {
    throw new Error(`page errors during the drive: ${pageErrors.join(' | ')}`);
  }

  process.stdout.write(
    `REFINE2_E2E_OK ${METERS_SHOT} + ${POLARITY_SHOT} (0 page errors; meters ${meters.amberSegments} amber / ${meters.jadeSegments} jade lit; carry engaged at the shot)\n`,
  );
  ws.close();
} catch (error) {
  process.exitCode = 1;
  process.stdout.write(`REFINE2_E2E_FAILED ${error.message}\n`);
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

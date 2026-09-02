#!/usr/bin/env node
/**
 * INT-4 FIX end-to-end LINKED-cord drive — real input, real app, real
 * physics. Serves the BUILT bundle (vite preview), opens the production page
 * in headless Chrome + swiftshader over CDP, and drives ONE SPAWNED cord all
 * the way to the LINKED state — BOTH jacks seated on two cubes — with
 * trusted browser input (Input.dispatchKeyEvent / Input.dispatchMouseEvent):
 *
 *   1. wait out the opening intro (the staged cord rests)
 *   2. cursor over the spawn point, press N — a coiled cord spawns IN HAND
 *      (red jack carried at the cursor, blue trailing)
 *   3. wait out the uncoil, carry the RED jack a short hop to cube 04's top
 *      face, release → RED SEATS (the INT-2 socket rule). The hop is short
 *      (1.13 world vs 2.4 of cord), so the slack absorbs it and BLUE stays
 *      resting at the spawn column — inside the probe-verified scan window
 *   4. scan the window for the blue jack's 'grab' hover (the window excludes
 *      every cube's screen rect and the M1 cord's resting jack, which show
 *      the same affordance), double-confirm it is stable, grab BLUE
 *   5. drag blue to cube 05's top face, release → SEATED — the spawned cord
 *      is now LINKED (both ends seated), the verifier's unreachable state
 *   6. screenshot of record: the visibly LINKED cord
 *   7. grab cube 05 itself (clear of its seated plug) and DRAG it: the blue
 *      plug rides its cube (per-end seat transport) while red holds on
 *      cube 04 — mid-drag screenshot, then release
 *
 * Exits 0 when the drive completed with zero page errors; the screenshots
 * are the visual evidence (the sim-level proof lives in cordWorld.test.ts).
 *
 * Usage: node scripts/linked-e2e.mjs [linked-shot] [transport-shot]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const CHROME =
  process.env.CORDS_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = 9343;
const PORT = 5203;
const APP_URL = `http://localhost:${PORT}/`;
const LINKED_SHOT = process.argv[2] ?? '.impeccable/review/int4-linked-fix.png';
const TRANSPORT_SHOT = process.argv[3] ?? '.impeccable/review/int4-linked-fix-transport.png';

// World → screen waypoints, from the fixed production camera (scene.ts:
// position (0,1.45,4.5), lookAt (0,0.55,0), fov 60, 1440x900; basis right
// (1,0,0), up (0,0.98058,-0.19612), forward (0,-0.19612,-0.98058),
// f = 450/tan(30°) ≈ 779.42 — same derivation as seat-e2e.mjs):
const SPAWN_AT = { x: 789, y: 391 };     // world (0.4, 0.9, 0) — spawn-plane point
const CUBE04_TOP = { x: 906, y: 506 };   // world (0.85, 0.5, 1.05) — red seats here
const BLUE_REST = { x: 727, y: 531 };    // world (0.4, 0.055, 0) — where blue settles
const CUBE05_TOP = { x: 1018, y: 464 };  // world (1.7, 0.5, 0.15) — blue seats here
const CUBE05_BODY = { x: 1050, y: 545 }; // cube 05's front face, clear of its seated plug
const CUBE05_DRAG = { x: 1120, y: 620 }; // transport destination — away from cube 04, cord stays visible
// The blue-jack scan window: covers the rest spot (±0.2 world coil radius
// ≈ ±40 px) and EXCLUDES every cube's screen rect (cube 08 x ≥ 775, cube 07
// y ≤ 475, cube 02 x ≤ 600) and the OPENING cord's resting jack (REFINE-3:
// it rests at ≈ (622,547), its grab halo reaching ≈ x 645 — the draped body
// is never grabbable, only jack proxies and cubes are) — inside this window
// a 'grab' hover can only be the spawned cord's blue end.
const SCAN = { x0: 680, x1: 772, y0: 480, y1: 600, step: 12 };
const NEUTRAL = { x: 640, y: 700 }; // open floor — hover reads 'default' there

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
  throw new Error(`linked-e2e: timed out waiting for ${desc}${lastError ? ` (${lastError.message})` : ''}`);
}

// --- CDP over WebSocket (same plumbing as seat-e2e.mjs) -----------------------

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

const pressN = async (ws) => {
  await send(ws, 'Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key: 'n',
    code: 'KeyN',
    windowsVirtualKeyCode: 78,
    nativeVirtualKeyCode: 78,
    text: 'n',
    unmodifiedText: 'n',
  });
  await sleep(30);
  await send(ws, 'Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'n',
    code: 'KeyN',
    windowsVirtualKeyCode: 78,
    nativeVirtualKeyCode: 78,
  });
};

const shoot = async (ws, path) => {
  const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
  writeFileSync(path, Buffer.from(shot.data, 'base64'));
};

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

/**
 * Find the blue jack: scan for 'grab', then DOUBLE-CONFIRM — away to the
 * neutral floor spot (must read 'default') and back (must read 'grab'
 * again). A graze on a cube edge flickers; a jack proxy is stable.
 */
async function findJack(ws) {
  for (let y = SCAN.y0; y <= SCAN.y1; y += SCAN.step) {
    for (let x = SCAN.x0; x <= SCAN.x1; x += SCAN.step) {
      await mouseMove(ws, x, y);
      await sleep(70);
      if ((await cursorNow(ws)) !== 'grab') continue;
      await sleep(80);
      if ((await cursorNow(ws)) !== 'grab') continue; // stable read
      await mouseMove(ws, NEUTRAL.x, NEUTRAL.y);
      await sleep(140);
      if ((await cursorNow(ws)) !== 'default') continue; // not a stable jack hit
      await mouseMove(ws, x, y);
      await sleep(140);
      if ((await cursorNow(ws)) === 'grab') return { x, y };
    }
  }
  return null;
}

/** Grab the jack under (x,y): press, then require the carrying cursor. */
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
const profileDir = mkdtempSync(join(tmpdir(), 'cords-linked-'));
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

  // 1. spawn: cursor to the spawn point, the REAL N key — cord in hand.
  await mouseMove(ws, SPAWN_AT.x, SPAWN_AT.y);
  await sleep(150);
  await pressN(ws);
  await sleep(2400); // the uncoil settles; red stays carried at the cursor

  // 2. carry the RED jack to cube 04's top face (short hop — the slack
  //    absorbs it, blue stays at the spawn column) and release → RED SEATS.
  await drag(ws, SPAWN_AT, CUBE04_TOP);
  await sleep(600); // the carried pin converges against the drag plane
  await releaseAt(ws, CUBE04_TOP);
  await sleep(2400); // red's settle; blue rests at the spawn column

  // 3. find the BLUE jack in the window, grab it (grabbing one end of a
  //    cord with the other just seated — the awaiting-plug → linked path).
  const blue = await findJack(ws);
  if (blue === null) throw new Error('blue jack not found in the scan window');
  await grabJack(ws, blue);
  process.stdout.write(`linked-e2e: blue jack grabbed at ${JSON.stringify(blue)}\n`);

  // 4. carry blue to cube 05's top face and release → SEATED. LINKED: both
  //    ends of the spawned cord hold their sockets.
  await drag(ws, blue, CUBE05_TOP);
  await sleep(600);
  await releaseAt(ws, CUBE05_TOP);
  await sleep(2600); // the settle: the cord sighs into its linked rest

  // 5. screenshot of record: the visibly LINKED cord (both jacks seated).
  await shoot(ws, LINKED_SHOT);

  // 6. SEAT TRANSPORT, visually: grab cube 05's front face (clear of the
  //    seated blue plug; cube 05 is the unoccluded near cube) and drag —
  //    the plug rides its cube while red holds on cube 04.
  await send(ws, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x: CUBE05_BODY.x, y: CUBE05_BODY.y, button: 'left', buttons: 1, clickCount: 1,
  });
  await sleep(180);
  await drag(ws, CUBE05_BODY, CUBE05_DRAG, 10);
  await sleep(500); // mid-drag hold: the plug riding, the cord trailing
  await shoot(ws, TRANSPORT_SHOT);
  await releaseAt(ws, CUBE05_DRAG);
  await sleep(2200);

  if (pageErrors.length > 0) {
    throw new Error(`page errors during the drive: ${pageErrors.join(' | ')}`);
  }

  process.stdout.write(`LINKED_E2E_OK ${LINKED_SHOT} + ${TRANSPORT_SHOT} (0 page errors)\n`);
  ws.close();
} catch (error) {
  process.exitCode = 1;
  process.stdout.write(`LINKED_E2E_FAILED ${error.message}\n`);
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

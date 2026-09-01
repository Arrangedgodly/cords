#!/usr/bin/env node
/**
 * T-LIFE-1 end-to-end RELEASE-ROUTING drive — real input, real app, real
 * lifecycle. Serves the BUILT bundle (vite preview), opens the production page
 * in headless Chrome + swiftshader over CDP, and drives the approved
 * release decisions through the REAL composition (main.ts):
 *
 *   1. wait out the M1 intro, press N — a coiled cord spawns IN HAND
 *      (lifecycle reads `carried`, red end carrying)
 *   2. carry the RED jack to cube 04's top face and release → RED SEATS
 *      (lifecycle reads `awaiting-plug`)
 *   3. the AMENDMENT check: the SEATED red plug still reads 'grab' —
 *      hand-pulled plugs are legal (INT-4's seated re-grab stands)
 *   4. find the BLUE jack (free end), grab it, carry it over OPEN FLOOR and
 *      release → NOT over a cube: the user-initiated failure — lifecycle
 *      reads `vanishing` (the releaseJack intent routed through main.ts)
 *   5. screenshot of record: the cord hanging from its ONE seated plug
 *      (the FSM is locked; LIFE-2's choreography will own what follows)
 *   6. THE COMPOSED REMOVAL PATH on a second cord: spawn, seat red on
 *      cube 04, seat blue on cube 05 (LINKED), then GRAB THE SEATED BLUE
 *      PLUG (the hand-pulled plug — linked → awaiting-plug, red holding),
 *      carry it over open floor, release → NOT over a cube → `vanishing`.
 *      Manual unplug + off-cube release is an approved removal path.
 *
 * Exits 0 when the drive completed with zero page errors; every state read
 * goes through the `window.cords.lifecycle()` seam (labels name real state).
 *
 * Usage: node scripts/release-e2e.mjs [vanish-shot] [composed-shot]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const CHROME =
  process.env.CORDS_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = 9347;
const PORT = 5207;
const APP_URL = `http://localhost:${PORT}/`;
const VANISH_SHOT = process.argv[2] ?? '.impeccable/review/life1-release-vanish.png';
const COMPOSED_SHOT = process.argv[3] ?? '.impeccable/review/life1-composed-vanish.png';

// World → screen waypoints, from the fixed production camera (same
// derivation as seat-e2e/linked-e2e).
const SPAWN_AT = { x: 789, y: 391 };     // world (0.4, 0.9, 0) — spawn-plane point
const CUBE04_TOP = { x: 906, y: 506 };   // world (0.85, 0.5, 1.05) — red seats here
const CUBE05_TOP = { x: 1018, y: 464 };  // world (1.7, 0.5, 0.15) — a top-face seat
const CUBE05_BODY = { x: 1050, y: 545 }; // cube 05's front face, clear of its top plug
const NEUTRAL = { x: 640, y: 700 };      // open floor — NOT over any cube
// The blue-jack scan window (from linked-e2e): covers the rest spot and
// EXCLUDES every cube's screen rect and the M1 cord's resting jack.
const SCAN = { x0: 680, x1: 772, y0: 480, y1: 600, step: 12 };

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
  throw new Error(`release-e2e: timed out waiting for ${desc}${lastError ? ` (${lastError.message})` : ''}`);
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

const lifecycleNow = async (ws) => {
  const res = await send(ws, 'Runtime.evaluate', {
    expression: 'JSON.stringify(window.cords?.lifecycle?.() ?? null)',
    returnByValue: true,
  });
  return JSON.parse(String(res.result?.value ?? 'null'));
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
      if ((await cursorNow(ws)) !== 'grab') continue; // stable read
      return { x, y };
    }
  }
  return null;
}

/**
 * Probe the SEATED plug's affordance at its exact seat pixel. The jack proxy
 * shadows the cube face there (priority jack > cube — the pre-amendment drive
 * read 'default' at this pixel precisely because the ungrabbable jack covered
 * it), so 'grab' here means the PLUG is grabbable, not the cube under it.
 */
async function seatedPlugReadsGrabbable(ws, at) {
  await mouseMove(ws, at.x, at.y);
  await sleep(150);
  const first = await cursorNow(ws);
  await sleep(120);
  const second = await cursorNow(ws); // stable read
  return first === 'grab' && second === 'grab';
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

// CORDS_PREVIEW_URL reuses an already-running preview (e.g. a persistent dev
// harness); otherwise the script serves the BUILT bundle itself.
const preview =
  process.env.CORDS_PREVIEW_URL !== undefined
    ? null
    : spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
        cwd: new URL('..', import.meta.url).pathname,
        stdio: 'ignore',
        detached: true,
      });
const appUrl = process.env.CORDS_PREVIEW_URL ?? APP_URL;
const profileDir = mkdtempSync(join(tmpdir(), 'cords-release-'));
let chrome;
const pageErrors = [];

try {
  await waitFor('vite preview server', async () => {
    const res = await fetch(appUrl);
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
  await send(ws, 'Page.navigate', { url: appUrl });
  await sleep(3500); // the M1 intro converge (~2 s) + margin

  const cordState = (dump, id) => dump?.find((c) => c.id === id)?.state ?? 'missing';

  // 1. spawn: cursor to the spawn point, the REAL N key — cord in hand.
  await mouseMove(ws, SPAWN_AT.x, SPAWN_AT.y);
  await sleep(150);
  await pressN(ws);
  await sleep(2400); // the uncoil settles; red stays carried at the cursor
  const afterSpawn = await lifecycleNow(ws);
  process.stdout.write(`release-e2e: after spawn → ${JSON.stringify(afterSpawn)}\n`);
  if (cordState(afterSpawn, 1) !== 'carried') {
    throw new Error(`after spawn the cord reads ${cordState(afterSpawn, 1)}, expected carried`);
  }

  // 2. carry the RED jack to cube 04's top face and release → SEATED.
  await drag(ws, SPAWN_AT, CUBE04_TOP);
  await sleep(600); // the carried pin converges against the drag plane
  await releaseAt(ws, CUBE04_TOP);
  await sleep(2400); // red's settle; blue rests at the spawn column
  const afterSeat = await lifecycleNow(ws);
  process.stdout.write(`release-e2e: after seat → ${JSON.stringify(afterSeat)}\n`);
  if (cordState(afterSeat, 1) !== 'awaiting-plug') {
    throw new Error(`after seating the red jack the cord reads ${cordState(afterSeat, 1)}, expected awaiting-plug`);
  }

  // 3. the AMENDMENT check: the SEATED red plug reads 'grab' at its seat
  //    pixel — the jack proxy shadows the cube there (the pre-amendment drive
  //    read 'default' at this pixel), so 'grab' means the PLUG is grabbable:
  //    the hand-pulled plug is legal (INT-4's seated re-grab stands).
  const plugGrabbable = await seatedPlugReadsGrabbable(ws, CUBE04_TOP);
  process.stdout.write(`release-e2e: seated plug hover → '${plugGrabbable ? 'grab' : 'NOT GRAB'}' at ${JSON.stringify(CUBE04_TOP)}\n`);
  if (!plugGrabbable) {
    throw new Error('the seated plug does not read grabbable — the amendment is not wired');
  }

  // 4. find the BLUE jack (free end), grab it, carry it over open floor and
  //    release → NOT over a cube: the user-initiated failure → vanishing.
  const blue = await findJack(ws);
  if (blue === null) throw new Error('blue jack not found in the scan window');
  await grabJack(ws, blue);
  process.stdout.write(`release-e2e: blue jack grabbed at ${JSON.stringify(blue)}\n`);
  await drag(ws, blue, NEUTRAL);
  await sleep(600); // the carried pin converges against the drag plane
  await releaseAt(ws, NEUTRAL);
  await waitFor('the cord to vanish (the releaseJack intent)', async () => {
    const dump = await lifecycleNow(ws);
    return cordState(dump, 1) === 'vanishing' ? dump : null;
  });
  const afterRelease = await lifecycleNow(ws);
  process.stdout.write(`release-e2e: after off-cube release → ${JSON.stringify(afterRelease)}\n`);
  const entry = afterRelease?.find((c) => c.id === 1);
  if (entry === undefined || entry.state !== 'vanishing' || entry.grace !== null) {
    throw new Error(`expected cord 1 vanishing with no grace, got ${JSON.stringify(entry)}`);
  }

  // 5. screenshot of record: the cord hanging from its ONE seated plug —
  //    the FSM is locked (LIFE-2 owns what the vanish looks like).
  await sleep(1200);
  await shoot(ws, VANISH_SHOT);

  // 6. THE COMPOSED REMOVAL PATH on a second cord: spawn, seat red on cube
  //    05's top face, seat blue on cube 05's FRONT face (both seats on one
  //    cube — a self-link; cord 1's vanishing plug still shadows cube 04's
  //    top face, so cube 05 is the unshadowed host), then GRAB THE SEATED
  //    BLUE PLUG (the hand-pulled plug — linked → awaiting-plug with red
  //    holding), carry it over open floor, release → NOT over a cube →
  //    `vanishing`. Manual unplug + off-cube release is an approved removal.
  await mouseMove(ws, SPAWN_AT.x, SPAWN_AT.y);
  await sleep(150);
  await pressN(ws);
  await sleep(2400); // the uncoil settles
  let dump = await lifecycleNow(ws);
  if (cordState(dump, 2) !== 'carried') {
    throw new Error(`composed: cord 2 reads ${cordState(dump, 2)} after spawn, expected carried`);
  }
  // Seat red on cube 05's top face (unshadowed).
  await drag(ws, SPAWN_AT, CUBE05_TOP);
  await sleep(600);
  await releaseAt(ws, CUBE05_TOP);
  await sleep(2400);
  dump = await lifecycleNow(ws);
  if (cordState(dump, 2) !== 'awaiting-plug') {
    throw new Error(`composed: cord 2 reads ${cordState(dump, 2)} after red's seat, expected awaiting-plug`);
  }
  // Seat blue on cube 05's front face (clear of red's top plug) → LINKED.
  const blue2 = await findJack(ws);
  if (blue2 === null) throw new Error('composed: blue jack not found in the scan window');
  await grabJack(ws, blue2);
  await drag(ws, blue2, CUBE05_BODY);
  await sleep(600);
  await releaseAt(ws, CUBE05_BODY);
  await sleep(2600);
  dump = await lifecycleNow(ws);
  if (cordState(dump, 2) !== 'linked') {
    throw new Error(`composed: cord 2 reads ${cordState(dump, 2)} after blue's seat, expected linked`);
  }
  // Grab the SEATED BLUE PLUG (its proxy shadows the cube face there — the
  // lifecycle read below verifies the pull, not just the cursor).
  await grabJack(ws, CUBE05_BODY);
  process.stdout.write(`release-e2e: composed — seated blue plug pulled at ${JSON.stringify(CUBE05_BODY)}\n`);
  await sleep(400);
  dump = await lifecycleNow(ws);
  if (cordState(dump, 2) !== 'awaiting-plug') {
    throw new Error(`composed: cord 2 reads ${cordState(dump, 2)} after the pull, expected awaiting-plug (red holding)`);
  }
  // Carry the pulled plug over open floor and release → NOT over a cube.
  await drag(ws, CUBE05_BODY, NEUTRAL, 18);
  await sleep(600);
  await releaseAt(ws, NEUTRAL);
  await waitFor('composed: cord 2 to vanish (the composed removal path)', async () => {
    const d = await lifecycleNow(ws);
    return cordState(d, 2) === 'vanishing' ? d : null;
  });
  dump = await lifecycleNow(ws);
  process.stdout.write(`release-e2e: composed — after pull + off-cube release → ${JSON.stringify(dump)}\n`);
  await sleep(1200);
  await shoot(ws, COMPOSED_SHOT);

  if (pageErrors.length > 0) {
    throw new Error(`page errors during the drive: ${pageErrors.join(' | ')}`);
  }

  process.stdout.write(`RELEASE_E2E_OK ${VANISH_SHOT} + ${COMPOSED_SHOT} (0 page errors)\n`);
  // The CDP WebSocket keeps the event loop alive after the drive — end
  // deterministically once the evidence is on disk (the finally still runs).
  process.exit(0);
} finally {
  try {
    if (chrome !== undefined) process.kill(-chrome.pid);
  } catch {}
  try {
    if (preview !== null && preview.pid !== undefined) process.kill(-preview.pid);
  } catch {}
  try {
    rmSync(profileDir, { recursive: true, force: true });
  } catch {}
}

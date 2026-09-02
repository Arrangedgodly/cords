#!/usr/bin/env node
/**
 * INT-4 end-to-end spawn drive — real input, real app, real physics. Serves
 * the BUILT bundle (vite preview), opens the production page in headless
 * Chrome + swiftshader over CDP, and springs cords from midair with
 * BROWSER-LEVEL KEYBOARD EVENTS (Input.dispatchKeyEvent — trusted input):
 *
 *   1. wait out the opening intro (the staged cord rests)
 *   2. move the mouse to a stage point (the cursor's world ray is where the
 *      cord will appear) and press N — a coiled cord spawns IN HAND, red
 *      jack at the cursor, blue trailing, uncoiling by the sim alone
 *   3. ~200 ms later: screenshot MID-UNCOIL (the springy uncoil is sim
 *      physics, not keyframes — the capture is the evidence)
 *   4. wait out the settle, then DRAG the carried red jack across the stage
 *      (the carry controller follows the cursor) — carried screenshot
 *   5. press N AGAIN while carrying: the documented swap — the held end
 *      drops per the ordinary release and the new cord lands in hand
 *   6. call window.cords.spawnCord() — the exposed HUD seam (REN-3's future
 *      NEW CORD button) — a third cord appears in hand; carry it to rest
 *   7. screenshot the settled multi-cord stage
 *
 * Exits 0 when the drive completed with zero page errors (the screenshots
 * are the visual evidence; the verifier judges the uncoil).
 *
 * Usage: node scripts/spawn-e2e.mjs [mid-shot] [settled-shot] [carried-shot]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const CHROME =
  process.env.CORDS_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = 9341;
const PORT = 5201;
const APP_URL = `http://localhost:${PORT}/`;
const MID_SHOT = process.argv[2] ?? '.impeccable/review/int4-spawn.png';
const SETTLED_SHOT = process.argv[3] ?? '.impeccable/review/int4-spawn-settled.png';
const CARRIED_SHOT = process.argv[4] ?? '.impeccable/review/int4-spawn-carried.png';
const SPAWN_A = { x: 520, y: 400 };
const DRAG_TO = { x: 900, y: 300 };
const SPAWN_C = { x: 1020, y: 430 };

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
  throw new Error(`spawn-e2e: timed out waiting for ${desc}${lastError ? ` (${lastError.message})` : ''}`);
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
  // A real key press: down (with the char text so the DOM key fires) + up.
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

// --- Main --------------------------------------------------------------------

const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'ignore',
  detached: true,
});
const profileDir = mkdtempSync(join(tmpdir(), 'cords-spawn-'));
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

  // 1. cursor to the first spawn point, then the REAL N key: cord in hand.
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: SPAWN_A.x, y: SPAWN_A.y });
  await sleep(120);
  await pressN(ws);
  await sleep(200); // mid-uncoil — the springy uncoil is the sim's
  await shoot(ws, MID_SHOT);

  // 2. settle, then drag the carried red jack across the stage: the cord
  //    follows the cursor in hand (the carry controller is attached).
  await sleep(2400);
  const STEPS = 12;
  for (let i = 1; i <= STEPS; i += 1) {
    await send(ws, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: SPAWN_A.x + ((DRAG_TO.x - SPAWN_A.x) * i) / STEPS,
      y: SPAWN_A.y + ((DRAG_TO.y - SPAWN_A.y) * i) / STEPS,
    });
    await sleep(55);
  }
  await sleep(500); // the carried pin converges to the cursor
  await shoot(ws, CARRIED_SHOT);

  // 3. press N while carrying — the documented swap: the held end drops per
  //    the ordinary release and the NEW cord lands in hand at the cursor.
  await pressN(ws);
  await sleep(2400); // cord A settles where it dropped; cord B rides in hand

  // 4. carry cord B aside, then the HUD seam: window.cords.spawnCord() —
  //    the future REN-3 button path — swaps again: B drops where held, C
  //    lands in hand at the cursor.
  for (let i = 1; i <= STEPS; i += 1) {
    await send(ws, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: DRAG_TO.x + ((620 - DRAG_TO.x) * i) / STEPS,
      y: DRAG_TO.y + ((560 - DRAG_TO.y) * i) / STEPS,
    });
    await sleep(55);
  }
  await sleep(400);
  const seam = await send(ws, 'Runtime.evaluate', {
    expression: 'typeof window.cords?.spawnCord === "function"',
    returnByValue: true,
  });
  if (seam.result?.value !== true) {
    throw new Error('window.cords.spawnCord() (the HUD seam) is not exposed');
  }
  await send(ws, 'Runtime.evaluate', { expression: 'window.cords.spawnCord()' });
  await sleep(600);

  // 5. carry cord C to its rest pose for the settled multi-cord shot.
  for (let i = 1; i <= STEPS; i += 1) {
    await send(ws, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: DRAG_TO.x + ((SPAWN_C.x - DRAG_TO.x) * i) / STEPS,
      y: DRAG_TO.y + ((SPAWN_C.y - DRAG_TO.y) * i) / STEPS,
    });
    await sleep(55);
  }
  await sleep(2600); // the final settle (A and B resting on the bench, C in hand)

  if (pageErrors.length > 0) {
    throw new Error(`page errors during the drive: ${pageErrors.join(' | ')}`);
  }

  await shoot(ws, SETTLED_SHOT);
  process.stdout.write(`SPAWN_E2E_OK ${MID_SHOT} + ${SETTLED_SHOT} + ${CARRIED_SHOT} (0 page errors)\n`);
  ws.close();
} catch (error) {
  process.exitCode = 1;
  process.stdout.write(`SPAWN_E2E_FAILED ${error.message}\n`);
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

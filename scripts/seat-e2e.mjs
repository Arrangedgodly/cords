#!/usr/bin/env node
/**
 * INT-2 end-to-end seat drive — real input, real app, real physics. Serves
 * the BUILT bundle (vite preview), opens the production page in headless
 * Chrome + swiftshader over CDP, and drives the full plug flow with
 * browser-level mouse events (Input.dispatchMouseEvent — trusted input, the
 * closest thing to a hand):
 *
 *   1. wait out the M1 intro (the free end rests on the bench)
 *   2. pointer-down on the resting blue jack (projected grab point)
 *   3. drag toward cube 05's top face (projected aim point)
 *   4. pointer-up over the face → the INT-2 socket rule must SEAT the jack
 *   5. wait out the SIM-3 settle window, capture the screenshot
 *
 * Exits 0 when the drive completed with zero page errors (the screenshot is
 * the visual evidence; the verifier judges the seat). The two pixel targets
 * are derived from the fixed production camera (scene.ts: position
 * (0,1.45,4.5), lookAt (0,0.55,0), fov 60, 1440x900): world → NDC through
 * the camera basis (right (1,0,0), up (0,0.98058,-0.19612), forward
 * (0,-0.19612,-0.98058)):
 *   rest spot  (-0.4, 0.055, -0.15) → (655.5, 523.5)  the resting blue jack
 *   cube-05 top ( 1.7, 0.5,   0.15) → (1017.6, 463.7) the socket aim
 *
 * Usage: node scripts/seat-e2e.mjs [screenshot-path]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const CHROME =
  process.env.CORDS_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = 9339;
const PORT = 5198;
const APP_URL = `http://localhost:${PORT}/`;
const SHOT = process.argv[2] ?? '.impeccable/review/int2-seat-e2e.png';
const GRAB = { x: 655, y: 524 };
const AIM = { x: 1018, y: 464 };

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
  throw new Error(`seat-e2e: timed out waiting for ${desc}${lastError ? ` (${lastError.message})` : ''}`);
}

// --- CDP over WebSocket (same plumbing as measure-perf.mjs) ------------------

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

// --- Main --------------------------------------------------------------------

const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'ignore',
  detached: true,
});
const profileDir = mkdtempSync(join(tmpdir(), 'cords-seat-'));
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
  await sleep(3500); // the M1 intro converge (~2 s) + margin; end rests on the bench

  const mouseMove = (x, y) =>
    send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });

  // 1. grab the resting blue jack
  await send(ws, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x: GRAB.x, y: GRAB.y, button: 'left', buttons: 1, clickCount: 1,
  });
  await sleep(120);
  // 2. drag toward the socket in small steps (the carried pin converges bounded)
  const STEPS = 14;
  for (let i = 1; i <= STEPS; i += 1) {
    const x = GRAB.x + ((AIM.x - GRAB.x) * i) / STEPS;
    const y = GRAB.y + ((AIM.y - GRAB.y) * i) / STEPS;
    await mouseMove(x, y);
    await sleep(55);
  }
  await sleep(600); // let the carried end converge against the drag plane
  // 3. release over the cube face → the socket rule seats the jack
  await send(ws, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: AIM.x, y: AIM.y, button: 'left', buttons: 0, clickCount: 1,
  });
  await sleep(2800); // the SIM-3 settle window (~1.0–2.0 s) + margin

  if (pageErrors.length > 0) {
    throw new Error(`page errors during the drive: ${pageErrors.join(' | ')}`);
  }

  const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
  writeFileSync(SHOT, Buffer.from(shot.data, 'base64'));
  process.stdout.write(`SEAT_E2E_OK ${SHOT} (0 page errors)\n`);
  ws.close();
} catch (error) {
  process.exitCode = 1;
  process.stdout.write(`SEAT_E2E_FAILED ${error.message}\n`);
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

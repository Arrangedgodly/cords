#!/usr/bin/env node
/**
 * INT-3 end-to-end cube-drag drive — real input, real app, real physics.
 * Serves the BUILT bundle (vite preview), opens the production page in
 * headless Chrome + swiftshader over CDP, and drives the full INT-3 flow
 * with browser-level mouse events (Input.dispatchMouseEvent — trusted
 * input, the closest thing to a hand):
 *
 *   1. wait out the opening intro (the free end rests on the bench)
 *   2. grab the resting blue jack, drag to cube 05's top face, release
 *      → the INT-2 socket rule SEATS the jack (the cord is now attached
 *        to the cube)
 *   3. wait out the SIM-3 settle window
 *   4. pointer-down on cube 05's front face → INT-3 grabs the CUBE
 *   5. drag the cube across the bench (it follows the cursor on the
 *      camera-parallel plane through the grab point; the seated plug rides
 *      the cube; the cord trails from the opening cord's seated red plug)
 *   6. capture MID-DRAG (button still held) — the staged screenshot of record
 *   7. release → the cube stays where dropped (floor-clamped); capture after
 *
 * Exits 0 when the drive completed with zero page errors. Pixel targets are
 * derived from the fixed production camera (scene.ts: position (0,1.45,4.5),
 * lookAt (0,0.55,0), fov 60, 1440x900) by projecting world points (the same
 * basis seat-e2e.mjs documents: right (1,0,0), up (0,0.98058,-0.19612),
 * forward (0,-0.19612,-0.98058); x is divided by the 1.6 aspect).
 *
 * Usage: node scripts/drag-e2e.mjs [mid-drag-shot] [after-drop-shot]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const CHROME =
  process.env.CORDS_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = 9341;
const PORT = 5199;
const APP_URL = `http://localhost:${PORT}/`;
const SHOT_MID = process.argv[2] ?? '.impeccable/review/int3-drag.png';
const SHOT_AFTER = process.argv[3] ?? '.impeccable/review/int3-drop.png';

// --- Production camera basis (scene.ts) --------------------------------------
const EYE = { x: 0, y: 1.45, z: 4.5 };
const FORWARD = { x: 0, y: -0.19611613, z: -0.98058067 };
const RIGHT = { x: 1, y: 0, z: 0 };
const UP = { x: 0, y: 0.98058067, z: -0.19611613 };
const TAN_HALF_FOV = Math.tan((60 / 2) * (Math.PI / 180));
const ASPECT = 1440 / 900;
const W = 1440;
const H = 900;

/** World point → client pixel through the fixed production camera. */
function project(p) {
  const d = { x: p.x - EYE.x, y: p.y - EYE.y, z: p.z - EYE.z };
  const cx = d.x * RIGHT.x + d.y * RIGHT.y + d.z * RIGHT.z;
  const cy = d.x * UP.x + d.y * UP.y + d.z * UP.z;
  const cz = d.x * FORWARD.x + d.y * FORWARD.y + d.z * FORWARD.z;
  const sx = ((cx / (cz * TAN_HALF_FOV * ASPECT) + 1) * W) / 2;
  const sy = ((1 - cy / (cz * TAN_HALF_FOV)) * H) / 2;
  return { x: Math.round(sx), y: Math.round(sy) };
}

// --- The drive's world-space waypoints ----------------------------------------
// REFINE-3 — the opening cord's red end is SEATED on module 08's top (world
// (0.45, 0.5, 1.95)); its blue jack rests on the bench at main.ts's
// RESTING_SPOT. The drive performs the toy's core verb on it: grab blue,
// plug it into cube 05, then drag that cube — the cord trails from the
// SEATED RED PLUG (a real socket, not the old invisible anchor pin).
const JACK_REST = { x: -0.55, y: 0.055, z: 0.3 }; // the resting blue jack (main.ts RESTING_SPOT)
const SEAT_AIM = { x: 1.7, y: 0.5, z: 0.15 }; // cube 05's top face (the socket)
const CUBE_GRAB = { x: 1.7, y: 0.25, z: 0.4 }; // cube 05's front face center
// Cursor target ON the drag plane (⊥ the camera through the grab point): a
// pure +x slide (x is exactly in-plane), same floor-level y and z. The cube
// center lands at (2.05, 0.25, 0.15): the seated blue pin rides to (2.05,
// 0.418, 0.15), 2.41 from the seated red pin (0.45, 0.418, 1.95) against
// 2.4 of cord — the trailing cord reads near-taut from the red plug to the
// riding blue plug, still inside the 2.496 over-stretch bound (a shorter
// move leaves so much slack that the body piles on the bench under the
// module and the trailing read disappears into the pile).
const DRAG_TO = { x: CUBE_GRAB.x + 0.35, y: CUBE_GRAB.y, z: CUBE_GRAB.z };

// The grab point: the rope END pins at JACK_REST's projection (622,547), but
// the jack MESH extends from that point along the plug — the invisible grab
// proxy rides the mesh, centered at ≈ (629,541) (measured on the built page:
// the cursor first reads 'grab' over x ≈ 615–645, y ≈ 530–560).
const GRAB = { x: 629, y: 541 };
const AIM = project(SEAT_AIM);
const CUBE = project(CUBE_GRAB);
const DEST = project(DRAG_TO);

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
  throw new Error(`drag-e2e: timed out waiting for ${desc}${lastError ? ` (${lastError.message})` : ''}`);
}

// --- CDP over WebSocket (same plumbing as seat-e2e.mjs) ----------------------

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
const profileDir = mkdtempSync(join(tmpdir(), 'cords-drag-'));
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

  // Phase 1 — SEAT the blue jack on cube 05 (the INT-2 flow; the cord is
  // then attached to the cube the plug is seated on).
  await send(ws, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x: GRAB.x, y: GRAB.y, button: 'left', buttons: 1, clickCount: 1,
  });
  await sleep(120);
  const SEAT_STEPS = 14;
  for (let i = 1; i <= SEAT_STEPS; i += 1) {
    const x = GRAB.x + ((AIM.x - GRAB.x) * i) / SEAT_STEPS;
    const y = GRAB.y + ((AIM.y - GRAB.y) * i) / SEAT_STEPS;
    await mouseMove(x, y);
    await sleep(55);
  }
  await sleep(600); // let the carried end converge against the drag plane
  await send(ws, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: AIM.x, y: AIM.y, button: 'left', buttons: 0, clickCount: 1,
  });
  await sleep(2800); // the SIM-3 settle window (~1.0–2.0 s) + margin

  // Phase 2 — GRAB the cube and drag it across the bench (INT-3). The
  // seated plug rides the cube; the cord trails near-taut from the red plug.
  await send(ws, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x: CUBE.x, y: CUBE.y, button: 'left', buttons: 1, clickCount: 1,
  });
  await sleep(150);
  const DRAG_STEPS = 20;
  for (let i = 1; i <= DRAG_STEPS; i += 1) {
    const x = CUBE.x + ((DEST.x - CUBE.x) * i) / DRAG_STEPS;
    const y = CUBE.y + ((DEST.y - CUBE.y) * i) / DRAG_STEPS;
    await mouseMove(x, y);
    await sleep(70);
  }
  await sleep(600); // hold mid-drag: trailing cord still carries a little sway

  if (pageErrors.length > 0) {
    throw new Error(`page errors during the drive: ${pageErrors.join(' | ')}`);
  }
  const mid = await send(ws, 'Page.captureScreenshot', { format: 'png' });
  writeFileSync(SHOT_MID, Buffer.from(mid.data, 'base64'));

  // Phase 3 — RELEASE: the cube stays where dropped (already floor-clamped).
  await send(ws, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: DEST.x, y: DEST.y, button: 'left', buttons: 0, clickCount: 1,
  });
  await sleep(2500); // the post-drag re-settle (bounded: measured ≤ 2.0 s) + margin

  if (pageErrors.length > 0) {
    throw new Error(`page errors after the release: ${pageErrors.join(' | ')}`);
  }
  const after = await send(ws, 'Page.captureScreenshot', { format: 'png' });
  writeFileSync(SHOT_AFTER, Buffer.from(after.data, 'base64'));

  process.stdout.write(
    `DRAG_E2E_OK ${SHOT_MID} + ${SHOT_AFTER} (0 page errors) [grab ${GRAB.x},${GRAB.y} → seat ${AIM.x},${AIM.y} → cube ${CUBE.x},${CUBE.y} → dest ${DEST.x},${DEST.y}]\n`,
  );
  ws.close();
} catch (error) {
  process.exitCode = 1;
  process.stdout.write(`DRAG_E2E_FAILED ${error.message}\n`);
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

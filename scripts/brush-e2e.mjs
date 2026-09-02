#!/usr/bin/env node
/**
 * T-INT-5 end-to-end PASSIVE CURSOR-BRUSH drive — real input, real app, real
 * physics, NO BUTTON EVER HELD. Serves the BUILT bundle (vite preview),
 * opens the production page in headless Chrome + swiftshader over CDP, and
 * proves the approved behavior in numbers AND pixels:
 *
 *   1. wait out the M1 intro; the anchor cord is calm (motion probe baseline)
 *   2. THOR'S RULE, in pixels: park the cursor ON the cord (the ray sits
 *      inside the brush halo for the whole hold) and HOLD STILL — the motion
 *      probe reads ~zero. An idle pointer injects nothing.
 *   3. THE BRUSH: sweep the cursor horizontally across the dangling cord
 *      (buttons: 0 — pure hover). The motion probe — window.cords.
 *      readMotionProbe(), max point speed in world units per second of SIM
 *      time — must JUMP (the cord is visibly perturbed; subtle sway is hard
 *      to prove by vision, so the numbers carry the assertion). Capture the
 *      cord mid-sway (.impeccable/review/int5-brush.png) + a late frame.
 *   4. the cord calms again (the ordinary settle window), the lifecycle seam
 *      never moved (a brush is not an intent), zero page errors.
 *
 * Exits 0 on: baseline calm, idle ~0, sweep maxSpeed above threshold, decay
 * below the sweep reading, lifecycle unchanged, 0 page errors.
 *
 * Usage: node scripts/brush-e2e.mjs [sweep-shot] [late-shot]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const CHROME =
  process.env.CORDS_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = 9347;
const PORT = 5211;
const APP_URL = `http://localhost:${PORT}/`;
const SWEEP_SHOT = process.argv[2] ?? '.impeccable/review/int5-brush.png';
const LATE_SHOT = process.argv[3] ?? '.impeccable/review/int5-brush-late.png';

// The M1 anchor cord drapes from its pin at world (0, 1.6, 0) — screen
// (720, 266) — to the resting jack at world (-0.4, 0.055, -0.15) — screen
// ≈ (655, 524); same fixed-camera derivation as life2-e2e.mjs (which
// independently confirms the resting jack at x ≈ 655). Mid-drape ≈ (689,
// 390): the sweep line crosses the cord there; the idle park sits ON it.
const SWEEP_Y = 390;
const SWEEP = { x0: 540, x1: 860, y: SWEEP_Y, steps: 18, holdMs: 40 };
const PARK = { x: 689, y: SWEEP_Y }; // ON the cord's mid-drape
const IDLE_MAX = 0.02; // u/s — an idle pointer injects nothing
const SWEEP_MIN = 0.2; // u/s — the brush visibly perturbs (strength ≤ 1 u/s)

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
  throw new Error(`brush-e2e: timed out waiting for ${desc}${lastError ? ` (${lastError.message})` : ''}`);
}

// --- CDP over WebSocket (same plumbing as life2-e2e.mjs) ----------------------

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

const shoot = async (ws, path) => {
  const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
  writeFileSync(path, Buffer.from(shot.data, 'base64'));
};

/** A PASSIVE move — buttons: 0. No button is ever held in this drive. */
const mouseMove = (ws, x, y) =>
  send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });

const evalPage = async (ws, expression) => {
  const res = await send(ws, 'Runtime.evaluate', { expression, returnByValue: true });
  return res.result?.value;
};

/** The motion probe (T-INT-5 verification seam, read-only): max point speed per cord. */
const cordSpeed = async (ws, id) => {
  const list = await evalPage(ws, 'JSON.stringify(window.cords.readMotionProbe())');
  const found = JSON.parse(String(list ?? '[]')).find((c) => c.id === id);
  return found === undefined ? null : found.maxSpeed;
};

const armProbe = (ws) => evalPage(ws, 'window.cords.setMotionProbe(true)');

/**
 * Poll until a full 1.5s probe window reads the anchor cord calm. Headless
 * rAF speed varies wildly under swiftshader, and the M1 intro pose is
 * FRAME-counted — a fixed sleep cannot know when the intro ends and the
 * dangle settles, so this waits on the physics itself.
 */
async function waitCalm(ws, threshold, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    await armProbe(ws);
    await sleep(1500);
    last = await cordSpeed(ws, 0);
    if (last !== null && last < threshold) return last;
  }
  throw new Error(`the anchor cord never calmed below ${threshold} (last read ${last})`);
}

const lifecycleNow = async (ws) => {
  const res = await send(ws, 'Runtime.evaluate', {
    expression: 'JSON.stringify(window.cords.lifecycle())',
    returnByValue: true,
  });
  return JSON.parse(String(res.result?.value ?? '[]'));
};

// --- Main --------------------------------------------------------------------

const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'ignore',
  detached: true,
});
const profileDir = mkdtempSync(join(tmpdir(), 'cords-brush-'));
let chrome;
let ws;
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

  ws = new WebSocket(list.webSocketDebuggerUrl);
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

  let cords = await lifecycleNow(ws);
  process.stdout.write(`brush-e2e: lifecycle at rest: ${JSON.stringify(cords)}\n`);
  const anchorBefore = cords.find((c) => c.id === 0)?.state;

  // --- Baseline: the scene is calm with nobody touching it --------------------
  const baseline = await waitCalm(ws, 0.05, 45000);
  process.stdout.write(`brush-e2e: baseline maxSpeed ${baseline.toFixed(6)} u/s\n`);

  // --- THOR'S RULE: an idle cursor ON the cord injects NOTHING ----------------
  // Move onto the cord's mid-drape (the parking move itself lands one last
  // impulse — legal, it is a move), let it decay, then hold the cursor
  // STILL with the ray sitting inside the halo for the whole window.
  await mouseMove(ws, 560, SWEEP_Y);
  await sleep(80);
  await mouseMove(ws, PARK.x, PARK.y);
  await waitCalm(ws, IDLE_MAX, 30000); // the parking impulse decays away
  await armProbe(ws);
  await sleep(1500); // idle hold, ray ON the cord
  const idle = await cordSpeed(ws, 0);
  process.stdout.write(`brush-e2e: idle-on-cord maxSpeed ${idle?.toFixed(6) ?? '?'} u/s\n`);
  if (idle === null || idle >= IDLE_MAX) {
    throw new Error(
      `an idle pointer through the cord injected energy (read ${idle}, want < ${IDLE_MAX})`,
    );
  }

  // --- THE BRUSH: sweep the cursor across the dangling cord (no button) -------
  const dx = SWEEP.x1 - SWEEP.x0;
  const stepTo = async (from, to, i) => {
    await mouseMove(ws, from + ((to - from) * i) / SWEEP.steps, SWEEP.y);
    await sleep(SWEEP.holdMs);
  };
  // Across the cord…
  for (let i = 1; i <= SWEEP.steps; i += 1) await stepTo(SWEEP.x0, SWEEP.x1, i);
  // …and back, capturing MID-BRUSH on the return (the halo is on the cord
  // in the frame of record, not after the sway decayed).
  const partial = Math.max(1, Math.floor(SWEEP.steps * 0.4));
  for (let i = 1; i <= partial; i += 1) await stepTo(SWEEP.x1, SWEEP.x0, i);
  await shoot(ws, SWEEP_SHOT); // mid-brush, the capture of record
  for (let i = partial + 1; i <= SWEEP.steps; i += 1) await stepTo(SWEEP.x1, SWEEP.x0, i);
  const swept = await cordSpeed(ws, 0);
  process.stdout.write(`brush-e2e: swept maxSpeed ${swept?.toFixed(6) ?? '?'} u/s → ${SWEEP_SHOT}\n`);
  if (swept === null || swept <= SWEEP_MIN) {
    throw new Error(`the sweep did not perturb the cord (read ${swept}, want > ${SWEEP_MIN})`);
  }
  await sleep(250);
  await shoot(ws, LATE_SHOT); // still swaying a beat later

  // --- The cord calms again (the ordinary settle window) ----------------------
  const decayed = await waitCalm(ws, swept * 0.5, 45000);
  process.stdout.write(`brush-e2e: decayed maxSpeed ${decayed.toFixed(6)} u/s\n`);
  if (decayed >= swept * 0.5) {
    throw new Error(`the brushed cord did not calm down (read ${decayed} after sweep ${swept})`);
  }

  // --- A brush is not an intent: the lifecycle never moved --------------------
  cords = await lifecycleNow(ws);
  const anchorAfter = cords.find((c) => c.id === 0)?.state;
  process.stdout.write(`brush-e2e: lifecycle after the sweep: ${JSON.stringify(cords)}\n`);
  if (anchorBefore !== anchorAfter) {
    throw new Error(`the brush moved the lifecycle (${anchorBefore} → ${anchorAfter})`);
  }

  if (pageErrors.length > 0) {
    throw new Error(`page errors during the drive: ${pageErrors.join(' | ')}`);
  }

  process.stdout.write(
    `BRUSH_E2E_OK ${SWEEP_SHOT} + ${LATE_SHOT} (idle ${idle?.toFixed(4)} < ${IDLE_MAX}; sweep ${swept?.toFixed(3)} > ${SWEEP_MIN}; decayed ${decayed?.toFixed(4)}; 0 page errors)\n`,
  );
} catch (error) {
  process.exitCode = 1;
  process.stdout.write(`BRUSH_E2E_FAILED ${error.message}\n`);
} finally {
  try {
    ws?.close();
  } catch {
    // already closed
  }
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

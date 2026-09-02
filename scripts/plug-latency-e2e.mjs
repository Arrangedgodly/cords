#!/usr/bin/env node
/**
 * QA-2 measure 2 — PLUG REGISTERS ≤ 1 FRAME, on the BUILT bundle with REAL
 * input. The latency is measured through the composition itself:
 *
 *   - a page-side rAF sampler records, every animation tick, the render
 *     layer's frame counter (`window.cords.resilience().framesDrawn` — one
 *     increment per drawn frame) and the lifecycle state of the test cord;
 *   - the drive spawns a cord with the real N key, grabs its red jack with
 *     a real mouse press, drags it over cube 04, and releases with a real
 *     mouse-up;
 *   - F0 = the frame counter read IMMEDIATELY after the mouse-up dispatch
 *     (the pointerup handler has then run — the seat record exists); the
 *     seat intent composes into the very next frame's latch;
 *   - PASS ⇔ the first sampled frame that reads `awaiting-plug` is at
 *     counter ≤ F0 + 1 — the seat landed in the first frame after the
 *     release, i.e. "the frame the release arrives (or next at worst)".
 *
 * The headless driver-frame-count pin of the same law lives in
 * src/sim/dodGate.test.ts; this drive proves the COMPOSITION wiring (input
 * → handler → latch → sim → seam) with trusted browser input.
 *
 * Exits 0 (`PLUG_LATENCY_E2E_OK`) with the measured latency; 0 page errors.
 *
 * Usage: node scripts/plug-latency-e2e.mjs
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const CHROME =
  process.env.CORDS_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = 9362;
const PORT = 5230;
const APP_URL = `http://localhost:${PORT}/`;

// World → screen waypoints (the fixed production camera; hud-e2e's geometry).
const SPAWN_AT = { x: 789, y: 391 };   // world (0.4, 0.9, 0)
const CUBE04_TOP = { x: 906, y: 506 }; // world (0.85, 0.5, 1.05)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(desc, fn, timeoutMs = 30000, intervalMs = 200) {
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
  throw new Error(`plug-latency-e2e: timed out waiting for ${desc}${lastError ? ` (${lastError.message})` : ''}`);
}

// --- CDP over WebSocket (same plumbing as hud-e2e.mjs) -----------------------

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

const evalJson = async (ws, expression) => {
  const res = await send(ws, 'Runtime.evaluate', { expression, returnByValue: true });
  return res.result?.value;
};

// --- Main --------------------------------------------------------------------

const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'ignore',
  detached: true,
});
const profileDir = mkdtempSync(join(tmpdir(), 'cords-pluglat-'));
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

  await send(ws, 'Page.navigate', { url: APP_URL });
  await waitFor('app boot (window.cords seam)', () =>
    evalJson(ws, 'typeof window.cords?.resilience === "function"'));
  await sleep(2800); // the M1 intro pose, then steady drawing

  // The per-frame sampler: every rAF tick (AFTER three's own loop callback
  // for that tick has run — registration order), record the frame counter
  // and the newest cord's lifecycle state. Kept for the analysis below.
  await evalJson(ws, `
    (function () {
      window.__PLUG_SAMPLES = [];
      window.__PLUG_RAF = function () {
        try {
          const drawn = window.cords.resilience().framesDrawn;
          const cords = window.cords.lifecycle();
          const newest = cords[cords.length - 1] ?? null;
          window.__PLUG_SAMPLES.push({
            frame: drawn,
            newestId: newest ? newest.id : -1,
            newestState: newest ? newest.state : 'none',
          });
          if (window.__PLUG_SAMPLES.length > 6000) window.__PLUG_SAMPLES.splice(0, 2000);
        } catch (e) { /* the seam must never break the page */ }
        requestAnimationFrame(window.__PLUG_RAF);
      };
      requestAnimationFrame(window.__PLUG_RAF);
      return true;
    })()
  `);
  await sleep(300);

  // Spawn the test cord with the real N key, cursor parked at the spawn spot.
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: SPAWN_AT.x, y: SPAWN_AT.y, buttons: 0 });
  await sleep(150);
  await send(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'n', code: 'KeyN', windowsVirtualKeyCode: 78, nativeVirtualKeyCode: 78, text: 'n', unmodifiedText: 'n' });
  await sleep(60);
  await send(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'n', code: 'KeyN', windowsVirtualKeyCode: 78, nativeVirtualKeyCode: 78 });
  await sleep(250);
  const spawned = await evalJson(ws, 'JSON.stringify((window.cords.lifecycle()).map((c) => ({ id: c.id, state: c.state })))');
  const cordsAfterSpawn = JSON.parse(spawned);
  const testCord = cordsAfterSpawn[cordsAfterSpawn.length - 1];
  if (testCord === undefined || testCord.state !== 'carried') {
    throw new Error(`spawn did not land a carried cord: ${spawned}`);
  }

  // Grab the red jack where it hangs (at/near the spawn point) and drag it
  // over cube 04's top — REAL input, no shortcuts.
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: SPAWN_AT.x, y: SPAWN_AT.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(160);
  const steps = 12;
  for (let i = 1; i <= steps; i += 1) {
    await send(ws, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(SPAWN_AT.x + ((CUBE04_TOP.x - SPAWN_AT.x) * i) / steps),
      y: Math.round(SPAWN_AT.y + ((CUBE04_TOP.y - SPAWN_AT.y) * i) / steps),
      buttons: 1,
    });
    await sleep(50);
  }
  const samplesBefore = await evalJson(ws, 'window.__PLUG_SAMPLES.length');
  // THE RELEASE. The pointerup handler runs synchronously with this dispatch;
  // the counter read right after is F0 — the frame the release "arrives in".
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: CUBE04_TOP.x, y: CUBE04_TOP.y, button: 'left', buttons: 0, clickCount: 1 });
  const f0 = await evalJson(ws, 'window.cords.resilience().framesDrawn');
  await sleep(900); // let frames land and the sampler record them

  const samples = JSON.parse(await evalJson(ws, 'JSON.stringify(window.__PLUG_SAMPLES)'));
  const after = samples.filter((s) => s.frame >= f0 && s.newestId === testCord.id);
  const seatSample = after.find((s) => s.newestState === 'awaiting-plug');
  const finalState = await evalJson(ws, `(window.cords.lifecycle().find((c) => c.id === ${testCord.id}) ?? { state: 'gone' }).state`);
  if (finalState !== 'awaiting-plug') {
    throw new Error(`release over cube 04 did not seat: final state ${finalState}`);
  }
  if (seatSample === undefined) {
    throw new Error(`no sampled frame read awaiting-plug (f0=${f0}, samples=${JSON.stringify(after.slice(0, 8))})`);
  }
  const latencyFrames = seatSample.frame - f0;
  console.log(`plug latency: released at counter ${f0}, first 'awaiting-plug' sampled at ${seatSample.frame} → ${latencyFrames} frame(s)`);
  if (latencyFrames > 1) {
    throw new Error(`FAIL: seat took ${latencyFrames} frames (> 1) to register`);
  }
  void samplesBefore;

  if (pageErrors.length > 0) {
    throw new Error(`page errors: ${pageErrors.join(' | ')}`);
  }
  console.log('PLUG_LATENCY_E2E_OK');
} catch (error) {
  process.exitCode = 1;
  console.error(`PLUG_LATENCY_E2E_FAILED ${error.message}`);
  if (pageErrors.length > 0) console.error(`page errors: ${pageErrors.join(' | ')}`);
} finally {
  chrome?.kill('SIGKILL');
  if (preview.pid !== undefined) process.kill(-preview.pid, 'SIGKILL');
  await sleep(300);
  rmSync(profileDir, { recursive: true, force: true });
}

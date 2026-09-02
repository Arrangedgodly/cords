#!/usr/bin/env node
/**
 * REN-2 frame-budget measurement (Thor evidence) — runs the perf.html
 * harness (12 live cords, ?bench=1) in REAL TIME under headless Chrome +
 * swiftshader, via the DevTools Protocol. Virtual-time budgeting would
 * distort rAF deltas, so this drives a live page and polls for the
 * harness's completion flag, then prints the measured JSON.
 *
 * Usage: node scripts/measure-perf.mjs [seconds]
 * Manages its own vite dev server (strict port 5173) and Chrome instance.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const CHROME =
  process.env.CORDS_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = 9337;
// Mode selects the harness's extra load: `brush` sweeps the passive
// cursor-brush across the fleet every substep (T-INT-5); `pulse` links 4
// cords and chase-pulses them every frame (T-REN-4); `brush+pulse` stacks
// both. Default: the REN-2 baseline (12 live moving cords, no extras).
const mode = process.argv[3] ?? '';
const EXTRA = mode.includes('brush') ? '&brush=1' : '';
const PULSE = mode.includes('pulse') ? '&pulse=1' : '';
const APP_URL = `http://localhost:5173/perf.html?bench=1${EXTRA}${PULSE}`;
const ROOT = new URL('..', import.meta.url).pathname;
const TIMEOUT_MS = Number(process.argv[2] ?? 150) * 1000;

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
  throw new Error(`measure-perf: timed out waiting for ${desc}${lastError ? ` (${lastError.message})` : ''}`);
}

// --- CDP over WebSocket ------------------------------------------------------

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

const vite = spawn('npx', ['vite', '--port', '5173', '--strictPort'], {
  cwd: ROOT,
  stdio: 'ignore',
  detached: true,
});
const profileDir = mkdtempSync(join(tmpdir(), 'cords-perf-'));
let chrome;

try {
  await waitFor('vite dev server', async () => {
    const res = await fetch(APP_URL.replace(/perf\.html.*/, ''));
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
  await send(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send(ws, 'Page.navigate', { url: APP_URL });

  await waitFor('perf harness completion (window.__PERF_DONE)', async () => {
    const res = await send(ws, 'Runtime.evaluate', {
      expression: 'window.__PERF_DONE === true',
      returnByValue: true,
    });
    return res.result?.value === true;
  }, TIMEOUT_MS, 500);

  const payload = await send(ws, 'Runtime.evaluate', {
    expression: 'window.__PERF_JSON',
    returnByValue: true,
  });
  process.stdout.write(`PERF_RESULT ${payload.result?.value ?? 'MISSING'}\n`);
  ws.close();
} catch (error) {
  process.exitCode = 1;
  process.stdout.write(`MEASURE_FAILED ${error.message}\n`);
} finally {
  chrome?.kill('SIGKILL');
  if (vite.pid !== undefined) process.kill(-vite.pid, 'SIGKILL');
  await sleep(300);
  rmSync(profileDir, { recursive: true, force: true });
}

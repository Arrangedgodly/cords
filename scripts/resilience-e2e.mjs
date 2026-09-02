#!/usr/bin/env node
/**
 * LIFE-3 end-to-end resilience drive — REAL context loss, REAL restore, and
 * the visibilitychange path, on the BUILT bundle (vite preview) in headless
 * Chrome + swiftshader over CDP.
 *
 * CONTEXT LOSS is as real as headless Chrome can make it: the page's own
 * renderer (exposed for exactly this drive) calls WEBGL_lose_context.
 * loseContext() — the BROWSER fires the genuine `webglcontextlost` event
 * (three's handler and the frame gate's both run), the same context object
 * is revived with restoreContext(), and the genuine
 * `webglcontextrestored` fires. What CDP cannot do is kill the GPU process
 * itself; document that honestly — this drive proves the EVENT PATH, the
 * app-level resource re-init, and the lifecycle continuation, which is what
 * the page owns. The VISIBILITY path is simulated the standard way
 * (redefining document.hidden + dispatching visibilitychange): headless
 * Chrome cannot really background its only tab.
 *
 * Proves, in order:
 *   1. baseline: the loop draws, resilience() reads live truth
 *   2. LOSS: preventDefault + paused (framesDrawn FROZEN, framesSkipped
 *      climbing, sim time frozen — the sim is pure, pausing loses nothing)
 *   3. RESTORE: contextRestores=1, the PMREM env re-bake ran (the restore
 *      hook), drawing RESUMES, the canvas still has a live WebGL context
 *   4. LIFECYCLE CONTINUES: real N spawns a cord, real mouse input seats its
 *      red jack on cube 04 → `awaiting-plug` — transitions still flow
 *   5. HIDDEN: paused cleanly; VISIBLE: resumes cleanly with no sim
 *      explosion (the resume's sim-time jump stays inside the hidden span)
 *
 * Exits 0 (`LIFE3_E2E_OK`) when every assertion held with zero page errors.
 *
 * Usage: node scripts/resilience-e2e.mjs [loss-shot] [restore-shot]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const CHROME =
  process.env.CORDS_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = 9361;
const PORT = 5229;
const APP_URL = `http://localhost:${PORT}/`;
const LOSS_SHOT = process.argv[2] ?? '.impeccable/review/life3-context-lost.png';
const RESTORE_SHOT = process.argv[3] ?? '.impeccable/review/life3-restored.png';

// World → screen waypoints (the fixed production camera; same derivation as
// hud-e2e.mjs — the post-restore seat reuses its proven geometry).
const SPAWN_AT = { x: 789, y: 391 };   // world (0.4, 0.9, 0)
const CUBE04_TOP = { x: 906, y: 506 }; // world (0.85, 0.5, 1.05)

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
  throw new Error(`resilience-e2e: timed out waiting for ${desc}${lastError ? ` (${lastError.message})` : ''}`);
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
const resilience = (ws) => evalJson(ws, 'JSON.stringify(window.cords.resilience())').then(JSON.parse);
const simTime = (ws) => evalJson(ws, 'window.cords.pulse().time');
const lifecycle = (ws) => evalJson(ws, 'JSON.stringify((window.cords?.lifecycle?.() ?? []).map((c) => ({ id: c.id, state: c.state })))').then(JSON.parse);

const pressN = async (ws) => {
  await send(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'n', code: 'KeyN', windowsVirtualKeyCode: 78, nativeVirtualKeyCode: 78, text: 'n', unmodifiedText: 'n' });
  await sleep(60);
  await send(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'n', code: 'KeyN', windowsVirtualKeyCode: 78, nativeVirtualKeyCode: 78 });
  await sleep(200);
};

async function dragJack(ws, from, to, steps = 12, holdMs = 55) {
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(160);
  for (let i = 1; i <= steps; i += 1) {
    await send(ws, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(from.x + ((to.x - from.x) * i) / steps),
      y: Math.round(from.y + ((to.y - from.y) * i) / steps),
      buttons: 1,
    });
    await sleep(holdMs);
  }
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(160);
}

const shoot = async (ws, path) => {
  const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
  writeFileSync(path, Buffer.from(shot.data, 'base64'));
};

const setHidden = (ws, hidden) =>
  evalJson(
    ws,
    `(function () {
       Object.defineProperty(document, 'hidden', { configurable: true, get: () => ${hidden} });
       document.dispatchEvent(new Event('visibilitychange'));
       return document.hidden;
     })()`,
  );

// --- Main --------------------------------------------------------------------

const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'ignore',
  detached: true,
});
const profileDir = mkdtempSync(join(tmpdir(), 'cords-life3-'));
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
  await waitFor('app boot (window.cords + resilience seam)', () =>
    evalJson(ws, 'typeof window.cords?.resilience === "function" && typeof window.cords?.forceContextLoss === "function"'));
  await sleep(2800); // the M1 intro pose (~2s) then steady drawing

  // 1 — baseline: the loop draws and the probe reads live truth.
  const base1 = await resilience(ws);
  await sleep(400);
  const base2 = await resilience(ws);
  if (!(base2.framesDrawn > base1.framesDrawn)) throw new Error(`baseline not drawing: ${JSON.stringify(base1)} → ${JSON.stringify(base2)}`);
  if (base1.paused || base1.contextLost || base1.hidden) throw new Error(`baseline not healthy: ${JSON.stringify(base1)}`);

  // 2 — REAL context loss (WEBGL_lose_context via the browser's own event).
  const simBeforeLoss = await simTime(ws);
  await evalJson(ws, 'window.cords.forceContextLoss()');
  const lost = await waitFor('contextLost + paused in the probe', async () => {
    const p = await resilience(ws);
    return p.contextLost && p.paused ? p : null;
  });
  // Sample the freeze point AFTER the pause has taken effect (the loss event
  // is asynchronous — a few frames may legitimately run between the request
  // and the pause; from here on not one substep may advance).
  const simFrozenAt = await simTime(ws);
  if (!(simFrozenAt >= simBeforeLoss)) throw new Error('sim rewound during the loss transition');
  await sleep(700);
  const duringLoss = await resilience(ws);
  if (duringLoss.framesDrawn !== lost.framesDrawn) {
    throw new Error(`drew while context lost: ${JSON.stringify(lost)} → ${JSON.stringify(duringLoss)}`);
  }
  if (!(duringLoss.framesSkipped > lost.framesSkipped)) {
    throw new Error(`did not count skipped ticks while lost: ${JSON.stringify(duringLoss)}`);
  }
  const simDuringLoss = await simTime(ws);
  if (simDuringLoss !== simFrozenAt) {
    throw new Error(`sim advanced while paused (pure state must freeze exactly): ${simFrozenAt} → ${simDuringLoss}`);
  }
  await shoot(ws, LOSS_SHOT); // the frozen frame of record
  console.log(`LIFE3 loss OK — drawn=${duringLoss.framesDrawn} skipped=${duringLoss.framesSkipped} losses=${duringLoss.contextLosses}`);

  // 3 — REAL restore: the re-bake hook ran, drawing resumes, context alive.
  await evalJson(ws, 'window.cords.forceContextRestore()');
  const restored = await waitFor('context restored + unpaused', async () => {
    const p = await resilience(ws);
    return !p.contextLost && !p.paused && p.contextRestores >= 1 ? p : null;
  });
  await waitFor('drawing resumed after restore', async () => {
    const p = await resilience(ws);
    return p.framesDrawn > restored.framesDrawn ? p : null;
  });
  const glAlive = await evalJson(ws, '!!document.querySelector("canvas")?.getContext("webgl2")');
  if (glAlive !== true) throw new Error('canvas lost its WebGL context after restore');
  const simAfterRestore = await simTime(ws);
  if (!(simAfterRestore > simDuringLoss)) throw new Error('sim did not resume after restore');
  await sleep(600);
  await shoot(ws, RESTORE_SHOT);
  console.log(`LIFE3 restore OK — restores=${restored.contextRestores} sim ${simDuringLoss.toFixed(3)} → ${simAfterRestore.toFixed(3)}`);

  // 4 — LIFECYCLE CONTINUES post-restore: real N + real mouse seat.
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: SPAWN_AT.x, y: SPAWN_AT.y, buttons: 0 });
  await sleep(150);
  await pressN(ws);
  const cordsAfterSpawn = await lifecycle(ws);
  if (!cordsAfterSpawn.some((c) => c.state === 'carried')) {
    throw new Error(`spawn after restore did not land a carried cord: ${JSON.stringify(cordsAfterSpawn)}`);
  }
  // The spawned red jack sits at the cursor's spawn point: grab it there and
  // seat it on cube 04's top with real input.
  await dragJack(ws, SPAWN_AT, CUBE04_TOP);
  await waitFor('post-restore seat → awaiting-plug', async () => {
    const cords = await lifecycle(ws);
    return cords.some((c) => c.state === 'awaiting-plug') ? cords : null;
  });
  console.log('LIFE3 lifecycle continues OK — post-restore spawn + seat → awaiting-plug');

  // 5 — the visibility path: hidden pauses cleanly, visible resumes cleanly.
  await setHidden(ws, true);
  await waitFor('hidden → paused', async () => {
    const p = await resilience(ws);
    return p.hidden && p.paused ? p : null;
  });
  // Sample the freeze point AFTER the pause holds (same discipline as the
  // loss transition: a few frames may run before the event lands).
  const simPreHide = await simTime(ws);
  const hiddenFor = 1200;
  await sleep(hiddenFor);
  const duringHidden = await resilience(ws);
  const simDuringHidden = await simTime(ws);
  if (simDuringHidden !== simPreHide) {
    throw new Error(`sim advanced while hidden: ${simPreHide} → ${simDuringHidden}`);
  }
  await setHidden(ws, false);
  await waitFor('visible → resumed', async () => {
    const p = await resilience(ws);
    return !p.hidden && !p.paused ? p : null;
  });
  await sleep(500);
  const afterVisible = await resilience(ws);
  if (!(afterVisible.framesDrawn > duringHidden.framesDrawn)) throw new Error('did not resume drawing after visible');
  const simAfterVisible = await simTime(ws);
  // No explosion: the resume may reclaim at most the hidden span (the gate's
  // zero-delta resume hands the driver nothing; ARC-3 clamps whatever else).
  const jumped = simAfterVisible - simDuringHidden;
  if (!(jumped > 0) || jumped > (hiddenFor + 900) / 1000) {
    throw new Error(`resume jumped ${jumped.toFixed(3)}s of sim time (explosion or stall)`);
  }
  console.log(`LIFE3 visibility OK — frozen through ${hiddenFor}ms hidden, resumed +${jumped.toFixed(3)}s sim (no explosion)`);

  if (pageErrors.length > 0) {
    throw new Error(`page errors: ${pageErrors.join(' | ')}`);
  }
  console.log('LIFE3_E2E_OK');
} catch (error) {
  process.exitCode = 1;
  console.error(`LIFE3_E2E_FAILED ${error.message}`);
  if (pageErrors.length > 0) console.error(`page errors: ${pageErrors.join(' | ')}`);
} finally {
  chrome?.kill('SIGKILL');
  if (preview.pid !== undefined) process.kill(-preview.pid, 'SIGKILL');
  await sleep(300);
  rmSync(profileDir, { recursive: true, force: true });
}

#!/usr/bin/env node
/**
 * 2D-2 — CDP SMOKE DRIVE + EVIDENCE CAPTURES (headless Chrome, Canvas 2D).
 *
 * One script, two jobs (run against the BUILT app — `npm run build` first):
 *
 *   1. EVIDENCE — .impeccable/review/2d2-world.png (the opening frame: panel,
 *      eight modules, the seated red jack + resting blue end) and
 *      2d2-jacks-closeup.png (a 2× clip around the opening cord's jack pair).
 *   2. SMOKE — the real input path end to end, asserted through the
 *      window.cords seams only: N spawns a carried cord → a REAL CDP mouse
 *      drag seats its red jack on a module edge (awaiting-plug) → the blue
 *      jack seats on a second module (linked) → the held blue jack is pulled
 *      and released off-module (linked → awaiting-plug → vanishing → gone,
 *      the full approved failure path) → R resets to the empty bench (hint
 *      back) → N works post-reset. Plus a ?probe=1 pass that logs frame-time
 *      numbers at 12 live cords.
 *
 * Chrome flags (on record in docs/ultron/production-log.md): headless=new +
 * --use-angle=swiftshader --enable-unsafe-swiftshader — Canvas 2D needs no
 * GPU, but the flags keep the drive's environment identical to the v1
 * records. Zero page errors is part of the pass condition.
 *
 * Usage: node scripts/2d2-smoke.mjs [--no-shots]
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist', 'index.html');
const REVIEW = join(ROOT, '.impeccable', 'review');
const PORT = 4181;
const CDP_PORT = 9223;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = !process.argv.includes('--no-shots');

if (!existsSync(DIST)) {
  console.error('dist/index.html missing — run `npm run build` first');
  process.exit(1);
}
mkdirSync(REVIEW, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- tiny CDP client (Node's built-in WebSocket) -----------------------------
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message}: ${msg.error.data ?? ''}`));
        else resolve(msg.result);
      } else {
        for (const fn of this.listeners) fn(msg);
      }
    });
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    return new CDP(ws);
  }

  send(method, params = {}) {
    const id = ++this.seq;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  on(fn) {
    this.listeners.push(fn);
  }
}

// --- process plumbing ----------------------------------------------------------
const children = [];
const cleanup = () => {
  for (const p of children) {
    try {
      p.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
};
process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});

const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
  cwd: ROOT,
  stdio: 'ignore',
});
children.push(preview);

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${CDP_PORT}`,
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu-sandbox',
  `--user-data-dir=/tmp/cords-2d2-chrome-${Date.now()}`,
  '--window-size=1600,1000',
  'about:blank',
]);
children.push(chrome);

const http = async (path) => {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}${path}`);
  return res.json();
};

async function waitFor(fn, what, timeoutMs = 15000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      /* not up yet */
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${what}`);
    await sleep(150);
  }
}

async function openPage(url) {
  const targets = await waitFor(
    () => http('/json').then((ts) => ts.find((t) => t.type === 'page')),
    'a page target',
  );
  const cdp = await CDP.connect(targets.webSocketDebuggerUrl);
  let pageErrors = 0;
  cdp.on((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') pageErrors += 1;
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') pageErrors += 1;
  });
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url });
  await waitFor(
    () =>
      cdp
        .send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true })
        .then((r) => r.result.value === 'complete'),
    'page load',
  );
  return { cdp, pageErrorsRef: { get count() { return pageErrors; } } };
}

const evalJs = async (cdp, expression) => {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`eval failed: ${expression} — ${JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)}`);
  return r.result.value;
};

const lifecycle = (cdp) => evalJs(cdp, 'window.cords.lifecycle()');
const ends = (cdp) => evalJs(cdp, 'window.cords.ends()');
const rects = (cdp) => evalJs(cdp, 'window.cords.rects()');

// --- CDP input -------------------------------------------------------------------
// Headless input can drop an event under load (the v1 drives documented the
// same rest-scan flake); every step here VERIFIES its effect through a
// window.cords seam and retries once before failing.
async function key(cdp, k, code, vk) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text: k });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await sleep(180);
}

async function mouseDrag(cdp, from, to, steps = 14) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(from.x), y: Math.round(from.y), button: 'left', clickCount: 1 });
  await sleep(40);
  for (let i = 1; i <= steps; i += 1) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(from.x + ((to.x - from.x) * i) / steps),
      y: Math.round(from.y + ((to.y - from.y) * i) / steps),
      button: 'left',
      buttons: 1,
    });
    await sleep(36);
  }
  await sleep(40);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(to.x), y: Math.round(to.y), button: 'left', clickCount: 1 });
  await sleep(200); // a few rAF frames for the seat intent to land
}

/** Prime focus with a neutral click on open floor (grabs nothing). */
async function primeFocus(cdp) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 200, y: 700, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 200, y: 700, button: 'left', clickCount: 1 });
  await sleep(120);
}

const stateOf = async (cdp, cordId) =>
  (await lifecycle(cdp)).find((c) => c.id === cordId)?.state;

async function waitForState(cdp, predicate, what, timeoutMs = 6000) {
  const t0 = Date.now();
  for (;;) {
    const life = await lifecycle(cdp);
    if (predicate(life)) return life;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${what}; lifecycle = ${JSON.stringify(life)}`);
    await sleep(100);
  }
}

async function shot(cdp, name, clip, scale = 1) {
  const params = { format: 'png' };
  if (clip !== undefined) params.clip = { ...clip, scale };
  const r = await cdp.send('Page.captureScreenshot', params);
  writeFileSync(join(REVIEW, name), Buffer.from(r.data, 'base64'));
  console.log(`  capture: .impeccable/review/${name}${clip !== undefined ? ` (clip ${Math.round(clip.width)}x${Math.round(clip.height)}@${scale}x)` : ''}`);
}

// =====================================================================================
const run = async () => {
  // --- load + the opening state ------------------------------------------------
  const base = `http://127.0.0.1:${PORT}/`;
  await waitFor(
    () => fetch(base).then((r) => r.ok),
    'the preview server',
    20000,
  );
  const page = await openPage(base);
  const cdp = page.cdp;
  await waitFor(() => evalJs(cdp, 'typeof window.cords').then((t) => t === 'object'), 'window.cords');
  await sleep(2600); // let the opening settle (dangle calm window)

  const opening = await lifecycle(cdp);
  const oneSeated = await evalJs(
    cdp,
    'window.cords.ends().filter(e => e.seated).length',
  );
  console.log(`opening: ${JSON.stringify(opening)} · seated jacks: ${oneSeated}`);
  if (opening.length !== 1 || opening[0].state !== 'awaiting-plug' || oneSeated < 1) {
    throw new Error(`opening state wrong: ${JSON.stringify(opening)}`);
  }

  if (SHOTS) {
    await shot(cdp, '2d2-world.png');
    // The jack pair closeup: the opening cord's two jacks, generous crop.
    const pair = (await ends(cdp)).filter((e) => e.cordId === opening[0].id);
    const pad = 110;
    const xs = pair.map((e) => e.x);
    const ys = pair.map((e) => e.y);
    const view = await evalJs(cdp, 'window.cords.view()');
    const clip = {
      x: Math.max(0, Math.min(...xs) - pad),
      y: Math.max(0, Math.min(...ys) - pad),
      width: Math.max(...xs) - Math.min(...xs) + pad * 2,
      height: Math.max(...ys) - Math.min(...ys) + pad * 2,
    };
    clip.width = Math.min(clip.width, view.width - clip.x);
    clip.height = Math.min(clip.height, view.height - clip.y);
    await shot(cdp, '2d2-jacks-closeup.png', clip, 2);
  }

  // --- smoke: N → seat → link → fail → gone → reset → N -------------------------
  await primeFocus(cdp);

  // 1. N spawns a carried cord (retried once — headless keys occasionally
  //    race the page, the v1 drives' documented flake).
  let afterN = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await key(cdp, 'n', 'KeyN', 78);
    if ((await lifecycle(cdp)).length === 2) {
      afterN = await lifecycle(cdp);
      break;
    }
    console.log(`  N attempt ${attempt} did not land — retrying`);
  }
  if (afterN === null) throw new Error('N never spawned a second cord');
  console.log(`N: ${JSON.stringify(afterN)}`);
  const spawnedId = afterN.find((c) => c.id !== opening[0].id)?.id;
  if (spawnedId === undefined) throw new Error('spawned cord not found');

  // 2. Drag its red jack onto module 05's top edge → awaiting-plug. The jack
  //    is the held red end — verify the pick through the held seam.
  const modules = await rects(cdp);
  const m05 = modules.find((m) => m.id === 4);
  const m06 = modules.find((m) => m.id === 5);
  const jackEnd = async (index) =>
    (await ends(cdp)).find((e) => e.cordId === spawnedId && e.index === index);
  let jack = await jackEnd(0);
  await mouseDrag(cdp, { x: jack.x, y: jack.y }, { x: m05.x + m05.w / 2, y: m05.y - 4 });
  if ((await stateOf(cdp, spawnedId)) !== 'awaiting-plug') {
    // One full retry (fresh jack position read): the v1 drives' discipline.
    console.log('  red seat did not land — one retry');
    jack = await jackEnd(0);
    await mouseDrag(cdp, { x: jack.x, y: jack.y }, { x: m05.x + m05.w / 2, y: m05.y - 4 });
  }
  await waitForState(
    cdp,
    (l) => l.find((c) => c.id === spawnedId)?.state === 'awaiting-plug',
    'the red seat (awaiting-plug)',
  );
  const seatedRed = await jackEnd(0);
  if (!seatedRed.seated) throw new Error(`red jack not seated after drop: ${JSON.stringify(seatedRed)}`);
  console.log(`seat red on 05: awaiting-plug ✓ (jack at ${seatedRed.x.toFixed(0)},${seatedRed.y.toFixed(0)})`);

  // 3. Blue jack onto module 06 → linked.
  jack = await jackEnd(24);
  await mouseDrag(cdp, { x: jack.x, y: jack.y }, { x: m06.x + m06.w / 2, y: m06.y - 4 });
  if ((await stateOf(cdp, spawnedId)) !== 'linked') {
    console.log('  blue seat did not land — one retry');
    jack = await jackEnd(24);
    await mouseDrag(cdp, { x: jack.x, y: jack.y }, { x: m06.x + m06.w / 2, y: m06.y - 4 });
  }
  await waitForState(
    cdp,
    (l) => l.find((c) => c.id === spawnedId)?.state === 'linked',
    'the blue seat (linked)',
  );
  console.log('seat blue on 06: linked ✓');

  // 4. Pull the blue jack back out and release over open floor → the full
  //    failure path: linked → awaiting-plug (hand pull) → vanishing → gone.
  jack = await jackEnd(24);
  await mouseDrag(cdp, { x: jack.x, y: jack.y }, { x: 700, y: 820 }, 10);
  await waitForState(
    cdp,
    (l) => l.find((c) => c.id === spawnedId)?.state === 'vanishing',
    'the off-module release (vanishing)',
    5000,
  );
  console.log('off-module release: vanishing ✓');
  await waitForState(cdp, (l) => !l.some((c) => c.id === spawnedId), 'the despawn', 5000);
  console.log('vanish completed: cord gone ✓');

  // 5. R resets to the empty bench; the hint returns; N still works.
  await key(cdp, 'r', 'KeyR', 82);
  await sleep(300);
  const afterReset = await lifecycle(cdp);
  if (afterReset.length !== 0) throw new Error(`reset left cords: ${JSON.stringify(afterReset)}`);
  const hintVisible = await evalJs(
    cdp,
    'document.querySelector(".hud")?.classList.contains("is-empty")',
  );
  if (hintVisible !== true) throw new Error('empty-scene hint not visible after reset');
  console.log('R: empty bench, hint visible ✓');
  await key(cdp, 'n', 'KeyN', 78);
  await waitForState(cdp, (l) => l.length === 1, 'N after reset');
  console.log('N after reset: carried cord ✓');

  const errors = page.pageErrorsRef.count;
  console.log(`page errors: ${errors}`);
  if (errors > 0) throw new Error(`${errors} page errors during the drive`);

  // --- perf probe (?probe=1): 12 staged cords + the opening cord -----------------
  const probePage = await openPage(`${base}?probe=1`);
  // Headless swiftshader runs rAF well under 60 fps (the software raster's
  // present cost — the v1 records measured ~9 fps); the probe's own frame
  // counter resets every log window, so wait for any healthy sample count.
  // 2D-8 (environmental): under this machine's documented load (avg 13–16)
  // a quiet probe page throttles to ~3 fps — the 4-s counter window never
  // holds 20 frames — so the bar is any TWO drawn frames (the avg/max cost
  // reads below are per-frame and unaffected by cadence).
  await waitFor(() => evalJs(probePage.cdp, 'window.cords.probe()').then((p) => p !== null && p.frames > 1), 'the perf probe', 20000);
  const probe1 = await evalJs(probePage.cdp, 'window.cords.probe()');
  await sleep(4600); // one full log window later
  const probe2 = await evalJs(probePage.cdp, 'window.cords.probe()');
  console.log(`probe window 1: ${JSON.stringify(probe1)}`);
  console.log(`probe window 2: ${JSON.stringify(probe2)}`);
  const probeErrors = probePage.pageErrorsRef.count;
  if (probeErrors > 0) throw new Error(`${probeErrors} page errors on the probe page`);
  if (probe2.cords < 12) throw new Error(`probe expected ≥12 cords, got ${probe2.cords}`);
  if (probe2.avgMs > 4) throw new Error(`probe avg frame work ${probe2.avgMs.toFixed(2)} ms exceeds the 4 ms bar`);

  console.log('2D2_SMOKE_OK');
};

run()
  .then(() => {
    cleanup();
    process.exit(0);
  })
  .catch((err) => {
    console.error(`2D2_SMOKE_FAILED: ${err.message}`);
    cleanup();
    process.exit(1);
  });

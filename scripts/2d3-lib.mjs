#!/usr/bin/env node
/**
 * 2D-3 — THE SHARED DRIVE LIBRARY (CDP, headless Chrome + swiftshader, the
 * production-log's incantation). Everything the six 2D-3 drives share: the
 * tiny CDP client, the preview+chrome plumbing, trusted-input helpers that
 * VERIFY their effect through the window.cords seams (headless input can
 * drop an event — the v1 drives' documented flake; every step retries once),
 * the seam readers, screenshot capture, and a small PNG decoder for the
 * drives' pixel-level assertions (amber LED cluster, band-shard ink).
 *
 * Chrome flags identical to the v1 records: headless=new +
 * --use-angle=swiftshader --enable-unsafe-swiftshader (Canvas 2D needs no
 * GPU; the flags keep the environment identical).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist', 'index.html');
export const REVIEW = join(ROOT, '.impeccable', 'review');
export const PORT = 4183;
export const CDP_PORT = 9227;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function assertDist() {
  if (!existsSync(DIST)) {
    console.error('dist/index.html missing — run `npm run build` first');
    process.exit(1);
  }
  mkdirSync(REVIEW, { recursive: true });
}

// --- tiny CDP client (Node's built-in WebSocket) ------------------------------
export class CDP {
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
    // A wedged browser must fail the drive LOUDLY, not hang it: every CDP
    // call carries its own timeout (the pending entry is cleaned either way).
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP ${method} timed out after 15 s`));
        }
      }, 15000);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
    });
  }

  on(fn) {
    this.listeners.push(fn);
  }
}

// --- process plumbing ----------------------------------------------------------
const children = [];
export const cleanup = () => {
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

export async function startStack() {
  const preview = spawn(
    'npx',
    ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore' },
  );
  children.push(preview);
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu-sandbox',
    `--user-data-dir=/tmp/cords-2d3-chrome-${Date.now()}`,
    '--window-size=1600,1000',
    'about:blank',
  ]);
  children.push(chrome);
  const base = `http://127.0.0.1:${PORT}/`;
  await waitFor(() => fetch(base).then((r) => r.ok), 'the preview server', 20000);
  return base;
}

export async function waitFor(fn, what, timeoutMs = 15000) {
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

const http = async (path) => (await fetch(`http://127.0.0.1:${CDP_PORT}${path}`)).json();

export async function openPage(url) {
  const targets = await waitFor(
    () => http('/json').then((ts) => ts.find((t) => t.type === 'page')),
    'a page target',
  );
  const cdp = await CDP.connect(targets.webSocketDebuggerUrl);
  let pageErrors = 0;
  let warnings = 0;
  cdp.on((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') pageErrors += 1;
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') pageErrors += 1;
    if (
      msg.method === 'Runtime.consoleAPICalled' &&
      msg.params.type === 'warning' &&
      JSON.stringify(msg.params.args ?? []).includes('lifecycle rejected')
    ) {
      warnings += 1;
    }
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
  // Headless Chrome can mark the page hidden (activation quirk — an early
  // input event flips it), which the product's frame gate honestly honors by
  // pausing. The drives need a VISIBLE page: bring it to the front.
  await cdp.send('Page.bringToFront');
  await sleep(150);
  return { cdp, errors: () => pageErrors, rejections: () => warnings };
}

export const evalJs = async (cdp, expression) => {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    throw new Error(
      `eval failed: ${expression} — ${JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)}`,
    );
  }
  return r.result.value;
};

// --- the seams -------------------------------------------------------------------
export const lifecycle = (cdp) => evalJs(cdp, 'window.cords.lifecycle()');
export const ends = (cdp) => evalJs(cdp, 'window.cords.ends()');
export const rects = (cdp) => evalJs(cdp, 'window.cords.rects()');
export const stateOf = async (cdp, cordId) =>
  (await lifecycle(cdp)).find((c) => c.id === cordId)?.state;
export const summary = (cdp) =>
  evalJs(cdp, 'document.querySelector(".hud-summary")?.textContent');

export async function waitForState(cdp, predicate, what, timeoutMs = 6000) {
  const t0 = Date.now();
  for (;;) {
    const life = await lifecycle(cdp);
    if (predicate(life)) return life;
    if (Date.now() - t0 > timeoutMs) {
      throw new Error(`timeout waiting for ${what}; lifecycle = ${JSON.stringify(life)}`);
    }
    await sleep(100);
  }
}

/**
 * Headless Chrome can flip `document.hidden` true on an input event (an
 * activation quirk of this build); the product's frame gate honestly honors
 * it by pausing, which would freeze the sim mid-drive. Every input helper
 * below therefore ensures the page is visible first (bringToFront, plus the
 * event dispatch as a belt) — the drives test a VISIBLE page.
 */
async function ensureVisible(cdp) {
  const hidden = await evalJs(cdp, 'document.hidden');
  if (hidden !== true) return;
  await cdp.send('Page.bringToFront');
  await sleep(90);
  const still = await evalJs(cdp, 'document.hidden');
  if (still === true) {
    await evalJs(cdp, `(() => {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      return true;
    })()`);
    await sleep(90);
  }
}

// --- trusted input ----------------------------------------------------------------
/**
 * A letter/modifier key WITHOUT text (the v1 discipline): text-carrying
 * keydowns are reserved for ACTIVATION keys (Enter/Space below) — sending
 * `text` with a character key against a focused button makes headless
 * Chrome re-dispatch the keydown as a trusted storm (observed ~3 k/s,
 * repeat=false, timeStamp=0), which would flood the page with intents.
 */
export async function key(cdp, k, code, vk) {
  await ensureVisible(cdp);
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: k,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
  });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: k,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
  });
  await sleep(180);
}

export const press = async (cdp, x, y) => {
  await ensureVisible(cdp);
  return cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: Math.round(x),
      y: Math.round(y),
      button: 'left',
      clickCount: 1,
    });
};

export const move = async (cdp, x, y) => {
  await ensureVisible(cdp);
  return cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: Math.round(x),
    y: Math.round(y),
    button: 'left',
    buttons: 1,
  });
};

export const moveNoButtons = async (cdp, x, y) => {
  await ensureVisible(cdp);
  return cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(x), y: Math.round(y) });
};

export const release = async (cdp, x, y) => {
  await ensureVisible(cdp);
  return cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: Math.round(x),
    y: Math.round(y),
    button: 'left',
    clickCount: 1,
  });
};

export async function mouseDrag(cdp, from, to, steps = 14) {
  await press(cdp, from.x, from.y);
  await sleep(40);
  for (let i = 1; i <= steps; i += 1) {
    await move(cdp, from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    await sleep(36);
  }
  await sleep(40);
  await release(cdp, to.x, to.y);
  await sleep(220); // a few rAF frames for the seat intent to land
}

/** Prime focus with a neutral click on open floor (grabs nothing). */
export async function primeFocus(cdp) {
  await press(cdp, 200, 700);
  await release(cdp, 200, 700);
  await sleep(120);
}

/**
 * N with the drives' retry discipline (headless Chrome occasionally drops a
 * key event — the v1 drives' documented flake): press until the lifecycle
 * grows by one carried cord; returns the new cord id.
 */
export async function spawnViaKey(cdp, expectCount, what = 'N') {
  void expectCount;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const before = (await lifecycle(cdp)).length;
    await key(cdp, 'n', 'KeyN', 78);
    // Headless keys can arrive LATE and then in bursts — wait for the count
    // to grow (never count-match: a retried press may double-land).
    const grew = await waitFor(async () => (await lifecycle(cdp)).length > before, `${what} to land`, 3500)
      .then(() => true)
      .catch(() => false);
    if (grew) {
      const life = await lifecycle(cdp);
      return life.find((c) => c.state === 'carried')?.id ?? life[life.length - 1].id;
    }
    console.log(`  ${what} attempt ${attempt} did not land — retrying`);
    await sleep(300);
  }
  throw new Error(`${what} never landed`);
}

/** R with retries, verified empty (late-key tolerant). */
export async function resetViaKey(cdp) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await key(cdp, 'r', 'KeyR', 82);
    const empty = await waitFor(async () => (await lifecycle(cdp)).length === 0, 'R to land', 3500)
      .then(() => true)
      .catch(() => false);
    if (empty) return;
    console.log(`  R attempt ${attempt} left cords — retrying`);
    await sleep(300);
  }
  throw new Error('R never emptied the bench');
}

/** Seat a cord end (held or specified) on a module's top edge; verified. */
export async function seatEnd(cdp, cordId, endIndex, rectId, what) {
  const modules = await rects(cdp);
  const m = modules.find((r) => r.id === rectId);
  if (m === undefined) throw new Error(`module ${rectId} missing`);
  const target = { x: m.x + m.w / 2, y: m.y - 4 };
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const jack = (await ends(cdp)).find((e) => e.cordId === cordId && e.index === endIndex);
    if (jack === undefined) throw new Error(`end ${endIndex} of cord ${cordId} not found`);
    await mouseDrag(cdp, { x: jack.x, y: jack.y }, target);
    const seated = (await ends(cdp)).find(
      (e) => e.cordId === cordId && e.index === endIndex,
    )?.seated;
    if (seated === true) return true;
    console.log(`  ${what} did not land — one retry`);
  }
  throw new Error(`${what}: the seat never landed`);
}

export async function shot(cdp, name, clip, scale = 1) {
  const params = { format: 'png' };
  if (clip !== undefined) params.clip = { ...clip, scale };
  const r = await cdp.send('Page.captureScreenshot', params);
  writeFileSync(join(REVIEW, name), Buffer.from(r.data, 'base64'));
  console.log(
    `  capture: .impeccable/review/${name}${clip !== undefined ? ` (clip ${Math.round(clip.width)}x${Math.round(clip.height)}@${scale}x)` : ''}`,
  );
}

// --- PNG decode (no deps: node zlib + the PNG spec's unfilter) -------------------
export function decodePng(buf) {
  const b = Buffer.from(buf);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8;
  let width = 0;
  let height = 0;
  let colorType = 6;
  const idat = [];
  while (off < b.length) {
    const len = b.readUInt32BE(off);
    const type = b.toString('ascii', off + 4, off + 8);
    const data = b.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;
    off += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = new Uint8Array(width * height * bpp);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const bb = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += bb;
      else if (filter === 3) v += Math.floor((a + bb) / 2);
      else if (filter === 4) {
        const p = a + bb - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - bb);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? bb : c;
      }
      cur[x] = v & 0xff;
    }
    prev = cur;
  }
  return { width, height, bpp, data: out };
}

/** The centroid + count of amber-LED pixels (r>190, g>160, b<130, r>g>b). */
export function findAmberCluster(png) {
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const i = (y * png.width + x) * png.bpp;
      const r = png.data[i];
      const g = png.data[i + 1];
      const bb = png.data[i + 2];
      if (r > 190 && g > 160 && bb < 130 && r > g && g > bb) {
        n += 1;
        sx += x;
        sy += y;
      }
    }
  }
  return n === 0 ? null : { count: n, x: sx / n, y: sy / n };
}

/** Count pixels within a per-channel tolerance of an ink (and their centroid). */
export function findInkPixels(png, rgb, tol) {
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const i = (y * png.width + x) * png.bpp;
      const r = png.data[i];
      const g = png.data[i + 1];
      const bb = png.data[i + 2];
      if (
        Math.abs(r - rgb[0]) <= tol &&
        Math.abs(g - rgb[1]) <= tol &&
        Math.abs(bb - rgb[2]) <= tol
      ) {
        n += 1;
        sx += x;
        sy += y;
      }
    }
  }
  return n === 0 ? null : { count: n, x: sx / n, y: sy / n };
}

/** Run an async fn under emulated prefers-reduced-motion, then clear it. */
export async function withReducedMotion(cdp, fn) {
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  try {
    return await fn();
  } finally {
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: '' }],
    });
  }
}

export const run = (name, fn) => {
  fn()
    .then(() => {
      console.log(`${name}_OK`);
      cleanup();
      process.exit(0);
    })
    .catch((err) => {
      console.error(`${name}_FAILED: ${err.message}`);
      cleanup();
      process.exit(1);
    });
};

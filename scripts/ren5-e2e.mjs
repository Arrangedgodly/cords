#!/usr/bin/env node
/**
 * T-REN-5 end-to-end STATE PAINT drive — real input, real app, real paint.
 * Serves the BUILT bundle (vite preview), opens the production page in
 * headless Chrome + swiftshader over CDP, and proves the three state
 * visuals, each asserted through the `window.cords.statePaint()` seam (the
 * RENDER layer's own truth) before its capture of record:
 *
 *   1. STRETCH TICKS: seat a spawned cord's red end on cube 04 (the
 *      awaiting-plug "learning its length" state), grab the blue end, and
 *      drag it away until the end-to-end span crosses 90% of the 2.4 rest
 *      length — the seam must read stretch > 0.9 with tickGain > 0 (the
 *      silkscreen furniture ON) → `.impeccable/review/ren5-ticks.png`
 *      (+ a closeup along the taut drape), captured mid-drag.
 *   2. SHATTER (rides the same cord's release): release the held blue end
 *      over open floor — awaiting-plug → vanishing → the fall → the
 *      shatter. The seam must read fragments > 0 (the pooled burst live)
 *      through the burst frames → `ren5-shatter.png` (debris at the impact
 *      incl. the failing end's BLUE band shard); the cord then despawns
 *      (scene clean through the lifecycle seam).
 *   3. POPPED GRACE: link a second cord 04↔05 (the pop-e2e flow), drag cube
 *      05 past the over-stretch bound → the far jack pops; mid-drag the
 *      seam must read the grace countdown with the render dim EXACTLY the
 *      law (0.22 + 0.78 · remaining/3) → `ren5-grace.png` captured
 *      mid-countdown; then an in-page rAF sampler proves the failing jack
 *      band BLINKS through the final second (both phases seen).
 *   4. REDUCED MOTION (the A11Y seam, emulated media): link + pop again
 *      under prefers-reduced-motion — the same sampler must see the band
 *      STEADY (no blink) with the dim still counting down.
 *
 * Exits 0 when every assertion held with zero page errors.
 *
 * Usage: node scripts/ren5-e2e.mjs [ticks-shot] [grace-shot] [shatter-shot]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const CHROME =
  process.env.CORDS_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = 9352;
const PORT = 5231;
const APP_URL = `http://localhost:${PORT}/`;
const TICKS_SHOT = process.argv[2] ?? '.impeccable/review/ren5-ticks.png';
const GRACE_SHOT = process.argv[3] ?? '.impeccable/review/ren5-grace.png';
const SHATTER_SHOT = process.argv[4] ?? '.impeccable/review/ren5-shatter.png';

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
  throw new Error(`ren5-e2e: timed out waiting for ${desc}${lastError ? ` (${lastError.message})` : ''}`);
}

// The fixed production camera waypoints (pop-e2e/linked-e2e's proven spots).
const SPAWN_AT = { x: 789, y: 391 };     // world (0.4, 0.9, 0)
const CUBE04_TOP = { x: 906, y: 506 };   // world (0.85, 0.5, 1.05)
const CUBE05_TOP = { x: 1018, y: 464 };  // world (1.7, 0.5, 0.15)
const CUBE05_GRAB = { x: 1058, y: 527 };
const CUBE05_DRAG_TO = { x: 1304, y: 336 };
// REN-5 act 4: act 3's pop drag LEAVES cube 05 moved to ≈ (1304, 336), so the
// reduced-motion link seats the blue on the UNMOVED cube 02 and pops by
// dragging cube 04 itself (low front face — clear of the seated red proxy).
const CUBE02_TOP = { x: 539, y: 500 };
// Cube 04's grab spot: its lower-front face is SHADOWED by the nearer cube
// 08's projected body (x 771–943 × y 552–748) — the first act-4 runs grabbed
// cube 08 and the pop never fired. This spot is inside cube 04's box
// (840–978 × 492–631), clear of cube 08's box and of the seated red proxy.
const CUBE04_GRAB = { x: 966, y: 585 };
const CUBE04_DRAG_TO = { x: 1250, y: 430 };
const NEUTRAL = { x: 640, y: 700 }; // open floor
// The blue-jack scan (jack-only): the spawn-column rest ≈ (789, 538), and
// the projected cube boxes are EXCLUDED — cube 08's body spans x 771–943 ×
// y 552–748 (the REN-4 verifier's note: cube bodies also read 'grab', and a
// press there grabs the CUBE). Cells are kept clear of every box (+8 px).
const SCAN = { x0: 735, x1: 830, y0: 490, y1: 546, step: 10 };
const CUBE_BOXES = [
  [405, 514, 440, 534], [469, 603, 487, 622], [521, 599, 413, 487],
  [840, 978, 492, 631], [956, 1081, 455, 562], [844, 926, 417, 494],
  [641, 703, 404, 471], [771, 943, 552, 748],
];
const inCubeBox = (x, y) =>
  CUBE_BOXES.some(([x0, x1, y0, y1]) => x >= x0 - 8 && x <= x1 + 8 && y >= y0 - 8 && y <= y1 + 8);

// The ticks drag: blue held, pulled left-and-slightly-down away from cube
// 04's socket — ~2.2 world units of span (pixel scale ≈ 131 px/u at bench
// depth). The seam's stretch read adjudicates; the drag extends if needed.
const TICKS_DRAG_TO = { x: 560, y: 470 };
const TICKS_DRAG_MORE = { x: 470, y: 486 };
// The closeup along the taut drape (cube 04 → the held blue end).
const TICKS_CLIP = { x: 430, y: 360, width: 540, height: 190 };

// --- CDP over WebSocket (same plumbing as pop-e2e.mjs) ----------------------

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

const pressR = async (ws) => {
  await send(ws, 'Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key: 'r',
    code: 'KeyR',
    windowsVirtualKeyCode: 82,
    nativeVirtualKeyCode: 82,
    text: 'r',
    unmodifiedText: 'r',
  });
  await sleep(30);
  await send(ws, 'Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'r',
    code: 'KeyR',
    windowsVirtualKeyCode: 82,
    nativeVirtualKeyCode: 82,
  });
};

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
    nativeVirtualKeyCode: 78,
  });
};

const shoot = async (ws, path, clip) => {
  const shot = await send(ws, 'Page.captureScreenshot', {
    format: 'png',
    ...(clip === undefined ? {} : { clip: { ...clip, scale: 2 } }),
  });
  writeFileSync(path, Buffer.from(shot.data, 'base64'));
};

const evalJson = async (ws, expression) => {
  const res = await send(ws, 'Runtime.evaluate', { expression, returnByValue: true });
  return res.result?.value;
};
const lifecycleNow = (ws) =>
  evalJson(ws, 'JSON.stringify(window.cords.lifecycle())').then((s) => JSON.parse(String(s ?? '[]')));
const statePaintNow = (ws) =>
  evalJson(ws, 'JSON.stringify(window.cords.statePaint())').then((s) => JSON.parse(String(s ?? 'null')));

const cursorNow = async (ws) => {
  const res = await send(ws, 'Runtime.evaluate', {
    expression: 'document.querySelector("canvas")?.style.cursor ?? ""',
    returnByValue: true,
  });
  return String(res.result?.value ?? '');
};

const mouseMove = (ws, x, y, buttons = 1) =>
  send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons });

async function drag(ws, from, to, steps = 14, holdMs = 55) {
  for (let i = 1; i <= steps; i += 1) {
    await mouseMove(ws, from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    await sleep(holdMs);
  }
}

/**
 * Find and GRAB the resting blue jack in one pass: a single 'grab' read per
 * cell (no away/back confirmation — the hover moves themselves brush the
 * resting cord and drift it between the read and the press; the probe runs
 * of this drive proved that), then an IMMEDIATE press verified by the
 * carrying cursor. Cells inside projected cube boxes are skipped (a cube
 * body also reads 'grab', and pressing one grabs the CUBE). A missed press
 * has no side effect — the scan just continues.
 */
async function findAndGrabJack(ws, window_) {
  for (let y = window_.y0; y <= window_.y1; y += window_.step) {
    for (let x = window_.x0; x <= window_.x1; x += window_.step) {
      if (inCubeBox(x, y)) continue; // a cube body also reads 'grab' — never press one
      await mouseMove(ws, x, y);
      await sleep(60);
      if ((await cursorNow(ws)) !== 'grab') continue;
      await sleep(60);
      if ((await cursorNow(ws)) !== 'grab') continue; // stable read, no away trip
      await send(ws, 'Input.dispatchMouseEvent', {
        type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1,
      });
      await sleep(150);
      if ((await cursorNow(ws)) === 'grabbing') return { x, y };
      // Missed (the jack drifted under the press): make the press safe and
      // keep scanning.
      await send(ws, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1,
      });
      await sleep(60);
    }
  }
  return null;
}

const pressAt = async (ws, at) =>
  send(ws, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x: at.x, y: at.y, button: 'left', buttons: 1, clickCount: 1,
  });
const releaseAt = async (ws, at) =>
  send(ws, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: at.x, y: at.y, button: 'left', buttons: 0, clickCount: 1,
  });

/**
 * The one live cord in a state (a RESET-scene drive: exactly one spawned
 * cord exists at a time, so the STATE identifies it).
 */
const cordInState = (cords, state) => cords.find((c) => c.state === state) ?? null;

/** Links a fresh cord 04↔05 with the trusted choreography; returns its id. */
async function linkOneCord(ws, blueSeat = CUBE05_TOP) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const id = await linkOneCordAttempt(ws, blueSeat);
    if (id !== null) return id;
    process.stdout.write(`ren5-e2e: link attempt ${attempt} failed — retrying\n`);
  }
  throw new Error('link failed twice (the world emptied mid-flow)');
}

async function linkOneCordAttempt(ws, blueSeat) {
  await mouseMove(ws, SPAWN_AT.x, SPAWN_AT.y);
  await sleep(150);
  await pressN(ws);
  await sleep(2400); // the uncoil settles; red stays carried at the cursor
  await drag(ws, SPAWN_AT, CUBE04_TOP);
  await sleep(600);
  await releaseAt(ws, CUBE04_TOP);
  await sleep(2400); // red's settle; blue rests at the spawn column
  let afterRed = await lifecycleNow(ws);
  if (cordInState(afterRed, 'awaiting-plug') === null) {
    process.stdout.write(`ren5-e2e: red seat failed: ${JSON.stringify(afterRed)}\n`);
    return null;
  }
  let blue = await findAndGrabJack(ws, SCAN);
  if (blue === null) {
    await mouseMove(ws, SPAWN_AT.x, SPAWN_AT.y + 60); // the documented flake nudge
    await sleep(400);
    blue = await findAndGrabJack(ws, SCAN);
  }
  if (blue === null) {
    process.stdout.write('ren5-e2e: blue jack not found/grabbed in the scan window\n');
    return null;
  }
  await drag(ws, blue, blueSeat);
  await sleep(600);
  await releaseAt(ws, blueSeat);
  const atRelease = await lifecycleNow(ws);
  await sleep(900);
  const midSettle = await lifecycleNow(ws);
  await sleep(1700); // the linked settle
  const cords = await lifecycleNow(ws);
  const linked = cordInState(cords, 'linked');
  if (linked === null) {
    process.stdout.write(
      `ren5-e2e: link trajectory — atRelease ${JSON.stringify(atRelease)} +0.9s ${JSON.stringify(midSettle)} final ${JSON.stringify(cords)}\n`,
    );
    return null;
  }
  return linked.id;
}

/**
 * In-page rAF sampler over the failing jack's band across the grace window:
 * counts lit/off frames and the minimum remaining observed — proves the
 * BLINK (both phases) or, under reduced motion, the STEADY band, without
 * wall-clock polling latency.
 */
async function sampleBand(ws, cordId, frames = 40) {
  const res = await send(ws, 'Runtime.evaluate', {
    expression: `
      (async () => {
        let lit = 0, off = 0, n = 0, minRemaining = Infinity, ended = false;
        await new Promise((resolve) => {
          const tick = () => {
            const s = window.cords.statePaint();
            const c = s?.cords?.find((x) => x.id === ${cordId});
            if (c && c.grace) {
              n += 1;
              if (c.grace.bandLit) lit += 1; else off += 1;
              if (c.grace.remaining < minRemaining) minRemaining = c.grace.remaining;
            } else if (n > 0) {
              ended = true; // the window closed (re-seat or expiry) — stop
              resolve();
              return;
            }
            if (n < ${frames}) requestAnimationFrame(tick); else resolve();
          };
          requestAnimationFrame(tick);
        });
        return JSON.stringify({ lit, off, n, minRemaining, ended });
      })()`,
    returnByValue: true,
    awaitPromise: true,
  });
  return JSON.parse(String(res.result?.value ?? '{}'));
}

// --- Main --------------------------------------------------------------------

const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'ignore',
  detached: true,
});
const profileDir = mkdtempSync(join(tmpdir(), 'cords-ren5-'));
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

  // RESET the scene empty: this drive works ONE cord at a time, and the M1
  // anchor's dangling free end SWINGS through the blue-jack scan region (a
  // press there grabs the ANCHOR — the first runs of this drive proved it:
  // carry engaged, the spawned cord's span bitwise-untouched). With the
  // anchor gone, a state uniquely identifies the one live cord.
  await pressR(ws);
  await sleep(900);
  const empty = await lifecycleNow(ws);
  if (empty.length !== 0) {
    throw new Error(`RESET left cords on the bench: ${JSON.stringify(empty)}`);
  }

  // --- 1. STRETCH TICKS: awaiting-plug cord pulled taut ---------------------
  {
    await mouseMove(ws, SPAWN_AT.x, SPAWN_AT.y);
    await sleep(150);
    await pressN(ws);
    await sleep(2400);
    await drag(ws, SPAWN_AT, CUBE04_TOP);
    await sleep(600);
    await releaseAt(ws, CUBE04_TOP);
    await sleep(2400);
    let cords = await lifecycleNow(ws);
    let cord1 = cordInState(cords, 'awaiting-plug');
    if (cord1 === null) {
      throw new Error(`cord did not reach awaiting-plug (read ${JSON.stringify(cords)})`);
    }
    const id = cord1.id;
    const beforeEntry = (await statePaintNow(ws))?.cords?.find((c) => c.id === id);
    const spanBefore = beforeEntry?.stretch ?? 0;
    if ((beforeEntry?.tickGain ?? 0) > 0) {
      throw new Error(`the slack cord already carries furniture: ${JSON.stringify(beforeEntry)}`);
    }
    let blue = await findAndGrabJack(ws, SCAN);
    if (blue === null) {
      await mouseMove(ws, SPAWN_AT.x, SPAWN_AT.y + 60);
      await sleep(400);
      blue = await findAndGrabJack(ws, SCAN);
    }
    if (blue === null) throw new Error('blue jack not found/grabbed for the ticks drag');
    await drag(ws, blue, TICKS_DRAG_TO, 16, 50);
    await sleep(250);
    // Engagement guard: the held end must have MOVED (a press that missed the
    // jack — e.g. onto a cube body — would leave the span exactly at rest).
    const spanDragged = (await statePaintNow(ws))?.cords?.find((c) => c.id === id)?.stretch ?? 0;
    if (Math.abs(spanDragged - spanBefore) < 0.02) {
      throw new Error(
        `the carry did not engage (stretch ${spanBefore.toFixed(3)} → ${spanDragged.toFixed(3)}) — the press likely grabbed a cube body`,
      );
    }

    // Adjudicate through the seam; pull further left while under threshold
    // (the carried pin follows at 12 u/s — short holds suffice).
    let lastAt = { ...TICKS_DRAG_TO };
    const stretchOf = async () => {
      const p = await statePaintNow(ws);
      return { paint: p, entry: p?.cords?.find((c) => c.id === id) };
    };
    let read = await stretchOf();
    for (let pull = 0; pull < 9 && !(read.entry?.stretch > 0.93); pull += 1) {
      lastAt = { x: lastAt.x - 70, y: lastAt.y + 3 };
      await mouseMove(ws, lastAt.x, lastAt.y);
      await sleep(170);
      read = await stretchOf();
    }
    const paint = read.paint;
    const entry = read.entry;
    process.stdout.write(
      `ren5-e2e: ticks seam — state=${entry?.state} stretch=${entry?.stretch?.toFixed(3)} tickGain=${entry?.tickGain?.toFixed(3)} spacing=${entry?.tickSpacing?.toFixed(4)}\n`,
    );
    if (!entry || entry.state !== 'awaiting-plug' || !(entry.stretch > 0.9)) {
      throw new Error(`the taut read failed: ${JSON.stringify(entry)}`);
    }
    if (!(entry.tickGain > 0)) {
      throw new Error(`stretch ${entry.stretch.toFixed(3)} but tickGain ${entry.tickGain} — no furniture`);
    }
    // Rest evidence is already pinned above: the same cord, slack at span
    // ~0.45, carried tickGain 0 — furniture appears with tautness, not with
    // the cord's existence.
    await shoot(ws, TICKS_SHOT); // mid-drag, button still held
    await shoot(ws, TICKS_SHOT.replace(/\.png$/, '-closeup.png'), TICKS_CLIP);
    process.stdout.write(`ren5-e2e: ticks captured at stretch ${entry.stretch.toFixed(3)}\n`);

    // --- 2. SHATTER: release the held blue end over open floor -------------
    await drag(ws, lastAt, NEUTRAL, 10, 40);
    await releaseAt(ws, NEUTRAL);
    // The awaiting-plug release is the user-initiated failure → vanishing.
    cords = await waitFor('vanishing after the off-cube release', async () => {
      const c = await lifecycleNow(ws);
      return c.find((x) => x.id === id)?.state === 'vanishing' ? c : null;
    }, 8000, 40);
    // Burst frames: the fragments live ~0.55 SIM seconds (~0.1 s wall under
    // the headless pump) — poll fast, shoot a burst of three.
    let sawFragments = 0;
    const burstStart = Date.now();
    while (Date.now() - burstStart < 6000) {
      const p = await statePaintNow(ws);
      const count = p?.fragments ?? 0;
      if (count > sawFragments) sawFragments = count;
      if (count > 0) {
        await shoot(ws, SHATTER_SHOT);
        await shoot(ws, SHATTER_SHOT.replace(/\.png$/, '-b.png'));
        await shoot(ws, SHATTER_SHOT.replace(/\.png$/, '-c.png'));
        break;
      }
      const c = await lifecycleNow(ws);
      if (c.every((x) => x.id !== id)) break; // gone without a burst read (too fast)
      await sleep(8);
    }
    if (sawFragments <= 0) {
      throw new Error('the shatter burst was never observed through the seam (fragments = 0)');
    }
    process.stdout.write(`ren5-e2e: shatter burst observed (${sawFragments} shards live)\n`);
    // The sequence completes: the cord despawns, the scene clean.
    await waitFor('the vanished cord gone from the world', async () => {
      const c = await lifecycleNow(ws);
      return c.every((x) => x.id !== id);
    }, 8000, 60);
    const p2 = await statePaintNow(ws);
    if ((p2?.fragments ?? 0) > 0) {
      process.stdout.write(`ren5-e2e: note — ${p2.fragments} shards still fading at despawn (life outruns the pull window)\n`);
    }
  }

  // --- 3. POPPED GRACE: link 04↔05, over-stretch pop, dim + blink ----------
  {
    const id = await linkOneCord(ws);
    await pressAt(ws, CUBE05_GRAB);
    await sleep(180);
    await drag(ws, CUBE05_GRAB, CUBE05_DRAG_TO, 16, 60);
    const popped = await waitFor('the over-stretch pop mid-drag', async () => {
      const c = await lifecycleNow(ws);
      const me = c.find((x) => x.id === id);
      return me?.state === 'popped' ? me : null;
    }, 8000, 30);
    // Mid-countdown capture: grace in (0.8, 2.3) → dim 0.43–0.82.
    const graceCord = await waitFor('grace in the mid window', async () => {
      const c = await lifecycleNow(ws);
      const me = c.find((x) => x.id === id);
      if (me?.state !== 'popped') return null;
      const g = me.grace ?? 0;
      return g <= 2.3 && g > 0.8 ? me : null;
    }, 6000, 20);
    const g = graceCord.grace;
    const paint = await statePaintNow(ws);
    const entry = paint?.cords?.find((c) => c.id === id);
    const expectedDim = 0.22 + 0.78 * (g / 3);
    process.stdout.write(
      `ren5-e2e: grace seam — remaining=${g.toFixed(3)} dim(law)=${expectedDim.toFixed(3)} render=${entry?.graceFactor?.toFixed(3)} bandOff=${entry?.bandOff}\n`,
    );
    if (!entry || !entry.grace) {
      throw new Error(`the grace paint read failed: ${JSON.stringify(entry)}`);
    }
    if (Math.abs(entry.graceFactor - expectedDim) > 0.08) {
      throw new Error(`render dim ${entry.graceFactor} vs the law ${expectedDim} at remaining ${g}`);
    }
    if (entry.tickGain > 0) {
      throw new Error('a popped cord carries tick furniture (the grace owns its look)');
    }
    await shoot(ws, GRACE_SHOT); // mid-countdown, cube still held
    // The blink: sample the failing jack's band across the window's tail.
    const band = await sampleBand(ws, id, 40);
    process.stdout.write(`ren5-e2e: band sampler — ${JSON.stringify(band)}\n`);
    if (band.n < 10) throw new Error(`the band sampler only caught ${band.n} grace frames`);
    if (band.off === 0 || band.lit === 0) {
      throw new Error(`the band never blinked through the final second: ${JSON.stringify(band)}`);
    }
    await releaseAt(ws, CUBE05_DRAG_TO);
    await waitFor('the popped cord expired to vanishing', async () => {
      const c = await lifecycleNow(ws);
      return c.find((x) => x.id === id)?.state === 'vanishing' ? c : null;
    }, 8000, 60);
    await waitFor('the expired cord gone', async () => {
      const c = await lifecycleNow(ws);
      return c.every((x) => x.id !== id);
    }, 8000, 60);
  }

  // --- 4. REDUCED MOTION: the same pop under the emulated seam -------------
  {
    await send(ws, 'Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    await waitFor('the seam reads reduced', async () => {
      const p = await statePaintNow(ws);
      return p?.reduced === true;
    });
    const id = await linkOneCord(ws, CUBE02_TOP);
    await mouseMove(ws, CUBE04_GRAB.x, CUBE04_GRAB.y);
    await sleep(150);
    const preGrab = await cursorNow(ws);
    await pressAt(ws, CUBE04_GRAB);
    await sleep(200);
    const engaged = await cursorNow(ws);
    process.stdout.write(`ren5-e2e: cube-04 grab — pre '${preGrab}' → engaged '${engaged}'\n`);
    if (engaged !== 'grabbing') {
      throw new Error(`the cube-04 press at ${JSON.stringify(CUBE04_GRAB)} did not engage (cursor '${engaged}')`);
    }
    // Incremental drag with a pop check each step: the bound is crossed
    // EARLY on this geometry, and the ~3s grace can expire before a
    // post-drag poll would start — stop the drag the frame it pops.
    let popped = false;
    for (let i = 1; i <= 16 && !popped; i += 1) {
      await mouseMove(
        ws,
        CUBE04_GRAB.x + ((CUBE04_DRAG_TO.x - CUBE04_GRAB.x) * i) / 16,
        CUBE04_GRAB.y + ((CUBE04_DRAG_TO.y - CUBE04_GRAB.y) * i) / 16,
      );
      await sleep(45);
      const c = await lifecycleNow(ws);
      if (c.find((x) => x.id === id)?.state === 'popped') popped = true;
    }
    if (!popped) {
      const diag = await statePaintNow(ws);
      await shoot(ws, '/tmp/ren5-act4-debug.png');
      throw new Error(
        `the over-stretch pop never fired on the cube-04 drag (reduced run); paint ${JSON.stringify(diag)}`,
      );
    }
    const band = await sampleBand(ws, id, 120);
    process.stdout.write(`ren5-e2e: reduced-motion band sampler — ${JSON.stringify(band)}\n`);
    if (band.minRemaining === undefined || band.minRemaining === Infinity || band.minRemaining > 1.05) {
      throw new Error(`the sampler never reached the final second (min ${band.minRemaining}) — blink unproven either way`);
    }
    if (band.off > 0) {
      throw new Error(`the band BLINKED under reduced motion: ${JSON.stringify(band)}`);
    }
    await releaseAt(ws, CUBE04_DRAG_TO);
    await send(ws, 'Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: '' }],
    });
    await waitFor('the expired cord gone (reduced run)', async () => {
      const c = await lifecycleNow(ws);
      return c.every((x) => x.id !== id);
    }, 8000, 60);
    process.stdout.write('ren5-e2e: reduced-motion seam — band STEADY through the final second, dim live\n');
  }

  if (pageErrors.length > 0) {
    throw new Error(`page errors during the drive: ${pageErrors.join(' | ')}`);
  }

  process.stdout.write(`REN5_E2E_OK ${TICKS_SHOT} + ${GRACE_SHOT} + ${SHATTER_SHOT} (0 page errors)\n`);
  ws.close();
} catch (error) {
  process.exitCode = 1;
  process.stdout.write(`REN5_E2E_FAILED ${error.message}\n`);
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

#!/usr/bin/env node
/**
 * T-INT-6 end-to-end OVER-STRETCH AUTO-UNPLUG drive — real input, real app,
 * real physics. Serves the BUILT bundle (vite preview), opens the production
 * page in headless Chrome + swiftshader over CDP, and drives ONE SPAWNED
 * LINKED cord past its total length with trusted browser input:
 *
 *   1. wait out the M1 intro; spawn a cord (N) and LINK it across two cubes
 *      exactly as linked-e2e.mjs does (red on cube 04's top, blue on cube
 *      05's top — verified through window.cords.lifecycle())
 *   2. GRAB CUBE 05 ITSELF and drag it up-and-right, away from cube 04,
 *      until the two seated sockets sit past 104% of the cord's 2.4 total
 *      rest length (the production threshold) — the OVER-STRETCH fires
 *      inside the sim: the FAR jack (red, on the STATIONARY cube 04) pops
 *      out and the cord now hangs from the dragged cube 05's blue plug
 *   3. mid-drag, read the lifecycle seam: cord 1 `popped`, grace counting
 *      down inside the ~3s window — then the screenshot of record
 *      (.impeccable/review/int6-pop.png): the lifted cube trailing its cord,
 *      the popped red jack danglng/resting free, cube 04's socket empty
 *   4. release the cube; BEST-EFFORT re-plug coda (optional evidence): find
 *      the freed red jack on the floor, grab it, and seat it back on the
 *      lifted cube 05 (a self-link) — lifecycle reads `linked` again and
 *      int6-replug.png is captured. The coda never fails the drive.
 *
 * Exits 0 when the LINKED and POPPED states were both read through the
 * lifecycle seam with zero page errors and the pop capture was written.
 *
 * Usage: node scripts/pop-e2e.mjs [pop-shot] [replug-shot]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const CHROME =
  process.env.CORDS_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = 9344;
const PORT = 5204;
const APP_URL = `http://localhost:${PORT}/`;
const POP_SHOT = process.argv[2] ?? '.impeccable/review/int6-pop.png';
const REPLUG_SHOT = process.argv[3] ?? '.impeccable/review/int6-replug.png';

// World → screen waypoints, from the fixed production camera (scene.ts:
// position (0,1.45,4.5), lookAt (0,0.55,0), fov 60, 1440x900; basis right
// (1,0,0), up (0,0.98058,-0.19612), forward (0,-0.19612,-0.98058),
// f = 450/tan(30°) ≈ 779.42 — same derivation as linked-e2e.mjs):
const SPAWN_AT = { x: 789, y: 391 };     // world (0.4, 0.9, 0) — spawn-plane point
const CUBE04_TOP = { x: 906, y: 506 };   // world (0.85, 0.5, 1.05) — red seats here
const CUBE05_TOP = { x: 1018, y: 464 };  // world (1.7, 0.5, 0.15) — blue seats here
// INT-6 drag: cube 05's front face (clear of its seated blue plug), then
// up-and-right. The drag plane is camera-parallel: Δpx 246 ≈ 1.35 world x,
// Δpy −191 ≈ 1.05 world up — cube 05 lands at ≈ (3.05, 1.28, −0.06), its
// top socket ≈ (3.05, 1.53, −0.06), which is ≈ 2.65 from cube 04's socket
// (0.85, 0.55, 1.05) — past 2.496 = 2.4 × 1.04 (the production threshold).
const CUBE05_GRAB = { x: 1058, y: 527 };
const CUBE05_DRAG_TO = { x: 1304, y: 336 };
// The popped red jack hangs from the lifted cube 05 and comes to rest on
// the floor below-left of it. The rest point slides with the post-pop swing
// (observed anywhere in x ≈ 1000–1200 at y ≈ 520–590 across runs), so the
// probe hits the two observed hotspots FIRST, then sweeps the line between
// them — all inside the ~3s grace window (once it expires the cord locks
// `vanishing` and its jack stops reading 'grab'; the sweep stays clear of
// the lifted cube's rect, y ≤ 368).
const JACK_HOTSPOTS = [
  { x: 1040, y: 555 },
  { x: 1150, y: 535 },
];
const JACK_LINE = { x0: 1060, x1: 1140, y: 550, step: 20 };
const JACK_RADIUS = 44;
const JACK_STEP = 10;
// The lifted cube 05's FRONT face (≈ world (3.05, 1.28, 0.2) → screen
// (1278, 326)) — the re-plug target. NOT the top face: the seated blue
// plug sits at the top face's center and shadows it under the approved
// jack > cube priority (main.ts documents the hazard — a release onto a
// face aims at a CLEAR spot), so the coda aims at the plug-free front.
const CUBE05_FRONT_MOVED = { x: 1278, y: 326 };
// The blue-jack scan window (pre-drag, from linked-e2e.mjs): covers the
// spawn-column rest spot and excludes every cube rect and the M1 jack.
const SCAN = { x0: 680, x1: 772, y0: 480, y1: 600, step: 12 };
const NEUTRAL = { x: 640, y: 700 }; // open floor — hover reads 'default' there

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
  throw new Error(`pop-e2e: timed out waiting for ${desc}${lastError ? ` (${lastError.message})` : ''}`);
}

// --- CDP over WebSocket (same plumbing as linked-e2e.mjs) ---------------------

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

const cursorNow = async (ws) => {
  const res = await send(ws, 'Runtime.evaluate', {
    expression: 'document.querySelector("canvas")?.style.cursor ?? ""',
    returnByValue: true,
  });
  return String(res.result?.value ?? '');
};

/** The lifecycle seam (read-only): [{id, state, grace}] per cord. */
const lifecycleNow = async (ws) => {
  const res = await send(ws, 'Runtime.evaluate', {
    expression: 'JSON.stringify(window.cords.lifecycle())',
    returnByValue: true,
  });
  return JSON.parse(String(res.result?.value ?? '[]'));
};

const mouseMove = (ws, x, y) =>
  send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 1 });

async function drag(ws, from, to, steps = 14, holdMs = 55) {
  for (let i = 1; i <= steps; i += 1) {
    await mouseMove(ws, from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    await sleep(holdMs);
  }
}

/**
 * Find a 'grab' hover inside a window, DOUBLE-CONFIRMED (away to the neutral
 * floor spot and back) — same stability discipline as linked-e2e.mjs.
 */
async function findJackIn(ws, window_) {
  for (let y = window_.y0; y <= window_.y1; y += window_.step) {
    for (let x = window_.x0; x <= window_.x1; x += window_.step) {
      await mouseMove(ws, x, y);
      await sleep(60);
      if ((await cursorNow(ws)) !== 'grab') continue;
      await sleep(60);
      if ((await cursorNow(ws)) !== 'grab') continue; // stable read
      await mouseMove(ws, NEUTRAL.x, NEUTRAL.y);
      await sleep(110);
      if ((await cursorNow(ws)) !== 'default') continue; // not a stable hit
      await mouseMove(ws, x, y);
      await sleep(110);
      if ((await cursorNow(ws)) === 'grab') return { x, y };
    }
  }
  return null;
}

/**
 * Find the popped jack FAST: the observed hotspots first, then the line
 * between them, then a fine spiral around each hotspot — confirming with
 * quick double reads. The ~3s grace window is closing the whole time; once
 * it expires the cord locks `vanishing` and the jack never reads 'grab'.
 */
async function findJackNear(ws, hotspots, line, radius, step, { awayConfirm = true } = {}) {
  const ordered = [...hotspots];
  for (let x = line.x0; x <= line.x1; x += line.step) ordered.push({ x, y: line.y });
  for (const c of hotspots) {
    const ring = [];
    for (let dy = -radius; dy <= radius; dy += step) {
      for (let dx = -radius; dx <= radius; dx += step) {
        ring.push({ x: c.x + dx, y: c.y + dy });
      }
    }
    ring.sort((p, q) =>
      (p.x - c.x) ** 2 + (p.y - c.y) ** 2 - ((q.x - c.x) ** 2 + (q.y - c.y) ** 2),
    );
    ordered.push(...ring);
  }
  for (const p of ordered) {
    await mouseMove(ws, p.x, p.y);
    await sleep(40);
    if ((await cursorNow(ws)) !== 'grab') continue;
    await sleep(40);
    if ((await cursorNow(ws)) !== 'grab') continue; // stable read
    if (awayConfirm) {
      await mouseMove(ws, NEUTRAL.x, NEUTRAL.y);
      await sleep(80);
      if ((await cursorNow(ws)) !== 'default') continue; // not a stable hit
      await mouseMove(ws, p.x, p.y);
      await sleep(80);
      if ((await cursorNow(ws)) === 'grab') return p;
    } else {
      return p;
    }
  }
  return null;
}

/**
 * Grab the settling jack at `at`: press immediately (the jack is still
 * drifting — every ms between the read and the press moves the target),
 * then require the carrying cursor.
 */
async function grabJackAt(ws, at) {
  await send(ws, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x: at.x, y: at.y, button: 'left', buttons: 1, clickCount: 1,
  });
  await sleep(150);
  return (await cursorNow(ws)) === 'grabbing';
}

/** Grab the jack under (x,y): press, then require the carrying cursor. */
async function grabJack(ws, at) {
  await send(ws, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x: at.x, y: at.y, button: 'left', buttons: 1, clickCount: 1,
  });
  await sleep(180);
  if ((await cursorNow(ws)) !== 'grabbing') {
    throw new Error(`grab at ${JSON.stringify(at)} did not engage a carry`);
  }
}

const releaseAt = async (ws, at) => {
  await send(ws, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: at.x, y: at.y, button: 'left', buttons: 0, clickCount: 1,
  });
};

// --- Main --------------------------------------------------------------------

const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'ignore',
  detached: true,
});
const profileDir = mkdtempSync(join(tmpdir(), 'cords-pop-'));
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

  // 1. spawn + LINK across cubes 04 and 05 (the linked-e2e.mjs choreography).
  await mouseMove(ws, SPAWN_AT.x, SPAWN_AT.y);
  await sleep(150);
  await pressN(ws);
  await sleep(2400); // the uncoil settles; red stays carried at the cursor

  await drag(ws, SPAWN_AT, CUBE04_TOP);
  await sleep(600); // the carried pin converges against the drag plane
  await releaseAt(ws, CUBE04_TOP);
  await sleep(2400); // red's settle; blue rests at the spawn column

  const blue = await findJackIn(ws, SCAN);
  if (blue === null) throw new Error('blue jack not found in the scan window');
  await grabJack(ws, blue);
  process.stdout.write(`pop-e2e: blue jack grabbed at ${JSON.stringify(blue)}\n`);

  await drag(ws, blue, CUBE05_TOP);
  await sleep(600);
  await releaseAt(ws, CUBE05_TOP);
  await sleep(2600); // the settle into the linked rest

  let cords = await lifecycleNow(ws);
  const linked = cords.find((c) => c.id === 1);
  process.stdout.write(`pop-e2e: lifecycle after link: ${JSON.stringify(cords)}\n`);
  if (linked?.state !== 'linked') {
    throw new Error(`cord 1 did not reach linked (read ${linked?.state ?? 'gone'})`);
  }

  // 2. THE OVER-STRETCH: grab cube 05 itself and drag it away from cube 04,
  //    past 104% of the cord's total length. The sim pops the FAR jack —
  //    red, on the stationary cube 04 — mid-drag, inside the world step.
  await send(ws, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x: CUBE05_GRAB.x, y: CUBE05_GRAB.y, button: 'left', buttons: 1, clickCount: 1,
  });
  await sleep(180);
  await drag(ws, CUBE05_GRAB, CUBE05_DRAG_TO, 16, 60);

  // 3. Mid-drag hold: the popped state + the grace countdown through the
  //    seam, then the capture of record. Timings are lean from here — the
  //    ~3s grace window is what the re-plug coda races.
  await sleep(150);
  cords = await lifecycleNow(ws);
  const popped = cords.find((c) => c.id === 1);
  process.stdout.write(`pop-e2e: lifecycle mid-drag: ${JSON.stringify(cords)}\n`);
  if (popped?.state !== 'popped') {
    throw new Error(`cord 1 did not pop (read ${popped?.state ?? 'gone'}) — over-stretch never fired`);
  }
  if (typeof popped.grace !== 'number' || popped.grace <= 0 || popped.grace > 3) {
    throw new Error(`cord 1 popped but the grace window read ${popped.grace}`);
  }
  const graceFirst = popped.grace;
  await shoot(ws, POP_SHOT); // the required capture, mid-drag
  cords = await lifecycleNow(ws);
  const graceSecond = cords.find((c) => c.id === 1)?.grace ?? null;
  process.stdout.write(
    `pop-e2e: grace counting down: ${graceFirst.toFixed(3)} → ${graceSecond?.toFixed(3) ?? '?'} s\n`,
  );
  if (graceSecond === null || graceSecond >= graceFirst) {
    throw new Error('the grace window is not counting down');
  }

  // 4. Release the cube (kinematic: dropping is stopping — it stays lifted),
  //    then the re-plug coda races the remaining grace.
  await releaseAt(ws, CUBE05_DRAG_TO);
  await sleep(250); // the popped red jack swings out toward its rest

  // 5. RE-PLUG coda (the optional variant): grab the freed red jack and seat
  //    it on the lifted cube 05 — popped → linked before expiry. Best
  //    effort: a miss is reported, never fatal.
  let replugState = 'skipped';
  try {
    // The jack is still settling (the pop springs it); locate and press
    // with minimal ceremony, twice if the first press misses a mover.
    let jack = null;
    let grabbed = false;
    for (let attempt = 0; attempt < 2 && !grabbed; attempt += 1) {
      jack = await findJackNear(ws, JACK_HOTSPOTS, JACK_LINE, JACK_RADIUS, JACK_STEP, {
        awayConfirm: attempt === 0,
      });
      if (jack === null) throw new Error('red jack not found near its rest point');
      process.stdout.write(`pop-e2e: popped red jack located at ${JSON.stringify(jack)}\n`);
      grabbed = await grabJackAt(ws, jack);
    }
    if (!grabbed) throw new Error(`grab at ${JSON.stringify(jack)} did not engage a carry`);
    await drag(ws, jack, CUBE05_FRONT_MOVED, 14, 40);
    await sleep(100);
    process.stdout.write(
      `pop-e2e: at release, lifecycle ${JSON.stringify(await lifecycleNow(ws))}\n`,
    );
    await sleep(100);
    await releaseAt(ws, CUBE05_FRONT_MOVED);
    await sleep(1800); // the re-seat settle
    cords = await lifecycleNow(ws);
    replugState = cords.find((c) => c.id === 1)?.state ?? 'gone';
    process.stdout.write(`pop-e2e: lifecycle after the re-plug attempt: ${JSON.stringify(cords)}\n`);
    if (replugState === 'linked') {
      await shoot(ws, REPLUG_SHOT);
      replugState = `linked (${REPLUG_SHOT})`;
    }
  } catch (codaError) {
    replugState = `skipped (${codaError.message})`;
    try {
      await shoot(ws, '/tmp/int6-coda-debug.png'); // diagnostic only, not of record
    } catch {
      // best effort even in failure
    }
  }
  process.stdout.write(`pop-e2e: re-plug coda: ${replugState}\n`);

  if (pageErrors.length > 0) {
    throw new Error(`page errors during the drive: ${pageErrors.join(' | ')}`);
  }

  process.stdout.write(`POP_E2E_OK ${POP_SHOT} (0 page errors; re-plug coda: ${replugState})\n`);
  ws.close();
} catch (error) {
  process.exitCode = 1;
  process.stdout.write(`POP_E2E_FAILED ${error.message}\n`);
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

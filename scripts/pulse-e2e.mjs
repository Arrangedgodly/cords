#!/usr/bin/env node
/**
 * T-REN-4 end-to-end LINK CHASE PULSE drive — real input, real app, real
 * glow policy. Serves the BUILT bundle (vite preview), opens the production
 * page in headless Chrome + swiftshader over CDP, and proves the pulse:
 *
 *   1. wait out the M1 intro; link FOUR cords with the trusted mouse (the
 *      proven hud-e2e flow, seat spots derived from the fixed production
 *      camera and self-checked against its known waypoints): 04↔05, 02↔04,
 *      01↔02, 05↔06 — every pair well inside the 4% over-stretch bound
 *   2. the gate: `window.cords.pulse().linked` === exactly the four ids the
 *      lifecycle reports `linked`; the opening cord (awaiting-plug) is NOT
 *      in it
 *   3. CADENCE DETERMINISM through the seam: phase === (time · speed) mod 1
 *      bitwise-tight at every sample, and the phase advances by Δt·speed
 *      across samples (locked to the SIM clock, not wall time)
 *   4. MID-PULSE captures of record: poll the seam until the LED is
 *      early-travel (~0.12–0.30 arc) → `.impeccable/review/ren4-pulse.png`
 *      + a closeup straddling the 04↔05 cord; a second trigger at
 *      ~0.55–0.70 → `ren4-pulse-late.png` (two chances at mid-travel)
 *   5. NO-GLOW CONTRAST: a clip along the opening cord (awaiting-plug — a
 *      real cord, deliberately not linked) → `ren4-noglow.png`
 *   6. REDUCED MOTION seam: CDP emulated prefers-reduced-motion → the seam
 *      reads reduced + speed halved (0.6 → 0.3), phase advancing at half
 *      rate; then back
 *   7. LIVE-STATE GATING: grab one seated plug (cord 3's red, on cube 01)
 *      → lifecycle awaiting-plug → pulse().linked drops it while the other
 *      three keep pulsing
 *
 * Exits 0 when every assertion held with zero page errors.
 *
 * Usage: node scripts/pulse-e2e.mjs [pulse-shot] [late-shot] [noglow-shot] [closeup-shot]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const CHROME =
  process.env.CORDS_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = 9349;
const PORT = 5223;
const APP_URL = `http://localhost:${PORT}/`;
const PULSE_SHOT = process.argv[2] ?? '.impeccable/review/ren4-pulse.png';
const LATE_SHOT = process.argv[3] ?? '.impeccable/review/ren4-pulse-late.png';
const NOGLOW_SHOT = process.argv[4] ?? '.impeccable/review/ren4-noglow.png';
const CLOSEUP_SHOT = process.argv[5] ?? '.impeccable/review/ren4-pulse-closeup.png';

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
  throw new Error(`pulse-e2e: timed out waiting for ${desc}${lastError ? ` (${lastError.message})` : ''}`);
}

// --- The fixed production camera, replicated for seat-spot derivation ------
// position (0, 1.45, 4.5), lookAt (0, 0.55, 0), up +Y, fov 60 (vertical),
// 1440×900. Self-checked below against hud-e2e's known waypoints.
const CAM_POS = [0, 1.45, 4.5];
const CAM_TARGET = [0, 0.55, 0];
const FOV_Y = (60 * Math.PI) / 180;
const VIEW_W = 1440;
const VIEW_H = 900;

function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
const CAM_Z = normalize([CAM_POS[0] - CAM_TARGET[0], CAM_POS[1] - CAM_TARGET[1], CAM_POS[2] - CAM_TARGET[2]]);
const CAM_X = normalize(cross([0, 1, 0], CAM_Z));
const CAM_Y = cross(CAM_Z, CAM_X);

function worldToScreen(p) {
  const v = [p[0] - CAM_POS[0], p[1] - CAM_POS[1], p[2] - CAM_POS[2]];
  const camX = dot(v, CAM_X);
  const camY = dot(v, CAM_Y);
  const camZ = dot(v, CAM_Z); // negative: in front of the camera
  const halfH = Math.tan(FOV_Y / 2);
  const halfW = halfH * (VIEW_W / VIEW_H);
  const ndcX = camX / (-camZ * halfW);
  const ndcY = camY / (-camZ * halfH);
  return { x: ((ndcX + 1) / 2) * VIEW_W, y: ((1 - ndcY) / 2) * VIEW_H };
}

// Known waypoints (hud-e2e.mjs) — the derivation must reproduce these.
const WAYPOINTS = [
  { world: [0.85, 0.5, 1.05], expect: { x: 906, y: 506 } }, // cube 04 top
  { world: [1.7, 0.5, 0.15], expect: { x: 1018, y: 464 } }, // cube 05 top
];
for (const w of WAYPOINTS) {
  const got = worldToScreen(w.world);
  if (Math.abs(got.x - w.expect.x) > 10 || Math.abs(got.y - w.expect.y) > 10) {
    throw new Error(
      `camera derivation drifted: world ${JSON.stringify(w.world)} → ${JSON.stringify(got)}, expected ~${JSON.stringify(w.expect)}`,
    );
  }
}

// Cube tops (REN-1 layout, CUBE_POSITIONS; tops at y = 0.5):
const TOP = {
  c01: [-1.65, 0.5, -0.35],
  c02: [-0.85, 0.5, 0.95],
  c03: [-1.25, 0.5, -1.55],
  c04: [0.85, 0.5, 1.05],
  c05: [1.7, 0.5, 0.15],
  c06: [1.25, 0.5, -1.35],
};
const at = (spot, dx = 0) => {
  const s = worldToScreen(spot);
  return { x: Math.round(s.x + dx), y: Math.round(s.y) };
};

// Four link pairs (all separations ≤ 1.71 u, far inside the 2.496 pop bound).
// dx offsets separate the two plugs sharing cubes 04 / 05 / 02 (25 px ≈ a
// plug head at bench depth; the nearer proxy wins the pick).
const LINKS = [
  { red: at(TOP.c04, -12), blue: at(TOP.c05, -12) }, // cord 1: 04 ↔ 05
  { red: at(TOP.c02, -12), blue: at(TOP.c04, +13) }, // cord 2: 02 ↔ 04
  { red: at(TOP.c01), blue: at(TOP.c02, +13) },      // cord 3: 01 ↔ 02
  { red: at(TOP.c05, +13), blue: at(TOP.c06) },      // cord 4: 05 ↔ 06
];
// REFINE-3 — the no-glow contrast cord: the OPENING cord (awaiting-plug —
// red seated on module 08, blue resting on the bench). The clip spans its
// bench run: the module's base edge world (0.2, 0, 1.7) → ≈ (771, 674) down
// to the blue rest world (-0.55, 0.06, 0.3) → ≈ (622, 547) — padded to stay
// clear of every LINKS plug (cube 02's blue at (552,500) left, cube 04's red
// at (906,506) right) so the only cord in frame is the unlit opening one.
const OPENING_BASE = worldToScreen([0.2, 0.0, 1.7]);
const OPENING_REST = worldToScreen([-0.55, 0.06, 0.3]);

const SPAWN_AT = { x: 789, y: 391 };     // world (0.4, 0.9, 0) — hud-e2e's proven spot
const SCAN = { x0: 680, x1: 772, y0: 480, y1: 600, step: 12 };
const NEUTRAL = { x: 640, y: 700 };

// --- CDP over WebSocket (same plumbing as hud-e2e.mjs) ----------------------

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

const key = (k) => ({
  key: k.key,
  code: k.code,
  windowsVirtualKeyCode: k.vk,
  nativeVirtualKeyCode: k.vk,
});

const pressN = async (ws) => {
  await send(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', ...key({ key: 'n', code: 'KeyN', vk: 78 }), text: 'n' });
  await sleep(50);
  await send(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'n', code: 'KeyN', windowsVirtualKeyCode: 78, nativeVirtualKeyCode: 78 });
  await sleep(150);
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
const lifecycleStates = (ws) =>
  evalJson(ws, `JSON.stringify((window.cords?.lifecycle?.() ?? []).map((c) => c.state))`);
const pulseRead = (ws) => evalJson(ws, `JSON.stringify(window.cords?.pulse?.() ?? null)`);

const cursorNow = async (ws) => {
  const res = await send(ws, 'Runtime.evaluate', {
    expression: 'document.querySelector("canvas")?.style.cursor ?? ""',
    returnByValue: true,
  });
  return String(res.result?.value ?? '');
};

const mouseMove = (ws, x, y) =>
  send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 1 });

async function drag(ws, from, to, steps = 14, holdMs = 55) {
  for (let i = 1; i <= steps; i += 1) {
    await mouseMove(ws, from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    await sleep(holdMs);
  }
}

async function findJack(ws) {
  for (let y = SCAN.y0; y <= SCAN.y1; y += SCAN.step) {
    for (let x = SCAN.x0; x <= SCAN.x1; x += SCAN.step) {
      await mouseMove(ws, x, y);
      await sleep(70);
      if ((await cursorNow(ws)) !== 'grab') continue;
      await sleep(80);
      if ((await cursorNow(ws)) !== 'grab') continue;
      await mouseMove(ws, NEUTRAL.x, NEUTRAL.y);
      await sleep(140);
      if ((await cursorNow(ws)) !== 'default') continue;
      await mouseMove(ws, x, y);
      await sleep(140);
      if ((await cursorNow(ws)) === 'grab') return { x, y };
    }
  }
  return null;
}

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

const assertEq = (actual, expected, what) => {
  if (String(actual) !== String(expected)) {
    throw new Error(`${what}: expected ${JSON.stringify(String(expected))}, got ${JSON.stringify(String(actual))}`);
  }
};

/** Links one cord: spawn at the cursor, seat red, find + seat blue. */
async function linkOneCord(ws, index) {
  const { red, blue } = LINKS[index];
  await mouseMove(ws, SPAWN_AT.x, SPAWN_AT.y);
  await sleep(150);
  await pressN(ws);
  await sleep(2400); // uncoil settles; red stays carried at the cursor
  await drag(ws, SPAWN_AT, red);
  await sleep(600);
  await releaseAt(ws, red);
  await sleep(2400); // red's settle; blue rests at the spawn column
  // The drives' documented rest-position scan flake gets one nudge+retry:
  // a breeze-settled blue end can rest a scan-cell off the column.
  let blueJack = await findJack(ws);
  if (blueJack === null) {
    await mouseMove(ws, SPAWN_AT.x, SPAWN_AT.y + 60);
    await sleep(400);
    blueJack = await findJack(ws);
  }
  if (blueJack === null) throw new Error(`cord ${index + 1}: blue jack not found in the scan window`);
  await grabJack(ws, blueJack);
  await drag(ws, blueJack, blue);
  await sleep(600);
  await releaseAt(ws, blue);
  await sleep(2600); // the linked settle
}

/** Polls the seam until the phase sits inside [lo, hi] (mid-travel windows). */
async function awaitPhase(ws, lo, hi, timeoutMs = 20000) {
  return waitFor(`phase in [${lo}, ${hi}]`, async () => {
    const raw = await pulseRead(ws);
    const p = JSON.parse(raw);
    if (p === null) return null;
    if (p.phase >= lo && p.phase <= hi) return p;
    return null;
  }, timeoutMs, 120);
}

// --- Main --------------------------------------------------------------------

const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'ignore',
  detached: true,
});
const profileDir = mkdtempSync(join(tmpdir(), 'cords-pulse-'));
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

  // 1–2. Four linked cords, through the trusted mouse.
  for (let i = 0; i < LINKS.length; i += 1) {
    await linkOneCord(ws, i);
    const states = JSON.parse(await lifecycleStates(ws));
    const linkedCount = states.filter((s) => s === 'linked').length;
    if (linkedCount !== i + 1) {
      throw new Error(`after cord ${i + 1}: expected ${i + 1} linked, lifecycle says ${JSON.stringify(states)}`);
    }
  }
  const statesFinal = JSON.parse(await lifecycleStates(ws));
  assertEq(JSON.stringify(statesFinal), JSON.stringify(['awaiting-plug', 'linked', 'linked', 'linked', 'linked']),
    'lifecycle after four links (opening + 4)');
  const pulse1 = JSON.parse(await pulseRead(ws));
  assertEq(JSON.stringify(pulse1.linked), JSON.stringify([1, 2, 3, 4]),
    'pulse().linked === exactly the linked ids');
  assertEq(pulse1.reduced, false, 'reduced-motion off by default');
  // The RENDER layer's own read (not main's math): the same phase, and the
  // gain gate lit on exactly the four linked views.
  if (Math.abs(pulse1.renderPhase - pulse1.phase) > 0.12) {
    throw new Error(`render phase ${pulse1.renderPhase} drifted from the clock ${pulse1.phase}`);
  }
  const litGains = pulse1.renderGains.filter((g) => g.gain > 0).map((g) => g.id).sort();
  assertEq(JSON.stringify(litGains), JSON.stringify([1, 2, 3, 4]),
    'render gains lit on exactly the four linked views (the opening cord dark)');
  process.stdout.write('pulse-e2e: 4 cords linked; gate === lifecycle === render gains\n');

  // 3. Cadence determinism: phase === (time·speed) mod 1, and it advances
  // with SIM time at exactly the configured rate.
  {
    const samples = [];
    for (let i = 0; i < 10; i += 1) {
      samples.push(JSON.parse(await pulseRead(ws)));
      await sleep(220);
    }
    for (const s of samples) {
      const expected = ((s.time * s.speed) % 1 + 1) % 1;
      if (Math.abs(s.phase - expected) > 1e-9) {
        throw new Error(`determinism: phase ${s.phase} ≠ (time·speed) mod 1 ${expected} at t=${s.time}`);
      }
    }
    for (let i = 1; i < samples.length; i += 1) {
      const a = samples[i - 1];
      const b = samples[i];
      if (b.time > a.time) {
        const expectedAdvance = (b.time - a.time) * b.speed;
        const actual = ((b.phase - a.phase) % 1 + 1) % 1;
        // One sim frame of quantization slack (phase ticks with sim frames).
        if (Math.abs(actual - expectedAdvance) > 1 / 60 * b.speed + 1e-9) {
          throw new Error(`cadence: phase advanced ${actual} over Δt=${b.time - a.time}, expected ~${expectedAdvance}`);
        }
      }
    }
    process.stdout.write(`pulse-e2e: cadence deterministic — phase === (t·${samples[0].speed}) mod 1 across ${samples.length} samples\n`);
  }

  // 4. Mid-pulse captures of record. The LED is a compact chase segment
  // (~12% of the cord's arc — probe-measured ~25–30 px on a draped bench
  // cord), and headless captureScreenshot composites the last PRESENTED
  // frame, which under swiftshader can lag the seam read by a few hundred
  // ms of phase — so each trigger takes a short BURST: consecutive frames
  // step the phase by ~0.1 and at least one lands mid-travel (verified
  // offline; the record names carry the best frames). The closeup covers
  // the 04↔05 drape INCLUDING its sag (2.4 u cord over a 1.24 u gap).
  const c04 = worldToScreen(TOP.c04);
  const c05 = worldToScreen(TOP.c05);
  const closeupClip = {
    x: Math.min(c04.x, c05.x) - 70,
    y: Math.min(c04.y, c05.y) - 70,
    width: Math.abs(c05.x - c04.x) + 140,
    height: 260, // tops + the full sag below the line
  };
  await awaitPhase(ws, 0.25, 0.45);
  await shoot(ws, PULSE_SHOT);
  await shoot(ws, PULSE_SHOT.replace(/\.png$/, '-b.png'));
  await shoot(ws, PULSE_SHOT.replace(/\.png$/, '-c.png'));
  await shoot(ws, CLOSEUP_SHOT, closeupClip);
  await shoot(ws, CLOSEUP_SHOT.replace(/\.png$/, '-b.png'), closeupClip);
  await awaitPhase(ws, 0.55, 0.70);
  await shoot(ws, LATE_SHOT);
  process.stdout.write('pulse-e2e: mid-pulse bursts captured at early + late travel\n');

  // 5. The no-glow contrast: the opening cord (awaiting-plug) carries no LED.
  {
    const x0 = Math.min(OPENING_BASE.x, OPENING_REST.x) - 60;
    const y0 = Math.min(OPENING_BASE.y, OPENING_REST.y) - 60;
    await shoot(ws, NOGLOW_SHOT, {
      x: x0,
      y: y0,
      width: Math.abs(OPENING_REST.x - OPENING_BASE.x) + 120,
      height: Math.abs(OPENING_REST.y - OPENING_BASE.y) + 120,
    });
  }
  process.stdout.write('pulse-e2e: no-glow contrast captured (opening cord, awaiting-plug)\n');

  // 6. The reduced-motion seam, through the browser's own media emulation.
  {
    await send(ws, 'Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    const reduced = await waitFor('the reduced-motion pulse read', async () => {
      const p = JSON.parse(await pulseRead(ws));
      return p?.reduced === true ? p : null;
    });
    if (Math.abs(reduced.speed - reduced.baseSpeed / 2) > 1e-9) {
      throw new Error(`reduced speed ${reduced.speed} ≠ base/2 ${reduced.baseSpeed / 2}`);
    }
    const a = JSON.parse(await pulseRead(ws));
    await sleep(700);
    const b = JSON.parse(await pulseRead(ws));
    const expectedAdvance = (b.time - a.time) * a.speed;
    const actual = ((b.phase - a.phase) % 1 + 1) % 1;
    if (b.time > a.time && Math.abs(actual - expectedAdvance) > 1 / 60 * a.speed + 1e-9) {
      throw new Error(`reduced cadence: ${actual} over Δt=${b.time - a.time}, expected ~${expectedAdvance}`);
    }
    await send(ws, 'Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: '' }],
    });
    await waitFor('reduced-motion cleared', async () =>
      (JSON.parse(await pulseRead(ws)))?.reduced === false);
    process.stdout.write(`pulse-e2e: reduced-motion seam — speed ${a.baseSpeed} → ${a.speed}, cadence holds\n`);
  }

  // 7. Live-state gating: grab a seated plug → the glow dies THAT cord.
  {
    const spot = LINKS[2].red; // cord 3's red plug on cube 01 (single-plug cube)
    await mouseMove(ws, spot.x, spot.y);
    await sleep(200);
    const cursor = await cursorNow(ws);
    if (cursor !== 'grab') throw new Error(`seated plug at ${JSON.stringify(spot)} reads '${cursor}', expected 'grab'`);
    await grabJack(ws, spot);
    await drag(ws, spot, { x: spot.x - 110, y: spot.y - 70 }, 10);
    await sleep(500);
    const afterGrab = JSON.parse(await lifecycleStates(ws));
    assertEq(afterGrab[3], 'awaiting-plug', 'cord 3 after the pull (linked → awaiting-plug)');
    const pulseAfter = JSON.parse(await pulseRead(ws));
    assertEq(JSON.stringify(pulseAfter.linked), JSON.stringify([1, 2, 4]),
      'pulse().linked drops the pulled cord, keeps the other three');
    const litAfter = pulseAfter.renderGains.filter((g) => g.gain > 0).map((g) => g.id).sort();
    assertEq(JSON.stringify(litAfter), JSON.stringify([1, 2, 4]),
      'render gains drop the pulled cord the same frame');
    await awaitPhase(ws, 0.2, 0.5); // the survivors still chase
    await releaseAt(ws, { x: spot.x - 110, y: spot.y - 70 });
    await sleep(400);
    process.stdout.write('pulse-e2e: pull one plug → that cord dark, three still pulsing\n');
  }

  if (pageErrors.length > 0) {
    throw new Error(`page errors during the drive: ${pageErrors.join(' | ')}`);
  }

  process.stdout.write(`PULSE_E2E_OK ${PULSE_SHOT} + ${LATE_SHOT} + ${NOGLOW_SHOT} + ${CLOSEUP_SHOT} (0 page errors)\n`);
  ws.close();
} catch (error) {
  process.exitCode = 1;
  process.stdout.write(`PULSE_E2E_FAILED ${error.message}\n`);
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

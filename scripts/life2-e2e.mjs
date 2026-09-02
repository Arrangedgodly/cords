#!/usr/bin/env node
/**
 * T-LIFE-2 end-to-end VANISH SEQUENCE drive — real input, real app, real
 * physics. Serves the BUILT bundle (vite preview), opens the production page
 * in headless Chrome + swiftshader over CDP, and drives the approved
 * failure through the REAL composition:
 *
 *   1. wait out the M1 intro; spawn a cord (N) and seat its RED end on cube
 *      04's top (verified through window.cords.lifecycle() = awaiting-plug)
 *   2. grab the BLUE end, carry it over OPEN FLOOR, release it there — the
 *      user-initiated failure: the cord reads `vanishing` and the choreography
 *      owns it: the failing end FREE-FALLS (the sim's gravity — no scripted
 *      descent), the jack SHATTERS on first floor contact (dark fragments at
 *      the impact point; its mesh despawns with them), the cord PULLS OUT of
 *      cube 04 and collapses toward the failure point, then fades and is
 *      REMOVED from the world (lifecycle() stops listing it)
 *   3. tight-poll the lifecycle seam's live `vanish` info and capture MID-
 *      PULL-OUT (the required capture of record, .impeccable/review/
 *      life2-vanish.png); a second cord provides the mid-FALL frame
 *      (life2-vanish-fall.png) + the scene-clean frame (life2-clean.png)
 *   4. THE SHADOW-HAZARD REGRESSION (the LIFE-1 verifier's carry-forward):
 *      hover cube 04's top face — the exact face the vanished plug shadowed
 *      under jack > cube priority — and require the cursor to read 'grab'
 *      (the CUBE; a leaked proxy would read 'default', since nothing on a
 *      gone cord is grabbable); then seat a NEW cord's red end on that exact
 *      face and require `awaiting-plug` — the face is droppable-on again.
 *
 * Exits 0 when the sequence completed in pixels (vanishing read, mid-pull
 * capture written, cord gone from the seam, the freed face re-seatable) with
 * zero page errors.
 *
 * Usage: node scripts/life2-e2e.mjs [vanish-shot] [fall-shot] [clean-shot]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const CHROME =
  process.env.CORDS_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = 9346;
const PORT = 5207;
const APP_URL = `http://localhost:${PORT}/`;
const VANISH_SHOT = process.argv[2] ?? '.impeccable/review/life2-vanish.png';
const FALL_SHOT = process.argv[3] ?? '.impeccable/review/life2-vanish-fall.png';
const CLEAN_SHOT = process.argv[4] ?? '.impeccable/review/life2-clean.png';

// World → screen waypoints, from the fixed production camera (scene.ts:
// position (0,1.45,4.5), lookAt (0,0.55,0), fov 60, 1440x900 — same
// derivation as pop-e2e.mjs / linked-e2e.mjs):
const SPAWN_AT = { x: 789, y: 391 };     // world (0.4, 0.9, 0) — spawn-plane point
const CUBE04_TOP = { x: 906, y: 506 };   // world (0.85, 0.5, 1.05) — red seats here
// The failure release: high OPEN AIR left of the spawn column — clear of
// every cube rect (cube tops sit at y ≈ 420–540 px) and of the seated red
// plug at (906,506). The carried jack rides the camera-parallel drag plane
// up to ≈ world y 0.9–1.0, so the free fall is a readable ~0.4–0.6 s.
const RELEASE_AT = { x: 700, y: 350 };
// The blue-jack scan window: covers the spawn-column rest spot (which drifts
// run to run) and excludes the OPENING cord's resting jack (REFINE-3: it
// rests at screen ≈ (622,547), its grab halo reaching ≈ x 645 — 31 px clear
// of the window's left edge) and its seated red plug on module 08's top
// (proxy spans ≈ x 816–886 at y ≈ 575, right of x1), the draped BODY being
// ungrabbable (only jack proxies and cubes are); also clear of cube 06's
// bottom edge (the far-back cube spans y ≈ 407–465 at x 645–703), cube 03's
// left edge (≈ 810), and cube 08's body (x ≥ 771 below y ≈ 575).
const SCAN = { x0: 676, x1: 800, y0: 486, y1: 604, step: 12 };
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
  throw new Error(`life2-e2e: timed out waiting for ${desc}${lastError ? ` (${lastError.message})` : ''}`);
}

// --- CDP over WebSocket (same plumbing as pop-e2e.mjs) ------------------------

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

/** The lifecycle seam (read-only): [{id, state, grace, vanish}] per cord. */
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

/** Find a 'grab' hover inside a window, DOUBLE-CONFIRMED (linked-e2e discipline). */
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

const grabJack = async (ws, at) => {
  await send(ws, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x: at.x, y: at.y, button: 'left', buttons: 1, clickCount: 1,
  });
  await sleep(180);
  if ((await cursorNow(ws)) !== 'grabbing') {
    throw new Error(`grab at ${JSON.stringify(at)} did not engage a carry`);
  }
};

const releaseAt = async (ws, at) => {
  await send(ws, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: at.x, y: at.y, button: 'left', buttons: 0, clickCount: 1,
  });
};

/**
 * Spawn a cord, seat its RED end on cube 04's top, and grab the BLUE end.
 * Returns once the blue jack is in hand (cursor 'grabbing'). The next
 * pointer-up is the caller's failure (or seat).
 */
async function seatRedGrabBlue(ws) {
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
  process.stdout.write(`life2-e2e: blue jack grabbed at ${JSON.stringify(blue)}\n`);
}

// --- Main --------------------------------------------------------------------

const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'ignore',
  detached: true,
});
const profileDir = mkdtempSync(join(tmpdir(), 'cords-life2-'));
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

  // --- Round 1 (cord 1): the failure + the REQUIRED mid-pull capture ---------

  await seatRedGrabBlue(ws);
  let cords = await lifecycleNow(ws);
  const seated = cords.find((c) => c.id === 1);
  process.stdout.write(`life2-e2e: lifecycle after red seat: ${JSON.stringify(cords)}\n`);
  if (seated?.state !== 'awaiting-plug') {
    throw new Error(`cord 1 did not reach awaiting-plug (read ${seated?.state ?? 'gone'})`);
  }

  // Carry the held blue jack over open floor and RELEASE — the failure.
  await drag(ws, NEUTRAL, RELEASE_AT, 12, 45);
  await sleep(250); // the carried pin converges on the drag plane
  await releaseAt(ws, RELEASE_AT);

  // Tight-poll the seam through the whole sequence: fall → shatter → pull.
  // The pull window is 0.35 s of real time, so no sleeps in this loop — each
  // CDP round trip is ~5–15 ms. Capture the frame the pull phase is live.
  const startedAt = Date.now();
  let vanishInfo = null;
  let pullShot = false;
  let shatterSeen = false;
  while (Date.now() - startedAt < 4000) {
    cords = await lifecycleNow(ws);
    const me = cords.find((c) => c.id === 1);
    if (me === undefined) break; // gone — the sequence completed
    if (me.state === 'awaiting-plug' && Date.now() - startedAt < 600) {
      continue; // the release intent is consumed by the next frame — not yet
    }
    if (me.state !== 'vanishing') {
      try {
        await shoot(ws, '/tmp/life2-debug.png');
      } catch {
        // best effort
      }
      throw new Error(
        `cord 1 read ${me.state} after the off-cube release (expected vanishing; dbg /tmp/life2-debug.png)`,
      );
    }
    vanishInfo = me.vanish;
    if (vanishInfo?.phase === 'pull') {
      await shoot(ws, VANISH_SHOT); // the required capture, mid-pull-out
      pullShot = true;
      break;
    }
    // The shatter has fired once the fall phase is behind us (shatter is the
    // crossing instant; the seam exposes the phases either side of it).
    if (vanishInfo?.phase === 'fall' && Date.now() - startedAt > 600) shatterSeen = true;
  }
  if (!pullShot) {
    throw new Error('the pull phase was never caught by the poll (sequence too fast or failed)');
  }
  process.stdout.write(
    `life2-e2e: captured mid-pull-out at progress ${vanishInfo?.progress?.toFixed(2) ?? '?'} → ${VANISH_SHOT}\n`,
  );

  // The completion: the cord leaves the world (the despawn the sequence itself
  // reports). The seam stops listing it entirely.
  await waitFor('cord 1 despawned from the seam', async () => {
    const now = await lifecycleNow(ws);
    return now.every((c) => c.id !== 1);
  }, 4000, 60);
  await sleep(700); // the render's unseen-view hide + fragment tail
  await shoot(ws, CLEAN_SHOT);
  process.stdout.write(`life2-e2e: cord 1 gone from world state; clean scene → ${CLEAN_SHOT}\n`);

  // --- THE SHADOW-HAZARD REGRESSION (the LIFE-1 verifier's carry-forward) -----

  // Before the fix, the vanished plug's stale proxy still raycast at its seat
  // pixel: jack > cube priority shadows the face, and jackGrabbable on a gone
  // cord reads NOT grabbable → the hover reads 'default'. After the pull-out
  // unregisters the proxy, the CUBE wins: the hover reads 'grab'.
  await mouseMove(ws, CUBE04_TOP.x, CUBE04_TOP.y);
  await sleep(120);
  const faceCursor = await cursorNow(ws);
  await sleep(80);
  const faceCursorStable = await cursorNow(ws);
  process.stdout.write(`life2-e2e: freed-face cursor reads '${faceCursor}'/'${faceCursorStable}'\n`);
  if (faceCursor !== 'grab' || faceCursorStable !== 'grab') {
    throw new Error(
      `cube 04's top face is not grabbable after the vanish (read '${faceCursor}'/'${faceCursorStable}') — a leaked proxy still shadows it`,
    );
  }

  // The strongest form: seat a NEW cord's red end on that exact face.
  await mouseMove(ws, SPAWN_AT.x, SPAWN_AT.y);
  await sleep(150);
  await pressN(ws);
  await sleep(2400); // the new cord's red end is carried at the cursor
  await drag(ws, SPAWN_AT, CUBE04_TOP);
  await sleep(600);
  await releaseAt(ws, CUBE04_TOP);
  await sleep(2000); // the seat settle
  cords = await lifecycleNow(ws);
  const reseated = cords.find((c) => c.id === 2);
  process.stdout.write(`life2-e2e: lifecycle after the freed-face re-seat: ${JSON.stringify(cords)}\n`);
  if (reseated?.state !== 'awaiting-plug') {
    throw new Error(`the freed face did not seat the new cord (read ${reseated?.state ?? 'gone'})`);
  }

  // --- Round 2 (cord 2's blue): the mid-FALL frame (multi-frame evidence) -----
  // TIMING NOTE (measured): headless Chrome's rAF pump compresses sim time to
  // roughly 5x wall time (the fixed-timestep clamp at 5 substeps/frame), so
  // the ~0.9s-of-sim fall elapses in ~0.2s of wall time — too fast to catch
  // by polling (each CDP eval costs ~200ms under swiftshader). Instead: fire a
  // frame BURST the instant the button lifts; the middle frame is the mid-fall
  // capture of record. Best effort — a miss never fails the drive (the fall
  // itself is bitwise-pinned in the unit suite; a probe burst verified the
  // jack visibly airborne descent in pixels).
  try {
    const blue2 = await findJackIn(ws, SCAN);
    if (blue2 !== null) {
      await grabJack(ws, blue2);
      await drag(ws, blue2, RELEASE_AT, 12, 40);
      await sleep(600); // let the carried pin climb the drag plane (round 1's
      // discipline) — releasing at the floor-level rest would shatter instantly
      await releaseAt(ws, RELEASE_AT);
      await shoot(ws, '.impeccable/review/life2-vanish-fall-a.png');
      await shoot(ws, FALL_SHOT);
      await shoot(ws, '.impeccable/review/life2-vanish-fall-b.png');
      process.stdout.write(`life2-e2e: fall burst captured → ${FALL_SHOT} (+a/b frames)\n`);
    } else {
      process.stdout.write('life2-e2e: round-2 blue jack not found; fall frame skipped\n');
    }
  } catch (fallError) {
    process.stdout.write(`life2-e2e: fall-frame round skipped (${fallError.message})\n`);
  }

  if (pageErrors.length > 0) {
    throw new Error(`page errors during the drive: ${pageErrors.join(' | ')}`);
  }

  process.stdout.write(
    `LIFE2_E2E_OK ${VANISH_SHOT} + ${CLEAN_SHOT} (0 page errors; freed face re-seatable)\n`,
  );
  ws.close();
} catch (error) {
  process.exitCode = 1;
  process.stdout.write(`LIFE2_E2E_FAILED ${error.message}\n`);
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

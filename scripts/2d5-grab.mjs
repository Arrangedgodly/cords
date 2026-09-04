#!/usr/bin/env node
/**
 * 2D-5 — THE GRAB-RELIABILITY DRIVE (the user's exact report, pinned):
 *
 *   "jacks are hard to click and drag — drags spontaneously release
 *    mid-move and the unintended off-module release shatters the cord.
 *    Almost every cord test."
 *
 * Ten fast-fling grabs (rapid big-delta moves, a real wrist), HUD-crossing
 * drags (the DOM faceplate overlays the canvas bottom), and window-edge
 * excursions — every one must END IN A SEAT with ZERO unintended
 * vanishing anywhere in between. The drive then performs ONE deliberate
 * off-module release and asserts the approved failure path still fires
 * (the shatter must remain a deliberate act, not an accident).
 *
 * In-page watchers (installed before any input, read through the
 * production seams only):
 *   - the VANISH WATCHER: every rAF polls lifecycle(); any cord ENTERING
 *     'vanishing' is recorded with a timestamp (the accident detector).
 *   - the CAPTURE SAMPLER: while a pointerdown is live, samples
 *     canvas.hasPointerCapture(pointerId) each rAF (the pointer-capture
 *     wiring pin — every sample during a drag must be true).
 */
import {
  assertDist,
  ends,
  evalJs,
  lifecycle,
  openPage,
  press,
  move,
  release,
  rects,
  run,
  sleep,
  spawnViaKey,
  startStack,
  waitFor,
} from './2d3-lib.mjs';

const WATCHERS = `(() => {
  const c = document.querySelector('#stage');
  window.__vanish = [];      // { id, t } — cords entering 'vanishing'
  window.__capture = [];     // booleans — hasPointerCapture during a drag
  window.__held = [];        // booleans — window.cords.held() during a drag
  let prev = new Map();
  let dragId = null;
  c.addEventListener('pointerdown', (e) => { dragId = e.pointerId; });
  const endDrag = () => { dragId = null; };
  c.addEventListener('pointerup', endDrag);
  c.addEventListener('pointercancel', endDrag);
  const tick = () => {
    for (const cord of window.cords.lifecycle()) {
      if (cord.state === 'vanishing' && prev.get(cord.id) !== 'vanishing') {
        window.__vanish.push({ id: cord.id, t: performance.now() });
      }
      prev.set(cord.id, cord.state);
    }
    if (dragId !== null) {
      window.__capture.push(c.hasPointerCapture(dragId));
      window.__held.push(window.cords.held() !== null);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return true;
})()`;

const held = (cdp) => evalJs(cdp, 'window.cords.held()');
const watchers = (cdp) => evalJs(cdp, '({ vanish: window.__vanish, capture: window.__capture, held: window.__held })');
const resetWatchers = (cdp) =>
  evalJs(cdp, 'window.__vanish = []; window.__capture = []; window.__held = []');

/** One fast fling: press at `jack`, a burst of big-delta moves toward `to`,
 * a 3-move deceleration onto the target, a beat, then release. Asserts the
 * latch HELD through the burst and the release SEATED. */
async function flingDrag(cdp, jack, target, what, burst = 22) {
  await press(cdp, jack.x, jack.y);
  await sleep(40);
  // the burst: rapid large deltas (a real wrist flick — ±100–250 px per move)
  let x = jack.x;
  let y = jack.y;
  for (let i = 0; i < burst; i += 1) {
    x += (target.x - x) * 0.22 + (i % 2 === 0 ? 90 : -70);
    y += (target.y - y) * 0.22 + (i % 3 === 0 ? -60 : 40);
    x = Math.max(40, Math.min(1560, x));
    y = Math.max(40, Math.min(960, y));
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: Math.round(x), y: Math.round(y), button: 'left', buttons: 1,
    });
  }
  const hMid = await held(cdp);
  if (hMid === null) throw new Error(`${what}: the carry latch DROPPED mid-fling`);
  // decelerate onto the target (the honest plug: fast approach, soft landing)
  for (let i = 1; i <= 3; i += 1) {
    await move(cdp, x + (target.x - x) * (i / 3), y + (target.y - y) * (i / 3));
    await sleep(30);
  }
  await sleep(140);
  const hNow = await held(cdp);
  if (hNow === null) throw new Error(`${what}: the latch dropped before release`);
  await release(cdp, target.x, target.y);
  await sleep(260);
  return hNow;
}

/** Assert the just-released end is seated on module `rectId`. */
async function assertSeated(cdp, cordId, index, rectId, what) {
  const e = (await ends(cdp)).find((x) => x.cordId === cordId && x.index === index);
  if (!e) throw new Error(`${what}: end ${index} of cord ${cordId} vanished`);
  if (!e.seated) {
    const mods = await rects(cdp);
    const m = mods.find((r) => r.id === rectId);
    throw new Error(
      `${what}: end did not seat (jack at ${Math.round(e.x)},${Math.round(e.y)}; module ${rectId} at ${Math.round(m.x)},${Math.round(m.y)})`,
    );
  }
  return true;
}

/** A module's top-edge landing zone (screen px). */
async function topEdge(cdp, rectId) {
  const m = (await rects(cdp)).find((r) => r.id === rectId);
  if (!m) throw new Error(`module ${rectId} missing`);
  return { x: m.x + m.w / 2, y: m.y - 3 };
}

run('2d5grab', async () => {
  assertDist();
  const base = await startStack();
  const { cdp, errors } = await openPage(base);
  await evalJs(cdp, WATCHERS);
  await sleep(250);

  const v = await evalJs(cdp, 'window.cords.view()');
  let seatTally = 0;
  let vanishTally = 0;

  // --- DRAG 1 — the user's very first move: the opening's blue jack --------
  {
    const life = await lifecycle(cdp);
    const opening = life.find((c) => c.state === 'awaiting-plug');
    if (!opening) throw new Error('the opening cord is missing');
    const blue = (await ends(cdp)).find((e) => e.cordId === opening.id && !e.seated);
    const target = await topEdge(cdp, 6); // module 07 — within m08's reach
    await flingDrag(cdp, blue, target, 'drag-1 (opening blue jack, fast fling)');
    await assertSeated(cdp, opening.id, blue.index, 6, 'drag-1');
    const st = (await lifecycle(cdp)).find((c) => c.id === opening.id)?.state;
    if (st !== 'linked') throw new Error(`drag-1: expected linked, got ${st}`);
    seatTally += 1;
    console.log('  drag 1 — opening blue jack, fast fling → seated on 07, cord LINKED');
  }

  // --- DRAGS 2–6 — N-spawned cords, wrist-flick flings onto modules --------
  for (const rectId of [0, 2, 3, 5, 7]) {
    const before = (await lifecycle(cdp)).length;
    const cordId = await spawnViaKey(cdp, before, 'N');
    await sleep(300);
    // The spawn holds the RED end in hand at the cursor — fling IT.
    const heldEnd = await held(cdp);
    if (heldEnd === null || heldEnd.cordId !== cordId) {
      throw new Error(`spawn ${cordId}: no held end after N`);
    }
    const jack = (await ends(cdp)).find((e) => e.cordId === cordId && e.index === heldEnd.index);
    const target = await topEdge(cdp, rectId);
    // press is not needed (the spawn IS the grab): moves + release.
    let x = jack.x;
    let y = jack.y;
    for (let i = 0; i < 22; i += 1) {
      x += (target.x - x) * 0.22 + (i % 2 === 0 ? 110 : -80);
      y += (target.y - y) * 0.22 + (i % 3 === 0 ? -70 : 50);
      x = Math.max(40, Math.min(1560, x));
      y = Math.max(40, Math.min(960, y));
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: Math.round(x), y: Math.round(y), button: 'left', buttons: 1,
      });
    }
    if ((await held(cdp)) === null) throw new Error(`fling to ${rectId}: latch dropped mid-fling`);
    for (let i = 1; i <= 3; i += 1) {
      await move(cdp, x + (target.x - x) * (i / 3), y + (target.y - y) * (i / 3));
      await sleep(30);
    }
    await sleep(140);
    await release(cdp, target.x, target.y);
    await sleep(260);
    await assertSeated(cdp, cordId, heldEnd.index, rectId, `fling onto ${rectId}`);
    seatTally += 1;
    console.log(`  drag — N-spawn ${cordId} wrist-flick → seated on module 0${rectId + 1}`);
  }

  // --- HUD-CROSSING DRAGS — down through the faceplate strip and back ------
  for (let k = 0; k < 2; k += 1) {
    const before = (await lifecycle(cdp)).length;
    const cordId = await spawnViaKey(cdp, before, 'N');
    await sleep(250);
    const heldEnd = await held(cdp);
    if (heldEnd === null || heldEnd.cordId !== cordId) throw new Error('hud drag: no held end');
    // Drop the spawn on open floor (a carried cord's ordinary drop — NOT a
    // failure), then GRAB a jack from the floor and cross the HUD with it.
    await move(cdp, 700 + k * 200, 500);
    await sleep(80);
    await release(cdp, 700 + k * 200, 500);
    await sleep(300);
    await waitFor(
      async () => (await lifecycle(cdp)).find((c) => c.id === cordId)?.state === 'carried',
      'the dropped coil to settle',
      4000,
    ).catch(() => {});
    await sleep(600); // let the coil settle on the bench
    const jacks = (await ends(cdp)).filter((e) => e.cordId === cordId);
    const jack = jacks[0];
    await press(cdp, jack.x, jack.y);
    await sleep(40);
    if ((await held(cdp)) === null) throw new Error('hud drag: the floor grab MISSED — pick regression');
    // Down across the floor line INTO the HUD strip, wiggle there, come back.
    for (let i = 1; i <= 8; i += 1) {
      await move(cdp, jack.x + 30 * i, jack.y + ((v.height - 14 - jack.y) * i) / 8);
      await sleep(26);
    }
    for (let w = 0; w < 3; w += 1) {
      await move(cdp, 400 + w * 120, v.height - 12);
      await sleep(26);
    }
    if ((await held(cdp)) === null) {
      throw new Error('hud drag: the latch dropped while over the HUD strip');
    }
    const target = await topEdge(cdp, 4 - k);
    for (let i = 1; i <= 6; i += 1) {
      const x = 400 + 120 * 2 + (target.x - 640) * (i / 6);
      const y = v.height - 12 + (target.y - (v.height - 12)) * (i / 6);
      await move(cdp, x, y);
      await sleep(28);
    }
    await sleep(140);
    await release(cdp, target.x, target.y);
    await sleep(260);
    await assertSeated(cdp, cordId, jack.index, 4 - k, 'hud crossing');
    seatTally += 1;
    console.log(`  hud drag ${k + 1} — through the faceplate strip and back → seated on module 0${5 - k}`);
  }

  // --- EDGE-CROSSING DRAGS — outside the window bounds and back -------------
  for (let k = 0; k < 2; k += 1) {
    const before = (await lifecycle(cdp)).length;
    const cordId = await spawnViaKey(cdp, before, 'N');
    await sleep(250);
    await move(cdp, 600 + k * 300, 550);
    await sleep(80);
    await release(cdp, 600 + k * 300, 550);
    await sleep(900);
    const jack = (await ends(cdp)).filter((e) => e.cordId === cordId)[0];
    await press(cdp, jack.x, jack.y);
    await sleep(40);
    if ((await held(cdp)) === null) throw new Error('edge drag: grab missed');
    // Out the left (or right) edge, along the outside, and back in.
    const outX = k === 0 ? -260 : v.width + 260;
    for (let i = 1; i <= 6; i += 1) {
      await move(cdp, jack.x + (outX - jack.x) * (i / 6), jack.y - 40 * i);
      await sleep(24);
    }
    for (let i = 0; i < 4; i += 1) {
      await move(cdp, outX + (k === 0 ? 1 : -1) * 40 * i, 200 + 30 * i);
      await sleep(24);
    }
    if ((await held(cdp)) === null) throw new Error('edge drag: latch dropped while OUTSIDE the window');
    const target = await topEdge(cdp, 1 + k);
    for (let i = 1; i <= 8; i += 1) {
      const x = outX + (k === 0 ? 1 : -1) * 120 + (target.x - (outX + (k === 0 ? 1 : -1) * 120)) * (i / 8);
      await move(cdp, x, 290 + (target.y - 290) * (i / 8));
      await sleep(26);
    }
    await sleep(140);
    await release(cdp, target.x, target.y);
    await sleep(260);
    await assertSeated(cdp, cordId, jack.index, 1 + k, 'edge crossing');
    seatTally += 1;
    console.log(`  edge drag ${k + 1} — outside the window and back → seated on module 0${2 + k}`);
  }

  // --- THE ACCIDENT AUDIT ----------------------------------------------------
  await sleep(300);
  const w = await watchers(cdp);
  if (w.vanish.length !== 0) {
    throw new Error(`UNINTENDED vanishing during the drags: ${JSON.stringify(w.vanish)}`);
  }
  const droppedSamples = w.held.filter((h) => h === false).length;
  if (droppedSamples > 0) {
    throw new Error(`the carry latch read NULL on ${droppedSamples} in-drag samples`);
  }
  const noCapture = w.capture.filter((c) => c !== true).length;
  if (noCapture > 0) {
    throw new Error(`pointer capture was NOT held on ${noCapture} in-drag samples`);
  }
  console.log(
    `  audit — ${w.capture.length} in-drag samples: capture held 100%, latch held 100%, unintended vanishing: 0`,
  );

  // --- THE DELIBERATE FAILURE (the shatter must still be a choice) ----------
  {
    const mods = await rects(cdp);
    const m = mods.find((r) => r.id === 6);
    const jack = (await ends(cdp)).find((e) => e.seated && e.x > m.x - 40 && e.x < m.x + m.w + 40);
    if (!jack) throw new Error('deliberate failure: no seated jack near module 07');
    await press(cdp, jack.x, jack.y);
    await sleep(40);
    if ((await held(cdp)) === null) throw new Error('deliberate failure: the seated-plug grab missed');
    const off = { x: 480, y: 620 }; // open bench, far from every module
    for (let i = 1; i <= 8; i += 1) {
      await move(cdp, jack.x + (off.x - jack.x) * (i / 8), jack.y + (off.y - jack.y) * (i / 8));
      await sleep(24);
    }
    await sleep(100);
    await release(cdp, off.x, off.y);
    await sleep(400);
    const w2 = await watchers(cdp);
    if (w2.vanish.length !== 1) {
      throw new Error(`the deliberate off-module release must fire exactly one vanish (got ${w2.vanish.length})`);
    }
    const st = (await lifecycle(cdp)).find((c) => c.id === w2.vanish[0].id)?.state;
    if (st !== 'vanishing') throw new Error(`deliberate failure cord is '${st}', expected vanishing`);
    vanishTally += 1;
    console.log('  deliberate failure — off-module release of a pulled plug → vanishing (the shatter is a choice)');
  }

  console.log(
    `2D-5 grab drive: ${seatTally} seated drags (10 flings/HUD/edge), 0 unintended vanishing, ${vanishTally} deliberate failure`,
  );

  const pageErrors = errors();
  if (pageErrors > 0) throw new Error(`page errors: ${pageErrors}`);
});

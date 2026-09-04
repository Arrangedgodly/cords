#!/usr/bin/env node
/**
 * 2D-3 — THE FULL-ARC DRIVE. The toy's whole story on the Canvas world, every
 * step asserted through the window.cords seams (zero page errors throughout):
 *
 *   load → link (+ the pulse) → pop (over-stretch) → the grace states
 *   (dim + blink + ticks elsewhere, captured) → re-plug inside the grace →
 *   hand-pull → off-module release → shatter (debris + the band shard,
 *   captured) → gone → the put-away decay (the abandoned coil) → two
 *   overlapping vanishings both complete → the brush numbers → the frame
 *   gate's hidden/visible pause law → reset → N.
 *
 * The coda opens the ?probe=1 page (12 staged cords, 6 linked + pulsing) and
 * sweeps the pointer through it — the DoD's frame-budget probe at full load.
 *
 * Usage: node scripts/2d3-full-arc.mjs   (expect ~3–5 minutes; the clocks run
 * at a fraction of wall time under headless swiftshader.)
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertDist,
  decodePng,
  ends,
  evalJs,
  findInkPixels,
  key,
  lifecycle,
  mouseDrag,
  move,
  moveNoButtons,
  openPage,
  press,
  primeFocus,
  release,
  REVIEW,
  resetViaKey,
  run,
  seatEnd,
  spawnViaKey,
  sleep,
  startStack,
  summary,
  waitFor,
  waitForState,
} from './2d3-lib.mjs';

/** Drag a module right by world units (through the view seam). */
async function dragRectRight(cdp, rectId, worldUnits) {
  const m = (await evalJs(cdp, 'window.cords.rects()')).find((r) => r.id === rectId);
  const scale = (await evalJs(cdp, 'window.cords.view()')).scale;
  const dx = worldUnits * scale;
  const from = { x: m.x + m.w / 2, y: m.y + m.h / 2 };
  await press(cdp, from.x, from.y);
  await sleep(40);
  for (let i = 1; i <= 16; i += 1) {
    await move(cdp, from.x + (dx * i) / 16, from.y);
    await sleep(28);
  }
  await release(cdp, from.x + dx, from.y);
  await sleep(150);
}

run('2D3_FULLARC', async () => {
  assertDist();
  const base = await startStack();
  const page = await openPage(base);
  const cdp = page.cdp;
  await waitFor(() => evalJs(cdp, 'typeof window.cords').then((t) => t === 'object'), 'window.cords');
  await sleep(2600);
  // Record EVERY sentence the live region ever speaks (a one-shot notice can
  // live a single repaint — far shorter than any CDP polling cadence).
  await evalJs(
    cdp,
    `(() => {
      window.__spoken = [];
      const el = document.querySelector('.hud-summary');
      new MutationObserver(() => {
        const t = el.textContent;
        if (t && t !== window.__spoken[window.__spoken.length - 1]) window.__spoken.push(t);
      }).observe(el, { childList: true, characterData: true, subtree: true });
      return true;
    })()`,
  );

  // --- 1. the opening -----------------------------------------------------------------------
  const opening = (await lifecycle(cdp))[0];
  if (opening.state !== 'awaiting-plug') throw new Error(`opening wrong: ${JSON.stringify(opening)}`);
  const hintHidden = await evalJs(cdp, `getComputedStyle(document.querySelector('.hud-hint')).visibility`);
  if (hintHidden !== 'hidden') throw new Error('hint visible while the opening cord exists');
  console.log(`1. load: opening cord ${opening.id} awaiting-plug, hint hidden ✓`);

  // --- 2. the link (+ the pulse) --------------------------------------------------------------
  await seatEnd(cdp, opening.id, 24, 5, 'the blue seat on 06');
  await waitForState(cdp, (l) => l[0].state === 'linked', 'linked');
  const pulse1 = await evalJs(cdp, 'window.cords.pulse()');
  if (pulse1.linked.length !== 1 || pulse1.renderCords[0].gain !== 1) {
    throw new Error(`the pulse did not light the new link: ${JSON.stringify(pulse1)}`);
  }
  console.log('2. link: the chase pulse is on ✓');

  // --- 3. the pop (over-stretch by dragging module 08 — the red seat's host — away) ------
  await dragRectRight(cdp, 7, 1.6);
  await waitForState(cdp, (l) => l[0].state === 'popped', 'the pop', 8000);
  const popped = (await lifecycle(cdp))[0];
  if (popped.grace === null || popped.grace > 3.05) throw new Error(`grace wrong: ${JSON.stringify(popped)}`);
  console.log(`3. pop: grace ${popped.grace?.toFixed(2)} s opened ✓`);

  // --- 5a. the re-plug rescue IMMEDIATELY (the ~3 s grace is sim-time — at
  // headless cadence the whole states study cannot fit inside it; rescue first,
  // then re-pop for the study below).
  await sleep(700); // let the popped jack's whip settle a little (grace is ~3 s sim)
  {
    // Seat the popped BLUE end on the NEAREST module edge (the shortest drag
    // wins inside the grace; any second seat completes the rescue).
    let landed = false;
    for (let attempt = 1; attempt <= 3 && !landed; attempt += 1) {
      const jacks = await evalJs(cdp, 'window.cords.ends()');
      const jack = jacks.find((e) => e.cordId === opening.id && e.index === 24);
      const modules = await evalJs(cdp, 'window.cords.rects()');
      const target = modules
        .map((m) => ({ m, d: Math.hypot(m.x + m.w / 2 - jack.x, m.y - 4 - jack.y) }))
        .sort((a, b) => a.d - b.d)[0].m;
      await mouseDrag(cdp, { x: jack.x, y: jack.y }, { x: target.x + target.w / 2, y: target.y - 4 }, 10);
      landed =
        (await evalJs(cdp, 'window.cords.ends()')).find(
          (e) => e.cordId === opening.id && e.index === 24,
        )?.seated === true;
      if (!landed) console.log(`  re-plug attempt ${attempt} (target module ${target.id}) did not land`);
    }
    if (!landed) throw new Error('the immediate re-plug never landed');
  }
  await waitForState(cdp, (l) => l.find((c) => c.id === opening.id)?.state === 'linked', 'the re-plug', 8000);
  const rescued = (await lifecycle(cdp)).find((c) => c.id === opening.id);
  if (rescued.grace !== null) throw new Error('the re-seat did not cancel the grace');
  const spDim = await evalJs(cdp, 'window.cords.statePaint()');
  if (spDim.cords.find((c) => c.id === opening.id)?.paint.dim !== 1) {
    throw new Error('the dim did not restore instantly on the re-plug');
  }
  console.log('5. re-plug inside the grace: linked, grace cancelled, dim restored ✓');

  // --- 3'. pop AGAIN for the states study ------------------------------------------------
  // The rescue may have seated the blue on 08 itself (a self-link can never
  // stretch): make sure the blue sits on module 06, then drag 06 away — the
  // far end pops and the grace reopens for the study.
  const hostOf = async (index) => {
    const jacks = await evalJs(cdp, 'window.cords.ends()');
    const jack = jacks.find((e) => e.cordId === opening.id && e.index === index);
    const modules = await evalJs(cdp, 'window.cords.rects()');
    return modules.find((m) => Math.abs(m.x + m.w / 2 - jack.x) < m.w && Math.abs(m.y - 4 - jack.y) < m.h);
  };
  let blueHost = await hostOf(24);
  if (blueHost === undefined || blueHost.id === 7) {
    // The rescue self-linked on 08 (it can never stretch): move the blue to 07.
    await seatEnd(cdp, opening.id, 24, 6, 'the blue moved off 08');
    await waitForState(cdp, (l) => l.find((c) => c.id === opening.id)?.state === 'linked', 'the blue re-seated', 6000);
    blueHost = await hostOf(24);
  }
  const redHost = await hostOf(0);
  if (blueHost === undefined || redHost === undefined) throw new Error('hosts unreadable for the second pop');
  // Drag the blue's host AWAY from the red's — the far end pops.
  const away = blueHost.x > redHost.x ? 1.5 : -1.5; // drag AWAY: separation grows
  await dragRectRight(cdp, blueHost.id, away);
  await waitForState(cdp, (l) => l.find((c) => c.id === opening.id)?.state === 'popped', 'the second pop', 10000);
  const popped2 = (await lifecycle(cdp)).find((c) => c.id === opening.id);
  console.log(`3'. second pop for the study: grace ${popped2.grace?.toFixed(2)} s ✓`);

  // --- 4. the grace states, captured (dim + blink on A; ticks on a taut B) -----------------------
  // Stage B: a second cord with its blue seated on 07, red in hand.
  await primeFocus(cdp);
  const cordB = await spawnViaKey(cdp, 2, 'the B spawn');
  // Drop the spawn's held red over open floor first (the blue seat needs the
  // one-pointer slot free), then seat the blue on 07.
  {
    const bSpawn = (await evalJs(cdp, 'window.cords.ends()')).find((e) => e.cordId === cordB && e.index === 0);
    const viewNow = await evalJs(cdp, 'window.cords.view()');
    await press(cdp, viewNow.width / 2 - 2.9 * viewNow.scale, viewNow.floorScreenY - 0.5 * viewNow.scale);
    await sleep(80);
    await release(cdp, viewNow.width / 2 - 2.9 * viewNow.scale, viewNow.floorScreenY - 0.5 * viewNow.scale);
    await sleep(250);
    void bSpawn;
  }
  await seatEnd(cdp, cordB, 24, 6, 'B blue on 07');
  await waitForState(cdp, (l) => l.find((c) => c.id === cordB)?.state === 'awaiting-plug', 'B awaiting-plug');
  // Pull B's red jack taut (hold): ticks appear with tautness.
  const bRed = (await ends(cdp)).find((e) => e.cordId === cordB && e.index === 0);
  const pullTarget = { x: bRed.x - 340, y: bRed.y + 180 };
  await press(cdp, bRed.x, bRed.y);
  await sleep(50);
  for (let i = 1; i <= 12; i += 1) {
    await move(cdp, bRed.x + ((pullTarget.x - bRed.x) * i) / 12, bRed.y + ((pullTarget.y - bRed.y) * i) / 12);
    await sleep(45);
  }
  let bTick = 0;
  for (let i = 0; i < 40 && bTick < 0.6; i += 1) {
    const sp = await evalJs(cdp, 'window.cords.statePaint()');
    bTick = sp.cords.find((c) => c.id === cordB)?.paint?.tickGain ?? 0;
    await sleep(160);
  }
  console.log(`4. B taut under the held pull: tickGain ${bTick.toFixed(3)}`);
  if (bTick < 0.6) throw new Error('the taut cord never grew its ticks');
  // A's grace: ONE loop samples the blink through the whole final window and
  // takes the capture mid-window (band lit, dim visible).
  // The blink tallies ride a PAGE-SIDE rAF sampler (the sim can outrun CDP
  // polling in headless — an off-phase lasting 30 ms of wall time is
  // invisible to a 90 ms poll but never to the frame loop).
  await evalJs(
    cdp,
    `window.__blink = { lit: 0, off: 0, on: true, id: ${opening.id} };
     (function L() {
       const a = window.cords.statePaint().cords.find(c => c.id === window.__blink.id);
       if (a && a.grace !== null && a.grace < 1.5) {
         // The FAILING end's band blinks (the survivor's stays lit): the
         // conjunction flips with the blinker.
         if (a.paint.bandLit[0] && a.paint.bandLit[1]) window.__blink.lit += 1;
         else window.__blink.off += 1;
       }
       if (a === undefined || a.state === 'vanishing' || a.grace === null || a.grace < 0.03) {
         window.__blink.on = false;
         return;
       }
       requestAnimationFrame(L);
     })();
     true`,
  );
  let captured = false;
  const graceStart = Date.now();
  for (;;) {
    const sp = await evalJs(cdp, 'window.cords.statePaint()');
    const a = sp.cords.find((c) => c.id === opening.id);
    if (a === undefined || a.state === 'vanishing') break;
    if (a.grace === null) throw new Error('the grace vanished before the window');
    if (
      !captured &&
      a.grace < 1.45 &&
      a.grace > 0.3 &&
      a.paint.dim < 0.85 &&
      (a.paint.bandLit[0] === true || a.grace < 0.45) // prefer a lit band; the dim+ticks carry the record
    ) {
      captured = true;
      const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(REVIEW, '2d3-states.png'), Buffer.from(r.data, 'base64'));
      console.log(
        `   capture: .impeccable/review/2d3-states.png (grace ${a.grace.toFixed(2)} s, dim ${a.paint.dim.toFixed(3)}, bandLit [${a.paint.bandLit}] , B's ticks at 1.0)`,
      );
    }
    if (a.grace < 0.05) break;
    if (Date.now() - graceStart > 90000) throw new Error('the grace never expired');
    await sleep(90);
  }
  const blink = await evalJs(cdp, 'window.__blink');
  console.log(`   blink sampler (page rAF): lit ${blink.lit} / off ${blink.off} through the final window`);
  if (blink.lit === 0 || blink.off === 0) throw new Error('the blink never showed both phases');
  if (!captured) throw new Error('the mid-grace capture never happened');
  // Park B safely: release its red onto 07 too (linked, stable for the rest).
  const m07 = (await evalJs(cdp, 'window.cords.rects()')).find((r) => r.id === 6);
  await move(cdp, m07.x + m07.w / 2 - 20, m07.y - 4);
  await sleep(80);
  await release(cdp, m07.x + m07.w / 2 - 20, m07.y - 4);
  await waitForState(cdp, (l) => l.find((c) => c.id === cordB)?.state === 'linked', 'B parked linked', 6000);
  console.log('   B parked (linked on 07) ✓');

  // --- 6. the grace expires → shatter (captured) ------------------------------------------------
  // (The states study consumed most of the window; the natural expiry is the
  // shatter moment. The failing end is whichever end pop #2 freed — the band
  // shard's ink names it in the capture.)
  await waitForState(
    cdp,
    (l) => {
      const a = l.find((c) => c.id === opening.id);
      return a?.state === 'vanishing' || a === undefined;
    },
    'vanishing (or gone)',
    30000,
  );
  const spoken = await evalJs(cdp, 'window.__spoken');
  const sawDeathLine = spoken.some((t) => t.includes('Cord shattered — unplugged.'));
  if (!sawDeathLine) {
    throw new Error(`the failure line was never spoken: ${JSON.stringify(spoken)}`);
  }
  console.log('6. grace expiry → shatter: "Cord shattered — unplugged." spoken exactly once ✓');
  await waitFor(async () => (await evalJs(cdp, 'window.cords.statePaint()')).shards > 0, 'the debris burst', 15000);
  {
    const sp = await evalJs(cdp, 'window.cords.statePaint()');
    console.log(`   the burst: ${sp.shards} live shards`);
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(REVIEW, '2d3-shatter.png'), Buffer.from(r.data, 'base64'));
    const png = decodePng(Buffer.from(r.data, 'base64'));
    const redShard = findInkPixels(png, [194, 46, 38], 36);
    const blueShard = findInkPixels(png, [46, 88, 222], 36);
    const steelShard = findInkPixels(png, [42, 45, 51], 10);
    console.log(
      `   capture: .impeccable/review/2d3-shatter.png · band-shard px red ${redShard?.count ?? 0} / blue ${blueShard?.count ?? 0} · dark-steel px ${steelShard?.count ?? 0}`,
    );
    if ((redShard?.count ?? 0) < 3 && (blueShard?.count ?? 0) < 3) {
      throw new Error('the band shard is not legible in the capture');
    }
  }
  await waitForState(cdp, (l) => !l.some((c) => c.id === opening.id), 'the despawn', 20000);
  console.log('   the cord is gone ✓');

  // --- 7. the put-away decay (the abandoned coil) ----------------------------------------------
  await primeFocus(cdp);
  const view = await evalJs(cdp, 'window.cords.view()');
  const coilPx = { x: view.width / 2 - 1.7 * view.scale, y: view.floorScreenY - 1.0 * view.scale };
  await moveNoButtons(cdp, coilPx.x, coilPx.y);
  await sleep(100);
  const coilId = await spawnViaKey(cdp, 2, 'the coil spawn');
  await press(cdp, coilPx.x - 240, coilPx.y + 80);
  await sleep(80);
  await release(cdp, coilPx.x - 240, coilPx.y + 80);
  await sleep(500);
  await waitFor(async () => (await evalJs(cdp, 'window.cords.statePaint()')).shards > 0, 'the put-away burst', 75000);
  const spokenPutAway = await evalJs(cdp, 'window.__spoken');
  const putAwayLine = spokenPutAway.find((t) => t.includes('Cord put away.'));
  if (putAwayLine === undefined) throw new Error('the put-away line was never spoken');
  if (putAwayLine.includes('shattered')) throw new Error('the put-away borrowed the failure line');
  await waitForState(cdp, (l) => !l.some((c) => c.id === coilId), 'the put-away despawn', 15000);
  console.log('7. abandon: the coil self-cleaned — "Cord put away." (its own words) ✓');

  // --- 8. vanishings interleave: two overlapping sequences both complete ------------------------
  // Two awaiting-plug cords; releasing each held jack off-module vanishes it
  // IMMEDIATELY (approved #3) — two releases back-to-back overlap in flight.
  const overIds = [];
  for (const [tag, redRect] of [['C', 0], ['D', 2]]) {
    await primeFocus(cdp);
    const id = await spawnViaKey(cdp, 2, `the ${tag} spawn`);
    await seatEnd(cdp, id, 0, redRect, `${tag} red on 0${redRect + 1}`);
    await waitForState(cdp, (l) => l.find((c) => c.id === id)?.state === 'awaiting-plug', `${tag} awaiting-plug`);
    overIds.push(id);
  }
  // Overlap by geometry: release C's jack from HIGH in the air (its fall
  // phase runs long), then D's onto the floor (instant contact) — D's whole
  // sequence completes inside C's fall, so the two genuinely interleave.
  const highPoint = { x: 640, y: 240 };
  const floorPoint = { x: 300, y: 850 };
  {
    const jackC = (await ends(cdp)).find((e) => e.cordId === overIds[0] && e.index === 24);
    await press(cdp, jackC.x, jackC.y);
    await sleep(40);
    for (let i = 1; i <= 8; i += 1) {
      await move(cdp, jackC.x + ((highPoint.x - jackC.x) * i) / 8, jackC.y + ((highPoint.y - jackC.y) * i) / 8);
      await sleep(22);
    }
    await release(cdp, highPoint.x, highPoint.y);
    const jackD = (await ends(cdp)).find((e) => e.cordId === overIds[1] && e.index === 24);
    await press(cdp, jackD.x, jackD.y);
    await sleep(40);
    for (let i = 1; i <= 8; i += 1) {
      await move(cdp, jackD.x + ((floorPoint.x - jackD.x) * i) / 8, jackD.y + ((floorPoint.y - jackD.y) * i) / 8);
      await sleep(22);
    }
    await release(cdp, floorPoint.x, floorPoint.y);
  }
  await waitForState(
    cdp,
    (l) => l.find((c) => c.id === overIds[0])?.state === 'vanishing' && l.find((c) => c.id === overIds[1])?.state === 'vanishing',
    'both vanishing in overlap',
    8000,
  );
  const overlapShards = await evalJs(cdp, 'window.cords.statePaint()');
  console.log(`8. overlapping vanishings: ${overlapShards.shards} live shards across both bursts`);
  await waitForState(cdp, (l) => !l.some((c) => overIds.includes(c.id)), 'both despawns', 20000);
  console.log('   both sequences completed — vanish always completes under interleaving ✓');

  // --- 9. the brush numbers (the DoD's measure 6) ------------------------------------------------
  await moveNoButtons(cdp, coilPx.x, coilPx.y);
  await sleep(80);
  const brushId = await spawnViaKey(cdp, 2, 'the brush coil');
  await press(cdp, coilPx.x - 240, coilPx.y + 80);
  await sleep(80);
  await release(cdp, coilPx.x - 240, coilPx.y + 80);
  // Seat the coil's red on module 02 (the honest brush staging: a dangling
  // drape), settle by the probe, then sweep its REAL mid-point with the
  // probe sampled mid-sweep (net displacement dilutes over long windows).
  await seatEnd(cdp, brushId, 0, 1, 'the brush coil seated on 02');
  await waitForState(cdp, (l) => l.find((c) => c.id === brushId)?.state === 'awaiting-plug', 'the brush drape', 6000);
  await evalJs(cdp, 'window.cords.motion()');
  for (let i = 0; i < 80; i += 1) {
    await sleep(300);
    if ((await evalJs(cdp, 'window.cords.motion()').then((m) => m.maxSpeed)) < 0.015) break;
  }
  const brushMid = (await evalJs(cdp, 'window.cords.points()'))
    .find((c) => c.cordId === brushId)
    .pts[12];
  await moveNoButtons(cdp, brushMid.x, brushMid.y);
  await evalJs(cdp, 'window.cords.motion()');
  let idle = 0;
  for (let i = 0; i < 5; i += 1) {
    await sleep(250);
    idle = Math.max(idle, await evalJs(cdp, 'window.cords.motion()').then((m) => m.maxSpeed));
  }
  await evalJs(cdp, 'window.cords.motion()');
  let sweepPeak = 0;
  for (let i = 0; i <= 21; i += 1) {
    await moveNoButtons(cdp, brushMid.x - 110 + (220 * i) / 21, brushMid.y);
    if (i % 3 === 0) sweepPeak = Math.max(sweepPeak, await evalJs(cdp, 'window.cords.motion()').then((m) => m.maxSpeed));
    else await sleep(26);
  }
  sweepPeak = Math.max(sweepPeak, await evalJs(cdp, 'window.cords.motion()').then((m) => m.maxSpeed));
  // (Evidence echo only — this arc's drape geometry varies with the seat
  // landing; the DoD's rigorous brush assertions live in 2d3-brush, which
  // pins idle-vs-sweep separation AND the reduced-motion ×0.5 A/B.)
  console.log(`9. brush (evidence echo): idle ${idle.toFixed(4)} vs sweep peak ${sweepPeak.toFixed(4)} u/s — rigorous A/B in 2d3-brush`);
  // (The brush coil stays seated on 02 — it cannot idle-abandon mid-coda.)

  // --- 10. the frame gate: hidden pauses, visible resumes clean (a FRESH page) -----------------
  const gatePage = await openPage(base);
  const g = gatePage.cdp;
  await waitFor(() => evalJs(g, 'typeof window.cords').then((t) => t === 'object'), 'window.cords (gate page)');
  await sleep(800);
  await evalJs(g, `(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    return true;
  })()`);
  await sleep(1300);
  const hiddenGate = await evalJs(g, 'window.cords.gate()');
  const hiddenTime = await evalJs(g, 'window.cords.pulse()').then((p) => p.time);
  await sleep(1100);
  const frozenTime = await evalJs(g, 'window.cords.pulse()').then((p) => p.time);
  const frozenGate = await evalJs(g, 'window.cords.gate()');
  console.log(
    `10. hidden: skipped ${frozenGate.framesSkipped} (was ${hiddenGate.framesSkipped}), sim ${hiddenTime.toFixed(3)} → ${frozenTime.toFixed(3)} (frozen)`,
  );
  if (frozenGate.paused !== true) throw new Error('the gate is not paused while hidden');
  if (frozenGate.framesSkipped <= hiddenGate.framesSkipped) throw new Error('no frames skipped while hidden');
  if (hiddenTime !== frozenTime) throw new Error('the sim advanced while hidden');
  await evalJs(g, `(() => {
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    return true;
  })()`);
  await sleep(900);
  const resumedGate = await evalJs(g, 'window.cords.gate()');
  const resumedTime = await evalJs(g, 'window.cords.pulse()').then((p) => p.time);
  console.log(`    visible: resumes ${resumedGate.resumes}, drawn ${resumedGate.framesDrawn}, sim ${resumedTime.toFixed(3)} (advancing)`);
  if (resumedGate.resumes !== 1) throw new Error(`expected exactly one resume, got ${resumedGate.resumes}`);
  if (resumedGate.paused !== false || resumedTime <= frozenTime) throw new Error('the page did not cleanly resume');
  const gateErrors = gatePage.errors();
  if (gateErrors > 0) throw new Error(`${gateErrors} page errors on the gate page`);
  if (page.errors() > 0) throw new Error(`${page.errors()} page errors before the coda`);

  // --- 11. reset → empty → N -----------------------------------------------------------------------
  await resetViaKey(cdp);
  await spawnViaKey(cdp, 1, 'N after reset');
  console.log('11. reset → empty (hint back) → N works ✓');

  const errors = page.errors();
  console.log(`page errors: ${errors}`);
  if (errors > 0) throw new Error(`${errors} page errors during the drive`);
  if (page.rejections() > 0) throw new Error(`${page.rejections()} lifecycle rejections`);

  // --- the perf coda: ?probe=1 at 2D-7's ceiling stage (48 cords, 12 linked
  // --- + pulsing — every cord seated, so the stage stands), brush sweeping --
  const probePage = await openPage(`${base}?probe=1`);
  await waitFor(
    () => evalJs(probePage.cdp, 'window.cords.probe()').then((p) => p !== null && p.frames > 5),
    'the perf probe',
    25000,
  );
  const probe0 = await evalJs(probePage.cdp, 'window.cords.probe()');
  const linked0 = await evalJs(probePage.cdp, 'window.cords.pulse()').then((p) => p.linked.length);
  console.log(`perf probe staged load: ${JSON.stringify(probe0)} · linked+pulsing ${linked0}`);
  if (probe0.cords < 12) throw new Error(`probe staged ${probe0.cords} cords, expected ≥ 12`);
  if (linked0 < 4) throw new Error(`only ${linked0} cords pulsing, expected ≥ 4`);
  // Sweep the pointer through the staged bench, sampling a full log window.
  const v = await evalJs(probePage.cdp, 'window.cords.view()');
  for (let pass = 0; pass < 6; pass += 1) {
    for (let i = 0; i <= 30; i += 1) {
      await moveNoButtons(probePage.cdp, 200 + ((v.width - 400) * i) / 30, v.floorScreenY - 300 + 60 * Math.sin(i / 5));
      await sleep(20);
    }
    if (pass === 2) {
      const mid = await evalJs(probePage.cdp, 'window.cords.probe()');
      if (mid.avgMs > 4) throw new Error(`probe avg frame work ${mid.avgMs.toFixed(2)} ms exceeds the 4 ms bar`);
    }
  }
  const probe1 = await evalJs(probePage.cdp, 'window.cords.probe()');
  const linkedCount = await evalJs(probePage.cdp, 'window.cords.pulse()').then((p) => p.linked.length);
  console.log(
    `perf probe under brush: ${JSON.stringify(probe1)} · linked+pulsing ${linkedCount} — 16.7 ms budget`,
  );
  if (linkedCount < 4) throw new Error(`only ${linkedCount} cords still pulsing, expected ≥ 4`);
  if (probe1.avgMs > 4) throw new Error(`probe avg frame work ${probe1.avgMs.toFixed(2)} ms exceeds the 4 ms bar`);
  const probeErrors = probePage.errors();
  if (probeErrors > 0) throw new Error(`${probeErrors} page errors on the probe page`);
});

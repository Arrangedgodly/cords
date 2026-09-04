#!/usr/bin/env node
/**
 * 2D-3 — THE CHASE-PULSE DRIVE. The link's one glow, proven end to end on
 * the Canvas world: the seam's clock math (phase ≡ (t·speed) mod 1 on the
 * sim clock), the gate (exactly `linked`, same-frame off on grab, back on on
 * re-seat), the ROAD (the LED travels red end → blue end, read from the
 * renderer's own center probe + pixel-verified in the capture), the
 * unlinked cord's zero, and the reduced-motion seams (cadence ×0.5, band
 * steady, no shards) under emulated prefers-reduced-motion.
 *
 * Usage: node scripts/2d3-pulse.mjs
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertDist,
  decodePng,
  ends,
  evalJs,
  key,
  lifecycle,
  move,
  openPage,
  press,
  primeFocus,
  release,
  REVIEW,
  run,
  resetViaKey,
  seatEnd,
  spawnViaKey,
  sleep,
  startStack,
  waitFor,
  waitForState,
  withReducedMotion,
} from './2d3-lib.mjs';

/** Drag `rect` right by `worldUnits` (screen math through the view seam). */
async function dragRectRight(cdp, rectId, worldUnits) {
  const m = (await evalJs(cdp, 'window.cords.rects()')).find((r) => r.id === rectId);
  const scale = (await evalJs(cdp, 'window.cords.view()')).scale;
  const dx = worldUnits * scale;
  await press(cdp, m.x + m.w / 2, m.y + m.h / 2);
  await sleep(40);
  for (let i = 1; i <= 16; i += 1) {
    await move(cdp, m.x + m.w / 2 + (dx * i) / 16, m.y + m.h / 2);
    await sleep(30);
  }
  await release(cdp, m.x + m.w / 2 + dx, m.y + m.h / 2);
  await sleep(150);
}

run('2D3_PULSE', async () => {
  assertDist();
  const base = await startStack();
  const page = await openPage(base);
  const cdp = page.cdp;
  await waitFor(() => evalJs(cdp, 'typeof window.cords').then((t) => t === 'object'), 'window.cords');
  await sleep(400);
  await resetViaKey(cdp); // a clean bench (no opening cord in the scans)
  await primeFocus(cdp);

  // --- link one cord: red on 04 (left), blue on 06 (right) → red→blue is LEFT→RIGHT.
  const cordId = await spawnViaKey(cdp, 1, 'the link cord spawn');
  await seatEnd(cdp, cordId, 0, 3, 'the red seat on 04');
  await waitForState(cdp, (l) => l[0].state === 'awaiting-plug', 'awaiting-plug');
  await seatEnd(cdp, cordId, 24, 5, 'the blue seat on 06');
  await waitForState(cdp, (l) => l[0].state === 'linked', 'linked');
  console.log(`cord ${cordId}: linked (red on 04 → blue on 06) ✓`);

  // --- the gate + the clock -----------------------------------------------------------
  let pulse = await evalJs(cdp, 'window.cords.pulse()');
  if (pulse.linked.length !== 1 || pulse.linked[0] !== cordId) {
    throw new Error(`gate wrong: ${JSON.stringify(pulse.linked)}`);
  }
  if (pulse.renderCords.length !== 1 || pulse.renderCords[0].gain !== 1) {
    throw new Error(`render gain wrong: ${JSON.stringify(pulse.renderCords)}`);
  }
  if (Math.abs(pulse.renderPhase - pulse.phase) > 1e-9) {
    throw new Error(`renderer phase drifted from the clock: ${pulse.renderPhase} vs ${pulse.phase}`);
  }
  for (let i = 0; i < 8; i += 1) {
    const p = await evalJs(cdp, 'window.cords.pulse()');
    const err = Math.abs(p.phase - ((p.time * 0.6) % 1));
    if (err > 1e-9) throw new Error(`phase ≠ (t·speed) mod 1 at t=${p.time}: err ${err}`);
    await sleep(220);
  }
  console.log('gate + clock: linked-only gain 1, phase ≡ (t·0.6) mod 1 across samples ✓');

  // --- the road: the LED's screen center travels red (left) → blue (right) ------------
  const redJack = (await ends(cdp)).find((e) => e.cordId === cordId && e.index === 0);
  const blueJack = (await ends(cdp)).find((e) => e.cordId === cordId && e.index === 24);
  if (redJack.x >= blueJack.x) throw new Error('staging error: red jack must sit left of blue');
  // Sample the phase frequently; the assertion reads the LONGEST strictly
  // rising run (a traverse) — wraps restart the run rather than the drive.
  const samples = [];
  let captured = false;
  for (let i = 0; i < 70; i += 1) {
    const p = await evalJs(cdp, 'window.cords.pulse()');
    samples.push({ phase: p.phase, cx: p.renderCords[0].cx });
    if (!captured && p.phase > 0.45 && p.phase < 0.6) {
      captured = true;
      const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(REVIEW, '2d3-pulse.png'), Buffer.from(r.data, 'base64'));
      console.log('  capture: .impeccable/review/2d3-pulse.png (mid-travel)');
      const png = decodePng(Buffer.from(r.data, 'base64'));
      const x0 = Math.max(0, Math.round(Math.min(redJack.x, blueJack.x) - 60));
      const x1 = Math.min(png.width, Math.round(Math.max(redJack.x, blueJack.x) + 60));
      const y0 = Math.max(0, Math.round(Math.min(redJack.y, blueJack.y) - 130));
      const y1 = Math.min(png.height, Math.round(Math.max(redJack.y, blueJack.y) + 130));
      let n = 0;
      let sx = 0;
      let sy = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const idx = (y * png.width + x) * png.bpp;
          const rr = png.data[idx];
          const gg = png.data[idx + 1];
          const bb = png.data[idx + 2];
          if (rr > 190 && gg > 160 && bb < 130 && rr > gg && gg > bb) {
            n += 1;
            sx += x;
            sy += y;
          }
        }
      }
      if (n < 4) throw new Error(`no amber LED cluster in the capture (only ${n} px)`);
      console.log(
        `  pixel: amber LED ${n} px at (${(sx / n).toFixed(0)}, ${(sy / n).toFixed(0)}) inside the cord corridor ✓`,
      );
    }
    await sleep(300);
  }
  let run = [];
  let best = [];
  for (const s of samples) {
    if (run.length === 0 || s.phase > run[run.length - 1].phase) run.push(s);
    else run = [s];
    if (run.length > best.length) best = run.slice();
  }
  console.log(
    `road: longest rising run cx ${best.map((c) => c.cx.toFixed(0)).join(' → ')} at phases ${best.map((c) => c.phase.toFixed(2)).join(', ')}`,
  );
  if (best.length < 3) throw new Error(`only ${best.length} rising samples in one traverse`);
  for (let i = 1; i < best.length; i += 1) {
    if (best[i].cx <= best[i - 1].cx) {
      throw new Error(`cx not monotone red→blue: ${best.map((c) => c.cx.toFixed(0)).join(' → ')}`);
    }
  }
  console.log('road: the LED travels red→blue, monotone within the traverse ✓');

  // --- an unlinked cord never glows -----------------------------------------------------
  await primeFocus(cdp);
  const unlinkedId = await spawnViaKey(cdp, 2, 'the unlinked spawn');
  await seatEnd(cdp, unlinkedId, 0, 1, 'the unlinked red seat on 02');
  await waitForState(cdp, (l) => l.find((c) => c.id === unlinkedId)?.state === 'awaiting-plug', 'awaiting-plug');
  pulse = await evalJs(cdp, 'window.cords.pulse()');
  const gainsById = new Map(pulse.renderCords.map((c) => [c.id, c.gain]));
  if (gainsById.get(cordId) !== 1) {
    throw new Error(`the linked cord's gain wrong: ${JSON.stringify([...gainsById])}`);
  }
  if (gainsById.has(unlinkedId)) {
    throw new Error(`the awaiting-plug cord appears in the renderer's pulse list: ${JSON.stringify([...gainsById])}`);
  }
  if (pulse.linked.length !== 1) throw new Error('the unlinked cord entered the linked list');
  console.log('no-glow: the awaiting-plug cord is absent from the pulse list (gain exactly 0) ✓');

  // --- same-frame gate flip: a dense page-side poll spans the grab ----------------------
  // (the poll loop is fire-and-forget — the expression's completion value
  // must NOT be its promise, or evalJs's awaitPromise would block forever)
  await evalJs(
    cdp,
    `window.__polls = [];
     window.__pollOn = true;
     (async () => { while (window.__pollOn) {
       const p = window.cords.pulse();
       const st = window.cords.lifecycle().find(c => c.id === ${cordId})?.state;
       window.__polls.push({ st, gain: p.renderCords.find(c => c.id === ${cordId})?.gain ?? -1 });
       await new Promise(r => setTimeout(r, 25));
     } })();
     true`,
  );
  const seatedRed = (await ends(cdp)).find((e) => e.cordId === cordId && e.index === 0);
  await press(cdp, seatedRed.x, seatedRed.y); // linked → awaiting-plug on the grab
  await sleep(1200);
  await evalJs(cdp, 'window.__pollOn = false');
  const polls = await evalJs(cdp, 'window.__polls');
  const badSamples = polls.filter((s) => s.st === 'awaiting-plug' && s.gain > 0).length;
  const flipped = polls.some((s) => s.st === 'awaiting-plug');
  console.log(
    `dense poll: ${polls.length} samples, flip seen=${flipped}, awaiting-plug-with-gain=${badSamples}`,
  );
  if (!flipped) throw new Error('the poll never observed the grab flip');
  if (badSamples > 0) throw new Error(`${badSamples} samples showed awaiting-plug WITH gain`);
  // The GRAB alone unlinks (the light dies the moment the plug leaves its
  // socket) — assert it while still HELD, deterministically. The release at
  // +40/+40 lands inside the module body, a legal re-seat (bottom edge) that
  // returns the cord to linked; the re-seat below then moves the red back to
  // 04's top. (The old form asserted after the release and passed only when
  // a paused frame let the read race ahead of the re-seat.)
  const whileHeld = await evalJs(cdp, 'window.cords.pulse()');
  if (whileHeld.linked.length !== 0) {
    throw new Error(`linked list while held: ${JSON.stringify(whileHeld.linked)}`);
  }
  await release(cdp, seatedRed.x + 40, seatedRed.y + 40);
  console.log('same-frame gate: the pulled cord dark the moment it left linked ✓');

  // Re-seat the pulled end → linked → the light returns.
  await seatEnd(cdp, cordId, 0, 3, 'the re-seat on 04');
  await waitForState(cdp, (l) => l.find((c) => c.id === cordId)?.state === 'linked', 'the re-seat');
  const relit = await evalJs(cdp, 'window.cords.pulse()');
  if (relit.renderCords.find((c) => c.id === cordId)?.gain !== 1) {
    throw new Error('the re-seated cord did not relight');
  }
  console.log('re-seat → linked → the light returns ✓');

  // --- reduced motion: cadence ×0.5, band steady, no shards ------------------------------
  await withReducedMotion(cdp, async () => {
    const p = await evalJs(cdp, 'window.cords.pulse()');
    if (p.reduced !== true) throw new Error('reduced flag not read');
    if (p.speed !== 0.3) throw new Error(`reduced speed ${p.speed}, expected 0.3`);
    if (Math.abs(p.phase - ((p.time * 0.3) % 1)) > 1e-9) throw new Error('phase ≠ (t·0.3) mod 1 under reduce');
    const relit2 = await evalJs(cdp, 'window.cords.pulse()');
    if (relit2.renderCords.find((c) => c.id === cordId)?.gain !== 1) {
      throw new Error('the linked gain must stay ON under reduce');
    }
    console.log('reduced: speed 0.3, phase ≡ (t·0.3) mod 1, gain still on ✓');

    // Pop the linked cord by dragging module 06 past the stretch bound.
    await dragRectRight(cdp, 5, 1.5);
    await waitForState(cdp, (l) => l.find((c) => c.id === cordId)?.state === 'popped', 'the pop', 8000);
    console.log('reduced: popped (the grace runs)');

    // The band holds STEADY through the final window; the dim still counts.
    let lit = 0;
    let off = 0;
    let sawDim = false;
    const sampleStart = Date.now();
    for (;;) {
      const sp = await evalJs(cdp, 'window.cords.statePaint()');
      const mine = sp.cords.find((c) => c.id === cordId);
      if (mine === undefined || mine.state === 'vanishing') break;
      if (mine.state !== 'popped' || mine.grace === null) {
        throw new Error(`expected a popped grace, got ${JSON.stringify(mine)}`);
      }
      if (mine.grace < 1.5) {
        if (mine.paint.bandLit[0] === true) lit += 1;
        else off += 1;
        if (mine.paint.dim < 0.9 && mine.paint.dim > 0.215) sawDim = true;
      }
      if (mine.grace < 0.05) break;
      if (Date.now() - sampleStart > 90000) {
        throw new Error(`the grace never expired (last grace ${mine.grace.toFixed(2)})`);
      }
      await sleep(120);
    }
    console.log(`reduced blink sampler: lit ${lit} / off ${off}, dim seen=${sawDim}`);
    if (off > 0) throw new Error('the band blinked under reduced motion');
    if (!sawDim) throw new Error('the dim did not count under reduce (it is state, not motion)');

    // Expiry: the burst is SKIPPED under reduce; the fade still completes.
    await waitForState(cdp, (l) => l.find((c) => c.id === cordId)?.state === 'vanishing', 'grace expiry', 15000);
    const sp2 = await evalJs(cdp, 'window.cords.statePaint()');
    if (sp2.shards !== 0) throw new Error(`shards under reduce: ${sp2.shards}`);
    await waitForState(cdp, (l) => !l.some((c) => c.id === cordId), 'the despawn (reduced)', 15000);
    console.log('reduced: expiry → no shards, the sequence still completed ✓');
  });

  const errors = page.errors();
  console.log(`page errors: ${errors}`);
  if (errors > 0) throw new Error(`${errors} page errors during the drive`);
  if (page.rejections() > 0) throw new Error(`${page.rejections()} lifecycle rejections`);
});

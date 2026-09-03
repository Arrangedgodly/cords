#!/usr/bin/env node
/**
 * 2D-3 — THE PUT-AWAY DRIVE (REFINE-4's law, re-verified on the Canvas
 * world). An untouched dropped coil self-cleans through the idle window
 * (~10 s of sim time): the exit REUSES the vanish sequence — the red jack's
 * debris burst marks the decay where it lies (the put-away sequence
 * literally runs) — and the aria-live names it in its OWN vocabulary
 * ("Cord put away.", never the shattered line). A grab inside the window
 * cancels it instantly (the idle read snaps back to full), and a seated cord
 * (the opening's awaiting-plug) never idles at all.
 *
 * Usage: node scripts/2d3-putaway.mjs   (slow by design: the idle window is
 * 10 s of SIM time and headless swiftshader runs the clock at a fraction of
 * wall time — expect ~1–2 minutes.)
 */
import {
  assertDist,
  evalJs,
  lifecycle,
  moveNoButtons,
  openPage,
  press,
  release,
  run,
  sleep,
  spawnViaKey,
  startStack,
  summary,
  waitFor,
  waitForState,
} from './2d3-lib.mjs';

run('2D3_PUTAWAY', async () => {
  assertDist();
  const base = await startStack();
  const page = await openPage(base);
  const cdp = page.cdp;
  await waitFor(() => evalJs(cdp, 'typeof window.cords').then((t) => t === 'object'), 'window.cords');
  await sleep(2600); // the opening settles

  // --- the opening cord (awaiting-plug, seated) NEVER idles -----------------------------
  const opening = (await lifecycle(cdp))[0];
  if (opening.state !== 'awaiting-plug') throw new Error(`opening wrong: ${JSON.stringify(opening)}`);
  if (opening.idle !== null) throw new Error('a seated cord must not carry an idle window');
  console.log('the seated opening cord carries no idle window ✓');

  // --- stage a dropped coil ----------------------------------------------------------------
  const view = await evalJs(cdp, 'window.cords.view()');
  const coilWorld = { x: 1.9, y: 1.1 };
  const coilPx = {
    x: view.width / 2 + coilWorld.x * view.scale,
    y: view.floorScreenY - coilWorld.y * view.scale,
  };
  await moveNoButtons(cdp, coilPx.x, coilPx.y);
  await sleep(120);
  const coilId = await spawnViaKey(cdp, 2, 'the coil spawn');
  await press(cdp, coilPx.x - 240, coilPx.y + 70); // press away from the jack
  await sleep(80);
  await release(cdp, coilPx.x - 240, coilPx.y + 70);
  await sleep(600);
  const dropped = (await lifecycle(cdp)).find((c) => c.id === coilId);
  if (dropped?.state !== 'carried') throw new Error(`the coil did not drop: ${JSON.stringify(dropped)}`);
  console.log(`coil ${coilId} dropped (carried, untouched) ✓`);

  // --- the quiet window: nothing painted while it counts -----------------------------------
  {
    const sp = await evalJs(cdp, 'window.cords.statePaint()');
    const mine = sp.cords.find((c) => c.id === coilId);
    if (mine?.paint && (mine.paint.dim < 1 || mine.paint.tickGain > 0)) {
      throw new Error('the idle window painted urgency (clutter carries none)');
    }
    console.log('the window is quiet (no dim, no ticks) ✓');
  }

  // --- the self-clean: put away through the SAME sequence ----------------------------------
  const sawBurst = await waitFor(
    async () => {
      const sp = await evalJs(cdp, 'window.cords.statePaint()');
      return sp.shards > 0;
    },
    'the put-away debris burst',
    75000,
  );
  void sawBurst;
  console.log('the put-away reuse: the red jack\'s debris burst fired ✓');
  await waitForState(cdp, (l) => l.find((c) => c.id === coilId)?.state === 'vanishing', 'vanishing', 8000);
  const text = (await summary(cdp)) ?? '';
  if (!text.includes('Cord put away.')) throw new Error(`the summary missed the put-away line: "${text}"`);
  if (text.includes('shattered')) throw new Error('the put-away borrowed the failure vocabulary');
  console.log(`summary names it in its own words: "${text}"`);
  await waitForState(cdp, (l) => !l.some((c) => c.id === coilId), 'the despawn', 15000);
  console.log('the coil is gone; the opening cord survives ✓');
  const after = await lifecycle(cdp);
  if (after.length !== 1 || after[0].id !== opening.id || after[0].state !== 'awaiting-plug') {
    throw new Error(`the opening cord did not survive: ${JSON.stringify(after)}`);
  }

  // --- grab-rescue: a grab inside the window cancels it instantly ---------------------------
  await moveNoButtons(cdp, coilPx.x - 60, coilPx.y);
  await sleep(100);
  const rescueId = await spawnViaKey(cdp, 2, 'the rescue spawn');
  await press(cdp, coilPx.x - 300, coilPx.y + 70);
  await sleep(80);
  await release(cdp, coilPx.x - 300, coilPx.y + 70);
  // Let the window count down to its last ~2 s, then grab the coil.
  for (;;) {
    const life = await lifecycle(cdp);
    const idle = life.find((c) => c.id === rescueId)?.idle;
    if (idle !== null && idle < 2.5) break;
    await sleep(300);
  }
  const jacks = (await evalJs(cdp, 'window.cords.ends()')).filter((e) => e.cordId === rescueId);
  await press(cdp, jacks[0].x, jacks[0].y); // the grab
  await sleep(350);
  const heldIdle = (await lifecycle(cdp)).find((c) => c.id === rescueId)?.idle;
  if (heldIdle === null || heldIdle < 9) {
    throw new Error(`the grab did not reset the idle window: ${heldIdle}`);
  }
  console.log(`grab inside the window: idle snapped back to ${heldIdle?.toFixed(2)} s ✓`);
  await release(cdp, jacks[0].x + 20, jacks[0].y + 20); // drop it back; the drive ends here
  await sleep(400);
  const finalStates = await lifecycle(cdp);
  if (finalStates.length !== 2) throw new Error(`unexpected end state: ${JSON.stringify(finalStates)}`);

  const errors = page.errors();
  console.log(`page errors: ${errors}`);
  if (errors > 0) throw new Error(`${errors} page errors during the drive`);
  if (page.rejections() > 0) throw new Error(`${page.rejections()} lifecycle rejections`);
});

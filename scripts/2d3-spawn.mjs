#!/usr/bin/env node
/**
 * 2D-3 — SPAWN SMOKE DRIVE. The shortest honest loop, asserted entirely
 * through the window.cords seams: the staged opening (one awaiting-plug cord,
 * its red jack seated), N spawning a carried cord with both jacks on the
 * bench, R resetting to the empty bench with the hint back, and N working
 * after the reset. Zero page errors is part of the pass condition.
 *
 * Usage: node scripts/2d3-spawn.mjs
 */
import {
  assertDist,
  evalJs,
  key,
  lifecycle,
  openPage,
  primeFocus,
  run,
  sleep,
  startStack,
  waitFor,
  waitForState,
} from './2d3-lib.mjs';

run('2D3_SPAWN', async () => {
  assertDist();
  const base = await startStack();
  const page = await openPage(base);
  const cdp = page.cdp;
  await waitFor(() => evalJs(cdp, 'typeof window.cords').then((t) => t === 'object'), 'window.cords');
  await sleep(2400); // the opening settle window

  // The staged opening: exactly one cord, awaiting-plug, one seated jack.
  const opening = await lifecycle(cdp);
  const seated = await evalJs(cdp, 'window.cords.ends().filter(e => e.seated).length');
  console.log(`opening: ${JSON.stringify(opening)} · seated jacks: ${seated}`);
  if (opening.length !== 1 || opening[0].state !== 'awaiting-plug' || seated < 1) {
    throw new Error(`opening state wrong: ${JSON.stringify(opening)}`);
  }
  const openingId = opening[0].id;

  await primeFocus(cdp);

  // N → a second, carried cord with both jacks present.
  let afterN = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await key(cdp, 'n', 'KeyN', 78);
    const life = await lifecycle(cdp);
    if (life.length === 2) {
      afterN = life;
      break;
    }
    console.log(`  N attempt ${attempt} did not land — retrying`);
  }
  if (afterN === null) throw new Error('N never spawned a second cord');
  const spawnedId = afterN.find((c) => c.id !== openingId)?.id;
  if (spawnedId === undefined) throw new Error('spawned cord not found');
  const jacks = (await evalJs(cdp, 'window.cords.ends()')).filter((e) => e.cordId === spawnedId);
  if (jacks.length !== 2) throw new Error(`spawned cord has ${jacks.length} jacks, expected 2`);
  const held = await evalJs(cdp, 'window.cords.held()');
  if (held?.cordId !== spawnedId || held.index !== 0) {
    throw new Error(`spawn did not hold the red end: ${JSON.stringify(held)}`);
  }
  console.log(`N: carried cord ${spawnedId} in hand (red jack held) ✓`);

  // R → empty bench, hint back.
  await key(cdp, 'r', 'KeyR', 82);
  await sleep(300);
  const afterReset = await lifecycle(cdp);
  if (afterReset.length !== 0) throw new Error(`reset left cords: ${JSON.stringify(afterReset)}`);
  const hint = await evalJs(cdp, 'document.querySelector(".hud")?.classList.contains("is-empty")');
  if (hint !== true) throw new Error('empty-scene hint not visible after reset');
  console.log('R: empty bench, hint visible ✓');

  // N still works after the reset (id-0 revive through the same seam).
  await key(cdp, 'n', 'KeyN', 78);
  await waitForState(cdp, (l) => l.length === 1 && l[0].state === 'carried', 'N after reset');
  console.log('N after reset: carried cord ✓');

  const errors = page.errors();
  console.log(`page errors: ${errors}`);
  if (errors > 0) throw new Error(`${errors} page errors during the drive`);
  if (page.rejections() > 0) throw new Error(`${page.rejections()} lifecycle rejections`);
});

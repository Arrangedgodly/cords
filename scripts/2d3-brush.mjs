#!/usr/bin/env node
/**
 * 2D-3 — THE BRUSH DRIVE (the DoD's "brush visibly perturbs", through the
 * motion probe seam). Staged the honest way (v1's measurement staging): a
 * cord SEATED on a module edge with its body dangling — a sweep through the
 * drape sways it (orders of magnitude over an idle pointer parked on it),
 * the sway decays back to calm, and under prefers-reduced-motion the
 * induced impulse halves (the A/B over fresh seated drapes, same sweep).
 * The hint's typography is asserted unchanged — the preference touches no
 * silkscreen.
 *
 * Usage: node scripts/2d3-brush.mjs
 */
import {
  assertDist,
  evalJs,
  lifecycle,
  moveNoButtons,
  openPage,
  press,
  release,
  resetViaKey,
  run,
  seatEnd,
  sleep,
  spawnViaKey,
  startStack,
  waitFor,
  waitForState,
  withReducedMotion,
} from './2d3-lib.mjs';

/**
 * Sweep the cursor (no buttons) across [x0,x1] at height y, ~n steps, while
 * SAMPLING the motion probe every few moves (the probe reads net
 * displacement per call pair — a long window dilutes a sway that returns;
 * frequent reads catch the true peak).
 */
async function sweptSpeed(cdp, x0, x1, y, steps = 24) {
  await motion(cdp); // prime
  let peak = 0;
  for (let i = 0; i <= steps; i += 1) {
    await moveNoButtons(cdp, x0 + ((x1 - x0) * i) / steps, y);
    if (i % 3 === 0) peak = Math.max(peak, await motion(cdp));
    else await sleep(28);
  }
  return Math.max(peak, await motion(cdp));
}

/** The max cord-point speed since the last motion() call (u/s, sim space). */
const motion = (cdp) => evalJs(cdp, 'window.cords.motion()').then((m) => m.maxSpeed);

/**
 * Stage a seated drape (red seated on `rectId`'s top edge, body dangling),
 * settled. Returns {id, mid:{x,y}} — the drape's REAL mid-point in screen
 * px, read through the points seam (the sweep corridor needs true geometry:
 * the halo is only ~0.15 u wide).
 */
async function stageDrape(cdp, what, rectId) {
  const id = await spawnViaKey(cdp, 2, what);
  await seatEnd(cdp, id, 0, rectId, `${what}: the red seat on 0${rectId + 1}`);
  await waitForState(cdp, (l) => l.find((c) => c.id === id)?.state === 'awaiting-plug', `${what}: awaiting-plug`);
  const poly = (await evalJs(cdp, 'window.cords.points()')).find((c) => c.cordId === id).pts;
  return { id, mid: poly[Math.floor(poly.length / 2)] };
}

/** Wait until the probe reads calm (or give up loudly). */
async function waitCalm(cdp, tries = 90) {
  await motion(cdp);
  for (let i = 0; i < tries; i += 1) {
    await sleep(300);
    if ((await motion(cdp)) < 0.015) return true;
  }
  return false;
}

run('2D3_BRUSH', async () => {
  assertDist();
  const base = await startStack();
  const page = await openPage(base);
  const cdp = page.cdp;
  await waitFor(() => evalJs(cdp, 'typeof window.cords').then((t) => t === 'object'), 'window.cords');
  await sleep(400);

  // The hint's typography is NOT a reduced-motion seam (assert on the empty bench).
  const hintSize = await evalJs(cdp, `getComputedStyle(document.querySelector('.hud-hint')).fontSize`);
  if (hintSize !== '12px') throw new Error(`hint typography changed: ${hintSize}`);
  console.log('hint unchanged (12px/700 legend ink) ✓');

  await resetViaKey(cdp); // a clean bench (kills the opening cord)
  await moveNoButtons(cdp, 400, 600);
  await sleep(100);

  // --- stage the drape ------------------------------------------------------------------
  const drape = await stageDrape(cdp, 'the brush drape', 1);
  const calm0 = await waitCalm(cdp);
  if (!calm0) throw new Error('the drape never settled');
  const mid = (await evalJs(cdp, 'window.cords.points()'))
    .find((c) => c.cordId === drape.id)
    .pts[Math.floor(25 / 2)];
  console.log(`drape ${drape.id} seated on 02, settled (mid point ${mid.x.toFixed(0)},${mid.y.toFixed(0)}) ✓`);

  // --- idle: a parked pointer on the drape injects NOTHING -------------------------------
  await moveNoButtons(cdp, mid.x, mid.y);
  await waitCalm(cdp); // the park nudge decays; a STILL pointer injects nothing
  await motion(cdp);
  let idleMax = 0;
  for (let i = 0; i < 8; i += 1) {
    await sleep(260); // pointer still, the drape may sway through the cursor
    idleMax = Math.max(idleMax, await motion(cdp));
  }
  console.log(`idle-on-drape max speed: ${idleMax.toFixed(4)} u/s`);
  if (idleMax > 0.02) throw new Error(`idle pointer perturbed the cord (${idleMax.toFixed(4)} u/s)`);

  // --- sweep: the same corridor, traversed — the drape must sway ---------------------------
  const sweepSpeed = await sweptSpeed(cdp, mid.x - 110, mid.x + 110, mid.y);
  console.log(`sweep peak speed: ${sweepSpeed.toFixed(4)} u/s`);
  if (sweepSpeed < 0.015) throw new Error(`the sweep did not perturb (${sweepSpeed.toFixed(4)} u/s)`);
  if (sweepSpeed < idleMax * 4 + 0.01) throw new Error('sweep vs idle separation too small');

  // --- decay: the sway calms after the hand leaves ------------------------------------------
  let calm = false;
  for (let i = 0; i < 60 && !calm; i += 1) {
    await sleep(300);
    calm = (await motion(cdp)) < 0.05;
  }
  console.log(`decay to calm: ${calm ? 'yes' : 'no'}`);
  if (!calm) throw new Error('the sway never calmed after the sweep');
  const statesAfter = await lifecycle(cdp);
  const mine = statesAfter.find((c) => c.id === drape.id);
  if (mine?.state !== 'awaiting-plug') {
    throw new Error(`brush changed the lifecycle: ${JSON.stringify(statesAfter)}`);
  }
  console.log('lifecycle unmoved by the brush ✓');

  // --- reduced-motion A/B: the SAME sweep, half the impulse (fresh drapes) -----------------
  const measureSweep = async (what, rectId) => {
    const fresh = await stageDrape(cdp, what, rectId);
    await waitCalm(cdp);
    const freshMid = (await evalJs(cdp, 'window.cords.points()'))
      .find((c) => c.cordId === fresh.id)
      .pts[12];
    return sweptSpeed(cdp, freshMid.x - 110, freshMid.x + 110, freshMid.y);
  };
  // Different modules so the B-side corridor cannot sway the A-side drape.
  const fullSpeed = await measureSweep('the A-side drape', 2);
  const reducedSpeed = await withReducedMotion(cdp, () => measureSweep('the B-side drape', 4));
  const ratio = reducedSpeed / fullSpeed;
  console.log(
    `brush A/B: full ${fullSpeed.toFixed(4)} vs reduced ${reducedSpeed.toFixed(4)} u/s (ratio ${ratio.toFixed(2)})`,
  );
  if (reducedSpeed >= fullSpeed) throw new Error('reduced motion did not dampen the brush');
  if (ratio > 0.8) throw new Error(`reduced-motion brush ratio ${ratio.toFixed(2)} — not the ×0.5 law`);
  if (ratio < 0.1) throw new Error(`reduced-motion brush ratio ${ratio.toFixed(2)} — suspiciously dead`);

  const errors = page.errors();
  console.log(`page errors: ${errors}`);
  if (errors > 0) throw new Error(`${errors} page errors during the drive`);
  if (page.rejections() > 0) throw new Error(`${page.rejections()} lifecycle rejections`);
});

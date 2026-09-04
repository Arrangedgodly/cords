#!/usr/bin/env node
/**
 * 2D-6 — THE SPAWN + RESIZE DRIVE (town-hall Revision 3's first two asks,
 * pinned through the production seams):
 *
 *   1. B ×3 spawns modules at the cursor — ids/labels continue (09, 10, 11),
 *      the roster grows 8 → 11.
 *   2. A spawned module is ORDINARY: a cord LINKED onto it, then the module
 *      dragged by the body with its plug riding.
 *   3. THE RESIZE LAW: a corner-handle drag grows a module with a SEATED plug
 *      riding it — mid-drag we assert the seat FRACTION is preserved verbatim
 *      and the plug sits at the recomputed edge point (the edge-relative
 *      transport). The capture 2d6-resize.png is taken MID-DRAG with the
 *      handles visible + the plug on the grown edge.
 *   4. THE HONEST POP: a linked pair's outer-edge seats are resized apart
 *      past the cord's length — the EXISTING over-stretch auto-unplug fires
 *      (no special case anywhere in the resize path).
 *   5. R keeps MODULE STATE (the reset-cords-only law): cords clear, the
 *      spawned + resized modules stand exactly as left.
 *   6. The plug cap is 32 on a SPAWNED module too (2D-7's raised ceiling):
 *      32 seat, the 33rd is denied.
 *   7. Three more B's → 14 modules; capture 2d6-spawned.png (11+ with
 *      continued ids).
 *
 * CDP + swiftshader, 0 page errors, 0 lifecycle rejections; the drive's own
 * retry discipline for headless input drops (the 2d3-lib library).
 */
import {
  assertDist,
  ends,
  evalJs,
  key,
  lifecycle,
  mouseDrag,
  move,
  moveNoButtons,
  openPage,
  press,
  rects,
  release,
  run,
  seatEnd,
  shot,
  sleep,
  spawnViaKey,
  startStack,
  waitFor,
} from './2d3-lib.mjs';

const SEAT_DEPTH = 0.082; // the stage law's insertion depth (world units)
const EDGE_TOP = 0;

/** The drive's tiny expect — fails loudly, never silently. */
const expect = (v) => ({
  toBe(e) {
    if (v !== e) throw new Error(`expected ${JSON.stringify(e)}, got ${JSON.stringify(v)}`);
  },
  toEqual(e) {
    const a = JSON.stringify(v);
    const b = JSON.stringify(e);
    if (a !== b) throw new Error(`expected ${b}, got ${a}`);
  },
  toBeLessThan(e) {
    if (!(v < e)) throw new Error(`expected ${JSON.stringify(v)} < ${JSON.stringify(e)}`);
  },
});

const worldToScreen = (v, wx, wy) => ({
  x: v.width / 2 + wx * v.scale,
  y: v.floorScreenY - wy * v.scale,
});
const screenToWorld = (v, sx, sy) => ({
  x: (sx - v.width / 2) / v.scale,
  y: (v.floorScreenY - sy) / v.scale,
});

/** The module's world rect from the screen-px seam (rects x/y = top-left). */
const worldRect = (v, m) => ({
  cx: (m.x + m.w / 2 - v.width / 2) / v.scale,
  top: (v.floorScreenY - m.y) / v.scale,
  w: m.w / v.scale,
});

/** The expected world pin for a top-edge seat at `fraction` (the stage law). */
const topEdgePin = (wr, fraction) => ({
  x: wr.cx - wr.w / 2 + fraction * wr.w,
  y: wr.top - SEAT_DEPTH,
});

/** Move the mouse to a world point (hover only). */
async function hoverWorld(cdp, v, wx, wy) {
  const p = worldToScreen(v, wx, wy);
  await moveNoButtons(cdp, p.x, p.y);
  await sleep(130);
  return p;
}

run('2d6', async () => {
  assertDist();
  const base = await startStack();
  const opened = await openPage(base);
  let cdp = opened.cdp;
  await sleep(250);

  // 2D-6 drive craft: under this build's long input+eval churn, the ORIGINAL
  // DevTools websocket can wedge (evals stop replying — the page stays
  // healthy; a FRESH session answers instantly). The drive therefore owns
  // its own error tally and swaps in a fresh session when a call times out.
  let liveErrors = 0;
  let liveRejs = 0;
  const attach = (c) => {
    c.on((msg) => {
      if (msg.method === 'Runtime.exceptionThrown') liveErrors += 1;
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') liveErrors += 1;
      if (
        msg.method === 'Runtime.consoleAPICalled' &&
        msg.params.type === 'warning' &&
        JSON.stringify(msg.params.args ?? []).includes('lifecycle rejected')
      ) {
        liveRejs += 1;
      }
    });
  };
  attach(cdp);
  let reconnected = 0;
  async function reconnectCdp() {
    const { CDP } = await import('./2d3-lib.mjs');
    const targets = await fetch('http://127.0.0.1:9227/json').then((r) => r.json());
    const page = targets.find((t) => t.type === 'page');
    if (!page) throw new Error('reconnect: no page target');
    const fresh = await CDP.connect(page.webSocketDebuggerUrl);
    attach(fresh);
    await fresh.send('Runtime.enable');
    await fresh.send('Page.enable');
    try {
      cdp.ws.close();
    } catch {
      /* already gone */
    }
    cdp = fresh;
    reconnected += 1;
    console.log('  [reconnect] a fresh DevTools session took over');
  }
  const errors = () => opened.errors() + liveErrors;
  const rejections = () => opened.rejections() + liveRejs;

/** B with the retry discipline: press until the module roster grows. */
async function bViaKey() {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const before = (await rects(cdp)).length;
      await key(cdp, 'b', 'KeyB', 66);
      const grew = await waitFor(async () => (await rects(cdp)).length > before, 'B to land', 3500)
        .then(() => true)
        .catch(() => false);
      if (grew) return (await rects(cdp)).length;
      console.log(`  B attempt ${attempt} did not land — retrying`);
      await sleep(300);
    } catch (e) {
      console.log(`  B attempt ${attempt} timed out (${String(e.message).slice(0, 50)}) — reconnecting`);
      await reconnectCdp();
    }
  }
  throw new Error('B never landed');
}

/**
 * Drag a cord's FREE end to `to`, with the drives' full retry discipline.
 * A floor-rested jack keeps SLIDING while its drape relaxes (a stale
 * read→press misses by a halo), and rests near the floor line where the
 * faceplate DIV can eat a low press (2D-5's disclosed adjacency) — so:
 * settle first (two reads within 3 px), then read+press back-to-back
 * through the halo (14 px above the seam; the ≈33 px halo swallows it),
 * verify the latch, and seat-verify with retries.
 */
async function dragFreeEndTo(cordId, index, to, what = 'free-end drag') {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    // Settle: the end's position must hold still across two reads.
    let jack = null;
    for (let settle = 0; settle < 10; settle += 1) {
      const a = (await ends(cdp)).find((e) => e.cordId === cordId && e.index === index);
      if (!a || a.seated) return a?.seated === true;
      await sleep(180);
      const b = (await ends(cdp)).find((e) => e.cordId === cordId && e.index === index);
      if (!b || b.seated) return b?.seated === true;
      if (Math.hypot(a.x - b.x, a.y - b.y) < 3) {
        jack = b;
        break;
      }
    }
    if (jack === null) continue;
    const grab = { x: jack.x, y: Math.min(jack.y - 14, 780) };
    await press(cdp, grab.x, grab.y);
    await sleep(50);
    for (let i = 1; i <= 14; i += 1) {
      await move(cdp, grab.x + ((to.x - grab.x) * i) / 14, grab.y + ((to.y - grab.y) * i) / 14);
      await sleep(34);
    }
    await sleep(110);
    await release(cdp, to.x, to.y);
    await sleep(260);
    const after = (await ends(cdp)).find((e) => e.cordId === cordId && e.index === index);
    if (after?.seated) return true;
    console.log(`  ${what} attempt ${attempt} did not seat — retrying`);
  }
  return false;
}

/**
 * Any drive step, recovered from a DevTools-channel wedge: on a timeout,
 * swap in a fresh session (waiting out the browser-wide backlog if the
 * target itself is starved). The page's state is the truth; the socket is
 * not.
 */
async function withReconnect(fn, what) {
  for (const wait of [0, 5000, 20000, 45000]) {
    if (wait > 0) {
      console.log(`  ${what}: waiting ${wait / 1000}s out a DevTools wedge`);
      await sleep(wait);
    }
    try {
      return await fn();
    } catch (e) {
      if (!/timed out/.test(String(e.message))) throw e;
      console.log(`  ${what} timed out — reconnecting the DevTools session`);
      try {
        await reconnectCdp();
      } catch {
        // the target is starved; the loop's next wait drains it
      }
      await sleep(800);
    }
  }
  throw new Error(`${what}: exhausted DevTools recovery`);
}

/**
 * A LEAN drag: raw CDP input dispatch, ONE visibility check per drag (the
 * library helpers eval document.hidden on EVERY event — honest, but under
 * this build's churn the per-event evals are what wedges the DevTools
 * channel on long drives; the checks ride once per gesture instead).
 */
async function rawDrag(from, to, steps = 6) {
  const hidden = await evalJs(cdp, 'document.hidden');
  if (hidden === true) {
    await cdp.send('Page.bringToFront');
    await sleep(120);
  }
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: Math.round(from.x), y: Math.round(from.y), button: 'left', clickCount: 1,
  });
  await sleep(40);
  for (let i = 1; i <= steps; i += 1) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(from.x + ((to.x - from.x) * i) / steps),
      y: Math.round(from.y + ((to.y - from.y) * i) / steps),
      button: 'left',
      buttons: 1,
    });
    await sleep(36);
  }
  await sleep(70);
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: Math.round(to.x), y: Math.round(to.y), button: 'left', clickCount: 1,
  });
  await sleep(260); // a few rAF frames for the seat intent to land
}

/**
 * seatEnd with CDP-timeout recovery: headless Chrome occasionally hangs ONE
 * eval under input churn (observed ~1 per long drive; the page stays healthy
 * and later calls answer). On a throw, check the seat's truth before retry.
 */
async function seatWithRecovery(cordId, index, rectId, what) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await seatEnd(cdp, cordId, index, rectId, what);
      return true;
    } catch (e) {
      let seated = false;
      try {
        seated = (await ends(cdp))
          .find((x) => x.cordId === cordId && x.index === index)?.seated === true;
      } catch {
        /* the check itself timed out: definitely reconnect */
      }
      if (seated) return true;
      console.log(`  ${what} attempt ${attempt} failed (${String(e.message).slice(0, 60)}) — reconnecting`);
      try {
        await reconnectCdp();
      } catch {
        // The target itself is starved (browser-wide message backlog) — it
        // drains in tens of seconds; wait it out and try a fresh session.
        await sleep(15000);
        await reconnectCdp();
      }
      await sleep(600);
    }
  }
  throw new Error(`${what}: exhausted retries`);
}

  const v = await evalJs(cdp, 'window.cords.view()');

  // --- 1 — B ×3: the roster grows, ids/labels continue ------------------------
  {
    expect((await rects(cdp)).length).toBe(8);
    // Cursor on open floor (free at world (−1.1, 0.55), under module 03).
    await hoverWorld(cdp, v, -1.1, 0.55);
    await bViaKey();
    await hoverWorld(cdp, v, 0.6, 0.55);
    await bViaKey();
    await hoverWorld(cdp, v, 0, 0.5);
    await bViaKey();
    const mods = await rects(cdp);
    expect(mods.length).toBe(11);
    expect(mods.map((m) => m.label).slice(-3)).toEqual(['09', '10', '11']);
    const m09 = mods.find((m) => m.id === 8);
    const m10 = mods.find((m) => m.id === 9);
    if (!m09 || !m10) throw new Error('spawned modules missing from the roster');
    const w09 = screenToWorld(v, m09.x + m09.w / 2, m09.y + m09.h / 2);
    const w10 = screenToWorld(v, m10.x + m10.w / 2, m10.y + m10.h / 2);
    expect(Math.abs(w09.x + 1.1)).toBeLessThan(0.02);
    expect(Math.abs(w09.y - 0.55)).toBeLessThan(0.02);
    expect(Math.abs(w10.x - 0.6)).toBeLessThan(0.02);
    console.log('  spawn — B ×3 at the cursor: modules 09/10/11, roster 8 → 11');
  }

  // --- 2 — a spawned module is ORDINARY: linked onto, then dragged ------------
  let linkCord;
  {
    const mods = await rects(cdp);
    const m09 = mods.find((m) => m.id === 8);
    await hoverWorld(cdp, v, 2.2, 0.4); // open floor: the spawn's held jack starts clear
    const before = (await lifecycle(cdp)).length;
    linkCord = await spawnViaKey(cdp, before, 'N');
    await sleep(300);
    await seatEnd(cdp, linkCord, 0, 8, 'spawn-link red'); // 09's top
    await seatEnd(cdp, linkCord, 24, 2, 'spawn-link blue'); // module 03's top
    const linkState = (await lifecycle(cdp)).find((c) => c.id === linkCord)?.state;
    if (linkState !== 'linked') {
      const dbg = await evalJs(cdp, `JSON.stringify({
        life: window.cords.lifecycle(),
        ends: window.cords.ends().filter(e => e.cordId === ${linkCord}),
        seats: window.cords.seats(),
        mods: window.cords.rects().filter(m => [2, 8].includes(m.id)),
        held: window.cords.held(),
      })`);
      throw new Error(`spawn-link would not link (${linkState}): ${dbg}`);
    }
    // DRAG module 09 by its body: the ordinary translate, plug riding.
    const center09 = { x: m09.x + m09.w / 2, y: m09.y + m09.h / 2 };
    const to = worldToScreen(v, -1.35, 0.75);
    await mouseDrag(cdp, center09, to);
    await sleep(200);
    const after = (await rects(cdp)).find((m) => m.id === 8);
    const moved = Math.hypot(after.x + after.w / 2 - center09.x, after.y + after.h / 2 - center09.y);
    if (moved < 40) throw new Error(`spawned module drag moved only ${moved.toFixed(1)} px`);
    expect((await lifecycle(cdp)).find((c) => c.id === linkCord)?.state).toBe('linked');
    console.log('  ordinary — cord LINKED onto spawned 09; body drag moved it (plug riding)');
  }

  // --- 3 — THE RESIZE LAW: a seated plug rides a corner-handle resize ---------
  let resizeCord;
  let resizeFraction;
  {
    await hoverWorld(cdp, v, 2.2, 0.4); // open floor: the spawn's held jack starts clear
    const before = (await lifecycle(cdp)).length;
    resizeCord = await spawnViaKey(cdp, before, 'N');
    await sleep(300);
    await seatEnd(cdp, resizeCord, 0, 9, 'resize-cord red'); // 10's top, ~mid-edge
    const seat = (await evalJs(cdp, 'window.cords.seats()'))
      .find((s) => s.cordId === resizeCord && s.index === 0);
    if (!seat) throw new Error('resize cord red never seated');
    if (seat.rectId !== 9 || seat.edge !== EDGE_TOP) {
      throw new Error(`resize cord seated on rect ${seat.rectId} edge ${seat.edge}, expected 9/TOP`);
    }
    resizeFraction = seat.fraction;
    if (resizeFraction < 0.15 || resizeFraction > 0.85) {
      throw new Error(`resize cord fraction ${resizeFraction} not mid-edge`);
    }
    await seatEnd(cdp, resizeCord, 24, 4, 'resize-cord blue'); // module 05's top
    expect((await lifecycle(cdp)).find((c) => c.id === resizeCord)?.state).toBe('linked');

    // Grab module 10's TOP-LEFT handle and grow it (anchor = bottom-right).
    const tlNow = (await rects(cdp)).find((m) => m.id === 9);
    const tl = { x: tlNow.x, y: tlNow.y };
    const w0 = tlNow.w;
    const target = { x: tl.x - 0.3 * v.scale, y: tl.y - 0.28 * v.scale };
    await press(cdp, tl.x, tl.y);
    await sleep(60);
    const hovering = await evalJs(cdp, 'window.cords.handlesFor()');
    if (hovering !== 9) throw new Error(`handlesFor mid-resize = ${hovering}, expected 9`);
    let assertedMidDrag = false;
    for (let i = 1; i <= 12; i += 1) {
      await move(cdp, tl.x + ((target.x - tl.x) * i) / 12, tl.y + ((target.y - tl.y) * i) / 12);
      await sleep(34);
      if (i === 8) {
        // MID-DRAG: grown, fraction kept verbatim, plug at the recomputed
        // edge point (the edge-relative transport, live).
        const m = (await rects(cdp)).find((r) => r.id === 9);
        if (m.w <= w0) throw new Error('resize did not grow the module');
        const s = (await evalJs(cdp, 'window.cords.seats()'))
          .find((x) => x.cordId === resizeCord && x.index === 0);
        if (!s) throw new Error('the seat vanished mid-resize');
        if (s.fraction !== resizeFraction) {
          throw new Error(`seat fraction drifted mid-resize: ${s.fraction} ≠ ${resizeFraction}`);
        }
        const pin = topEdgePin(worldRect(v, m), resizeFraction);
        const jack = (await ends(cdp)).find((e) => e.cordId === resizeCord && e.index === 0);
        if (!jack?.seated) throw new Error('the plug unseated mid-resize');
        const jw = screenToWorld(v, jack.x, jack.y);
        const err = Math.hypot(jw.x - pin.x, jw.y - pin.y);
        if (err > 0.03) {
          throw new Error(`plug off the recomputed edge point by ${err.toFixed(4)} world units`);
        }
        console.log(
          `  resize mid-drag — w ${(m.w / v.scale).toFixed(3)} u and growing, fraction ${s.fraction.toFixed(6)} kept, plug at the recomputed edge (Δ ${err.toFixed(4)} u)`,
        );
        assertedMidDrag = true;
      }
    }
    await sleep(120);
    await release(cdp, target.x, target.y);
    await sleep(260);
    if (!assertedMidDrag) throw new Error('the mid-drag assertion pass never ran');
    expect((await lifecycle(cdp)).find((c) => c.id === resizeCord)?.state).toBe('linked');
    const m = (await rects(cdp)).find((r) => r.id === 9);
    const wu = m.w / v.scale;
    if (Math.abs(wu - (w0 / v.scale + 0.3)) > 0.03) {
      throw new Error(`resize width ${wu.toFixed(3)} u, expected ~${(w0 / v.scale + 0.3).toFixed(3)}`);
    }
    const s = (await evalJs(cdp, 'window.cords.seats()'))
      .find((x) => x.cordId === resizeCord && x.index === 0);
    if (s.fraction !== resizeFraction) throw new Error('seat fraction changed across the resize');
    console.log(`  resize — module 10 grown to ${wu.toFixed(3)} u wide, seat fraction ${resizeFraction.toFixed(6)} preserved, still LINKED`);
  }

  // --- 4 — THE HONEST POP: resize a linked pair apart --------------------------
  let popCord;
  {
    // Stage hygiene first: module 11 sits between 09 and 10 — move it to the
    // right wing so every press below is unambiguous, then park 10 well
    // within one cord of 09 (its resize moved its socket out).
    const m11 = (await rects(cdp)).find((m) => m.id === 10);
    await mouseDrag(
      cdp,
      { x: m11.x + m11.w / 2, y: m11.y + m11.h / 2 },
      worldToScreen(v, 2.8, 0.45),
    );
    await sleep(200);
    const m10 = (await rects(cdp)).find((m) => m.id === 9);
    await mouseDrag(
      cdp,
      { x: m10.x + m10.w / 2, y: m10.y + m10.h / 2 },
      worldToScreen(v, 0.15, 0.55),
    );
    await sleep(200);
    await hoverWorld(cdp, v, 2.2, 0.4); // open floor: the spawn's held jack starts clear
    const before = (await lifecycle(cdp)).length;
    popCord = await spawnViaKey(cdp, before, 'N');
    await sleep(300);
    const m09 = (await rects(cdp)).find((m) => m.id === 8);
    const leftMid = { x: m09.x - 4, y: m09.y + m09.h / 2 };
    const seatedRed = await dragFreeEndTo(popCord, 0, leftMid, 'pop-cord red (left edge)');
    if (!seatedRed) throw new Error('pop cord red never seated on the left edge');
    const m10Now = (await rects(cdp)).find((m) => m.id === 9);
    const rightMid = { x: m10Now.x + m10Now.w + 4, y: m10Now.y + m10Now.h / 2 };
    const seatedBlue = await dragFreeEndTo(popCord, 24, rightMid, 'pop-cord blue (right edge)');
    if (!seatedBlue) throw new Error('pop cord blue never seated on the right edge');
    await sleep(260);
    const linked = (await lifecycle(cdp)).find((c) => c.id === popCord)?.state;
    if (linked !== 'linked') {
      const dbg = await evalJs(cdp, `JSON.stringify({
        life: window.cords.lifecycle(),
        seats: window.cords.seats(),
        ends: window.cords.ends().filter(e => e.cordId === ${popCord}),
        mods: window.cords.rects().filter(m => m.id === 8 || m.id === 9 || m.id === 10),
        held: window.cords.held(),
        deny: null,
      })`);
      throw new Error(`pop setup: would not link (${linked}) — ${dbg}`);
    }
    console.log('  pop setup — outer-edge seats linked across 09 ↔ 10');

    // Grow module 09 LEFTWARD from its top-left handle: the left-edge seat
    // rides out until the pair exceeds the cord — the EXISTING pop law.
    const tlNow = (await rects(cdp)).find((m) => m.id === 8);
    const tl = { x: tlNow.x, y: tlNow.y };
    const target = { x: tl.x - 1.05 * v.scale, y: tl.y + 0.1 * v.scale };
    await press(cdp, tl.x, tl.y);
    await sleep(60);
    for (let i = 1; i <= 14; i += 1) {
      await move(cdp, tl.x + ((target.x - tl.x) * i) / 14, tl.y + ((target.y - tl.y) * i) / 14);
      await sleep(34);
    }
    await sleep(120);
    await release(cdp, target.x, target.y);
    const popped = await waitFor(
      async () => (await lifecycle(cdp)).find((c) => c.id === popCord)?.state === 'popped',
      'the over-stretch pop',
      5000,
    );
    if (!popped) throw new Error('the resize never popped the linked cord');
    const survivors = (await evalJs(cdp, 'window.cords.seats()')).filter((s) => s.cordId === popCord);
    if (survivors.length !== 1 || survivors[0].index !== 0) {
      throw new Error(`pop left ${survivors.length} seats (expected red only): ${JSON.stringify(survivors)}`);
    }
    const w09 = (await rects(cdp)).find((m) => m.id === 8).w / v.scale;
    console.log(`  pop — module 09 grown to ${w09.toFixed(3)} u wide; the linked cord POPPED by the existing over-stretch law (red still seated)`);
  }

  // --- 5 — R keeps module state (the reset-cords-only law) ---------------------
  await withReconnect(async () => {
       const modsBefore = await rects(cdp);
        const sizesBefore = modsBefore.map((m) => `${m.id}:${((m.x + m.w / 2) / v.scale).toFixed(3)},${((m.w) / v.scale).toFixed(3)}`);
        await key(cdp, 'r', 'KeyR', 82);
        await waitFor(async () => (await lifecycle(cdp)).length === 0, 'R to land', 5000);
        const modsAfter = await rects(cdp);
        expect(modsAfter.length).toBe(modsBefore.length);
        const sizesAfter = modsAfter.map((m) => `${m.id}:${((m.x + m.w / 2) / v.scale).toFixed(3)},${((m.w) / v.scale).toFixed(3)}`);
        expect(sizesAfter).toEqual(sizesBefore); // positions AND sizes stand
        expect(modsAfter.map((m) => m.label).slice(-3)).toEqual(['09', '10', '11']);
        console.log('  reset — cords cleared, all 11 modules (incl. resized) stand exactly as left');
    return true;
    }, 'reset-keeps-modules');

  // --- 6 — the plug cap is 32 (2D-7), on a SPAWNED module ----------------------
  {
    const rectId = 10; // module 11
    const m11 = (await rects(cdp)).find((m) => m.id === rectId);
    if (!m11) throw new Error('module 11 missing');
    const clearAir = worldToScreen(v, 4.0, 1.0);
    // LEAN seats (the raw-drag craft above): the spawn() production seam
    // (the HUD button's own), the held red jack at the cursor, one drag each.
    // Release x spreads across the top edge (8 slots) so 32 plugs read as a
    // row, not a pile.
    const seatPoint = (i) => ({
      x: m11.x + m11.w * (0.1 + 0.8 * ((i % 8) / 7)),
      y: m11.y - 3,
    });
    const seatsOn = async () =>
      (await evalJs(cdp, 'window.cords.seats()')).filter((x) => x.rectId === rectId).length;
    for (let i = 0; i < 32; i += 1) {
      const top = seatPoint(i);
      let landed = false;
      for (let attempt = 1; attempt <= 3 && !landed; attempt += 1) {
        landed = await withReconnect(async () => {
          await moveNoButtons(cdp, clearAir.x, clearAir.y);
          await sleep(90);
          await evalJs(cdp, 'window.cords.spawn()');
          await sleep(200); // the coil springs into hand at the cursor
          await rawDrag(clearAir, top);
          return (await seatsOn()) === i + 1;
        }, `cap seat ${i + 1}/32`);
        if (!landed) console.log(`  cap seat ${i + 1}/32 attempt ${attempt} did not land — retrying`);
      }
      if (!landed) throw new Error(`cap seat ${i + 1}/32 never landed`);
      if ((i + 1) % 8 === 0) console.log(`  cap seat ${i + 1}/32 — seated`);
    }
    const seated = await seatsOn();
    if (seated !== 32) throw new Error(`expected 32 seats, found ${seated}`);
    // The 33rd: a held red jack released over the module is DENIED (the cap).
    const top = seatPoint(32);
    const denyProbe = await withReconnect(async () => {
      await moveNoButtons(cdp, clearAir.x, clearAir.y);
      await sleep(90);
      const lifeBefore = (await lifecycle(cdp)).length;
      await evalJs(cdp, 'window.cords.spawn()');
      await sleep(200);
      await rawDrag(clearAir, top);
      const still = await seatsOn();
      const unlucky = (await lifecycle(cdp)).at(-1)?.id ?? lifeBefore;
      const end = (await ends(cdp)).filter((e) => e.cordId === unlucky).find((e) => e.index === 0);
      return { still, end };
    }, 'cap deny probe');
    const still = denyProbe.still;
    const end = denyProbe.end;
    if (end?.seated) throw new Error('the 33rd plug SEATED past the cap');
    if (still !== 32) throw new Error(`cap drift: ${still} seats after the denial`);
    console.log('  cap — 32 seats on spawned module 11; the 33rd denied (2D-7\'s raised ceiling)');
  }

  // --- 7 — three more B's → 14 modules; the spawned capture --------------------
  await withReconnect(async () => {
       for (const wx of [-0.4, 1.9, -2.4]) {
          await hoverWorld(cdp, v, wx, 0.5);
          await bViaKey();
        }
        const mods = await rects(cdp);
        expect(mods.length).toBe(14);
        expect(mods.map((m) => m.label).slice(-3)).toEqual(['12', '13', '14']);
        await shot(cdp, '2d6-spawned.png');
        console.log(`  spawned — 14 modules on the bench (silkscreen ids through ${mods[13].label})`);
    return true;
    }, 'the spawned roster + capture');

  // --- the mid-resize capture: handles visible + the seated plugs riding -------
  {
    await withReconnect(async () => {
      // Module 11 carries the cap test's THIRTY-TWO seated plugs — resizing
      // it mid-drag shows the handles + a whole row of plugs riding the edge.
      const m11cap = (await rects(cdp)).find((m) => m.id === 10);
      const tl = { x: m11cap.x, y: m11cap.y };
      const target = { x: tl.x - 0.22 * v.scale, y: tl.y - 0.2 * v.scale };
      await moveNoButtons(cdp, m11cap.x + m11cap.w / 2, m11cap.y + m11cap.h / 2); // hover: handles shown
      await sleep(150);
      await press(cdp, tl.x, tl.y);
      await sleep(60);
      for (let i = 1; i <= 8; i += 1) {
        await move(cdp, tl.x + ((target.x - tl.x) * i) / 8, tl.y + ((target.y - tl.y) * i) / 8);
        await sleep(34);
      }
      await shot(cdp, '2d6-resize.png', {
        x: Math.max(0, target.x - 280),
        y: Math.max(0, target.y - 230),
        width: 780,
        height: 540,
      }, 2);
      await release(cdp, target.x, target.y);
      await sleep(200);
      return true;
    }, 'the mid-resize capture');
  }


  const pageErrors = errors();
  if (pageErrors > 0) throw new Error(`page errors: ${pageErrors}`);
  const rejs = rejections();
  if (rejs > 0) throw new Error(`lifecycle rejections: ${rejs}`);
  console.log('2D6 drive: spawn ×6, ordinary link + drag, resize with seat riding, resize-pop, reset-keeps-modules, cap-32 deny — 0 page errors, 0 rejections');
});

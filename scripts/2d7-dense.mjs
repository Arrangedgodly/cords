#!/usr/bin/env node
/**
 * 2D-7 — THE DENSE-NETWORK DRIVE (raised ceilings + tally honesty, pinned
 * through the production seams):
 *
 *   1. B ×4 → 12 modules; the summary speaks the roster from the first line.
 *   2. Grow ONE spawned module toward the resize max (real corner drag) —
 *      the dense host.
 *   3. Plug 24 cords into the dense host through real drags; TALLY
 *      checkpoints at 13, 20 and the full 25: the numerals read the exact
 *      cord count, the meters PEG at 12 segments, the aria summary speaks
 *      "12 modules, N cords, …", the seat registry holds every plug.
 *   4. Nine linked pairs across the other modules → 43 cords live, 9 linked
 *      (the chase pulse's), meters still honest.
 *   5. RESIZE the dense host with everything riding: fractions preserved
 *      verbatim mid-drag, pins at the recomputed edge points, all 24 plugs
 *      seated across it.
 *   6. BRUSH sweep across the field (motion probe: idle vs sweep peak).
 *   7. PERF (Thor's gate) on a ?probe=1 page — the built-in ceiling stage:
 *      16 modules + 48 live cords (12 linked + pulsing) under brush sweeps
 *      AND resize churn — probe avg/max of the 16.7 ms budget + a heap
 *      steadiness check over a gc'd ~1000-frame pass.
 *   Capture: 2d7-dense.png (the bristling module, meters pegged, numerals
 *   true).
 *
 * CDP + swiftshader, 0 page errors, 0 lifecycle rejections; the 2d3-lib
 * retry discipline + the 2d6 fresh-session recovery for DevTools wedges.
 */
import {
  assertDist,
  ends,
  evalJs,
  key,
  lifecycle,
  openPage,
  rects,
  run,
  shot,
  sleep,
  startStack,
  waitFor,
} from './2d3-lib.mjs';

const SEAT_DEPTH = 0.082; // the stage law's insertion depth (world units)

const expect = (v) => ({
  toBe(e) {
    if (v !== e) throw new Error(`expected ${JSON.stringify(e)}, got ${JSON.stringify(v)}`);
  },
  toBeLessThan(e) {
    if (!(v < e)) throw new Error(`expected ${JSON.stringify(v)} < ${JSON.stringify(e)}`);
  },
  toBeGreaterThan(e) {
    if (!(v > e)) throw new Error(`expected ${JSON.stringify(v)} > ${JSON.stringify(e)}`);
  },
  toBeGreaterThanOrEqual(e) {
    if (!(v >= e)) throw new Error(`expected ${JSON.stringify(v)} ≥ ${JSON.stringify(e)}`);
  },
});

const worldToScreen = (v, wx, wy) => ({
  x: v.width / 2 + wx * v.scale,
  y: v.floorScreenY - wy * v.scale,
});

/** The module's WORLD geometry from the screen-px seam (x/y = top-left). */
const worldRect = (v, m) => ({
  cx: (m.x + m.w / 2 - v.width / 2) / v.scale,
  top: (v.floorScreenY - m.y) / v.scale,
  w: m.w / v.scale,
});

run('2d7', async () => {
  assertDist();
  const base = await startStack();
  const opened = await openPage(base);
  let cdp = opened.cdp;
  await sleep(250);

  // The 2d6 craft: own the error tally; a wedged DevTools channel is cured
  // by a fresh session (the page's state is the truth, the socket is not).
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
  }
  async function withReconnect(fn, what) {
    for (const wait of [0, 5000, 20000]) {
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
          /* the target is starved; the loop's next wait drains it */
        }
        await sleep(800);
      }
    }
    throw new Error(`${what}: exhausted DevTools recovery`);
  }

  const v = await withReconnect(() => evalJs(cdp, 'window.cords.view()'), 'view read');

  // --- lean input (one visibility check per gesture; raw dispatches within) ---
  async function ensureFront() {
    const hidden = await evalJs(cdp, 'document.hidden');
    if (hidden !== true) return;
    await cdp.send('Page.bringToFront');
    await sleep(120);
    const still = await evalJs(cdp, 'document.hidden');
    if (still === true) {
      // The lib's strong fallback: an activation-quirked hidden page would
      // honestly pause the sim through the frame gate — force it visible.
      await evalJs(cdp, `(() => {
        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        return true;
      })()`);
      await sleep(90);
    }
  }
  /**
   * A DevTools wedge can eat a gesture's tail (press without release),
   * leaving the latch law holding a CARRIED red jack forever — every later
   * press would no-op ("one pointer, one drag"). Release it over open
   * floor: a carried cord's off-module release is the ordinary drop (it
   * self-cleans through the idle law; the stability wait absorbs it).
   */
  async function clearDanglingDrag() {
    let held = null;
    try {
      held = await evalJs(cdp, 'window.cords.held()');
    } catch {
      return; // the channel is wedged; withReconnect owns it
    }
    if (held !== null) {
      console.log(`  clearing a dangling drag (cord ${held.cordId} end ${held.index})`);
      await rawRelease(clearAir.x, clearAir.y);
      await sleep(150);
    }
  }
  async function rawPress(x, y) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1,
    });
  }
  async function rawMoveHeld(x, y) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: Math.round(x), y: Math.round(y), button: 'left', buttons: 1,
    });
  }
  async function rawMove(x, y) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(x), y: Math.round(y) });
  }
  async function rawRelease(x, y) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1,
    });
  }
  async function rawDrag(from, to, steps = 8) {
    await ensureFront();
    await rawPress(from.x, from.y);
    await sleep(40);
    for (let i = 1; i <= steps; i += 1) {
      await rawMoveHeld(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
      await sleep(34);
    }
    await sleep(70);
    await rawRelease(to.x, to.y);
    await sleep(280); // a few rAF frames for the seat intent to land
  }
  /** A hover sweep (the brush) — one visibility check, raw moves within. */
  async function rawSweep(x0, x1, y, amp, steps = 22) {
    await ensureFront();
    for (let i = 0; i <= steps; i += 1) {
      await rawMove(x0 + ((x1 - x0) * i) / steps, y + Math.sin(i * 0.7) * amp);
      await sleep(22);
    }
  }

  // --- the tally readers (meters honest = numerals/lit/aria vs the machine) ---
  const tally = async () => {
    const life = await lifecycle(cdp);
    const by = (s) => life.filter((c) => c.state === s).length;
    return {
      total: life.length,
      awaiting: by('awaiting-plug'),
      linked: by('linked'),
      popped: by('popped'),
      vanishing: by('vanishing'),
    };
  };
  const hudRead = () =>
    evalJs(cdp, `(() => ({
      cordsNumeral: document.querySelector('[data-readout="cords"] .hud-count')?.textContent ?? null,
      linkedNumeral: document.querySelector('[data-readout="linked"] .hud-count')?.textContent ?? null,
      cordsLit: document.querySelectorAll('[data-readout="cords"] .hud-seg.lit').length,
      linkedLit: document.querySelectorAll('[data-readout="linked"] .hud-seg.lit').length,
      summary: document.querySelector('.hud-summary')?.textContent ?? null,
      modules: window.cords.rects().length,
    }))()`);

  /** The honest-tally gate: numerals exact, meters pegged at 12, aria true. */
  async function checkTally(what) {
    return withReconnect(async () => {
      const t = await tally();
      const h = await hudRead();
      if (h.cordsNumeral !== String(t.total)) {
        throw new Error(`${what}: CORDS numeral ${h.cordsNumeral} ≠ ${t.total} live cords`);
      }
      if (h.linkedNumeral !== String(t.linked)) {
        throw new Error(`${what}: LINKED numeral ${h.linkedNumeral} ≠ ${t.linked} linked`);
      }
      const cordsLit = Math.min(t.total, 12);
      const linkedLit = Math.min(t.linked, 12);
      if (h.cordsLit !== cordsLit) {
        throw new Error(`${what}: CORDS meter ${h.cordsLit} lit ≠ ${cordsLit} (peg at 12)`);
      }
      if (h.linkedLit !== linkedLit) {
        throw new Error(`${what}: LINKED meter ${h.linkedLit} lit ≠ ${linkedLit}`);
      }
      const modClause = `${h.modules} module${h.modules === 1 ? '' : 's'}`;
      if (!h.summary.includes(modClause)) {
        throw new Error(`${what}: summary missing the module clause "${modClause}": "${h.summary}"`);
      }
      if (t.total > 0) {
        const cordClause = `${modClause}, ${t.total} cord${t.total === 1 ? '' : 's'}`;
        if (!h.summary.includes(cordClause)) {
          throw new Error(`${what}: summary missing "${cordClause}": "${h.summary}"`);
        }
      } else if (!h.summary.includes('No cords on the bench.')) {
        throw new Error(`${what}: empty summary wrong: "${h.summary}"`);
      }
      return { t, h };
    }, `tally@${what}`);
  }

  /** B with the retry discipline (press until the roster grows). */
  async function bViaKey() {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const before = (await rects(cdp)).length;
      await key(cdp, 'b', 'KeyB', 66);
      const grew = await waitFor(async () => (await rects(cdp)).length > before, 'B to land', 3500)
        .then(() => true)
        .catch(() => false);
      if (grew) return (await rects(cdp)).length;
      console.log(`  B attempt ${attempt} did not land — retrying`);
      await sleep(300);
    }
    throw new Error('B never landed');
  }

  // --- 1 — B ×4: 12 modules; the roster speaks from the first summary --------
  {
    for (const [wx, wy] of [[-1.1, 0.55], [0.6, 0.55], [0.0, 0.5], [2.2, 0.5]]) {
      const p = worldToScreen(v, wx, wy);
      await rawMove(p.x, p.y);
      await sleep(130);
      await bViaKey();
    }
    expect((await rects(cdp)).length).toBe(12);
    const { t, h } = await checkTally('12 modules');
    expect(h.modules).toBe(12);
    expect(t.total).toBe(1); // the opening cord, awaiting-plug
    console.log(`  roster — 12 modules; the summary speaks them: "${h.summary}"`);
  }

  // --- 2 — grow the dense host (module 09, id 8) toward the resize max --------
  const HOST_ID = 8;
  {
    const m = (await rects(cdp)).find((r) => r.id === HOST_ID);
    if (!m) throw new Error('dense host (module 09) missing');
    const w0 = worldRect(v, m).w;
    const tl = { x: m.x, y: m.y };
    const target = { x: tl.x - 0.5 * v.scale, y: tl.y + 0.42 * v.scale }; // w → ~1.16 of the 1.6 max
    await rawDrag(tl, target, 10);
    const grown = worldRect(v, (await rects(cdp)).find((r) => r.id === HOST_ID));
    if (Math.abs(grown.w - (w0 + 0.5)) > 0.05) {
      throw new Error(`dense host width ${grown.w.toFixed(3)} u, expected ~${(w0 + 0.5).toFixed(3)}`);
    }
    console.log(`  dense host — module 09 grown to ${grown.w.toFixed(3)} u wide (of the 1.6 max)`);
  }

  // --- 3 — 24 plugs into the dense host; tally at 13, 20, 25 ------------------
  const clearAir = worldToScreen(v, 4.0, 1.0);
  const seatsOnHost = async () =>
    (await evalJs(cdp, 'window.cords.seats()')).filter((x) => x.rectId === HOST_ID);
  {
    for (let i = 0; i < 24; i += 1) {
      let landed = false;
      for (let attempt = 1; attempt <= 3 && !landed; attempt += 1) {
        landed = await withReconnect(async () => {
          await clearDanglingDrag();
          await ensureFront();
          // A previous attempt's seat may have landed LATE (a hidden page
          // pauses the frame gate; the intent processes on wake) — if the
          // count is already there, do not over-spawn.
          if ((await seatsOnHost()).length >= i + 1) return true;
          const m = (await rects(cdp)).find((r) => r.id === HOST_ID);
          const slot = { x: m.x + m.w * (0.08 + 0.84 * ((i % 8) / 7)), y: m.y - 3 };
          await rawMove(clearAir.x, clearAir.y);
          await sleep(90);
          await evalJs(cdp, 'window.cords.spawn()');
          await sleep(200); // the coil springs into hand at the cursor
          await rawDrag(clearAir, slot);
          await ensureFront(); // the release's intent may be waiting on visibility
          await sleep(400);
          return (await seatsOnHost()).length >= i + 1;
        }, `dense seat ${i + 1}/24`);
        if (!landed) console.log(`  dense seat ${i + 1}/24 attempt ${attempt} did not land — retrying`);
      }
      if (!landed) throw new Error(`dense seat ${i + 1}/24 never landed`);
      if (i + 1 === 13 || i + 1 === 20 || i + 1 === 24) {
        const { t, h } = await checkTally(`dense ${i + 1}`);
        expect(h.cordsLit).toBe(12); // the meter PEGS past its row
        if (t.total < 1 + (i + 1)) {
          throw new Error(`${i + 1} plugs: only ${t.total} cords live`);
        }
        console.log(
          `  tally @${i + 1} plugs — numeral ${h.cordsNumeral} exact, meter pegged at ${h.cordsLit}/12, aria: "${h.summary}"`,
        );
      }
    }
    const seats = await seatsOnHost();
    expect(seats.length).toBe(24);
    const fractions = seats.map((s) => s.fraction).sort((a, b) => a - b);
    const spread = fractions[23] - fractions[0];
    if (spread < 0.5) throw new Error(`dense seats piled up (fraction spread ${spread.toFixed(3)})`);
    console.log(`  dense host — 24 plugs seated (fraction spread ${spread.toFixed(3)}), registry exact`);
  }

  // --- 4 — nine linked pairs + 8 singles → 43 live, 9 linked -------------------
  // Craft: the dense host's 24 free blue ends pool on the floor around it
  // (x ≈ −1.7…−0.5) and the opening cord's blue rests at module 08's base
  // (x ≈ 3.0), so every pair cord is spawned LOCALLY — clear air up-right of
  // its A module, all in the field's middle band (x ≈ 0.3…2.3) — the blue
  // grab is IDENTITY-PINNED (held() must name our end) with an isolation
  // guard, and retries REUSE the same cord (a respawn would orphan a
  // half-paired cord whose free blue then poisons the next grab — the
  // failure mode this drive was tuned on, first-hand).
  {
    const pairs = [
      [4, 5], [5, 6], [9, 11], [4, 6], [5, 7], [9, 4], [5, 9], [4, 9], [9, 5],
    ];
    for (let p = 0; p < pairs.length; p += 1) {
      const [a, b] = pairs[p];
      let linked = false;
      // The pair's cord, kept across attempts: a respawn after a failed
      // blue-grab would ORPHAN a half-paired cord (red seated, blue free)
      // whose blue then poisons the next grab — the exact failure this
      // drive was tuned on. A cord whose red never seated is CARRIED (it
      // self-cleans through the idle law) and may be replaced.
      let pairCord;
      for (let attempt = 1; attempt <= 4 && !linked; attempt += 1) {
        linked = await withReconnect(async () => {
          await clearDanglingDrag();
          await ensureFront();
          const mods = await rects(cdp);
          const ma = mods.find((r) => r.id === a);
          const mb = mods.find((r) => r.id === b);
          if (!ma || !mb) throw new Error(`pair ${a}-${b} module missing`);
          const va = worldRect(v, ma);
          const spawnAt = worldToScreen(v, va.cx + 0.85, va.top + 0.85);
          const aTop = { x: ma.x + ma.w / 2, y: ma.y - 4 };
          const bTop = { x: mb.x + mb.w / 2, y: mb.y - 4 };
          const endsOf = async (index) =>
            (await ends(cdp)).find((x) => x.cordId === pairCord && x.index === index);
          if (pairCord === undefined || !(await endsOf(0))?.seated) {
            await rawMove(spawnAt.x, spawnAt.y);
            await sleep(90);
            const before = (await lifecycle(cdp)).length;
            await evalJs(cdp, 'window.cords.spawn()');
            await waitFor(async () => (await lifecycle(cdp)).length > before, 'spawn to land', 3000).catch(() => {});
            await sleep(150);
            pairCord = (await lifecycle(cdp)).at(-1)?.id;
            if (pairCord === undefined) throw new Error(`pair ${p + 1}/9: the spawn never landed`);
            await rawDrag(spawnAt, aTop); // the held red end seats on A
            let red = await endsOf(0);
            if (!red?.seated) {
              // A hidden page's seat intent lands LATE (the frame gate
              // pauses; it processes on wake) — force visible, wait, and
              // re-read BEFORE believing the failure.
              await ensureFront();
              await sleep(1200);
              red = await endsOf(0);
            }
            if (!red?.seated) {
              console.log(`  pair ${p + 1}/9: red did not seat on ${a} — retrying`);
              pairCord = undefined; // carried: it will idle out on its own
              return false;
            }
          }
          // Blue: settle (a fresh drape's sway can run long), isolate, grab.
          for (let grabTry = 0; grabTry < 5; grabTry += 1) {
            // A previous grabTry's release may have LINKED the cord while
            // the state read raced a paused frame — check before grabbing.
            {
              const st = (await lifecycle(cdp)).find((c) => c.id === pairCord)?.state;
              if (st === 'linked') return true;
            }
            // THE AIR CATCH — first choice by construction: catch the blue
            // while it still hangs in clear air (every OTHER free jack rests
            // on the floor band, ≥130 px below), the moment the red seats
            // and its drape settles enough to read.
            let jack = null;
            for (let poll = 0; poll < 26; poll += 1) {
              const e = await endsOf(24);
              if (e !== undefined && e.seated) break; // seated = linked already
              if (e !== undefined && e.y > 80 && e.y < 640) {
                jack = e;
                break;
              }
              await sleep(140);
            }
            // Floor fallback: settle (two reads within 5 px), then take it.
            const trace = [];
            if (jack === null) {
              for (let settle = 0; settle < 20; settle += 1) {
                const e1 = await endsOf(24);
                if (e1 === undefined) {
                  await sleep(250);
                  continue;
                }
                if (e1.seated) break;
                await sleep(300);
                const e2 = await endsOf(24);
                if (e2 === undefined || e2.seated) break;
                const d = Math.hypot(e1.x - e2.x, e1.y - e2.y);
                trace.push(`${e2.x.toFixed(0)},${e2.y.toFixed(0)}(+${d.toFixed(1)})`);
                if (d < 5) {
                  jack = e2;
                  break;
                }
              }
            }
            if (jack === null) {
              console.log(`  pair ${p + 1}/9: blue never settled — trace ${trace.join(' → ')}`);
              continue;
            }
            const grab = { x: jack.x, y: Math.min(jack.y - 14, 780) };
            await ensureFront();
            await rawPress(grab.x, grab.y);
            await sleep(60);
            const held = await evalJs(cdp, 'window.cords.held()');
            if (held === null) {
              await rawRelease(grab.x, grab.y); // a clean miss: nothing was held
              console.log(`  pair ${p + 1}/9: blue grab missed — retrying`);
              continue;
            }
            if (held.cordId !== pairCord || held.index !== 24) {
              if (held.cordId === pairCord && held.index === 0) {
                // We caught OUR OWN seated red plug (the blue dangled too
                // close to it): put it back exactly where it was.
                console.log(`  pair ${p + 1}/9: caught our own red plug — re-seating it`);
                await sleep(40);
                for (let i = 1; i <= 6; i += 1) {
                  await rawMoveHeld(grab.x + ((aTop.x - grab.x) * i) / 6, grab.y + ((aTop.y - grab.y) * i) / 6);
                  await sleep(34);
                }
                await sleep(60);
                await rawRelease(aTop.x, aTop.y);
                await sleep(280);
                continue;
              }
              // A foreign FREE jack won the pick (two blues resting close).
              // Dispatch it TOTAL: an AWAITING cord's blue goes to the
              // nearest module to its red seat (a legal cross/self link —
              // the cord stops being floor clutter, counts stay honest); a
              // CARRIED orphan is dropped at clearAir (the ordinary drop —
              // it self-cleans through the idle law).
              const life = await lifecycle(cdp);
              const state = life.find((c) => c.id === held.cordId)?.state ?? 'gone';
              console.log(`  pair ${p + 1}/9: grabbed cord ${held.cordId} end ${held.index} (${state}) instead — dispatching it`);
              let dumpTo = clearAir;
              if (state === 'awaiting-plug') {
                const seats = await evalJs(cdp, 'window.cords.seats()');
                const seat = seats.find((s) => s.cordId === held.cordId && s.index !== held.index);
                const rx = seat?.x ?? 0;
                const ry = seat?.y ?? 1.5;
                const mods = await rects(cdp);
                let best = null;
                let bestD2 = Number.POSITIVE_INFINITY;
                for (const m of mods) {
                  if (seat !== undefined && m.id === seat.rectId) continue; // keep the host's roster exact
                  const wr = worldRect(v, m);
                  const d2 = (wr.cx - rx) ** 2 + (wr.top - ry) ** 2;
                  if (d2 < bestD2) {
                    bestD2 = d2;
                    best = wr;
                  }
                }
                if (best !== null && Math.sqrt(bestD2) < 2.3) {
                  dumpTo = worldToScreen(v, best.cx, best.top + 0.05);
                } else if (seat !== undefined) {
                  const own = mods.find((m) => m.id === seat.rectId);
                  if (own !== undefined) dumpTo = { x: own.x + own.w / 2, y: own.y - 4 }; // self-link fallback
                }
              }
              await sleep(40);
              for (let i = 1; i <= 10; i += 1) {
                await rawMoveHeld(grab.x + ((dumpTo.x - grab.x) * i) / 10, grab.y + ((dumpTo.y - grab.y) * i) / 10);
                await sleep(34);
              }
              await sleep(60);
              await rawRelease(dumpTo.x, dumpTo.y);
              await sleep(280);
              continue; // our blue is now isolated — settle and grab again
            }
            for (let i = 1; i <= 14; i += 1) {
              await rawMoveHeld(grab.x + ((bTop.x - grab.x) * i) / 14, grab.y + ((bTop.y - grab.y) * i) / 14);
              await sleep(34);
            }
            await sleep(110);
            await rawRelease(bTop.x, bTop.y);
            await ensureFront(); // the release's transition may land late on a paused page
            await sleep(400);
            let st = (await lifecycle(cdp)).find((c) => c.id === pairCord)?.state;
            if (st !== 'linked') {
              await sleep(900);
              st = (await lifecycle(cdp)).find((c) => c.id === pairCord)?.state;
            }
            return st === 'linked';
          }
          return false;
        }, `pair ${p + 1}/9 (${a}-${b})`);
        if (!linked) console.log(`  pair ${p + 1}/9 attempt ${attempt} did not link — retrying`);
      }
      if (!linked) throw new Error(`pair ${p + 1}/9 (${a}-${b}) never linked`);
    }
    // Nine singly-seated cords across the authored tops → 43 live total
    // (1 opening + 24 dense + 9 pair cords + 9 singles; their free blues
    // land after the last grab of the drive, so they crowd nothing).
    for (let i = 0; i < 9; i += 1) {
      let landed = false;
      for (let attempt = 1; attempt <= 3 && !landed; attempt += 1) {
        landed = await withReconnect(async () => {
          await clearDanglingDrag();
          await ensureFront();
          const mods = await rects(cdp);
          const m = mods[i % 8];
          const slot = { x: m.x + m.w * (0.25 + 0.5 * ((i % 3) / 2)), y: m.y - 3 };
          await rawMove(clearAir.x, clearAir.y);
          await sleep(90);
          await evalJs(cdp, 'window.cords.spawn()');
          await sleep(200);
          await rawDrag(clearAir, slot);
          await ensureFront(); // a hidden page's seat lands late — re-read before retrying
          await sleep(900);
          const life = await lifecycle(cdp);
          return life.at(-1)?.state === 'awaiting-plug';
        }, `single ${i + 1}/9`);
        if (!landed) console.log(`  single ${i + 1}/9 attempt ${attempt} did not seat — retrying`);
      }
      if (!landed) throw new Error(`single ${i + 1}/9 never seated`);
    }
    // Stability: any half-paired orphan self-cleans (~10 s idle + ~3 s fade);
    // the tally below is exact only once the bench is quiet.
    const stable = await waitFor(
      async () => {
        const life = await lifecycle(cdp);
        return life.length === 43 && life.every((c) => c.state === 'awaiting-plug' || c.state === 'linked')
          ? life
          : false;
      },
      'the bench to stabilize at 43 cords',
      25000,
    ).catch(async () => {
      const life = await lifecycle(cdp);
      throw new Error(
        `bench never stabilized at 43: ${life.length} cords — ${JSON.stringify(life.map((c) => `${c.id}:${c.state}`))}`,
      );
    });
    void stable;
    const { t, h } = await checkTally('after pairs');
    expect(t.total).toBe(43); // the opening cord + 24 dense + 9 pairs + 9 singles
    expect(t.linked).toBeGreaterThanOrEqual(9); // + any dispatched foreign blues
    console.log(`  pairs + singles — ${t.linked} linked (9 pairs + dispatches), 43 cords live; numerals ${h.cordsNumeral}/${h.linkedNumeral} exact`);
  }

  // --- 5 — resize the dense host with EVERYTHING riding ------------------------
  {
    const before = (await seatsOnHost()).map((s) => `${s.cordId}:${s.index}:${s.fraction}`);
    const m = (await rects(cdp)).find((r) => r.id === HOST_ID);
    const tl = { x: m.x, y: m.y };
    const target = { x: tl.x - 0.22 * v.scale, y: tl.y + 0.18 * v.scale };
    await ensureFront();
    await rawPress(tl.x, tl.y);
    await sleep(60);
    if ((await evalJs(cdp, 'window.cords.handlesFor()')) !== HOST_ID) {
      throw new Error('handlesFor does not name the dense host mid-resize');
    }
    let midChecked = false;
    for (let i = 1; i <= 10; i += 1) {
      await rawMoveHeld(tl.x + ((target.x - tl.x) * i) / 10, tl.y + ((target.y - tl.y) * i) / 10);
      await sleep(34);
      if (i === 6) {
        // MID-DRAG: every fraction verbatim, every top-edge pin at the
        // law's recomputed point against the LIVE geometry (world units).
        const seats = await seatsOnHost();
        if (seats.length !== 24) throw new Error(`mid-resize seat count ${seats.length} ≠ 24`);
        for (const seat of seats) {
          const want = before.find((b) => b.startsWith(`${seat.cordId}:${seat.index}:`));
          if (want !== `${seat.cordId}:${seat.index}:${seat.fraction}`) {
            throw new Error(`seat ${seat.cordId}:${seat.index} fraction drifted mid-resize`);
          }
        }
        const pinErr = await evalJs(cdp, `(() => {
          const seats = window.cords.seats().filter(s => s.rectId === ${HOST_ID});
          const m = window.cords.rects().find(r => r.id === ${HOST_ID});
          const view = window.cords.view();
          const cx = (m.x + m.w / 2 - view.width / 2) / view.scale;
          const top = (view.floorScreenY - m.y) / view.scale;
          const w = m.w / view.scale;
          let worst = 0;
          for (const s of seats) {
            if (s.edge !== 0) continue; // the top-edge slots (the release band)
            const wantX = cx - w / 2 + s.fraction * w;
            const wantY = top - ${SEAT_DEPTH};
            worst = Math.max(worst, Math.hypot(s.x - wantX, s.y - wantY));
          }
          return worst;
        })()`);
        if (pinErr > 0.005) {
          throw new Error(`dense plug off its recomputed edge by ${pinErr.toFixed(4)} u mid-resize`);
        }
        midChecked = true;
      }
    }
    await sleep(100);
    await rawRelease(target.x, target.y);
    await sleep(280);
    if (!midChecked) throw new Error('the mid-resize pass never ran');
    const after = (await seatsOnHost()).map((s) => `${s.cordId}:${s.index}:${s.fraction}`);
    if (after.length !== 24) throw new Error(`post-resize seat count ${after.length} ≠ 24`);
    for (const seat of after) {
      if (!before.includes(seat)) throw new Error(`seat fraction changed across the resize: ${seat}`);
    }
    const seatsNow = await seatsOnHost();
    const seatedEnds = (await ends(cdp)).filter((e) =>
      seatsNow.some((s) => s.cordId === e.cordId && s.index === e.index));
    if (seatedEnds.length !== 24) throw new Error(`expected 24 seated ends, found ${seatedEnds.length}`);
    for (const e of seatedEnds) {
      if (!e.seated) throw new Error(`cord ${e.cordId} end ${e.index} unseated by the resize`);
    }
    const { t } = await checkTally('after dense resize');
    expect(t.total).toBe(43);
    expect(t.linked).toBeGreaterThanOrEqual(9);
    console.log('  dense resize — 24 plugs rode it, fractions verbatim, pins at the recomputed edges (mid-drag Δ ≤ 0.005 u)');
  }

  // --- 6 — the brush sweep across the dense field ------------------------------
  {
    const idle = await evalJs(cdp, 'window.cords.motion()');
    const dense = (await rects(cdp)).find((r) => r.id === HOST_ID);
    const y = dense.y + dense.h / 2 - 30; // through the plugs' drapes
    await rawSweep(150, 1450, y, 40);
    await rawSweep(1450, 150, y, 40);
    const swept = await evalJs(cdp, 'window.cords.motion()');
    if (!(swept.maxSpeed > Math.max(0.05, idle.maxSpeed * 5))) {
      throw new Error(`brush dead: idle ${idle.maxSpeed.toFixed(4)} vs sweep ${swept.maxSpeed.toFixed(4)} u/s`);
    }
    await checkTally('after brush');
    console.log(`  brush — idle ${idle.maxSpeed.toFixed(4)} → sweep peak ${swept.maxSpeed.toFixed(4)} u/s; tally unchanged`);
  }

  // --- 7 — the capture + final tally -------------------------------------------
  {
    const { t, h } = await checkTally('final');
    expect(t.total).toBe(43);
    expect((await seatsOnHost()).length).toBe(24);
    await shot(cdp, '2d7-dense.png');
    console.log(`  capture: .impeccable/review/2d7-dense.png (12 modules, 24-plug host, meters pegged, numerals ${h.cordsNumeral}/${h.linkedNumeral})`);
  }

  // --- 8 — PERF at the ceilings (?probe=1): 16 modules + 48 cords + churn ------
  {
    await withReconnect(async () => {
      await cdp.send('Page.navigate', { url: `${base}?probe=1` });
      return true;
    }, 'navigate to ?probe=1');
    await waitFor(
      async () => {
        const mods = await withReconnect(() => rects(cdp), 'rects read');
        const life = await withReconnect(() => lifecycle(cdp), 'lifecycle read');
        return mods.length === 16 && life.length === 48;
      },
      'the probe ceiling stage (16 modules, 48 cords)',
      20000,
    );
    await sleep(1200);
    const stage = await withReconnect(() => evalJs(cdp, `(() => {
      const life = window.cords.lifecycle();
      return {
        modules: window.cords.rects().length,
        cords: life.length,
        linked: life.filter((c) => c.state === 'linked').length,
        awaiting: life.filter((c) => c.state === 'awaiting-plug').length,
        seats: window.cords.seats().length,
      };
    })()`), 'probe stage read');
    expect(stage.modules).toBe(16);
    expect(stage.cords).toBe(48);
    if (stage.linked < 12) throw new Error(`probe stage linked ${stage.linked} < 12`);
    console.log(`  perf stage — ${stage.modules} modules, ${stage.cords}/48 cords, ${stage.linked} linked+pulsing, ${stage.seats} seats`);

    // Churn A: brush sweeps across the field while the probe accumulates.
    await rawSweep(120, 1480, 420, 240);
    await rawSweep(1480, 120, 500, 240);
    await rawSweep(120, 1480, 560, 200);
    // Churn B: resize churn on a staging module (its seats riding), 2 round trips.
    const churn = async () => {
      const m = (await withReconnect(() => rects(cdp), 'churn rects')).find((r) => r.id === 12);
      const tl = { x: m.x, y: m.y };
      const out = { x: tl.x - 0.3 * v.scale, y: tl.y + 0.24 * v.scale };
      await rawDrag(tl, out, 5);
      await rawDrag(out, tl, 5);
    };
    await churn();
    await churn();

    // The probe read: sample consecutive 4-s log windows under continued
    // sweeps + report the worst (the gate is on the worst window). Headless
    // rAF throttles when nothing drives the page (a skipped frame measures
    // nothing), so the read waits carry a slow input trickle — and a read
    // that lands just after the probe's 4-s counter reset is retried until
    // the window carries a full payload. NOTE: a throttled page's drawn
    // frames each carry the driver's FULL 5-substep backlog cap, so these
    // numbers are the conservative (worst-case per-frame) cost.
    const budget = 1000 / 60;
    const trickle = async (ms) => {
      const t0 = Date.now();
      let i = 0;
      while (Date.now() - t0 < ms) {
        await rawMove(200 + (i % 12) * 100, 470 + Math.sin(i) * 180);
        i += 1;
        await sleep(220);
      }
    };
    let worst = null;
    for (let w = 0; w < 3; w += 1) {
      await rawSweep(150, 1450, 480, 260);
      let p = null;
      for (let thin = 0; thin < 5; thin += 1) {
        p = await withReconnect(() => evalJs(cdp, 'window.cords.probe()'), `probe read ${w + 1}`);
        if (p === null || p.frames >= 45) break;
        await trickle(1400); // keep drawing while a fresh 4-s window fills
      }
      if (!p) throw new Error('probe read returned null');
      if (p.frames < 45) console.log(`  probe window ${w + 1} thin (${p.frames} frames) — using it anyway`);
      if (worst === null || p.avgMs > worst.avgMs) worst = p;
      console.log(`  probe window ${w + 1} — ${p.frames} frames · avg ${p.avgMs.toFixed(3)} ms · max ${p.maxMs.toFixed(3)} ms`);
    }
    if (!(worst.avgMs < budget / 2)) {
      throw new Error(`perf at ceilings: avg ${worst.avgMs.toFixed(3)} ms ≥ half the 16.7 ms budget`);
    }
    if (!(worst.maxMs < budget)) {
      throw new Error(`perf at ceilings: max ${worst.maxMs.toFixed(3)} ms ≥ the 16.7 ms budget`);
    }
    console.log(
      `  perf — ${stage.cords} cords/${stage.modules} modules under brush + resize churn: WORST window avg ${worst.avgMs.toFixed(3)} ms · max ${worst.maxMs.toFixed(3)} ms of the 16.7 ms budget`,
    );

    // Heap steadiness: gc, read, ~17 s of live frames (kept warm with
    // sweeps), gc, read — the steady-state allocation law (nothing per frame).
    await cdp.send('Performance.enable');
    await cdp.send('HeapProfiler.enable');
    const heapUsed = async () => {
      const { metrics } = await cdp.send('Performance.getMetrics');
      return metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? null;
    };
    const gc = async () => {
      await cdp.send('HeapProfiler.collectGarbage');
      await sleep(500);
    };
    await gc();
    const h0 = await heapUsed();
    const t0 = Date.now();
    while (Date.now() - t0 < 17000) {
      await rawSweep(150, 1450, 480, 260); // ~0.5 s of live paint + brush each
    }
    await gc();
    const h1 = await heapUsed();
    if (h0 === null || h1 === null) throw new Error('heap metrics unavailable');
    const delta = h1 - h0;
    if (delta > 1024 * 1024) {
      throw new Error(`heap grew ${(delta / 1024).toFixed(1)} KB over the gc'd pass — a per-frame leak`);
    }
    console.log(
      `  heap — gc'd pass over ~1000 live frames: ${(h0 / 1048576).toFixed(2)} MB → ${(h1 / 1048576).toFixed(2)} MB (${delta >= 0 ? '+' : ''}${(delta / 1024).toFixed(1)} KB)`,
    );
  }

  const pageErrors = opened.errors() + liveErrors;
  if (pageErrors > 0) throw new Error(`page errors: ${pageErrors}`);
  const rejs = opened.rejections() + liveRejs;
  if (rejs > 0) throw new Error(`lifecycle rejections: ${rejs}`);
  console.log('2D7 drive: 12 modules + a 24-plug dense host, 43 cords live, resize-with-riders, brush, tally honest throughout, perf + heap at the 48-cord ceilings — 0 page errors, 0 rejections');
});

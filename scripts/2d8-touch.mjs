#!/usr/bin/env node
/**
 * 2D-8 — THE TOUCH DRIVE (town-hall Revision 4): the full sandbox loop
 * driven by EMULATED TOUCH on phone metrics — iPhone-class portrait
 * (390 × 844, DPR 3) and Pixel-class landscape (844 × 390, DPR 2) —
 * through the real Input.dispatchTouchEvent domain (pointer events derive
 * per touch point; the page's pointer-first code is exercised exactly as a
 * finger would).
 *
 * THE LOOP (both orientations):
 *   surface — coarse pointer, hover:none, the 1020-px wrap media query,
 *             touch-action:none on the canvas, DPR-correct backing store,
 *             the contain view fit (whole stage visible, floor above the
 *             wrapped faceplate), buttons >= 44 px.
 *   1. tap NEW CORD (the faceplate button, by finger) → a carried cord.
 *   2. touch-drag the jack (a fat-finger press offset off the tip) and
 *      seat it on a module edge → awaiting-plug.
 *   3. touch-drag the blue end with a SECOND FINGER landing mid-drag
 *      (multi-touch: the first pointer owns the interaction) → linked +
 *      the chase pulse speaks the pair.
 *   4. the hover-free handle law: tap a module → ITS handles appear; a
 *      corner touch-drag RESIZES it; tapping the floor dismisses.
 *   5. brush: a finger dragged across a hanging cord perturbs it (motion
 *      probe: calm vs sweep).
 *   6. deny ring: 32 plugs touched onto one spawned module, the 33rd
 *      DENIED at the soft cap.
 *   7. put-away: a never-seated coil dropped on the floor powers itself
 *      away (~10 s) and the summary says so.
 *   8. tap RESET → cords clear, modules stand as left.
 *   9. orientation swap mid-session (metrics rotation): the view re-fits,
 *      nothing crops, a touch drag still works.
 *
 * PERF (Thor): the ?probe=1 ceiling stage (16 modules / 48 cords) at phone
 * metrics under Emulation.setCPUThrottlingRate 1× / 4× / 6× — honest
 * numbers logged; the unthrottled phone-metrics gate holds 2D-7's
 * worst-window law, the throttled ones are exposure readings (a mid-phone
 * CPU at 4× is a stress test, not the shipping bar).
 *
 * EMULATION HONESTY (logged): CDP's device-metrics override applied AFTER
 * load does not fire window.resize in this build (rotation does — probed);
 * the drive therefore sets metrics BEFORE navigation wherever it can, and
 * dispatches the one manual resize the initial-override case skips (what a
 * real phone's configuration produces at load). Emulated touch points land
 * exactly where aimed — they prove the EVENT PATHS (pointer-from-touch,
 * halos, handles, ownership), not finger physics; the real-finger verdict
 * stays with the user on hardware.
 */
import {
  CDP,
  assertDist,
  cleanup,
  ends,
  evalJs,
  lifecycle,
  openPage,
  rects,
  run,
  shot,
  sleep,
  startStack,
  waitFor,
} from './2d3-lib.mjs';

const IPHONE = { w: 390, h: 844, dpr: 3, label: 'iPhone-portrait' };
const PIXEL = { w: 844, h: 390, dpr: 2, label: 'Pixel-landscape' };

/** The drive's tiny expect — fails loudly, never silently. */
const expect = (v) => ({
  toBe(e) {
    if (v !== e) throw new Error(`expected ${JSON.stringify(e)}, got ${JSON.stringify(v)}`);
  },
  toBeCloseTo(e, digits = 6) {
    if (Math.abs(v - e) > 0.5 * 10 ** -digits) {
      throw new Error(`expected ~${e}, got ${v}`);
    }
  },
  toBeGreaterThanOrEqual(e) {
    if (!(v >= e)) throw new Error(`expected >= ${e}, got ${JSON.stringify(v)}`);
  },
  toBeLessThan(e) {
    if (!(v < e)) throw new Error(`expected < ${e}, got ${JSON.stringify(v)}`);
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

run('2d8', async () => {
  assertDist();
  const base = await startStack();
  const opened = await openPage(base);
  let cdp = opened.cdp;

  // The 2D-6 drive-craft: under long input+eval churn the ORIGINAL DevTools
  // socket can wedge; a fresh session answers. The page's state is the truth.
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
          /* the target is starved; the loop's next wait drains it */
        }
        await sleep(800);
      }
    }
    throw new Error(`${what}: exhausted DevTools recovery`);
  }

  // --- the touch input domain ---------------------------------------------------
  const P = (x, y, id = 1) => ({ x: Math.round(x), y: Math.round(y), id });
  /**
   * The 2D-3 craft, restored: input events can flip document.hidden in this
   * headless build, and the product's frame gate honestly honors it — so
   * EVERY input helper ensures a visible page first (the eval cost is the
   * price; withReconnect absorbs the wedge risk).
   */
  async function ensureVisible() {
    const hidden = await evalJs(cdp, 'document.hidden');
    if (hidden !== true) return;
    await cdp.send('Page.bringToFront');
    await sleep(120);
    const still = await evalJs(cdp, 'document.hidden');
    if (still === true) {
      await evalJs(cdp, `(() => {
        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        return true;
      })()`);
      await sleep(90);
    }
  }
  async function tStart(pts) {
    await ensureVisible();
    // Defensive contact clear: headless Chrome occasionally DROPS a
    // touchEnd (the drives' documented flake) — a dangling contact would
    // leave the page's first-pointer ownership latched forever, silently
    // eating every later gesture at the door. touchEnd [] lifts whatever is
    // still down; when nothing is down CDP answers "Must send a TouchStart
    // first" — exactly the clean-state signal, swallowed.
    try {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } catch {
      /* no active contact — clean */
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts });
  }
  async function tMove(pts) {
    await ensureVisible();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts });
  }
  async function tEnd() {
    await ensureVisible();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }

  /** A finger tap (no movement → a click on DOM, a press+release on canvas). */
  async function tap(x, y) {
    await tStart([P(x, y)]);
    await sleep(70);
    await tEnd();
    await sleep(240);
  }

  /** A finger drag through the canvas (start → moves → lift). */
  async function touchDrag(from, to, steps = 6) {
    await tStart([P(from.x, from.y)]);
    await sleep(50);
    for (let i = 1; i <= steps; i += 1) {
      await tMove([P(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps)]);
      await sleep(38);
    }
    await sleep(90);
    await tEnd();
    await sleep(280); // a few rAF frames for the seat intent to land
  }

  /** The faceplate button's rect (finger-sized target check + aiming). */
  const buttonRect = (name) =>
    withReconnect(
      () => evalJs(cdp, `document.querySelector('[data-hud="${name}"]').getBoundingClientRect().toJSON()`),
      `${name} rect`,
    );

  /** Grab a FREE end with a fat-finger press (14 px off the tip, up-body) + drag. */
  async function touchDragEndTo(cordId, index, to, what) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
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
      const grab = { x: jack.x, y: Math.max(jack.y - 14, 12) }; // 14 px up-body (2D-6 craft; inside the capsule, clear of the HUD band)
      await touchDrag(grab, to);
      const after = (await ends(cdp)).find((e) => e.cordId === cordId && e.index === index);
      if (after?.seated) return true;
      console.log(`  ${what} attempt ${attempt} did not seat — retrying`);
    }
    return false;
  }

  /** A module's top-edge slot (screen px), spread for dense seating. */
  const topEdgeSlot = (m, i, of) => ({
    x: m.x + m.w * (0.1 + 0.8 * (i / Math.max(1, of - 1))),
    y: m.y - 3,
  });

  // --- one full orientation session ----------------------------------------------
  async function runSession(device, { withOrientationSwap }) {
    console.log(`\n=== ${device.label} (${device.w}x${device.h} @${device.dpr}x) ===`);
    await withReconnect(async () => {
      // Metrics + touch BEFORE navigation: the page's first fit reads the
      // phone's window exactly (no desktop flash, no manual resize needed).
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: device.w, height: device.h, deviceScaleFactor: device.dpr, mobile: true,
      });
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await cdp.send('Page.navigate', { url: base });
      return true;
    }, 'device setup + navigate');
    await waitFor(
      () => withReconnect(() => evalJs(cdp, 'document.readyState'), 'readyState').then((r) => r === 'complete'),
      'page load',
    );
    await cdp.send('Page.bringToFront');
    await sleep(400);

    // --- surface: the phone contract -------------------------------------------
    // Under this machine's documented load wedge the first read after a
    // reconnect can land on a stale page state — the surface contract is
    // re-established (re-navigate, re-read) once before failing loudly.
    let surface = null;
    for (let establish = 1; establish <= 2; establish += 1) {
      surface = await withReconnect(() => evalJs(cdp, `(() => {
        const canvas = document.getElementById('stage');
        const hud = document.querySelector('.hud');
        const btns = [...document.querySelectorAll('.hud-btn')].map((b) => b.getBoundingClientRect().height);
        return {
          inner: [window.innerWidth, window.innerHeight],
          dpr: window.devicePixelRatio,
          coarse: matchMedia('(pointer: coarse)').matches,
          hoverHover: matchMedia('(hover: hover)').matches,
          mq: matchMedia('(max-width: 1020px)').matches,
          touchAction: getComputedStyle(canvas).touchAction,
          backing: [canvas.width, canvas.height],
          style: [canvas.style.width, canvas.style.height],
          view: window.cords.view(),
          hudH: hud.getBoundingClientRect().height,
          minBtn: Math.min(...btns),
        };
      })()`), 'surface read');
      const stale =
        surface === null || surface.view === undefined
        || surface.inner?.[0] !== device.w || surface.inner?.[1] !== device.h
        || surface.coarse !== true || surface.mq !== true;
      if (!stale) break;
      if (establish === 2) throw new Error(`surface contract stale under load: ${JSON.stringify(surface)}`);
      console.log('  surface read landed on a stale page state — re-navigating once');
      await withReconnect(async () => {
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width: device.w, height: device.h, deviceScaleFactor: device.dpr, mobile: true,
        });
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
        await cdp.send('Page.navigate', { url: base });
        return true;
      }, 're-navigate for surface');
      await waitFor(
        () => withReconnect(() => evalJs(cdp, 'document.readyState'), 'readyState (retry)').then((r) => r === 'complete'),
        'page load (retry)',
      );
      await cdp.send('Page.bringToFront');
      await sleep(500);
    }
    expect(surface.inner[0]).toBe(device.w);
    expect(surface.inner[1]).toBe(device.h);
    expect(surface.coarse).toBe(true);
    expect(surface.hoverHover).toBe(false); // no hover affordances may hide behind it
    expect(surface.mq).toBe(true); // the narrow-bench wrap
    expect(surface.touchAction).toBe('none');
    expect(surface.dpr).toBeCloseTo(device.dpr, 6);
    expect(surface.backing[0]).toBeCloseTo(device.w * device.dpr, 6); // DPR-correct store
    expect(surface.backing[1]).toBeCloseTo(device.h * device.dpr, 6);
    expect(surface.minBtn).toBeGreaterThanOrEqual(44); // Daredevil's touch floor
    const v = surface.view;
    // The composition ROUNDS the strip height for the margin — mirror it.
    const margin = Math.max(72, Math.round(surface.hudH));
    const expectScale = Math.min(device.w / 9.2, (device.h - margin) / 4.4);
    expect(v.scale).toBeCloseTo(expectScale, 6); // the contain law, floor above the HUD
    expect(v.floorScreenY).toBe(device.h - margin);
    // No cropped modules: every screen quad fully on-canvas, above the floor.
    for (const m of await rects(cdp)) {
      if (m.x < -0.5 || m.y < -0.5 || m.x + m.w > device.w + 0.5 || m.y + m.h > v.floorScreenY + 0.5) {
        throw new Error(`module ${m.id} crops the viewport: ${JSON.stringify(m)}`);
      }
    }
    console.log(
      `  surface — coarse ✓ hover:none ✓ wrap ✓ touch-action:none ✓ DPR ${surface.dpr} → ${surface.backing[0]}x${surface.backing[1]} · scale ${v.scale.toFixed(2)} px/u · HUD ${surface.hudH.toFixed(0)} px (floor above it) · buttons ≥ ${surface.minBtn.toFixed(0)} px`,
    );

    // --- 1 — tap NEW CORD --------------------------------------------------------
    const newCord = await buttonRect('new-cord');
    const life0 = (await lifecycle(cdp)).length;
    await tap(newCord.x + newCord.width / 2, newCord.y + newCord.height / 2);
    await waitFor(async () => (await lifecycle(cdp)).length === life0 + 1, 'the tapped NEW CORD', 4000);
    const cordId = (await lifecycle(cdp)).at(-1).id;
    const heldNow = await evalJs(cdp, 'window.cords.held()');
    if (heldNow?.cordId !== cordId) throw new Error(`NEW CORD tap: held=${JSON.stringify(heldNow)} (cord ${cordId})`);
    console.log(`  1 tap NEW CORD — cord ${cordId} in hand (red held) by finger tap`);

    // --- 2 — touch-drag the jack onto a module edge ------------------------------
    const mods = await rects(cdp);
    const host = mods.find((m) => m.id === 4); // module 05, mid-bench
    if (!host) throw new Error('module 05 missing');
    const seatTarget = { x: host.x + host.w / 2, y: host.y - 3 };
    const seatedRed = await touchDragEndTo(cordId, 0, seatTarget, 'red seat');
    if (!seatedRed) throw new Error('the touched red end never seated');
    await waitFor(async () => (await evalJs(cdp, `window.cords.lifecycle().find(c => c.id === ${cordId})?.state`)) === 'awaiting-plug', 'awaiting-plug', 4000);
    console.log(`  2 touch-drag — red seated on module 05's top edge (a 14 px off-tip finger press)`);

    // --- 3 — blue end with a SECOND FINGER landing mid-drag (ownership) ----------
    {
      let jack = null;
      for (let settle = 0; settle < 10 && jack === null; settle += 1) {
        const a = (await ends(cdp)).find((e) => e.cordId === cordId && e.index === 24);
        if (a && !a.seated) {
          await sleep(180);
          const b = (await ends(cdp)).find((e) => e.cordId === cordId && e.index === 24);
          if (b && !b.seated && Math.hypot(a.x - b.x, a.y - b.y) < 3) jack = b;
        }
      }
      if (!jack) throw new Error('blue end never settled for the multi-touch grab');
      const grab = { x: jack.x, y: Math.max(jack.y - 14, 12) };
      const other = mods.find((m) => m.id === 5); // module 06
      if (!other) throw new Error('module 06 missing');
      const to = { x: other.x + other.w / 2, y: other.y - 3 };
      await tStart([P(grab.x, grab.y, 1)]);
      await sleep(60);
      const midA = { x: grab.x + (to.x - grab.x) * 0.3, y: grab.y + (to.y - grab.y) * 0.3 };
      await tMove([P(midA.x, midA.y, 1)]);
      await sleep(60);
      // The second finger lands and moves — the FIRST pointer must own the drag.
      const stray1 = { x: device.w * 0.85, y: device.h * 0.4 };
      const stray2 = { x: device.w * 0.9, y: device.h * 0.35 };
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart', touchPoints: [P(midA.x, midA.y, 1), P(stray1.x, stray1.y, 2)],
      });
      await sleep(60);
      const midB = { x: grab.x + (to.x - grab.x) * 0.55, y: grab.y + (to.y - grab.y) * 0.55 };
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [P(midB.x, midB.y, 1), P(stray2.x, stray2.y, 2)],
      });
      await sleep(60);
      const heldMid = await evalJs(cdp, 'window.cords.held()');
      if (heldMid?.cordId !== cordId || heldMid?.index !== 24) {
        throw new Error(`ownership lost mid-multi-touch (grab never latched or hijacked): held=${JSON.stringify(heldMid)}`);
      }
      for (let i = 1; i <= 5; i += 1) {
        const f = 0.55 + (0.45 * i) / 5;
        await tMove([P(grab.x + (to.x - grab.x) * f, grab.y + (to.y - grab.y) * f, 1)]);
        await sleep(38);
      }
      await sleep(90);
      await tEnd(); // both fingers lift; the OWNER's release routes the seat
      await sleep(320);
      const st3 = await evalJs(cdp, `window.cords.lifecycle().find(c => c.id === ${cordId})?.state`);
      if (st3 !== 'linked') throw new Error(`multi-touch drag did not link (state ${st3})`);
      const pulse = await evalJs(cdp, 'window.cords.pulse().linked');
      if (!pulse.includes(cordId)) throw new Error('the linked pair does not pulse');
      console.log('  3 multi-touch — second finger landed mid-drag and was IGNORED; blue seated on module 06 → LINKED + pulsing');
    }

    // --- 4 — the hover-free handle law + a corner touch-resize --------------------
    {
      const target = mods.find((m) => m.id === 3); // module 04
      if (!target) throw new Error('module 04 missing');
      const w0 = target.w / v.scale;
      // Tap the BODY: the last-touched law shows ITS handles.
      await tap(target.x + target.w / 2, target.y + target.h / 2);
      await sleep(200);
      const shown = await evalJs(cdp, 'window.cords.handlesFor()');
      if (shown !== 3) throw new Error(`tap on module 04: handlesFor=${shown}, expected 3`);
      // Corner touch-drag (top-left, outward): the resize.
      const tl = { x: target.x, y: target.y };
      const out = { x: tl.x - 0.22 * v.scale, y: tl.y - 0.2 * v.scale };
      await tStart([P(tl.x, tl.y)]);
      await sleep(60);
      const midShown = await evalJs(cdp, 'window.cords.handlesFor()');
      if (midShown !== 3) throw new Error(`mid-resize handlesFor=${midShown}, expected 3`);
      for (let i = 1; i <= 8; i += 1) {
        await tMove([P(tl.x + ((out.x - tl.x) * i) / 8, tl.y + ((out.y - tl.y) * i) / 8)]);
        await sleep(36);
      }
      await sleep(100);
      await tEnd();
      await sleep(300);
      const grown = (await rects(cdp)).find((m) => m.id === 3);
      const wu = grown.w / v.scale;
      if (Math.abs(wu - (w0 + 0.22)) > 0.05) throw new Error(`touch resize grew to ${wu.toFixed(3)} u, expected ~${(w0 + 0.22).toFixed(3)}`);
      // Tapping the floor dismisses the furniture.
      const floorTap = worldToScreen(v, 0, 0.15);
      await tap(floorTap.x, floorTap.y);
      await sleep(200);
      const dismissed = await evalJs(cdp, 'window.cords.handlesFor()');
      if (dismissed !== -1) throw new Error(`floor tap: handlesFor=${dismissed}, expected -1`);
      console.log(`  4 handles — tap showed module 04's handles; corner touch-drag grew it to ${wu.toFixed(3)} u; floor tap dismissed`);
    }

    // --- 5 — brush: a finger swept across a hanging cord --------------------------
    {
      // The OPENING cord's drape (awaiting-plug, blue hanging to the floor)
      // is the honest brush target — a short linked pair barely sways.
      // Calm baseline first (the drape settles), then FRESH mid reads and a
      // WORLD-fine corridor (2d3-brush's craft: ~0.07 u per move against
      // the 0.15-u halo), THREE alternating passes to accumulate the sway.
      // MEASUREMENT, the phone-page lesson: the motion probe divides
      // displacement by REAL time, but a busy DPR-3 page under swiftshader
      // advances only one clamped 41.7-ms sim step per drawn frame — long
      // read windows dilute the speed by sim/real — so the probe is read
      // after EVERY move (one-frame windows) and the peak taken over all.
      await sleep(1500);
      const idle = await evalJs(cdp, 'window.cords.motion().maxSpeed');
      await sleep(300);
      let peak = 0;
      for (let attempt = 1; attempt <= 2 && peak <= 0.04; attempt += 1) {
        const mid = (await evalJs(cdp, 'window.cords.points()')).find((c) => c.cordId === 1)?.pts[12];
        if (!mid) throw new Error('opening cord points missing for the brush');
        const left = { x: mid.x - 0.55 * v.scale, y: mid.y };
        const right = { x: mid.x + 0.55 * v.scale, y: mid.y };
        await tStart([P(left.x, left.y)]);
        await sleep(50);
        for (let pass = 0; pass < 3; pass += 1) {
          const a = pass % 2 === 0 ? left : right;
          const b = pass % 2 === 0 ? right : left;
          for (let i = 1; i <= 16; i += 1) {
            await tMove([P(a.x + ((b.x - a.x) * i) / 16, a.y)]);
            await sleep(70);
            const m = await evalJs(cdp, 'window.cords.motion().maxSpeed');
            if (m > peak) peak = m;
          }
        }
        await tEnd();
        if (attempt === 1 && peak <= 0.04) {
          console.log(`  brush attempt 1 peak ${peak.toFixed(4)} u/s — one fresh-drape retry`);
          await sleep(600);
        }
      }
      if (!(peak > 0.04)) throw new Error(`finger sweep peak ${peak.toFixed(4)} u/s — no brush`);
      if (!(peak > idle * 3)) throw new Error(`sweep peak ${peak.toFixed(4)} vs idle ${idle.toFixed(4)} — not a brush`);
      const heldAfter = await evalJs(cdp, 'window.cords.held()');
      if (heldAfter !== null) throw new Error('the brush sweep grabbed something');
      console.log(`  5 brush — finger sweep across the drape: idle ${idle.toFixed(4)} → peak ${peak.toFixed(4)} u/s, nothing grabbed`);
    }

    // --- 6 — the deny ring: 32 touched plugs, the 33rd denied ---------------------
    {
      const t0 = Date.now();
      // NEW MODULE by finger tap → module 09 near the last touch.
      const newModule = await buttonRect('new-module');
      await tap(newModule.x + newModule.width / 2, newModule.y + newModule.height / 2);
      await waitFor(async () => (await rects(cdp)).length === 9, 'NEW MODULE tap', 4000);
      let hostDense = (await rects(cdp)).find((m) => m.id === 8);
      if (!hostDense) throw new Error('spawned module 09 missing');
      // Grow it (corner touch-drag) so 32 plugs have edge to stand on.
      const w0d = hostDense.w / v.scale;
      const tl = { x: hostDense.x, y: hostDense.y };
      await touchDrag(tl, { x: tl.x - Math.min(0.5, 1.55 - w0d) * v.scale, y: tl.y - 0.28 * v.scale }, 6);
      hostDense = (await rects(cdp)).find((m) => m.id === 8);
      const hostW = hostDense.w / v.scale;
      if (hostW <= w0d + 0.1) throw new Error(`dense host did not grow (${hostW.toFixed(3)} u)`);
      // Clear air for spawns (open floor below the bench's left wing).
      const air = worldToScreen(v, -1.5, 0.6);
      const seatsOnHost = async () =>
        (await evalJs(cdp, 'window.cords.seats()')).filter((s) => s.rectId === 8).length;
      // Plug 1: the full finger path (button tap spawn + touch drag).
      {
        await tap(air.x, air.y); // the last pointer read parks the spawn point
        await sleep(150);
        await tap(newCord.x + newCord.width / 2, newCord.y + newCord.height / 2);
        await sleep(350);
        const id = (await lifecycle(cdp)).at(-1).id;
        const jack = (await ends(cdp)).find((e) => e.cordId === id && e.index === 0);
        if (!jack) throw new Error('deny plug 1: spawned jack missing');
        await touchDrag({ x: jack.x, y: Math.max(jack.y - 14, 12) }, topEdgeSlot(hostDense, 0, 32));
        if (!((await seatsOnHost()) >= 1)) throw new Error('deny plug 1 never seated');
      }
      // Plugs 2..32: the spawn() seam (the button's own function) + real touch drags.
      for (let i = 1; i < 32; i += 1) {
        let landed = false;
        for (let attempt = 1; attempt <= 3 && !landed; attempt += 1) {
          landed = await withReconnect(async () => {
            await tap(air.x, air.y);
            await sleep(90);
            await evalJs(cdp, 'window.cords.spawn()');
            await sleep(220); // the coil springs into hand at the last pointer read
            const id = (await lifecycle(cdp)).at(-1).id;
            const jack = (await ends(cdp)).find((e) => e.cordId === id && e.index === 0);
            if (!jack) return false;
            await touchDrag({ x: jack.x, y: Math.max(jack.y - 14, 12) }, topEdgeSlot(hostDense, i, 32));
            return (await seatsOnHost()) === i + 1;
          }, `deny seat ${i + 1}/32`);
          if (!landed) console.log(`  deny seat ${i + 1}/32 attempt ${attempt} did not land — retrying`);
        }
        if (!landed) throw new Error(`deny seat ${i + 1}/32 never landed`);
        if ((i + 1) % 8 === 0) console.log(`  6 deny — ${i + 1}/32 plugs touched in`);
      }
      if ((await seatsOnHost()) !== 32) throw new Error(`dense host holds ${await seatsOnHost()}, expected 32`);
      // The 33rd: button-tap spawn + touch drag → DENIED at the soft cap.
      let denied = false;
      for (let attempt = 1; attempt <= 3 && !denied; attempt += 1) {
        await tap(air.x, air.y);
        await sleep(90);
        await tap(newCord.x + newCord.width / 2, newCord.y + newCord.height / 2);
        await sleep(350);
        const unlucky = (await lifecycle(cdp)).at(-1).id;
        const jack = (await ends(cdp)).find((e) => e.cordId === unlucky && e.index === 0);
        if (!jack) continue;
        await touchDrag({ x: jack.x, y: Math.max(jack.y - 14, 12) }, topEdgeSlot(hostDense, 31, 32));
        const still = await seatsOnHost();
        const end = (await ends(cdp)).find((e) => e.cordId === unlucky && e.index === 0);
        denied = still === 32 && end !== undefined && !end.seated;
      }
      if (!denied) throw new Error('the 33rd plug was not denied');
      console.log(`  6 deny — 32 finger plugs on module 09 (${hostW.toFixed(2)} u wide); the 33rd DENIED (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
      await shot(cdp, `2d8-${device.label}.png`);
    }

    // --- 7 — put-away: a never-seated coil, touched to the floor ------------------
    {
      const air = worldToScreen(v, -3.8, 0.4); // open floor, left wing
      await tap(air.x, air.y);
      await sleep(120);
      const newCord2 = await buttonRect('new-cord');
      // The deny strays idle out about now — count by ID SET, not by +1 (a
      // concurrent vanish would eat an exact-count wait).
      const idsBefore = new Set((await lifecycle(cdp)).map((c) => c.id));
      await tap(newCord2.x + newCord2.width / 2, newCord2.y + newCord2.height / 2);
      const id = await waitFor(async () => {
        const life = await lifecycle(cdp);
        const fresh = life.filter((c) => !idsBefore.has(c.id));
        return fresh.length > 0 ? fresh[fresh.length - 1].id : false;
      }, 'put-away spawn', 5000);
      const jack = (await ends(cdp)).find((e) => e.cordId === id && e.index === 0);
      if (!jack) throw new Error('put-away jack missing');
      // Drag it to open floor and release: carried → the ordinary drop,
      // never seated → the 10 s abandoned law. SLOW BY DESIGN (2d3-putaway's
      // craft): the idle window is 10 s of SIM time, and a quiet headless
      // page throttles rAF until the clock barely moves — so the wait keeps
      // the page drawing with gentle VOID drags (the fog band above the
      // world's top: no cords, no modules, pure activity, 2d7's trickle
      // lesson) and allows the full slow-clock budget.
      await touchDrag({ x: jack.x, y: Math.max(jack.y - 14, 12) }, air);
      await sleep(300);
      const voidY = 60; // deep in the fog band, above world top (screen)
      let putAway = false;
      let lastState = '?';
      let sawPutAwayLine = false; // the notice is ONE-SHOT: a later stray's
      // death rewrites the summary without it — the line is sticky, the
      // gone-check is ours.
      for (let t = 0; t < 150 && !putAway; t += 1) {
        // ~0.6 s of activity, then a read.
        await tStart([P(device.w * 0.5, voidY)]);
        for (let k = 1; k <= 3; k += 1) {
          await tMove([P(device.w * (0.5 + 0.04 * k), voidY + k * 4)]);
          await sleep(60);
        }
        await tEnd();
        const life = await lifecycle(cdp);
        const mine = life.find((c) => c.id === id);
        lastState = mine?.state ?? 'gone';
        const said = await evalJs(cdp, 'document.querySelector(".hud-summary")?.textContent');
        if (/put away/i.test(said)) sawPutAwayLine = true;
        putAway = (mine === undefined || mine.state === 'gone') && sawPutAwayLine;
      }
      if (!putAway) {
        throw new Error(
          `the never-seated coil did not put itself away (last state ${lastState}, put-away line ${sawPutAwayLine}; summary "${await evalJs(cdp, 'document.querySelector(".hud-summary")?.textContent')}")`,
        );
      }
      console.log('  7 put-away — never-seated coil dropped by finger powered itself away; the summary said so');
    }

    // --- 8 — tap RESET: cords clear, modules stand --------------------------------
    {
      const before = await rects(cdp);
      const sizes = before.map((m) => `${m.id}:${(m.w / v.scale).toFixed(3)},${((m.x + m.w / 2 - v.width / 2) / v.scale).toFixed(3)}`);
      const resetBtn = await buttonRect('reset');
      await tap(resetBtn.x + resetBtn.width / 2, resetBtn.y + resetBtn.height / 2);
      await waitFor(async () => (await lifecycle(cdp)).length === 0, 'RESET tap', 5000);
      const after = await rects(cdp);
      if (after.length !== before.length) throw new Error('RESET changed the module roster');
      const sizesAfter = after.map((m) => `${m.id}:${(m.w / v.scale).toFixed(3)},${((m.x + m.w / 2 - v.width / 2) / v.scale).toFixed(3)}`);
      if (JSON.stringify(sizes) !== JSON.stringify(sizesAfter)) throw new Error('RESET moved/resized modules');
      console.log(`  8 reset — finger tap cleared every cord; ${after.length} modules stand exactly as left`);
    }

    // --- 9 — orientation swap: rotate the phone mid-session ------------------------
    if (withOrientationSwap) {
      const swap = device.label === 'iPhone-portrait'
        ? { w: IPHONE.h, h: IPHONE.w, dpr: IPHONE.dpr }
        : { w: PIXEL.h, h: PIXEL.w, dpr: PIXEL.dpr };
      await withReconnect(async () => {
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width: swap.w, height: swap.h, deviceScaleFactor: swap.dpr, mobile: true,
        });
        return true;
      }, 'rotate metrics');
      await sleep(600);
      // Rotation fires a real window resize (probed); belt for the quirk:
      await withReconnect(async () => {
        await evalJs(cdp, 'window.dispatchEvent(new Event("resize")); true');
        return true;
      }, 'resize dispatch');
      await sleep(400);
      const after = await withReconnect(() => evalJs(cdp, `(() => {
        const canvas = document.getElementById('stage');
        const hud = document.querySelector('.hud');
        return {
          view: window.cords.view(),
          backing: [canvas.width, canvas.height],
          hudH: hud.getBoundingClientRect().height,
        };
      })()`), 'post-rotation read');
      const vv = after.view;
      expect(vv.width).toBe(swap.w);
      expect(vv.height).toBe(swap.h);
      expect(vv.floorScreenY).toBeCloseTo(swap.h - after.hudH, 6);
      expect(after.backing[0]).toBeCloseTo(swap.w * swap.dpr, 6);
      for (const m of await rects(cdp)) {
        if (m.x < -0.5 || m.y < -0.5 || m.x + m.w > swap.w + 0.5 || m.y + m.h > vv.floorScreenY + 0.5) {
          throw new Error(`post-rotation crop on module ${m.id}: ${JSON.stringify(m)}`);
        }
      }
      // A touch drag still works after the swap (body-drag a module).
      const target = (await rects(cdp)).find((m) => m.id === 2);
      const to = worldToScreen(vv, 0.2, 1.0);
      const t0 = { x: target.x + target.w / 2, y: target.y + target.h / 2 };
      await touchDrag(t0, to, 5);
      const moved = (await rects(cdp)).find((m) => m.id === 2);
      const d = Math.hypot(moved.x + moved.w / 2 - t0.x, moved.y + moved.h / 2 - t0.y);
      if (d < 10) throw new Error(`post-rotation body drag moved only ${d.toFixed(1)} px`);
      console.log(`  9 rotation — ${device.label} → ${swap.w}x${swap.h}: view re-fit to ${vv.scale.toFixed(2)} px/u, nothing crops, touch drags still answer`);
    }
    return true;
  }

  await runSession(IPHONE, { withOrientationSwap: true });
  await runSession(PIXEL, { withOrientationSwap: true });

  // --- PERF (Thor): the ceiling stage at phone metrics, throttle ladder ------------
  {
    console.log('\n=== perf — ?probe=1 ceiling stage on phone metrics ===');
    await withReconnect(async () => {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: PIXEL.w, height: PIXEL.h, deviceScaleFactor: 2, mobile: true,
      });
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await cdp.send('Page.navigate', { url: `${base}?probe=1` });
      return true;
    }, 'perf navigate');
    await waitFor(async () => {
      const mods = await withReconnect(() => rects(cdp), 'perf rects');
      const life = await withReconnect(() => lifecycle(cdp), 'perf lifecycle');
      return mods.length === 16 && life.length === 48;
    }, 'the probe ceiling stage (16 modules, 48 cords)', 25000);
    await sleep(1200);
    const stage = await withReconnect(() => evalJs(cdp, `(() => {
      const life = window.cords.lifecycle();
      return {
        modules: window.cords.rects().length,
        cords: life.length,
        linked: life.filter((c) => c.state === 'linked').length,
        seats: window.cords.seats().length,
      };
    })()`), 'perf stage read');
    if (stage.modules !== 16 || stage.cords !== 48 || stage.linked < 12) {
      throw new Error(`perf stage wrong: ${JSON.stringify(stage)}`);
    }
    console.log(`  perf stage — ${stage.modules} modules, ${stage.cords}/48 cords, ${stage.linked} pulsing, ${stage.seats} seats`);

    const vv = await evalJs(cdp, 'window.cords.view()');
    const sweep = async () => {
      const y = vv.floorScreenY - 1.6 * vv.scale;
      await tStart([P(vv.width * 0.1, y)]);
      for (let i = 1; i <= 10; i += 1) {
        await tMove([P(vv.width * (0.1 + (0.8 * i) / 10), y + Math.sin(i) * 18)]);
        await sleep(34);
      }
      await tEnd();
    };
    const trickle = async (ms) => {
      // Keep the page drawing while a fresh 4-s probe window fills (headless
      // rAF throttles when nothing drives input): mini touch drags.
      const t0 = Date.now();
      let i = 0;
      while (Date.now() - t0 < ms) {
        const y = vv.floorScreenY - (1 + Math.sin(i) * 0.6) * vv.scale;
        await tStart([P(vv.width * 0.2, y)]);
        for (let k = 1; k <= 3; k += 1) {
          await tMove([P(vv.width * (0.2 + 0.02 * k * (i % 8)), y + k * 6)]);
          await sleep(30);
        }
        await tEnd();
        i += 1;
        await sleep(160);
      }
    };
    const readWindow = async (what) => {
      let p = null;
      for (let thin = 0; thin < 5; thin += 1) {
        p = await withReconnect(() => evalJs(cdp, 'window.cords.probe()'), `probe read ${what}`);
        if (p === null || p.frames >= 40) break;
        await trickle(1500); // keep drawing while a fresh 4-s window fills
      }
      if (!p) throw new Error('probe read returned null');
      console.log(`  ${what} — ${p.frames} frames · avg ${p.avgMs.toFixed(3)} ms · max ${p.maxMs.toFixed(3)} ms (of 16.7)`);
      return p;
    };

    // 1× baseline (the gate: 2D-7's worst-window law at phone metrics).
    await sweep(); await sweep();
    const base1x = await readWindow('1x window A');
    await sweep();
    const base1xB = await readWindow('1x window B');
    const worst1x = base1x.avgMs > base1xB.avgMs ? base1x : base1xB;
    if (!(worst1x.avgMs < 1000 / 60 / 2)) {
      throw new Error(`perf 1x at phone metrics: avg ${worst1x.avgMs.toFixed(3)} ms ≥ half the budget`);
    }
    if (!(worst1x.maxMs < 1000 / 60)) {
      throw new Error(`perf 1x at phone metrics: max ${worst1x.maxMs.toFixed(3)} ms ≥ the budget`);
    }

    // 4× and 6× — exposure readings, logged honestly (not the shipping bar).
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await sleep(300);
    await sweep(); await sweep();
    const w4 = await readWindow('4x throttled window A');
    await sweep();
    const w4b = await readWindow('4x throttled window B');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
    await sleep(300);
    await sweep(); await sweep();
    const w6 = await readWindow('6x throttled window A');
    await sweep();
    const w6b = await readWindow('6x throttled window B');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const worst4 = w4.avgMs > w4b.avgMs ? w4 : w4b;
    const worst6 = w6.avgMs > w6b.avgMs ? w6 : w6b;
    console.log(
      `  perf summary — 1x worst avg ${worst1x.avgMs.toFixed(3)}/max ${worst1x.maxMs.toFixed(3)} · 4x worst avg ${worst4.avgMs.toFixed(3)}/max ${worst4.maxMs.toFixed(3)} · 6x worst avg ${worst6.avgMs.toFixed(3)}/max ${worst6.maxMs.toFixed(3)} ms of 16.7 (16.7/4 = ${(16.7 / 4).toFixed(2)} and 16.7/6 = ${(16.7 / 6).toFixed(2)} ms hold-60 ceilings under throttle)`,
    );
  }

  const pageErrors = opened.errors() + liveErrors;
  if (pageErrors > 0) throw new Error(`page errors: ${pageErrors}`);
  const rejs = opened.rejections() + liveRejs;
  if (rejs > 0) throw new Error(`lifecycle rejections: ${rejs}`);
  console.log(
    `\n2D8 drive: full touch loop on iPhone portrait + Pixel landscape (tap-spawn, fat-finger grab, multi-touch ownership, hover-free handles + touch resize, brush, 33rd deny, put-away, reset, rotation re-fit) + phone-metrics perf under 1x/4x/6x — 0 page errors, 0 rejections${reconnected > 0 ? ` (${reconnected} DevTools reconnect(s), the documented wedge craft)` : ''}`,
  );
});

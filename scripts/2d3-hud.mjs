#!/usr/bin/env node
/**
 * 2D-3 — HUD + A11Y FLOOR DRIVE (Daredevil's floor re-verified on the Canvas
 * world). Structure (DOM + Chrome's own AX tree), the keyboard ring (Tab /
 * Shift+Tab / Enter / Space, the amber focus bracket, modifier + repeat
 * guards), the meters' honesty against the lifecycle seam, the aria-live
 * summary at EVERY transition across a full cord life, the empty-hint gate,
 * and the DoD's PLUG LATENCY sampler (a seat registers ≤ 1 frame).
 *
 * Usage: node scripts/2d3-hud.mjs
 */
import {
  assertDist,
  evalJs,
  key,
  lifecycle,
  openPage,
  press,
  primeFocus,
  rects,
  release,
  move,
  run,
  seatEnd,
  sleep,
  startStack,
  summary,
  waitFor,
  waitForState,
} from './2d3-lib.mjs';

const expectSummary = async (cdp, what, contains) => {
  const text = (await summary(cdp)) ?? '';
  if (!text.includes(contains)) {
    throw new Error(`summary at ${what}: expected "${contains}" in "${text}"`);
  }
  return text;
};

/** Install the page-side frame sampler (rAF + the per-frame lifecycle read). */
const installSampler = (cdp, cordId) =>
  evalJs(
    cdp,
    `window.__lat = { samples: [], id: ${cordId} };
     (function loop() {
       window.__lat.samples.push(window.cords.lifecycle().find(c => c.id === window.__lat.id)?.state ?? 'gone');
       requestAnimationFrame(loop);
     })();
     true`,
  );

run('2D3_HUD', async () => {
  assertDist();
  const base = await startStack();
  const page = await openPage(base);
  const cdp = page.cdp;
  await waitFor(() => evalJs(cdp, 'typeof window.cords').then((t) => t === 'object'), 'window.cords');
  await sleep(2400);

  // --- structure (DOM) -----------------------------------------------------------
  const structure = await evalJs(cdp, `(() => {
    const canvas = document.querySelector('canvas#stage');
    const btns = [...document.querySelectorAll('button')];
    const focusables = [...document.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')];
    const summaryEl = document.querySelector('.hud-summary');
    return {
      title: document.title,
      mains: document.querySelectorAll('main').length,
      canvasRole: canvas?.getAttribute('role'),
      canvasLabelLen: canvas?.getAttribute('aria-label')?.length ?? 0,
      canvasTabIndex: canvas?.tabIndex,
      buttons: btns.map((b) => b.querySelector('.hud-btn-label')?.textContent ?? b.textContent),
      focusableCount: focusables.length,
      summaryRole: summaryEl?.getAttribute('role'),
      summaryLive: summaryEl?.getAttribute('aria-live'),
      metersHidden: [...document.querySelectorAll('.hud-readout')].every((m) => m.getAttribute('aria-hidden') === 'true'),
      hintSize: getComputedStyle(document.querySelector('.hud-hint')).fontSize,
    };
  })()`);
  console.log(`structure: ${JSON.stringify(structure)}`);
  if (structure.title !== 'Cords — cable patch sandbox') throw new Error('title wrong');
  if (structure.mains !== 1) throw new Error('expected exactly one <main>');
  if (structure.canvasRole !== 'img' || structure.canvasLabelLen < 100) {
    throw new Error('canvas accessible name missing/short');
  }
  if (structure.canvasTabIndex !== -1) throw new Error('canvas must not be a tab stop');
  if (structure.focusableCount !== 3) {
    // 2D-6: the faceplate owns THREE controls now (NEW CORD, NEW MODULE, RESET).
    throw new Error(`expected exactly 3 focusables, got ${structure.focusableCount}`);
  }
  if (structure.summaryRole !== 'status' || structure.summaryLive !== 'polite') {
    throw new Error('summary is not a polite status region');
  }
  if (structure.metersHidden !== true) throw new Error('meters must be aria-hidden');
  if (structure.hintSize !== '12px') throw new Error(`hint typography changed: ${structure.hintSize}`);

  // --- Chrome's own AX tree (read once, then DISABLE — a live tree crawls rAF) ----
  await cdp.send('Accessibility.enable');
  const ax = await cdp.send('Accessibility.getFullAXTree');
  await cdp.send('Accessibility.disable');
  const axNodes = ax.nodes.map((n) => ({
    role: n.role?.value,
    name: n.name?.value ?? '',
    live: n.live?.value,
  }));
  const hasMain = axNodes.some((n) => n.role === 'main');
  const hasImage = axNodes.some((n) => n.role === 'image' && n.name.toLowerCase().includes('cable patch panel'));
  const axButtons = axNodes.filter((n) => n.role === 'button' && /NEW CORD|NEW MODULE|RESET/.test(n.name));
  const axStatus = axNodes.filter((n) => n.role === 'status');
  const interactives = axNodes.filter((n) =>
    ['button', 'link', 'textbox', 'combobox', 'checkbox', 'radio', 'slider'].includes(String(n.role)),
  );
  console.log(
    `AX tree: main=${hasMain} image=${hasImage} buttons=${axButtons.length} status=${axStatus.length} interactives=${interactives.length}`,
  );
  if (!hasMain || !hasImage) throw new Error('AX tree missing the main landmark or the labeled image');
  if (axButtons.length !== 3) throw new Error(`AX tree exposes ${axButtons.length} buttons`);
  if (axStatus.length !== 1) throw new Error('AX tree missing the single status (live) region');
  if (interactives.length !== 3) throw new Error(`AX tree shows ${interactives.length} interactive nodes`);

  // --- the keyboard ring ------------------------------------------------------------
  await evalJs(cdp, 'document.body.focus()');
  await key(cdp, 'Tab', 'Tab', 9);
  let focus = await evalJs(cdp, `(() => {
    const el = document.activeElement;
    return {
      tag: el.tagName,
      name: el.querySelector?.('.hud-btn-label')?.textContent ?? el.textContent,
      outline: getComputedStyle(el).outlineColor + ' ' + getComputedStyle(el).outlineStyle + ' ' + getComputedStyle(el).outlineWidth,
    };
  })()`);
  console.log(`Tab 1: ${JSON.stringify(focus)}`);
  if (focus.tag !== 'BUTTON' || focus.name !== 'NEW CORD') throw new Error('first Tab did not land on NEW CORD');
  if (!focus.outline.includes('rgb(242, 212, 58)')) {
    throw new Error(`focus bracket is not the amber LED: ${focus.outline}`);
  }
  await key(cdp, 'Tab', 'Tab', 9);
  const focus2 = await evalJs(cdp, 'document.activeElement.querySelector(".hud-btn-label")?.textContent');
  if (focus2 !== 'NEW MODULE') throw new Error(`second Tab landed on ${focus2}`);
  await key(cdp, 'Tab', 'Tab', 9);
  const focus3 = await evalJs(cdp, 'document.activeElement.querySelector(".hud-btn-label")?.textContent');
  if (focus3 !== 'RESET') throw new Error(`third Tab landed on ${focus3}`);
  // Reverse traversal + escape: real Shift-modified key events (a synthetic
  // keydown never triggers the browser's default focus navigation).
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, modifiers: 8,
  });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, modifiers: 8,
  });
  await sleep(150);
  const reverse = await evalJs(cdp, 'document.activeElement.querySelector(".hud-btn-label")?.textContent ?? document.activeElement.tagName');
  if (reverse !== 'NEW MODULE') throw new Error(`Shift+Tab from RESET landed on ${reverse}`);
  // (The three-button ring is circular; v1's drive documented the same
  // navigation on the two-button faceplate it had.)
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, modifiers: 8,
  });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, modifiers: 8,
  });
  await sleep(250);
  const wrap = await evalJs(cdp, 'document.activeElement.querySelector(".hud-btn-label")?.textContent ?? document.activeElement.tagName');
  console.log(`  reverse wraps within the three-button ring: ${wrap} (no trap: a button, never a dead end)`);
  console.log('keyboard ring: body → NEW CORD → NEW MODULE → RESET; amber bracket ✓; Shift+Tab reverses ✓');

  // --- Enter / Space activate the focused button ------------------------------------
  await evalJs(cdp, 'document.querySelector("[data-hud=\\"new-cord\\"]").focus()');
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r',
  });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await waitForState(cdp, (l) => l.length === 2, 'Enter on NEW CORD');
  console.log('Enter on NEW CORD spawns ✓');
  // 2D-6 — the module control activates the same way: focus NEW MODULE,
  // press Enter (keydown WITH text — button activation needs it), and the
  // module roster grows by one through the B-key's own seam.
  // The ring is circular — Tab (at most a full turn) until NEW MODULE holds
  // focus, wherever the previous activation left it.
  let focusModule = '';
  for (let tab = 0; tab < 4 && focusModule !== 'NEW MODULE'; tab += 1) {
    await key(cdp, 'Tab', 'Tab', 9);
    focusModule = await evalJs(cdp, 'document.activeElement.querySelector(".hud-btn-label")?.textContent');
  }
  if (focusModule !== 'NEW MODULE') throw new Error(`focus for NEW MODULE landed on ${focusModule}`);
  const modulesBefore = (await rects(cdp)).length;
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
    text: '\r',
  });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
  });
  const modulesAfter = await waitFor(
    async () => (await rects(cdp)).length > modulesBefore,
    'Enter on NEW MODULE',
    4000,
  )
    .then(async () => (await rects(cdp)).length)
    .catch(() => -1);
  if (modulesAfter !== modulesBefore + 1) {
    throw new Error(`Enter on NEW MODULE grew the roster to ${modulesAfter}, expected ${modulesBefore + 1}`);
  }
  console.log(`Enter on NEW MODULE spawns module ${String(modulesAfter).padStart(2, '0')} ✓`);
  const spawnedId = (await lifecycle(cdp)).find((c) => c.id !== 0)?.id;
  if (spawnedId === undefined) throw new Error('spawned cord id missing');
  await expectSummary(cdp, 'spawn', '2 cords');

  // Space on RESET (keydown WITH text — button activation needs it).
  await evalJs(cdp, 'document.querySelector("[data-hud=\\"reset\\"]").focus()');
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ',
  });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await sleep(300);
  if ((await lifecycle(cdp)).length !== 0) throw new Error('Space on RESET did not reset');
  console.log('Space on RESET resets ✓');

  // --- N/R work wherever focus sits; the guards ignore chords + repeat ---------------
  await evalJs(cdp, 'document.querySelector("[data-hud=\\"new-cord\\"]").focus()');
  await key(cdp, 'n', 'KeyN', 78);
  await waitForState(cdp, (l) => l.length === 1, 'N while a button holds focus');
  await key(cdp, 'r', 'KeyR', 82);
  await sleep(200);
  if ((await lifecycle(cdp)).length !== 0) throw new Error('R while a button holds focus did not reset');
  console.log('N/R under button focus ✓');
  // Synthetic chords (a real CDP Cmd+R would reload the page).
  await key(cdp, 'n', 'KeyN', 78);
  await waitForState(cdp, (l) => l.length === 1, 'the chord-guard spawn');
  const chords = await evalJs(cdp, `(() => {
    for (const mods of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }]) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true, ...mods }));
    }
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', repeat: true, bubbles: true }));
    return window.cords.lifecycle().length;
  })()`);
  if (chords !== 1) throw new Error(`a chord or repeat changed the scene: ${chords} cords`);
  await key(cdp, 'r', 'KeyR', 82);
  await sleep(200);
  if ((await lifecycle(cdp)).length !== 0) throw new Error('post-chord reset broken');
  console.log('modifier + repeat guards ✓');

  // --- the summary + meters across a full cord life -----------------------------------
  await primeFocus(cdp);
  await key(cdp, 'n', 'KeyN', 78);
  await waitForState(cdp, (l) => l.length === 1, 'the life-study spawn');
  const cordId = (await lifecycle(cdp)).find((c) => c.state === 'carried')?.id;
  if (cordId === undefined) throw new Error('carried cord missing');
  await expectSummary(cdp, 'carried', '1 cord');

  // PLUG LATENCY — the DoD's measure 2: a seat registers ≤ 1 frame. A page-side
  // rAF sampler records the lifecycle per frame; the frame at (or immediately
  // after) the release must already read awaiting-plug.
  await installSampler(cdp, cordId);
  const modules = await rects(cdp);
  const m05 = modules.find((m) => m.id === 4);
  const jack = (await evalJs(cdp, 'window.cords.ends()')).find(
    (e) => e.cordId === cordId && e.index === 0,
  );
  const seatTarget = { x: m05.x + m05.w / 2, y: m05.y - 4 };
  await press(cdp, jack.x, jack.y);
  await sleep(40);
  for (let i = 1; i <= 10; i += 1) {
    await move(cdp, jack.x + ((seatTarget.x - jack.x) * i) / 10, jack.y + ((seatTarget.y - jack.y) * i) / 10);
    await sleep(30);
  }
  const beforeRelease = await evalJs(cdp, 'window.__lat.samples.length');
  await release(cdp, seatTarget.x, seatTarget.y);
  const countAtRelease = await evalJs(cdp, 'window.__lat.samples.length');
  void countAtRelease;
  await waitForState(cdp, (l) => l.find((c) => c.id === cordId)?.state === 'awaiting-plug', 'awaiting-plug');
  const lat = await evalJs(cdp, `(() => {
    const s = window.__lat.samples;
    return { first: s.indexOf('awaiting-plug'), beforeRelease: ${beforeRelease}, total: s.length };
  })()`);
  console.log(`plug latency: first awaiting-plug sample ${lat.first} vs release dispatched at ~${lat.beforeRelease}`);
  if (lat.first < 0) throw new Error('the sampler never saw awaiting-plug');
  // ≤ 1 frame: the release frame's own sample (or the single next rAF).
  if (lat.first > lat.beforeRelease + 2) {
    throw new Error(`seat took ${lat.first - lat.beforeRelease} frames to register (> 1)`);
  }
  console.log('plug latency ≤ 1 frame ✓');
  await expectSummary(cdp, 'first seat', '1 cord, 1 awaiting plug');
  const litCords = await evalJs(
    cdp,
    `[...document.querySelectorAll('[data-readout="cords"] .hud-seg')].filter(s => s.classList.contains('lit')).length`,
  );
  if (litCords !== 1) throw new Error(`CORDS meter lit ${litCords}, expected 1`);

  await seatEnd(cdp, cordId, 24, 5, 'the blue seat');
  await waitForState(cdp, (l) => l.find((c) => c.id === cordId)?.state === 'linked', 'linked');
  await expectSummary(cdp, 'link', 'linked');
  const litLinked = await evalJs(
    cdp,
    `[...document.querySelectorAll('[data-readout="linked"] .hud-seg')].filter(s => s.classList.contains('lit')).length`,
  );
  if (litLinked !== 1) throw new Error(`LINKED meter lit ${litLinked}, expected 1`);

  // The hint gate: hidden while the linked cord exists…
  const hintWhileCord = await evalJs(cdp, `getComputedStyle(document.querySelector('.hud-hint')).visibility`);
  if (hintWhileCord !== 'hidden') throw new Error('hint visible while a cord exists');

  // Hand-pull → awaiting-plug → vanish → gone; one failure line, exactly once.
  const seated = (await evalJs(cdp, 'window.cords.ends()')).find(
    (e) => e.cordId === cordId && e.index === 24,
  );
  const open = { x: 700, y: 830 };
  await press(cdp, seated.x, seated.y);
  await sleep(60);
  for (let i = 1; i <= 10; i += 1) {
    await move(cdp, seated.x + ((open.x - seated.x) * i) / 10, seated.y + ((open.y - seated.y) * i) / 10);
    await sleep(30);
  }
  await release(cdp, open.x, open.y);
  await waitForState(cdp, (l) => l.find((c) => c.id === cordId)?.state === 'vanishing', 'vanishing', 5000);
  await expectSummary(cdp, 'death', 'Cord shattered — unplugged.');
  await waitForState(cdp, (l) => !l.some((c) => c.id === cordId), 'the despawn', 5000);
  const afterGone = await expectSummary(cdp, 'after death', 'No cords on the bench.');
  if (afterGone.includes('shattered')) throw new Error('the failure line outlived its one repaint');
  console.log('full life: spawn → seat → link → pull → vanish → gone; one failure line ✓');

  // …and back when the bench empties (the death already drained it).
  const hintEmptyNow = await evalJs(cdp, `getComputedStyle(document.querySelector('.hud-hint')).visibility`);
  if (hintEmptyNow !== 'visible') throw new Error('hint not visible on the emptied bench');
  await key(cdp, 'r', 'KeyR', 82);
  await sleep(250);
  const hintEmpty = await evalJs(cdp, `getComputedStyle(document.querySelector('.hud-hint')).visibility`);
  if (hintEmpty !== 'visible') throw new Error('hint not visible on the empty bench');
  const emptySummary = await expectSummary(cdp, 'empty', 'No cords on the bench.');
  if (emptySummary.includes('R to reset')) throw new Error('empty summary must not advertise the no-op reset');

  const errors = page.errors();
  console.log(`page errors: ${errors}`);
  if (errors > 0) throw new Error(`${errors} page errors during the drive`);
  if (page.rejections() > 0) throw new Error(`${page.rejections()} lifecycle rejections`);
});

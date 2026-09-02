# Cords

A browser sandbox of cubes and vintage 1/4″ patch cords — spawn a cord, grab its jacks, plug them into any cube face, and let the rope physics do the rest. No goals, no score: just the feel of cables that dangle, wave, leash, pop, and tidy themselves away.

The bench is staged as an early-80s drum-machine panel: a machined charcoal stage, eight steel modules in candy-color zones, and a faceplate whose segmented LED meters speak live state only — lit segments are real cord and link counts, nothing decorative.

## Quickstart

Requires [Node.js](https://nodejs.org) 20.19+ (or 22.12+) and a desktop browser with WebGL.

```bash
npm install
npm run dev
```

Open the printed URL (default `http://localhost:5173`). The scene loads with one cord already half-patched — grab the blue jack to finish the link.

## How to play

- **Spawn** — press <kbd>N</kbd> (or the NEW CORD keycap on the faceplate). A coiled cord appears at your cursor with the red input jack in hand; the uncoil is physics, not an animation. One press, one cord.
- **Carry** — drag either jack. Both ends are grabbable, seated ends included — grabbing a seated plug simply pulls it out. The cord stretches, dangles, and leashes behind you; a violent cursor teleport drags it rather than ripping it.
- **Plug** — release a held jack over any cube face and it seats perpendicular to that face. Plug both ends (two cubes, two faces of one cube — even the same cube twice) and the cord is **linked**: an amber signal pulse chases down it, red end to blue end. Each cube takes up to 12 plugs; the next attempt draws a red deny ring.
- **Drag cubes** — grab a cube anywhere and move it (translate only). Seated plugs ride along and their cords go taut.
- **Brush** — sweep the cursor across a hanging cord, no button held, and it sways away from you.

Failure and cleanup are part of the toy:

- **Over-stretch pops** — drag linked cubes past the cord's length and the far jack pops out with a ~3-second grace: re-plug it in time and the link is restored; let the grace expire and the jack shatters, the cord pulls itself out, and the whole thing fades away.
- **Dropped half-plugged cords fail** — release the held jack of a cord with one end still seated anywhere but a cube, and it shatters the same way.
- **Abandoned coils put themselves away** — leave a never-seated cord lying untouched for ~10 seconds and it powers down and vanishes. Grab it before then and it is instantly rescued, no worse for wear.
- **Reset** — press <kbd>R</kbd> to clear every cord. Cubes keep their positions.

## Controls

| Action | Input |
| --- | --- |
| Spawn a new cord | <kbd>N</kbd> or the faceplate's NEW CORD button |
| Reset the bench (cords only) | <kbd>R</kbd> or the faceplate's RESET button |
| Grab a jack / cube | Press and hold on it |
| Plug a jack in | Release over a cube face |
| Pull a plug out | Grab a seated jack |
| Perturb hanging cords | Sweep the cursor over them (hover only) |

Modifier chords stay with the browser — <kbd>Cmd</kbd>+<kbd>R</kbd> still reloads, only bare N and R reach the page.

## Features worth knowing

- **Feel guarantees** — the sim runs a fixed 120 Hz timestep inside every frame, so behavior is frame-rate independent and deterministic: cords settle in about a second and a half without jitter, and every interaction answers within a frame.
- **A liftable, headless core** — `src/sim/` is pure TypeScript with zero Three.js imports, so the whole physics core can be lifted into another product untouched. A gate enforces it (see [Development](#development)).
- **Accessibility floor** — spawn and reset are fully keyboard-reachable (Tab, Enter, Space on the faceplate buttons), an `aria-live` summary speaks every lifecycle change ("2 cords, 1 awaiting plug, 1 linked…"), and `prefers-reduced-motion` dampens page-induced motion: the pulse slows, the shatter burst disappears, the brush softens.

  > [!NOTE]
  > Plugging a jack requires pointer aiming — the keyboard floor covers spawning, resetting, and the spoken summary.

- **Resilience** — a lost WebGL context or a hidden tab pauses the simulation exactly and resumes with no backlog; the sim is pure state, so nothing is lost mid-flight.
- **Zero network at runtime** — static single page, no backend, no telemetry, no CDN. The build output can be hosted from any static folder.

## Development

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Purity check + type-check + production build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Purity check + full Vitest suite |
| `npm run fuzz` | The full seeded fuzz corpus (adversarial input storms; every run reproducible) |
| `npm run check:sim` | The sim-purity gate alone |

- **Sim-purity gate** (`scripts/check-sim-purity.mjs`) — scans every file under `src/sim/` for Three.js imports and fails the build on any hit, keeping the physics core renderer-agnostic. It runs as part of `build` and `test`.
- **Tests** — Vitest unit suites cover the sim, interaction, render, and HUD layers; the fuzz harness replays adversarial patterns (drag storms, delta spikes, spawn/despawn churn, over-stretch pulls) with per-frame invariants and bitwise determinism. Set `CORDS_FUZZ_SEED=<n>` to explore a single seed.
- **Frame-budget measurement** — `node scripts/measure-perf.mjs [seconds] [brush\|pulse\|brush+pulse]` drives the perf harness (12 live cords) in headless Chrome and prints the measured frame timings.
- **Debug seams** — in the running page, `window.cords` exposes read-only probes (`lifecycle()`, `pulse()`, `statePaint()`, `resilience()`) plus `spawnCord()`.

## Troubleshooting

- **Blank page** — Cords needs WebGL. Enable hardware acceleration or try another desktop browser.
- **<kbd>N</kbd> did nothing** — the bench holds at most 16 cords; spawning at the cap is a deliberate no-op. Press <kbd>R</kbd> and try again.
- **My cord vanished** — that was one of the three exits: an over-stretched pop whose grace expired, a half-plugged cord's jack released off-cube, or an abandoned coil (10 s untouched) putting itself away. Spawn another.
- **Touch devices** — not supported; this is a desktop, mouse-driven sandbox.

## Further reading

- [`PRODUCT.md`](PRODUCT.md) — what the sandbox is for and its approved scope
- [`DESIGN.md`](DESIGN.md) — the Drum Machine Panel design system

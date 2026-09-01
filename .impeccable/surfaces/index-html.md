---
version: 1
slug: "index-html"
primary_target: "index.html"
related_targets: []
---

# Surface brief — Cords sandbox (single page)

## Scope & visitor mode

One Experience surface: the full-viewport sandbox IS the page; the interface recedes to a silkscreen faceplate strip. No marketing shell, no onboarding flow — first viewport is the working scene.

## Audience, job, action

The creator (developer evaluating the reactive feel for a bigger product) and future playtesters. Job: plug cords into cubes, drag cubes around, watch links and failures behave. Primary action: grab a red or blue jack. Proof is the simulation itself — every claim the page makes is performed live by the physics.

## Chosen direction & memorable moment

**Drum Machine Panel** (user-pinned over the roll): the sandbox as an early-80s hardware instrument faceplate. Charcoal steel ground, candy color zones, silkscreen caps naming real state only, lit LEDs as the only glow, segmented readout for live counts. Memorable moment: a completed link's pulse sweeping the cord red-to-blue like a chase light locked to the sim clock — and the shatter performing in the same hardware grammar ( LEDs out, key-cap red end dropping, segments counting the cord down to zero).

Guards native to the grammar: glow only where live state lives; labels never become costume — each silkscreen legend names a real state (CORDS, LINKED, length readout); measurement ticks on a stretching cord are silkscreen furniture, not decoration.

## States and ranges

Scene ranges: 0–8 cubes, 0–12 live cords (≥4 linked), 0–12 plugs per cube (soft cap). Material states per cord lifecycle: carried, awaiting-plug (stretching, ticks visible), linked (chase pulse), popped (grace countdown, dimming), vanishing (fall → shatter → pull-out → vanish). Empty scene = invitation state with one silkscreen hint. Reduced-motion dampens dangle/shatter intensity.

## Interaction and layout

Full-bleed 3D stage; faceplate HUD strip (bottom edge) with segmented readouts (CORDS / LINKED) and the NEW CORD + RESET controls — keyboard-reachable (N, R), visible focus. Picking priority jack > cube > cord body; passive cursor-brush perturbation. Desktop mouse, landscape; no mobile/touch in MVP.

## Constraints

Vite + TypeScript + Three.js static build; 60fps with 8 cubes + 12 cords on mid-range hardware; input-to-action under one frame; zero network; no sound. Direction contract (THESIS/OWN-WORLD/STORY/FIRST VIEWPORT/FORM/FINISH) is authored at build entry per impeccable new-work rules.

## Unresolved decisions

None blocking production. Production-lane tunables: exact silkscreen typeface, segment counts, brush radius/falloff, grace timer (~3s), pulse speed.

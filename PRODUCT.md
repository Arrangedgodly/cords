# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated: Vite + TypeScript + Three.js — a single-page static site, no backend, dependencies lockfile-pinned, no CDN runtime code. The approved scoping brief pins Three.js/WebGL, static hosting, and liftable architecture; bundler and language tooling recorded here as the implementation choice serving those pins.

## Users

Primary: the product's creator — a developer building toward a larger interactive product whose core mechanic is physical cables. They use this sandbox to evaluate and tune the reactive feel (plug, dangle, brush, failure) before committing the bigger product's architecture. Secondary: future playtesters of that bigger product, encountering the same scene.

## Product Purpose

A browser sandbox proving the most reactive cable-linking experience possible: cubes that accept vintage audio jacks at any point on their surface, cords with a red input end and blue output end that stretch and dangle while carried, wave under gravity once seated, perturb when the cursor brushes them, auto-unplug when over-stretched, self-clean when abandoned, and pulse energy when fully linked. Success: the creator plays for ten minutes and wants to build the bigger product on this simulation core.

## Positioning

A liftable, headless cord-physics core — pure state plus fixed-timestep solver — with Three.js as a disposable render layer. Cable toys couple physics to their renderer; this one is engineered to be lifted whole into a larger product. The sandbox proves the feel; the sim core is the durable asset.

## Operating Context

Desktop browser, mouse-driven, landscape viewport. One scene: free placement of cubes, grab-from-midair cord spawning (N key or HUD button), passive cursor-brush perturbation, keyboard-reachable controls, screen-reader scene summary. No backend, zero network calls, zero telemetry. Opened locally or from a static host for evaluation sessions of minutes, not marathons.

## Capabilities and Constraints

Approved mechanics: plugs seat at any point on a cube (perpendicular to the face under cursor; deterministic edge/corner resolution); red/blue polarity is cosmetic — self-links allowed, soft plug-cap ~12 per cube as perf guard only; cord lifecycle carried → awaiting-plug → linked → popped → vanishing; over-stretch auto-unplugs with ~3s self-clean grace; picking priority jack > cube > cord body, jacks the only grabbable; passive-hover brush on cord bodies; translate-only cubes. Performance floor: 60fps with 8 cubes + 12 live cords (≥4 linked and pulsing) on mid-range hardware; input-to-action under one frame; dangle settles ~1.5s without jitter. MVP non-goals: sound, save/load, sharing, mobile/touch, cube rotation, cube types, multiple cord colors/lengths, undo, level editing.

## Brand Commitments

Cord ends must read as old-school 1/4″ (6.35 mm) phone plugs: shiny metal shaft, tapered tip, dark sleeve grip; red input / blue output coding carried on the sleeve band and/or strain relief so polarity reads instantly. Product name: "Cords."

## Evidence on Hand

None — empty repository, no assets, content, prior art, or user research. Future work must not fabricate testimonials, benchmarks, or adoption claims; all demonstration content is authored in-sandbox.

## Product Principles

1. Feel is the product — every interaction answers within one frame.
2. The sim is liftable — headless core, renderer disposable.
3. Failure is safe, deliberate, and delightful to watch.
4. 60fps or it doesn't ship.
5. The scene tidies itself.

## Accessibility & Inclusion

MVP floor (approved): keyboard-reachable spawn/reset controls, visible focus states, HUD contrast, prefers-reduced-motion dampens dangle/shatter intensity, and a screen-reader scene summary ("3 cubes, 2 cords linked").

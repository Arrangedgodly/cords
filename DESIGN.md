---
name: Cords
description: A reactive cable-patch sandbox staged as an early-80s drum machine panel — machined charcoal steel, candy state zones, and LEDs that only speak live state.
colors:
  # The eight candy zones (src/render/scene.ts CUBE_COLORS) — module pads on the cube faceplates
  signal-red: "#e8433f"
  tangerine: "#f2903a"
  sulfur-yellow: "#f2d43a"
  jade: "#2fbd72"
  reef-cyan: "#3ec8d8"
  cobalt: "#4a7df2"
  magenta: "#d857c8"
  bone: "#e8e3d5"
  # State inks and keylines
  plug-red: "#c22e26"
  plug-blue: "#2e58de"
  amber-keyline: "#a98f1d"
  jade-keyline: "#1f7a4a"
  # Ground — charcoal steel, dark not black
  stage-void: "#111114"
  bench-charcoal: "#22252a"
  faceplate-charcoal: "#17191d"
  brushed-steel: "#2a2d31"
  unlit-slot: "#232730"
  machined-seam: "#0e1013"
  # Materials in the scene
  cord-rubber: "#2e3138"
  grip-rubber: "#17181c"
  plug-chrome: "#d6dade"
  # Silkscreen inks
  legend-ink: "#c3c8d1"
  dim-ink: "#9aa0ab"
  tick-ink: "#b6bcc6"
  silkscreen-id: "#8f96a0"
  cap-ink: "#d9dde4"
  # Control surfaces
  cap-face: "#242930"
  cap-hover: "#2b313a"
  cap-pressed: "#1f242b"
  key-chip-face: "#2c323b"
typography:
  nameplate:
    fontFamily: "\"Helvetica Neue\", Helvetica, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    letterSpacing: "0.34em"
    lineHeight: 1
  nameplate-sub:
    fontFamily: "\"Helvetica Neue\", Helvetica, Arial, sans-serif"
    fontSize: "9px"
    fontWeight: 600
    letterSpacing: "0.24em"
    lineHeight: 1
  label:
    fontFamily: "\"Helvetica Neue\", Helvetica, Arial, sans-serif"
    fontSize: "10px"
    fontWeight: 700
    letterSpacing: "0.16em"
    lineHeight: 1
  control-label:
    fontFamily: "\"Helvetica Neue\", Helvetica, Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    letterSpacing: "0.14em"
    lineHeight: 1
  hint:
    fontFamily: "\"Helvetica Neue\", Helvetica, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    letterSpacing: "0.2em"
    lineHeight: 1
  readout-numeral:
    fontFamily: "ui-monospace, \"SF Mono\", Menlo, Consolas, \"Liberation Mono\", monospace"
    fontSize: "13px"
    fontWeight: 600
    fontFeature: "tabular-nums"
    lineHeight: 1
  keycap:
    fontFamily: "ui-monospace, \"SF Mono\", Menlo, Consolas, \"Liberation Mono\", monospace"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1
rounded:
  sm: "2px"
  md: "10px"
spacing:
  xs: "3px"
  sm: "9px"
  md: "10px"
  lg: "24px"
components:
  faceplate-strip:
    backgroundColor: "{colors.faceplate-charcoal}"
    padding: "13px 28px"
  nameplate-word:
    textColor: "{colors.bone}"
    typography: "{typography.nameplate}"
  nameplate-sub:
    textColor: "{colors.dim-ink}"
    typography: "{typography.nameplate-sub}"
  meter-label:
    textColor: "{colors.legend-ink}"
    typography: "{typography.label}"
  meter-segment:
    backgroundColor: "{colors.unlit-slot}"
    width: "9px"
    height: "16px"
  meter-segment-lit-amber:
    backgroundColor: "{colors.sulfur-yellow}"
  meter-segment-lit-jade:
    backgroundColor: "{colors.jade}"
  readout-numeral-amber:
    textColor: "{colors.sulfur-yellow}"
    typography: "{typography.readout-numeral}"
  readout-numeral-jade:
    textColor: "{colors.jade}"
    typography: "{typography.readout-numeral}"
  readout-numeral-zero:
    textColor: "{colors.dim-ink}"
    typography: "{typography.readout-numeral}"
  empty-hint:
    textColor: "{colors.legend-ink}"
    typography: "{typography.hint}"
  hud-button:
    backgroundColor: "{colors.cap-face}"
    textColor: "{colors.cap-ink}"
    typography: "{typography.control-label}"
    rounded: "{rounded.sm}"
    padding: "9px 12px 9px 14px"
  hud-button-hover:
    backgroundColor: "{colors.cap-hover}"
  hud-button-active:
    backgroundColor: "{colors.cap-pressed}"
  keycap-chip:
    backgroundColor: "{colors.key-chip-face}"
    textColor: "{colors.tick-ink}"
    typography: "{typography.keycap}"
    rounded: "{rounded.sm}"
    padding: "2px 6px"
---

# Design System: Cords

## Overview

**Creative North Star: "The Drum Machine Panel"**

Cords is staged as an early-80s hardware instrument faceplate brought to life. A charcoal steel bench under one warm lamp, machined panel seams falling into fog, eight steel modules each carrying a single candy color zone, and the product's hero object — real 1/4″ phone plugs on dark rubber cords — lying across it. The interface recedes to a silkscreen faceplate strip along the bottom edge: tracked small-caps legends, squared segmented meters, machined keycap buttons. Nothing on the page is costume; every printed word names a real state, and every lit pixel is live state.

The system's core honesty is the **lit = live state only** contract. The scene is unlit hardware — matte rubber, brushed steel, painted silkscreen — until the simulation says otherwise: a completed link's amber chase pulse traveling the cord, a meter row filling one segment per live cord, a popped jack's band blinking like a dying battery. The same grammar performs failure: over-stretch a cord and the jack shatters into dark steel shards plus one shard of its own color band, the cord dims through its grace countdown, and the meters count it down to zero.

Motion is **sim-driven, never scripted** — there are no CSS keyframes and no tweens anywhere in the system. Every animated read (the chase light, the grace blink, the dangle, the settle) is a pure function of the simulation's own clock and state, so the same sim instant always paints the same picture and a frozen sim holds its light still. All values below are extracted from the shipped code: `src/render/scene.ts`, `src/render/pulse.ts`, `src/render/states.ts`, `src/hud/`, and the silkscreen CSS in `index.html`. Capture of the built world: `.impeccable/review/design-doc-built.png`.

**Key Characteristics:**
- Charcoal steel ground — dark, never black; the bench reads as lit steel under the warm key (base #22252a, void #111114).
- Eight candy color zones, each doubling as a state ink (amber = live cords, jade = links, red/blue = plug polarity).
- Silkscreen legends: tracked caps that name real state only; if the sim can't say it, the panel doesn't print it.
- One glow budget: the chase-pulse amber on linked cords and the lit meter segments — nothing else glows, ever.
- Machined depth: 1px bevels, seams, screws, and one warm key light; flat surfaces, no glass, no gradients.
- Sim-clock motion: deterministic, headless-testable, no keyframes; reduced motion slows or holds effects, never removes live-state meaning.

## Colors

A candy-on-charcoal instrument palette: eight saturated 80s hardware colors reserved for state zones and polarity coding, floating on layered charcoal steel, with gray-blue silkscreen inks for every printed word.

### Primary
- **Sulfur Yellow** (#f2d43a): The system's live-state ink. The lit CORDS meter segments and their numerals, the chase pulse's amber LED traveling a linked cord, and the visible focus bracket. It is the panel's only sanctioned glow color.
- **Jade** (#2fbd72): The linked-state ink. The lit LINKED meter segments and numerals — green means the connection is complete and pulsing. REFINE-2: cooled from #58c470 (HSV hue 133° → 148°, saturation 0.55 → 0.75, deeper L) because the old yellow-green read amber-warm beside the CORDS amber at meter scale — the two rows now differ by hue (~100°) AND depth (jade renders ~40% the amber's luminance). 7.24:1 on the panel.

### Secondary
- **Plug Red** (#c22e26): Input polarity — the red jack's sleeve band and strain-relief boot — and the soft-cap deny ring painted on a rejected cube face. A deeper red than the cube zone so it survives the warm key without drifting orange.
- **Plug Blue** (#2e58de): Output polarity — the blue jack's band, boot, and band shard. A deeper cobalt than the cube zone (the blue twin of Plug Red's rule) so it survives the warm key without drifting teal: the old zone-shared #4a7df2 rendered (79,104,154) — desaturated slate — at carry distance; this albedo renders a blue that classifies at hue ~223°/sat 0.64–0.88 in situ, at matched lightness to Plug Red (OKLCH L 51.7 vs 53.6 — the polarity pair differentiates by hue alone).
- **Cobalt** (#4a7df2): Cube 06's candy zone.
- **Signal Red** (#e8433f): Cube 01's candy zone.

### Tertiary (the candy zone roster — one per cube, index order 01–08)
- **Signal Red** (#e8433f), **Tangerine** (#f2903a), **Sulfur Yellow** (#f2d43a), **Jade** (#2fbd72), **Reef Cyan** (#3ec8d8), **Cobalt** (#4a7df2), **Magenta** (#d857c8), **Bone** (#e8e3d5). Flat fills with a darker keyline (rgba(0,0,0,0.45)) on each module's faceplate; Bone doubles as the nameplate ink ("CORDS").

### Neutral
- **Stage Void** (#111114): Page background, scene background, and fog color — the room the bench sits in.
- **Bench Charcoal** (#22252a): The floor plate's albedo; albedo-dark, not black, so the bench reads as lit steel.
- **Faceplate Charcoal** (#17191d): The HUD strip's machined panel.
- **Brushed Steel** (#2a2d31): The cube faceplates' base tone under the candy zones.
- **Unlit Slot** (#232730): A meter segment at rest — recessed, honest, waiting.
- **Machined Seam** (#0e1013): Segment and keycap borders; the same near-black ink as the panel seams (#0d0f12).
- **Cord Rubber** (#2e3138): The cord tube — dark matte rubber that reads against the bench via the key light.
- **Grip Rubber** (#17181c): The plug's knurled sleeve grip; also the popped band's blinked-off "unlit plastic" ink.
- **Plug Chrome** (#d6dade): The jack's metal tip and shaft (metalness 1.0, roughness 0.24, environment-lit).

### Ink neutrals (all silkscreen)
- **Legend Ink** (#c3c8d1): Meter labels ("CORDS", "LINKED") — 10.48:1 on the faceplate.
- **Dim Ink** (#9aa0ab): Zeroed numerals and the subtitle — unlit state (6.70:1). (The empty-scene hint was promoted to Legend Ink — REFINE-1: it is the page's only first-run instruction and 10px Dim Ink under-read.)
- **Tick Ink** (#b6bcc6): The stretch ticks' neutral registration marks on a taut cord (measurement, never red); also the keycap chip ink (6.76:1 on its chip).
- **Silkscreen ID** (#8f96a0): The painted module numbers 01–08 on the cube faceplates.

### Named Rules
**The One Glow Rule.** Glow exists only where live state lives: the chase-pulse amber on a linked cord, the lit meter segments, and the focus bracket (the meter LED's own amber). Everything else is painted, machined, or lit by the key — never emissive. A decorative glow is a bug.

**The State-Ink Rule.** Every saturated color names a live state: amber = cords alive, jade = links, red/blue = plug polarity, candy zones = the modules' identities. Saturated color is never used for mood, section, or filler.

## Typography

**Display/Body Font:** "Helvetica Neue", Helvetica, Arial, sans-serif — the whole silkscreen system; there is no display face.
**Label/Mono Font:** ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace — numerals and keycaps only.

**Character:** Narrow-tracked heavy caps at tiny sizes, the way hardware silkscreen actually prints: 9–15px, weight 600–700, letter-spacing 0.14–0.34em, line-height 1. The monospaced numerals carry every number, tabular so counts don't jitter as they tick. All-caps everywhere on the panel.

### Hierarchy
- **Nameplate** (700, 15px, 0.34em tracking, line-height 1, Bone #e8e3d5): The product's own name — "CORDS", the panel's silkscreen.
- **Nameplate Sub** (600, 9px, 0.24em, Dim Ink): "CABLE PATCH SANDBOX" beneath the name.
- **Label** (700, 10px, 0.16em, Legend Ink): Meter legends — CORDS, LINKED.
- **Control Label** (700, 11px, 0.14em, Cap Ink): Button text — NEW CORD, RESET.
- **Hint** (700, 12px, 0.2em, Legend Ink, centered): The empty-scene invitation "PRESS N FOR A NEW CORD"; visible only while no cord exists. The one functional line a first-timer must read, so it prints at the labels' own legibility (10.48:1) — still inside the 9–15px silkscreen scale.
- **Readout Numeral** (600, 13px, tabular-nums, mono, right-aligned, min-width 2.5ch): The exact count beside each meter — amber or jade when non-zero, Dim Ink at zero.
- **Keycap** (600, 10px, mono, centered, min-width 10px): The N and R shortcut chips inside the buttons.
- **In-scene silkscreen** (700, 24px in texture space, `ui-monospace, Menlo, Consolas, monospace`, Silkscreen ID #8f96a0): The painted module numbers 01–08 on each cube's faceplate canvas texture — the 3D world prints in the same mono.

### Named Rules
**The Silkscreen Honesty Rule.** Every printed string names a real state or a real control. Labels never become costume; the empty-scene hint disappears the moment one cord exists, and the meters are aria-hidden because the live-region summary already speaks the counts.

## Layout

One surface: the full-viewport WebGL stage IS the page (no marketing shell, no scroll; `overflow: hidden`, background #111114). All UI lives in a single fixed faceplate strip along the bottom edge.

**The faceplate strip** (`position: fixed; left: 0; right: 0; bottom: 0`): a flex row, vertically centered, gap 24px, padding 13px 28px, background #17191d, closed by a 1px machined top bevel (rgba(255,255,255,0.08)) and two 9px screw heads (::before/::after, #101215 with inset highlight) at both ends. Left to right: nameplate (two stacked lines, row gap 3px) → CORDS readout → LINKED readout → flexible centered hint (flex: 1) → actions. Each readout and the actions block are separated by a module seam: `border-left: 1px solid #0d0f12; padding-left: 24px`. Inner readout gap 11px; actions gap 10px; button internal gap 9px.

**The scene**: camera at (0, 1.45, 4.5) looking at (0, 0.55, 0), 60° fov. Eight 0.5-unit cubes scattered on the bench in authored positions (a stage, not a grid), each sitting on y=0. The floor is a 64×64 plane whose texture repeats every 4 world units as machined panels, half-tile offset so no seam runs under the world origin. Fog (#111114) starts at 8 units and saturates at 26 — the bench dissolves into the void at the horizon line.

**Density and responsiveness**: desktop, mouse, landscape — no breakpoints exist. The strip is the only responsive furniture (full-width fixed); the stage letterboxes via WebGL resize. Mobile/touch is out of scope by product decision.

## Elevation & Depth

Flat machined surfaces with inset bevels; there are no drop shadows anywhere in the system. Depth is conveyed three ways: tonal layering (void #111114 → bench #22252a → faceplate #17191d → unlit slot #232730), physical machining (1px lit bevels on seams and caps, recessed screw heads), and in the 3D world by light — one warm key (DirectionalLight #ffd2a0, intensity 6.0, low angle from (4, 3.2, 3) so cube faces model rather than flatten) over a dim cool hemisphere (#3a4150 sky / #101216 ground, 1.25), ACES tone mapping at exposure 1.45, and fog carrying the floor into distance. No shadow maps — the panel-line floor and fog do that job.

### Shadow Vocabulary (all inset, all machining — never drop shadows)
- **Cap bevel** (`box-shadow: inset 0 1px 0 rgba(255,255,255,0.07)`): The keycap button's top edge at rest — a machined chamfer.
- **Pressed cap** (`box-shadow: inset 0 1px 3px rgba(0,0,0,0.55)`): The button's :active state — the cap sinking into its well.
- **Fastener head** (`box-shadow: inset 0 1px 1px rgba(255,255,255,0.07)` on a 9px #101215 circle with 1px #0a0b0d border): The strip's two screws; the cubes and floor panels paint the same furniture into their textures.
- **Lit segment LED** (`0 0 6px rgba(242,212,58,0.45)` amber / `0 0 6px rgba(47,189,114,0.4)` jade): The one sanctioned glow — a lit LED's bloom, inseparable from its state.

### Named Rules
**The Machined-Edge Rule.** Surfaces are flat; depth is machined (inset bevels, seams, screws) or lit (the key, the fog). No drop shadows, no glass, no gradients, no blur.

## Shapes

Squared hardware geometry with two radii and one family of circles. Meter slots are pure rectangles (9×16px) with 1px borders. Keycap buttons and their key chips are 2px-radius squares. The candy zone on each cube faceplate is the one soft form — a 10px-radius rounded rectangle (128×56 in a 256px texture, roughly half the faceplate width) with a 45%-black keyline, sitting behind the jack. Circles are fasteners: 9px screw heads on the HUD strip, painted 6px screws at the cube faceplate corners, 4px bolts at the floor panels' corners.

In the scene, form follows manufacture: the cord is a 0.03-radius continuous tube (Catmull-Rom smoothed over the sim polyline, parallel-transported frames); the plug is a lathe-turned silhouette (tapered tip → insulator groove → shaft → band → knurled grip → molded strain-relief boot), drawn at hero scale (~0.37 long) so the anatomy reads beside a 0.5 cube; the deny cue is a flat ring (0.075–0.105 radii) laid 0.01 proud of the cube face; shatter shards are tetrahedra (base 0.03, scaled 0.75–1.8; the failing band's shard is the largest piece). Grab proxies are 0.12-radius invisible spheres riding the visible jacks.

## Components

### Faceplate Strip (the only container)
A machined instrument panel: #17191d ground, 1px top bevel, screw heads at both ends, modules separated by #0d0f12 seams. Flex row, gap 24px, padding 13px 28px, Helvetica Neue throughout, user-select disabled. Modules never float free — everything on the page lives on this one strip.

### Segmented Meter Readout (signature)
The tempo-readout grammar: a tracked label ("CORDS" amber row / "LINKED" jade row), a row of 12 squared slots (the approved 12-live-cord operating range), and an exact mono numeral. **One lit segment per live cord; overflow pegs the last segment and the numeral tells the truth** (`litSegments`, `HUD_SEGMENTS = 12`). Unlit slot #232730 / border #0e1013; lit = state ink with its keyline and 6px LED glow. Zero renders its numeral in Dim Ink — zero is an unlit state. Meters are aria-hidden; an sr-only `role="status"` region speaks the sentence ("3 cords, 1 awaiting plug, 2 linked. Press N for a new cord, R to reset.") — and, once per death, LEADS it with the failure's own line: "Cord shattered — unplugged. 2 cords, 1 vanishing. …" (REFINE-1: the live region names why a cord died, exactly once, at the vanish's start).

### Buttons (machined keycaps)
- **Shape:** squared with a 2px radius; 1px #0e1013 border; inset top bevel.
- **Primary (the only variant):** #242930 face, #d9dde4 cap ink, 11px/700/0.14em caps, padding 9px 12px 9px 14px, with an embedded keycap chip (mono, #b6bcc6 on #2c323b, #3d444d border) naming its shortcut (N / R).
- **Hover / Active:** hover lifts to #2b313a; active presses to #1f242b with the inset pressed-cap shadow. State flips are instantaneous — no transitions; hardware doesn't ease.
- **Focus:** a 2px Sulfur Yellow bracket at 3px offset (`:focus-visible`) — the meter LED's own amber, never the browser's default blue ring. 11.95:1.

### Keycap Chip
The physical shortcut legend: mono 10px/600, #b6bcc6 ink on #2c323b, 1px #3d444d border, 2px radius, padding 2px 6px, min-width 10px, centered, aria-hidden.

### Empty-Scene Hint
One silkscreen line — "PRESS N FOR A NEW CORD", 12px/700/0.2em, Legend Ink, centered in the strip's flexible middle — visible only while the bench holds no cords (`visibility` toggled by the `.is-empty` state). It names real state, so it vanishes the moment one exists. REFINE-1: promoted from 10px Dim Ink — the invitation is functional text and must be readable at rest.

### The Phone Plug (in-scene signature, brand commitment)
Every cord ends in two lathe-built 1/4″ plugs, tip → cable: shiny metal tapered tip (Plug Chrome, metalness 1.0, roughness 0.24, environment-lit) → dark insulator groove → metal shaft → **color-coded sleeve band** (Plug Red input / Plug Blue output — REFINE-2: the blue ink is its own deeper cobalt, not the cube zone's) → dark knurled rubber grip (#17181c, roughness 0.88) → color-coded strain-relief boot meeting the cable exactly. Polarity must read instantly at full-frame distance — the pair is albedo-honest paint under the warm key, never an emissive lift (lit = live state; a carried jack is not live). A seated plug renders perpendicular to its cube face; a linked cord's seated plugs lift their band's albedo ×1.5 within its own hue (lit ink, not a glow); a popped cord's failing band blinks dark (#17181c) like a low-battery LED through the grace window's final half (final 1.5s of ~3s), the flicker quickening toward expiry — steady under reduced motion.

### The Cord (in-scene hero)
Dark rubber tube (#2e3138, roughness 0.82) — matte, with a slight sheen under the key. Its states are the system's grammar:
- **Linked** — the chase pulse: a sulfur-amber LED (gain 2.4, gaussian, σ ≈ 5% of cord length) travels red end → blue end at 0.6 traverses per second of sim time, ramping in leaving the red jack and out arriving at the blue one. Emissive on the tube's own PBR surface — no additive blending, no bloom, no halo. Linked is the only state that glows.
- **Stretch ticks** — at ≥ 0.90 tautness (full ink at 0.985) the cord carries thin neutral Tick Ink registration marks, one per rest-length of measured arc, painted into the albedo. They spread with the measured stretch: the cord learning its length. Never red, never emissive; off for linked/counting-down cords.
- **Popped grace** — the tube dims linearly over the ~3s window to a 0.22 opacity floor (the visible countdown; the floor keeps the jack re-grabbable), composing multiplicatively with the vanish fade so expiry never flashes back to full. The failing band blinks through the window's final 1.5s — 3 Hz stepping up to 5 Hz at the window's half, 65% duty (REFINE-1: the countdown signals through half its window and quickens as it dies; previously only the final 1s).
- **Vanishing** — the failing jack shatters: ~18 dark cool-steel tetra shards (per-instance ink #23–#3a channel-varied, seeded deterministic; base 0.03, scaled 0.75–1.8 — REFINE-1's legibility bump, was 14 at 0.02) plus its own band's color shard as the largest piece; ballistic, two floor bounces (restitution 0.4 then 0.22), a friction slide, 0.55s lifetime, scaling out with the cord. Zero glow. The tube then fades as it pulls out.
- **Deny cue** — the soft-cap rejection: one flat Plug Red ring on the denied face, fading over 350ms. A painted mark, not a lamp; a second denial replaces the first.

### Motion Grammar (applies to every component)
All motion is a pure function of sim state + the sim clock (`src/render/pulse.ts`, `src/render/states.ts`): the chase phase is `simTime × speed mod 1` — never wall time, never frame deltas — and the blink keys on the same clock. There are zero CSS transitions, zero keyframes, zero tweens; DOM states flip instantly and the sim owns every moving pixel. A sleeping cord costs zero GPU work (frozen points = no buffer writes).

**Reduced-motion seams** (from `prefers-reduced-motion`): the chase cadence slows ×0.5 (the pulse IS the "linked" signal, so it is never removed); the grace band holds steady (the dim stays — it is state, not motion); the shatter burst is skipped (the despawn/fade sequence runs unchanged); the cursor-brush perturbation is dampened ×0.5.

## Do's and Don'ts

### Do:
- **Do** light a pixel only when the sim justifies it: lit segments = live counts, chase pulse = `linked`, band lift = seated-and-linked, band blink = dying. Everything else stays unlit.
- **Do** print only real state in silkscreen grammar: tracked caps (0.14–0.34em), Legend/Dim inks, mono numerals for every number.
- **Do** compose new panel modules from the strip's furniture: #0d0f12 module seam + 24px padding-left, squared slots, 2px keycaps, screw fasteners.
- **Do** keep candy color tied to state or module identity (the 8-zone roster, amber/jade meters, red/blue polarity), each with its darker keyline (#a98f1d / #1f7a4a / rgba(0,0,0,0.45)).
- **Do** drive every animated read from the sim clock; reuse the existing purity seam (pure function of `(sim state, sim time)`), so determinism tests keep working.
- **Do** honor the reduced-motion seams exactly: slow the pulse ×0.5, hold the blink steady, skip particles, keep the dim.

### Don't:
- **Don't** add decorative glow, bloom, halos, additive blending, or any emissive material outside the chase pulse and lit meter segments.
- **Don't** use drop shadows, glass, blur, or gradients — depth is machined (inset bevels, seams) or lit (the key, fog).
- **Don't** print a label, hint, or number the sim cannot back with live state; don't show the empty hint while a cord exists.
- **Don't** animate with CSS transitions/keyframes, wall-clock tweens, or `Math.random()` — motion that isn't a pure function of the sim clock breaks the determinism contract.
- **Don't** let red mean anything but input polarity / denial, or recolor the stretch ticks — measurement furniture is neutral ink (#b6bcc6), never damage-red.
- **Don't** introduce display type or sentence case on the panel; the voice is all-caps silkscreen at 9–15px with tabular mono numerals.

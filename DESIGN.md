---
name: Cords
description: A reactive cable-patch sandbox staged as an early-80s drum machine panel — machined charcoal steel, candy state zones, and LEDs that only speak live state.
colors:
  # The eight candy zones (src/world/stage.ts's authored roster) — the module pads on the steel faces
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
  # Ground — the machined charcoal panel, dark not black
  stage-void: "#111114"
  bench-charcoal: "#22252a"
  bench-grid-alt: "#232629"
  faceplate-charcoal: "#17191d"
  brushed-steel: "#2a2d31"
  unlit-slot: "#232730"
  machined-seam: "#0e1013"
  # Machined edges — the lit bevel, panel seams, fastener heads, the port inset (depth is machined, never dropped; the painted flat-shade strokes live in .impeccable/design.json extensions.machining)
  machined-bevel: "rgba(255,255,255,0.08)"
  panel-seam: "#0d0f12"
  fastener-ink: "#101215"
  fastener-rim: "#0a0b0d"
  socket-ink: "#101215"
  # Materials in the drawn world
  cord-rubber: "#2e3138"
  cord-rubber-dark: "#262930"
  grip-rubber: "#17181c"
  plug-chrome: "#d6dade"
  plug-chrome-edge: "#8f959d"
  plug-insulator: "#14161a"
  # The debris — dark cool-steel shard inks, channel-varied per instance
  shard-steel-deep: "#23262b"
  shard-steel-dark: "#26292f"
  shard-steel: "#2a2d33"
  shard-steel-bright: "#303339"
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
  key-chip-rim: "#3d444d"
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

Cords is staged as an early-80s hardware instrument faceplate brought to life — drawn flat, as the silkscreen itself would print it. One full-viewport machined charcoal panel in Canvas 2D: a bench of 1.2-unit panel tiles, hairline machining, and corner bolts; eight steel modules bolted on in an authored scatter, each carrying a single candy color zone; and the product's hero object — real 1/4″ phone plugs on dark rubber cords — inked across it as layered strokes. The interface recedes to a silkscreen faceplate strip along the bottom edge: tracked small-caps legends, squared segmented meters, machined keycap buttons. Nothing on the page is costume; every printed word names a real state, and every lit pixel is live state.

The system's core honesty is the **lit = live state only** contract. The panel is unlit hardware — matte rubber ink, steel fills, painted silkscreen — until the simulation says otherwise: a completed link's amber chase pulse traveling the drawn cord, a meter row filling one segment per live cord, a popped jack's band blinking like a dying battery. The same grammar performs failure: over-stretch a cord and the jack shatters into dark steel shards plus shards of its own color band, the cord dims through its grace countdown, and the meters count it down to zero.

Motion is **sim-driven, never scripted** — there are no CSS keyframes and no tweens anywhere in the system. Every animated read (the chase light, the grace blink, the dangle, the settle) is a pure function of the simulation's own clock and state, so the same sim instant always paints the same picture and a frozen sim holds its light still. All values below are extracted from the shipped code: `src/render/renderer.ts` (the painter), `src/render/pulse.ts` and `src/render/states.ts` (the pure laws), `src/world/stage.ts` and `src/world/view.ts` (the world contract), `src/hud/`, and the silkscreen CSS in `index.html`. Captures of the built world: `.impeccable/review/2d2-world.png`, `2d3-pulse.png`, `2d3-states.png`, `2d3-shatter.png`.

**Key Characteristics:**
- A machined charcoal panel — dark, never black; the bench reads as steel through tonal layering (base #22252a over grid alt #232629, void #111114 above the fog falloff).
- Eight candy color zones, each doubling as a state ink (amber = live cords, jade = links, red/blue = plug polarity).
- Silkscreen legends: tracked caps that name real state only; if the sim can't say it, the panel doesn't print it.
- One glow budget: the chase-pulse amber on linked cords and the lit meter segments — nothing else glows, ever.
- Machined depth: 1px bevels, seams, screws, bolts, and the port insets; flat surfaces, no glass, no drop shadows, no decorative gradients.
- Sim-clock motion: deterministic, headless-testable, no keyframes; reduced motion slows or holds effects, never removes live-state meaning.

## Colors

A candy-on-charcoal instrument palette: eight saturated 80s hardware colors reserved for state zones and polarity coding, floating on layered charcoal steel, with gray-blue silkscreen inks for every printed word.

### Primary
- **Sulfur Yellow** (#f2d43a): The system's live-state ink. The lit CORDS meter segments and their numerals, the chase pulse's amber LED traveling a linked cord, and the visible focus bracket. It is the panel's only sanctioned glow color.
- **Jade** (#2fbd72): The linked-state ink. The lit LINKED meter segments and numerals — green means the connection is complete and pulsing. REFINE-2: cooled from #58c470 (HSV hue 133° → 148°, saturation 0.55 → 0.75, deeper L) because the old yellow-green read amber-warm beside the CORDS amber at meter scale — the two rows now differ by hue (~100°) AND depth (jade renders ~40% the amber's luminance). 7.24:1 on the panel.

### Secondary
- **Plug Red** (#c22e26): Input polarity — the red jack's sleeve band and strain-relief boot — and the soft-cap deny ring painted on a rejected module edge. A deeper red than the module zone (Signal Red) so the band reads as hardware ink, not zone paint, even with the zone's color behind it.
- **Plug Blue** (#2e58de): Output polarity — the blue jack's band, boot, and band shard. A deeper cobalt than the module zone (the blue twin of Plug Red's rule, REFINE-2): the zone-shared #4a7df2 read as desaturated slate at full-frame distance in v1, while this ink classifies at hue ~223°/sat 0.64–0.88 in situ, at matched lightness to Plug Red (OKLCH L 51.7 vs 53.6 — the polarity pair differentiates by hue alone).
- **Cobalt** (#4a7df2): Module 06's candy zone.
- **Signal Red** (#e8433f): Module 01's candy zone.

### Tertiary (the candy zone roster — one per module, roster order 01–08)
- **Signal Red** (#e8433f), **Tangerine** (#f2903a), **Sulfur Yellow** (#f2d43a), **Jade** (#2fbd72), **Reef Cyan** (#3ec8d8), **Cobalt** (#4a7df2), **Magenta** (#d857c8), **Bone** (#e8e3d5). Flat rounded-rect fills with a darker keyline (rgba(0,0,0,0.45)) on each module's steel face, behind the jack; Bone doubles as the nameplate ink ("CORDS").

### Neutral
- **Stage Void** (#111114): The page background and the fog falloff's color — the room above the panel, which the top of the stage dissolves into.
- **Bench Charcoal** (#22252a): The panel ground — the machined bench the modules bolt onto; tonal steel, not black.
- **Bench Grid Alt** (#232629): The alternate tile tone of the bench's 1.2-unit panel grid — the quiet checker that makes the ground read as tiled steel plate.
- **Faceplate Charcoal** (#17191d): The HUD strip's machined panel.
- **Brushed Steel** (#2a2d31): The modules' steel bodies under the candy zones.
- **Unlit Slot** (#232730): A meter segment at rest — recessed, honest, waiting.
- **Machined Seam** (#0e1013): Segment and keycap borders, and the module body's 1px border; its darker twin **Panel Seam** (#0d0f12) closes the strip's modules, the bench's panel tiles, and the floor line's front face.
- **Cord Rubber** (#2e3138): The cord's body stroke — dark matte rubber ink.
- **Cord Rubber Dark** (#262930): The cord's wide under-stroke — the layer beneath the body that gives the inked line its round, sleeved read.
- **Grip Rubber** (#17181c): The plug's knurled sleeve grip; also the popped band's blinked-off "unlit plastic" ink.
- **Plug Chrome** (#d6dade): The jack's drawn metal tip and shaft — flat bright ink, closed by its edge stroke and shaded underneath so it reads machined, not white.
- **Plug Chrome Edge** (#8f959d): The 1px edge stroke around the chrome tip — the machined chamfer that keeps bright metal forms crisp against dark steel.
- **Plug Insulator** (#14161a): The near-black groove separating tip from shaft — the turned parting line, printed.
- **Machined Bevel** (rgba(255,255,255,0.08)): The 1px lit bevel — the HUD strip's top edge, each module's top edge, and the bench edge above the floor line. A stroke or border, never a shadow (REFINE-5: tokenized from the shipped CSS).
- **Fastener Ink / Fastener Rim** (#101215 / #0a0b0d): The screw heads holding the HUD strip, the four corner screws on every module, the corner bolts at the bench grid's seam intersections, and each head's 1px machined rim.
- **Socket Ink** (#101215): The machined port inset on a module edge — the dark slot a seated plug's tip crosses into (same value as Fastener Ink; its own role).
- **Shard Steel Deep / Dark / Base / Bright** (#23262b / #26292f / #2a2d33 / #303339): The debris shards' dark cool-steel inks, channel-varied per instance for a scattered-metal read; the family's fourth member is Cord Rubber (#2e3138). All five ride the shatter pool's seeded per-slot ink index.

### Ink neutrals (all silkscreen)
- **Legend Ink** (#c3c8d1): Meter labels ("CORDS", "LINKED") and the empty-scene hint — 10.48:1 on the faceplate.
- **Dim Ink** (#9aa0ab): Zeroed numerals and the subtitle — unlit state (6.70:1).
- **Tick Ink** (#b6bcc6): The stretch ticks' neutral registration marks on a taut cord (measurement, never red); also the keycap chip ink (6.76:1 on its chip).
- **Silkscreen ID** (#8f96a0): The painted module numbers 01–08 on the modules' steel faces.

### Named Rules
**The One Glow Rule.** Glow exists only where live state lives: the chase-pulse amber on a linked cord, the lit meter segments, and the focus bracket (the meter LED's own amber). Everything else stays paint or machining. A decorative glow is a bug.

**The State-Ink Rule.** Every saturated color names a live state: amber = cords alive, jade = links, red/blue = plug polarity, candy zones = the modules' identities. Saturated color is never used for mood, section, or filler.

## Typography

**Display/Body Font:** "Helvetica Neue", Helvetica, Arial, sans-serif — the whole silkscreen system; there is no display face.
**Label/Mono Font:** ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace — numerals, keycaps, and the in-scene module ids.

**Character:** Narrow-tracked heavy caps at tiny sizes, the way hardware silkscreen actually prints: 9–15px, weight 600–700, letter-spacing 0.14–0.34em, line-height 1. The monospaced numerals carry every number, tabular so counts don't jitter as they tick. All-caps everywhere on the panel.

### Hierarchy
- **Nameplate** (700, 15px, 0.34em tracking, line-height 1, Bone #e8e3d5): The product's own name — "CORDS", the panel's silkscreen.
- **Nameplate Sub** (600, 9px, 0.24em, Dim Ink): "CABLE PATCH SANDBOX" beneath the name. The panel's smallest print is a deliberate type role, not an oversight: the subtitle is identification, not instruction — when REFINE-1 promoted the page's one functional whisper (the empty-scene hint) to 12px Legend Ink, the sub stayed at the genre's 9px floor (Dim Ink 6.70:1).
- **Label** (700, 10px, 0.16em, Legend Ink): Meter legends — CORDS, LINKED.
- **Control Label** (700, 11px, 0.14em, Cap Ink): Button text — NEW CORD, RESET.
- **Hint** (700, 12px, 0.2em, Legend Ink, centered): The empty-scene invitation "PRESS N FOR A NEW CORD"; visible only while no cord exists. The one functional line a first-timer must read, so it prints at the labels' own legibility (10.48:1) — still inside the 9–15px silkscreen scale.
- **Readout Numeral** (600, 13px, tabular-nums, mono, right-aligned, min-width 2.5ch): The exact count beside each meter — amber or jade when non-zero, Dim Ink at zero.
- **Keycap** (600, 10px, mono, centered, min-width 10px): The N and R shortcut chips inside the buttons.
- **In-scene silkscreen** (700, 11px screen-space, `ui-monospace, "SF Mono", Menlo, Consolas, monospace` at 0.1em tracking, Silkscreen ID #8f96a0): The painted module numbers 01–08 on each module's steel face — the canvas world prints in the same mono as the HUD numerals.

### Named Rules
**The Silkscreen Honesty Rule.** Every printed string names a real state or a real control. Labels never become costume; the empty-scene hint disappears the moment one cord exists, and the meters are aria-hidden because the live-region summary already speaks the counts.

## Layout

One surface: the full-viewport Canvas 2D stage IS the page (no marketing shell, no scroll; `overflow: hidden`, background #111114). All DOM UI lives in a single fixed faceplate strip along the bottom edge.

**The view law** (`src/world/view.ts`): world x runs right, y runs up; the floor line (y = 0) sits a fixed 72px above the canvas bottom; the scale fits so the stage always shows 9.2 × 4.4 world units (the tighter axis fits, the other crops). Resize rebuilds the view — the cached panel, the picking math, and the painter all read the same numbers, so a pixel picked is always the pixel painted.

**The bench** (cached, repainted only on resize): Bench Charcoal ground; machined panel tiles every 1.2 world units in a half-tile-offset checker (Bench Charcoal / Bench Grid Alt) with 1px Panel Seam strokes; 0.3-unit machining hairlines (rgba(0,0,0,0.14)); corner bolts at the seam intersections (Fastener Ink heads, Fastener Rim borders, inset highlights). At the floor line the bench closes: a 1px Machined Bevel above, a 2px Panel Seam below, and the strip underneath darkened (rgba(0,0,0,0.22)) — the panel's front face. Over the top 32% of the stage, the fog falloff (a linear gradient from Stage Void to transparent) dissolves the bench into the room — v1's distance fog, translated flat.

**The modules** (`src/world/stage.ts`): eight 0.66 × 0.5-unit steel rectangles in authored positions — a stage, not a grid — spanning x −3.1…3.08 at varied heights (y 1.42–2.04) so neighboring tops sit inside one cord's reach while farthest pairs don't. Each carries its candy zone (rounded rect, 62% × 42% of the face, ~8px radius, rgba(0,0,0,0.45) keyline) and its silkscreen id top-left. Modules drag (translate); RESET returns them home.

**The opening composition (REFINE-3)**: the first frame stages the toy's core verb already performed once — one patch cord with its RED end seated on module 08's top edge through the real production seat path (pickable, grabbable, un-pluggable, transport-riding), the cord draped down onto the bench, and the BLUE end resting below, one grab away from completing a link. No cord in the world ever hangs from anything invisible.

**Density and responsiveness**: desktop, mouse, landscape — no breakpoints exist. The strip is fixed full-width; the stage refits by the view law. Mobile/touch is out of scope by product decision.

## Elevation & Depth

Flat machined surfaces with inset bevels; there are no drop shadows anywhere in the system. Depth is conveyed three ways: tonal layering (void #111114 → bench #22252a / grid alt #232629 → faceplate #17191d → unlit slot #232730), physical machining (1px lit bevels on seams, module edges, and caps; recessed screw heads, corner bolts, and the port insets), and painted light — the fog falloff at the stage's top, the cord's sheen stroke, the chrome's underside shade: v1's warm key and hemisphere translated into flat ink reads the painter composes in one pass. No blur, no filters.

### Shadow Vocabulary (all inset, all machining — never drop shadows)
- **Cap bevel** (`box-shadow: inset 0 1px 0 rgba(255,255,255,0.07)`): The keycap button's top edge at rest — a machined chamfer.
- **Pressed cap** (`box-shadow: inset 0 1px 3px rgba(0,0,0,0.55)`): The button's :active state — the cap sinking into its well.
- **Fastener head** (`box-shadow: inset 0 1px 1px rgba(255,255,255,0.07)` on a 9px #101215 circle with 1px #0a0b0d border): The strip's two screws; the canvas world paints the same furniture onto the modules' corner screws and the bench grid's corner bolts.
- **Lit segment LED** (`0 0 6px rgba(242,212,58,0.45)` amber / `0 0 6px rgba(47,189,114,0.4)` jade): The one sanctioned glow — a lit LED's bloom, inseparable from its state.

### Painted Machining Vocabulary (the canvas world's flat shading — strokes, not shadows)
The painter's shading is 1px strokes and half-fills over flat inks (each named with its exact value in `.impeccable/design.json` `extensions.machining`): the panel grid's hairlines (rgba(0,0,0,0.14)); the bolt-head highlights (rgba(255,255,255,0.06)); the machined underside shade — the bench's front face and the chrome tip/shaft's lower half (rgba(0,0,0,0.22)); the module's bottom-edge shade (rgba(0,0,0,0.4)); the cord's sheen stroke and the socket's bevel (rgba(255,255,255,0.07)); the boot's underside (rgba(0,0,0,0.18)); the grip's knurl flutes (rgba(255,255,255,0.05)); the candy-zone and polarity keyline (rgba(0,0,0,0.45)); and the fog falloff itself.

### Named Rules
**The Machined-Edge Rule.** Surfaces are flat; depth is machined (inset bevels, seams, screws, bolts, port insets) or painted (the fog falloff, the sheen and underside strokes). No drop shadows, no glass, no blur, no decorative gradients — the fog falloff at the stage's top is the one atmospheric gradient, and it is the room, not a surface.

## Shapes

Squared hardware geometry with two DOM radii and one family of circles, plus the drawn world's own manufactured silhouettes. Meter slots are pure rectangles (9×16px) with 1px borders. Keycap buttons and their key chips are 2px-radius squares. The candy zone on each module face is the one soft form — a rounded rectangle (~8px radius, 62% × 42% of the module) with a 45%-black keyline, sitting behind the jack. Circles are fasteners: 9px screw heads on the HUD strip, ~4.4px corner screws inset 6.5px on each module, 5px corner bolts at the bench grid's seam intersections.

In the drawn world, form follows manufacture, printed at hero scale: the module is a 5px-radius steel rectangle with a 1px machined border, lit top bevel, shaded bottom edge, and four corner screws; the cord is a smooth curve through the sim's own 25 points, inked in three layered strokes (under-stroke 0.08 world units, body 0.066, sheen 0.02; round caps and joins); the plug is the lathe silhouette drawn in 2D (0.415 units long, tip to boot — see The Phone Plug below); the deny cue is a flat stroked ring (0.075 inner radius growing to 0.105 over its fade); shatter shards are dark-steel triangles (base 0.03 world units, scaled 0.75–1.8) plus the failing band's flat color chip (0.052 × 0.02, the largest piece).

## Components

### Faceplate Strip (the only container)
A machined instrument panel: #17191d ground, 1px top bevel, screw heads at both ends, modules separated by #0d0f12 seams. Flex row, gap 24px, padding 13px 28px, Helvetica Neue throughout, user-select disabled. Modules never float free — everything in the DOM lives on this one strip.

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
Every cord ends in two drawn 1/4″ plugs, tip → cable, at hero scale (0.415 world units long — the anatomy reads beside a 0.66-unit module): shiny metal tapered tip (Plug Chrome, widening 0.007 → 0.031 half-width, closed by the Plug Chrome Edge stroke and shaded underneath) → dark insulator groove (Plug Insulator) → metal shaft → **color-coded sleeve band** (Plug Red input / Plug Blue output — REFINE-2: the blue ink is its own deeper cobalt, not the module zone's; a wide 0.042-half-width collar, keylined) → dark knurled rubber grip (Grip Rubber, 0.05 half-width, four knurl flutes) → color-coded strain-relief boot tapering to the cable exactly. Polarity must read instantly at full-frame distance — the pair is honest paint, never a glow (lit = live state; a carried jack is not live). A seated plug renders perpendicular to its module edge, its tip crossing into the machined port inset (Socket Ink) 0.082 units inside the perimeter; a linked cord's seated plugs lift their band ×1.5 within its own hue (lit ink, not a glow); a popped cord's failing band blinks dark (Grip Rubber) like a low-battery LED through the grace window's final half (final 1.5s of ~3s), the flicker quickening toward expiry — steady under reduced motion.

### The Cord (in-scene hero)
Dark rubber inked in three layers (under-stroke Cord Rubber Dark, body Cord Rubber, sheen) through the sim's own points. Its states are the system's grammar:
- **Linked** — the chase pulse: a sulfur-amber LED segment (Sulfur Yellow) overdrawn on the drawn curve, traveling red end → blue end at 0.6 traverses per second of sim time, half-width σ ≈ 5% of the measured arc, its alpha ramping over the first/last 12% of the road. An ink stroke on the cord's own line — no halo, no blur, no bloom. Linked is the only state that glows.
- **Stretch ticks** — at ≥ 0.90 tautness (full ink at 0.985) the cord carries thin neutral Tick Ink registration marks, one per 0.1-unit rest length of measured arc, perpendicular to the local tangent. They spread with the measured stretch: the cord learning its length. Never red, never a glow; state-gated to carried/awaiting-plug cords only.
- **Popped grace** — the cord dims linearly over the ~3s window to a 0.22 opacity floor (the visible countdown; the floor keeps the jack re-grabbable), composing multiplicatively with the vanish fade so expiry never flashes back to full. The failing band blinks through the window's final 1.5s — 3 Hz stepping up to 5 Hz toward expiry, 65% duty (REFINE-1: the countdown signals through half its window and quickens as it dies).
- **Vanishing** — the failing jack shatters: 18 dark cool-steel triangle shards (the Shard Steel inks + Cord Rubber, seeded deterministic per slot; base 0.03, scaled 0.75–1.8) plus two shards of its own band's color (the largest piece leads) — ballistic (gravity 9 u/s²), two floor bounces (restitution 0.4 then 0.22), a friction slide, 0.55s lifetime, scaling out over the final 35%, integrated on the sim clock's own 1/120 grid. Zero glow. The jack's drawing despawns into the debris; the cord then fades as it pulls out.
- **Abandoned decay** (REFINE-4 — PRODUCT.md's "self-clean when abandoned") — an untouched dropped coil self-cleans after a quiet ~10s sim-time idle window: no dim, no blink, nothing painted (clutter carries no urgency; the popped grace's ~3s countdown is the urgent one), and grabbing the coil cancels the timer instantly. The exit is the SAME Vanishing grammar, tuned for a grounded entry: the red jack's shard burst marks the decay where it lies, the body collapse-pulls in on itself and fades — the coil powering down, not failing. The live summary names it in its own words ("Cord put away.", never the shattered line).
- **Deny cue** — the soft-cap rejection: one flat Plug Red stroked ring on the denied module edge, 0.075 → 0.105 radius over a 350ms sim-time fade. A painted mark, not a lamp; a second denial replaces the first.

### Motion Grammar (applies to every component)
All motion is a pure function of sim state + the sim clock (`src/render/pulse.ts`, `src/render/states.ts`): the chase phase is `simTime × speed mod 1` — never wall time, never frame deltas — and the blink keys on the same clock. There are zero CSS transitions, zero keyframes, zero tweens; DOM states flip instantly and the sim owns every moving pixel. The painter allocates nothing per frame (pooled screen points, a cached panel, a pooled shard pool); a hidden page pauses sim and paint exactly — the frame gate — and the first frame back draws with delta zero, so no backlog is ever burned (Canvas 2D defines no context-loss event; the gate's counters are the resilience probe, and resize rebuilds the context surface).

**Reduced-motion seams** (from `prefers-reduced-motion`): the chase cadence slows ×0.5 (the pulse IS the "linked" signal, so it is never removed); the grace band holds steady (the dim stays — it is state, not motion); the shatter burst is skipped (the despawn/fade sequence runs unchanged — REFINE-4's abandoned decay rides this same seam: no fragment burst on the grounded decay, the fade holds); the cursor-brush perturbation is dampened ×0.5.

## Do's and Don'ts

### Do:
- **Do** light a pixel only when the sim justifies it: lit segments = live counts, chase pulse = `linked`, band lift = seated-and-linked, band blink = dying. Everything else stays unlit.
- **Do** print only real state in silkscreen grammar: tracked caps (0.14–0.34em), Legend/Dim inks, mono numerals for every number.
- **Do** compose new panel modules from the strip's furniture: #0d0f12 module seam + 24px padding-left, squared slots, 2px keycaps, screw fasteners.
- **Do** keep candy color tied to state or module identity (the 8-zone roster, amber/jade meters, red/blue polarity), each with its darker keyline (#a98f1d / #1f7a4a / rgba(0,0,0,0.45)).
- **Do** drive every animated read from the sim clock; reuse the purity seam (pure function of `(sim state, sim time)` in `states.ts`/`pulse.ts`, painted in `renderer.ts`), so determinism tests keep working.
- **Do** honor the reduced-motion seams exactly: slow the pulse ×0.5, hold the blink steady, skip particles, keep the dim.

### Don't:
- **Don't** add decorative glow, halos, blur, or shadow effects outside the chase pulse and lit meter segments — the canvas painter carries no glow primitive, and it stays that way.
- **Don't** use drop shadows, glass, blur, or decorative gradients — depth is machined or painted (see Elevation & Depth); the fog falloff is the one exception, and it is atmosphere, not surface.
- **Don't** print a label, hint, or number the sim cannot back with live state; don't show the empty hint while a cord exists.
- **Don't** animate with CSS transitions/keyframes, wall-clock tweens, or unseeded randomness — motion and debris that aren't pure functions of the sim clock break the determinism contract.
- **Don't** let red mean anything but input polarity / denial, or recolor the stretch ticks — measurement furniture is neutral ink (#b6bcc6), never damage-red.
- **Don't** introduce display type or sentence case on the panel; the voice is all-caps silkscreen at 9–15px with tabular mono numerals.

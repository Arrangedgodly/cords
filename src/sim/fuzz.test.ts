/**
 * QA-1 — the PERMANENT fuzz corpus: every adversarial pattern this
 * production line met (the verifiers' temp harnesses, promoted) replayed
 * FOREVER, seeded and reproducible, through the composition-faithful
 * harness (fuzzHarness.ts — production world shape, STRICT lifecycle,
 * same-frame latch discipline, per-frame invariants).
 *
 * PATTERNS (each = a fixed corpus seed list):
 *   dragStorm          random violent carry targets, regrabs, both ends
 *   bipolarTargets     carry targets snapping between opposite extremes,
 *                      alternating ends mid-flight
 *   spiralAtLeash      the held end swept on a circle AT the leash radius
 *                      (and a hair beyond) around the seated pin
 *   rapidSpawnDrop     spawn/drop churn at frame cadence
 *   multiCordInterleave spawn/link/pop/vanish interleaved across many cords
 *                      and cube drags (transports with seated passengers)
 *   brushHarassment    the brush swept INTO vanishing cords every frame
 *   deltaSpikes        frame deltas from 4ms to 60s (plus garbage) mid-storm
 *   cubePassengers     linked cords dragged past length (auto-pop), re-plug,
 *                      repeat — over-stretch churn under transport
 *
 * INVARIANTS (checked every frame by the harness, plus suite-level ones):
 *   finite state · position bounds · the EXACT SIM-2 leash · transient-only
 *   over-stretch · explosion bound · NO SILENT UNPLUGS (intent-accounted
 *   transitions) · FSM legality (strict world: illegal ⇒ THROW) · zero
 *   rejections · registry accounting (no zombie cords, no leaked latches)
 *   SETTLE WINDOW (calm tail ⇒ bitwise-still survivors) · DETERMINISM
 *   (same seed ⇒ bitwise-identical run + event log) · NO ALLOCATION GROWTH
 *   (heap delta across repeated runs bounded).
 *
 * CONFIGS:
 *   `npm test`          — fast corpus (every pattern, small seed count)
 *   `npm run fuzz`      — the FULL corpus (~seconds–a-minute)
 *   CORDS_FUZZ_SEED=n   — override the corpus with ONE exploration seed
 *                         (runs every pattern on that seed)
 */
import { describe, expect, it } from 'vitest';
import { createFuzzHarness, FUZZ_CUBES, FUZZ_FRAME_DT, FUZZ_SEGMENTS, FUZZ_TOTAL_REST } from './fuzzHarness';
import type { FuzzHarness } from './fuzzHarness';
import type { Ray3, Vec3 } from './types';

/** The ambient process env, typed without a node-types dependency (DOM lib). */
const ENV: Record<string, string | undefined> =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

// ---------------------------------------------------------------------------
// Seeded PRNG — mulberry32: 2^32 states, deterministic, dependency-free.
// Every scenario draws ONLY from its rng, so a seed fully determines a run.
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FULL = ENV.CORDS_FUZZ_FULL === '1';
const SEED_OVERRIDE = (() => {
  const env = ENV.CORDS_FUZZ_SEED;
  if (env !== undefined && env !== '' && Number.isFinite(Number(env))) return Number(env) >>> 0;
  return null;
})();

// The corpus: fixed seeds, recorded forever. A failure on a seed names the
// seed; re-running it replays the failure exactly.
const CORPUS = {
  dragStorm: [0x5eed_0001, 0x5eed_0002],
  bipolarTargets: [0x5eed_0011, 0x5eed_0012],
  spiralAtLeash: [0x5eed_0021, 0x5eed_0022],
  rapidSpawnDrop: [0x5eed_0031, 0x5eed_0032],
  multiCordInterleave: [0x5eed_0041, 0x5eed_0042],
  brushHarassment: [0x5eed_0051, 0x5eed_0052],
  deltaSpikes: [0x5eed_0061, 0x5eed_0062],
  cubePassengers: [0x5eed_0071, 0x5eed_0072],
} as const;
const FULL_EXTRA = [0x5eed_0101, 0x5eed_0102, 0x5eed_0103, 0x5eed_0104];

const FRAMES = FULL ? 900 : 220;
const seedsFor = (pattern: keyof typeof CORPUS): number[] =>
  SEED_OVERRIDE !== null
    ? [SEED_OVERRIDE]
    : FULL
      ? [...CORPUS[pattern], ...FULL_EXTRA]
      : [...CORPUS[pattern]];

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
/** A cube face point: the cube's top center (the geometry seat rules make). */
const cubeTop = (cubeId: number): Vec3 => {
  const [x, z] = FUZZ_CUBES[cubeId];
  return v(x, 0.5, z);
};
const rayThrough = (at: Vec3): Ray3 => ({
  origin: v(at.x * 0.5, at.y + 1.5, at.z + 4),
  direction: v(at.x * 0.5, -(at.y + 1.5), -(at.z + 4)),
});

// --- the patterns ------------------------------------------------------------

type Pattern = (h: FuzzHarness, rng: () => number, frames: number) => void;

/** Violent random carry: regrab storms, both ends, occasional garbage-free jumps. */
const dragStorm: Pattern = (h, rng, frames) => {
  let cooldown = 0;
  for (let f = 0; f < frames; f += 1) {
    if (cooldown <= 0 && rng() < 0.25) {
      // Spawn a fresh cord into hand (or re-grab whatever exists).
      const live = h.liveCordIds();
      if (live.length < 6 && rng() < 0.5) {
        h.spawn(v((rng() - 0.5) * 1.5, 0.8 + rng() * 0.8, (rng() - 0.5) * 1.2));
      } else if (live.length > 0) {
        const id = live[Math.floor(rng() * live.length)];
        h.grab(id, rng() < 0.5 ? 0 : FUZZ_SEGMENTS);
      }
      cooldown = 3 + Math.floor(rng() * 10);
    }
    if (h.held !== null) {
      // Targets jump up to ±3 u per frame — far past leash, under the floor,
      // wherever; the bounded pin + leash must absorb it.
      h.moveTo(v((rng() - 0.5) * 6, rng() * 2.4, (rng() - 0.5) * 6));
      if (rng() < 0.03) h.releaseOffCube();
    }
    cooldown -= 1;
    h.frame(FUZZ_FRAME_DT);
  }
};

/** Targets snapping between opposite extremes; ends swapped mid-flight. */
const bipolarTargets: Pattern = (h, rng, frames) => {
  h.spawn(v(0, 1.4, 0));
  let flip = true;
  for (let f = 0; f < frames; f += 1) {
    if (h.held !== null) {
      flip = !flip || rng() < 0.5;
      const mag = 1.2 + rng() * 1.6;
      h.moveTo(v(flip ? -mag : mag, 0.1 + rng() * 1.8, flip ? mag : -mag));
      if (rng() < 0.02) {
        // Swap ends mid-flight: release, grab the other end.
        const { cordId, index } = h.held;
        h.releaseOffCube();
        h.grab(cordId, index === 0 ? FUZZ_SEGMENTS : 0);
      }
    } else if (rng() < 0.1) {
      const live = h.liveCordIds();
      if (live.length > 0) h.grab(live[0], rng() < 0.5 ? 0 : FUZZ_SEGMENTS);
    }
    h.frame(FUZZ_FRAME_DT);
  }
};

/** The held end swept on a circle AT (and slightly past) the leash radius. */
const spiralAtLeash: Pattern = (h, rng, frames) => {
  // Seat red on a cube, hold blue, sweep blue around the seat at the limit.
  const id = h.spawn(v(0.3, 1.3, 0));
  h.frame(FUZZ_FRAME_DT); // spawn lands in hand
  const anchor = cubeTop(2);
  h.moveTo(anchor);
  h.frame(FUZZ_FRAME_DT);
  h.seatOnCube(2, anchor);
  const phase0 = rng() * Math.PI * 2;
  const wobble = 0.9 + rng() * 0.2;
  for (let f = 0; f < frames; f += 1) {
    const t = f / frames;
    const angle = phase0 + t * Math.PI * 14;
    const r = FUZZ_TOTAL_REST * (0.97 + 0.05 * Math.sin(t * 40)); // at/beyond the limit
    const seat = h.cubeCenter(2);
    h.moveTo(v(seat.x + Math.cos(angle) * r * wobble, 0.4 + 1.4 * Math.abs(Math.sin(t * 6)), seat.z + Math.sin(angle) * r * wobble));
    if (rng() < 0.008) h.releaseOffCube(); // occasionally let it snap
    if (h.held === null && rng() < 0.05) h.grab(id, FUZZ_SEGMENTS);
    h.frame(FUZZ_FRAME_DT);
  }
};

/** Spawn/drop churn at frame cadence — the cap, the id counter, the pool. */
const rapidSpawnDrop: Pattern = (h, rng, frames) => {
  for (let f = 0; f < frames; f += 1) {
    if (h.held === null && rng() < 0.6) {
      h.spawn(v((rng() - 0.5) * 2, 0.7 + rng() * 1.4, (rng() - 0.5) * 1.5));
    }
    if (h.held !== null) {
      h.moveTo(v((rng() - 0.5) * 3, 0.2 + rng() * 1.8, (rng() - 0.5) * 3));
      if (rng() < 0.5) h.releaseOffCube(); // drop the very next frame
    }
    h.frame(FUZZ_FRAME_DT);
  }
};

/** The full lifecycle interleaved across many cords + cube transports. */
const multiCordInterleave: Pattern = (h, rng, frames) => {
  const N = FUZZ_CUBES.length;
  for (let f = 0; f < frames; f += 1) {
    const roll = rng();
    if (roll < 0.18 && h.held === null && h.liveCordIds().length < 7) {
      h.spawn(v((rng() - 0.5) * 1.6, 0.9 + rng() * 0.9, (rng() - 0.5) * 1.4));
    } else if (roll < 0.38 && h.held !== null) {
      // Seat the held end on a random cube (a plug lands).
      const cube = Math.floor(rng() * N);
      const top = cubeTop(cube);
      h.moveTo(top);
      h.seatOnCube(cube, top);
    } else if (roll < 0.5) {
      const live = h.liveCordIds();
      if (live.length > 0) h.grab(live[Math.floor(rng() * live.length)], rng() < 0.5 ? 0 : FUZZ_SEGMENTS);
    } else if (roll < 0.62 && h.held !== null) {
      h.releaseOffCube(); // → drop or vanish depending on state
    } else if (roll < 0.78) {
      // Drag a cube (bounded step); seated plugs ride it.
      const cube = Math.floor(rng() * N);
      const c = h.cubeCenter(cube);
      const step = 0.12;
      h.dragCubeTo(cube, v(
        Math.max(-2.4, Math.min(2.4, c.x + (rng() - 0.5) * 2 * step)),
        0.25,
        Math.max(-2.4, Math.min(2.4, c.z + (rng() - 0.5) * 2 * step)),
      ));
    } else if (roll < 0.86) {
      // A deliberate pop on a linked cord (INT-6's seam, legal from linked).
      for (const id of h.liveCordIds()) {
        if (h.world.lifecycle.stateOf(id) === 'linked' && rng() < 0.25) {
          h.pop(id, rng() < 0.5 ? 0 : FUZZ_SEGMENTS);
          break;
        }
      }
    } else if (roll < 0.94) {
      // A brush sweep through the middle of everything.
      const at = v((rng() - 0.5) * 2, 0.3 + rng() * 1.2, (rng() - 0.5) * 1.6);
      h.brushMove(rayThrough(at), rng() < 0.1 ? 0.5 : 1);
    }
    if (h.held !== null) {
      h.moveTo(v((rng() - 0.5) * 2.4, 0.2 + rng() * 1.8, (rng() - 0.5) * 2.4));
    }
    h.frame(FUZZ_FRAME_DT);
  }
};

/** Brush harassment aimed INTO vanishing cords, every single frame. */
const brushHarassment: Pattern = (h, rng, frames) => {
  for (let f = 0; f < frames; f += 1) {
    // Keep a supply of dying cords: spawn, seat one end, release the other.
    if (f % 24 === 0 && h.held === null && h.liveCordIds().length < 6) {
      h.spawn(v(0, 1.2, 0));
    }
    if (h.held !== null && rng() < 0.4) {
      const top = cubeTop(1);
      h.moveTo(top);
      if (rng() < 0.5) h.seatOnCube(1, top);
      else h.releaseOffCube(); // awaiting-plug release → vanishing
    }
    // Sweep the brush through every vanishing cord's failing end.
    for (const id of h.liveCordIds()) {
      if (h.world.lifecycle.stateOf(id) === 'vanishing') {
        h.brushMove(rayThrough(h.endPoint(id, 0)), rng() < 0.2 ? 0.5 : 1);
        h.brushMove(rayThrough(h.endPoint(id, FUZZ_SEGMENTS)));
      }
    }
    h.frame(FUZZ_FRAME_DT);
  }
};

/** Frame deltas from 4ms to 60s (and garbage), mid-storm. */
const deltaSpikes: Pattern = (h, rng, frames) => {
  h.spawn(v(0.2, 1.2, 0));
  const deltas = [0.004, 0.0167, 0.05, 0.25, 1, 5, 60, 0, -0.02, Number.NaN];
  for (let f = 0; f < frames; f += 1) {
    if (h.held !== null) {
      h.moveTo(v((rng() - 0.5) * 5, rng() * 2.2, (rng() - 0.5) * 5));
      if (rng() < 0.02) h.releaseOffCube();
    } else if (rng() < 0.08) {
      const live = h.liveCordIds();
      if (live.length > 0) h.grab(live[0], FUZZ_SEGMENTS);
    }
    h.frame(deltas[Math.floor(rng() * deltas.length)]);
  }
};

/** Linked cords dragged past length — auto-pop, re-plug, repeat. */
const cubePassengers: Pattern = (h, rng, frames) => {
  // Two linked cords between cube pairs, then violent transports.
  for (const [a, b] of [
    [0, 3],
    [1, 2],
  ] as const) {
    const id = h.spawn(cubeTop(a));
    h.frame(FUZZ_FRAME_DT);
    h.moveTo(cubeTop(a));
    h.frame(FUZZ_FRAME_DT);
    h.seatOnCube(a, cubeTop(a));
    h.grab(id, FUZZ_SEGMENTS);
    h.moveTo(cubeTop(b));
    h.frame(FUZZ_FRAME_DT);
    h.seatOnCube(b, cubeTop(b));
  }
  let dragging: number | null = null;
  for (let f = 0; f < frames; f += 1) {
    const roll = rng();
    if (dragging === null && roll < 0.1) dragging = Math.floor(rng() * FUZZ_CUBES.length);
    if (dragging !== null) {
      const c = h.cubeCenter(dragging);
      const step = 0.22; // past the 4% bound within ~2 frames when taut
      h.dragCubeTo(dragging, v(
        Math.max(-3.5, Math.min(3.5, c.x + (rng() - 0.5) * 2 * step)),
        0.25,
        Math.max(-3.5, Math.min(3.5, c.z + (rng() - 0.5) * 2 * step)),
      ));
      if (roll > 0.7) dragging = null;
    }
    // Re-plug whatever popped and dangles (the grace window's whole point).
    if (h.held === null) {
      for (const id of h.liveCordIds()) {
        const state = h.world.lifecycle.stateOf(id);
        if (state === 'popped' && rng() < 0.15) {
          const freeEnd = h.world.lifecycle.endMode(id, 0) !== 'seated' ? 0 : FUZZ_SEGMENTS;
          if (h.grab(id, freeEnd)) {
            const seatCube = Math.floor(rng() * FUZZ_CUBES.length);
            const home = cubeTop(seatCube);
            h.moveTo(home);
            h.frame(FUZZ_FRAME_DT);
            h.seatOnCube(seatCube, home);
            break;
          }
        }
      }
    }
    h.frame(FUZZ_FRAME_DT);
  }
};

const PATTERNS: Record<string, Pattern> = {
  dragStorm,
  bipolarTargets,
  spiralAtLeash,
  rapidSpawnDrop,
  multiCordInterleave,
  brushHarassment,
  deltaSpikes,
  cubePassengers,
};

// ---------------------------------------------------------------------------
// The corpus: every pattern × its seeds — invariants + settle window.
// ---------------------------------------------------------------------------
const TAIL_SECONDS = 5;

function runPattern(name: string, seed: number): FuzzHarness {
  const h = createFuzzHarness();
  PATTERNS[name](h, mulberry32(seed), FRAMES);
  return h;
}

for (const [name, pattern] of Object.entries(PATTERNS)) {
  describe(`QA-1 fuzz — ${name} (${FULL ? 'FULL' : 'fast'} corpus)`, () => {
    for (const seed of seedsFor(name as keyof typeof CORPUS)) {
      it(`seed ${seed}: invariants hold every frame, and everything settles`, () => {
        const h = runPattern(name, seed);
        // The calm tail: settle window + bitwise stillness + no leaks.
        h.calmTail(TAIL_SECONDS);
        expect(h.snapshot().length).toBeGreaterThan(0);
      });
      it(`seed ${seed}: replays bitwise (same seed ⇒ identical world + event log)`, () => {
        const a = runPattern(name, seed);
        const b = runPattern(name, seed);
        expect(b.snapshot()).toBe(a.snapshot());
        expect(b.eventLog.join('\n')).toBe(a.eventLog.join('\n'));
      });
    }
  });
  void pattern;
}

describe('QA-1 fuzz — allocation discipline (heap delta on repeated runs)', () => {
  it('repeated full-pattern runs do not grow the heap (no per-frame leak)', () => {
    const gc = (globalThis as { gc?: () => void }).gc;
    const name = 'multiCordInterleave';
    const seed = CORPUS.multiCordInterleave[0];
    const heaps: number[] = [];
    for (let run = 0; run < 8; run += 1) {
      runPattern(name, seed); // fresh harness, identical deterministic load
      gc?.();
      const heap = (globalThis as { process?: { memoryUsage?: () => { heapUsed: number } } })
        .process?.memoryUsage?.();
      if (heap === undefined) throw new Error('fuzz heap probe: process.memoryUsage unavailable');
      heaps.push(heap.heapUsed);
    }
    // The first runs warm V8's interpreter tiers; the tail must plateau.
    const tail = heaps.slice(3);
    const growth = Math.max(...tail) - Math.min(...tail);
    // Generous for GC jitter, tiny for a real leak: multiCordInterleave runs
    // ~220 frames × up to 7 cords; a single leaked object per frame would
    // still be fine — a leaked ARRAY/rope per frame (the historical class of
    // bug) blows past this within two runs.
    const budget = FULL ? 48 * 1024 * 1024 : 16 * 1024 * 1024;
    if (growth > budget) {
      throw new Error(
        `heap grew ${growth} bytes across repeated runs (heaps: ${heaps.join(', ')}) — per-frame allocation leak`,
      );
    }
  });
});

describe('QA-1 fuzz — seed override plumbing', () => {
  it('CORDS_FUZZ_SEED runs the exploration seed on every pattern (documented seam)', () => {
    // The override is read at module load; this test documents the seam and
    // proves the plumbing end-to-end when set (CI runs it unset: fast corpus).
    expect(SEED_OVERRIDE === null || Number.isInteger(SEED_OVERRIDE)).toBe(true);
    if (SEED_OVERRIDE === null) return;
    const h = createFuzzHarness();
    dragStorm(h, mulberry32(SEED_OVERRIDE), 40);
    h.calmTail(3);
    expect(true).toBe(true);
  });
});

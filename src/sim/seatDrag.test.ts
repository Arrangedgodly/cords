import { describe, expect, it } from 'vitest';
import { createVerletRope } from './rope';
import type { Rope } from './rope';
import { createRopeSimStep } from './ropeStep';
import { createFixedTimestepDriver } from './fixedTimestep';
import type { SeatInput, SimInput, SimState, Vec3 } from './types';

/**
 * INT-3 — cube dragging with seated cords, at the sim boundary (plan.md:
 * "Cube dragging, translate-only, plane-constrained"; accept: "headless drag
 * with attached cords → no explosion; cords remain clamped"). Pinned here:
 *
 * (a) HARD-FOLLOW — the seated pins ride their cube's moving seat transform
 *     bitwise, every frame, for TWO attached cords driven through two
 *     production SimStep instances (the multi-cord shape LIFE-1 formalizes;
 *     the same machinery the REN-2 stage harness drives).
 * (b) REGRESSION (the SIM-3 verifier carry-over) — the latched per-frame
 *     seatTarget re-send must NEVER restart the settle: an unchanged
 *     transform keeps a settled cord bitwise-frozen (asleep) through the
 *     driver, and the rope-level `setSeatPosition` no-ops on a bitwise
 *     identical position without waking. This is what bounds the post-drag
 *     calm-down by the settle window instead of an endless re-settle.
 * (c) POST-DRAG RE-SETTLE IS WINDOW-BOUNDED — after per-frame seat moves
 *     stop (gentle, violent, and over-stretched endings), the cord re-sleeps
 *     inside the SIM-3 settle window (≤ 2.0 s), stays finite throughout, and
 *     is bitwise-still afterwards.
 * (d) DETERMINISM — identical seat+drag frame scripts through the production
 *     driver are bitwise-identical.
 * (e) CARRIED CORD, SEATED CUBE DRAGGED AWAY — the carried end stretches and
 *     LEASHES against the receding seated pin (SIM-2 leash exact per step,
 *     never rips, never fails; over-stretch auto-unplug is INT-6's).
 *
 * Everything is seeded/analytic — the suite is itself deterministic.
 */

const DT = 1 / 120;
const FRAME = 1 / 60; // production frame cadence → 2 substeps per advance
const SEGMENTS = 16;
const SEG_LEN = 0.1;
const TOTAL = SEGMENTS * SEG_LEN;
const PIN: Vec3 = { x: 0, y: 1.6, z: 0 };
const END = SEGMENTS;
const LEASH_EPS = 1e-9;

/** A rope hanging straight down from PIN (the spawn pose). */
function makeRope(): Rope {
  const rope = createVerletRope({ pin: PIN });
  rope.placeAlong(PIN, { x: 0, y: PIN.y - TOTAL, z: 0 });
  return rope;
}

function readPoint(rope: Rope, index: number): Vec3 {
  const out: Vec3 = { x: 0, y: 0, z: 0 };
  rope.readPoint(index, out);
  return out;
}

function positions(rope: Rope): number[] {
  const flat: number[] = [];
  for (let i = 0; i < rope.pointCount; i += 1) {
    const p = readPoint(rope, i);
    flat.push(p.x, p.y, p.z);
  }
  return flat;
}

/** Bitwise array equality — the determinism/stillness bar is exact. */
function expectBitwiseEqual(a: ArrayLike<number>, b: ArrayLike<number>, label: string): void {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      throw new Error(`${label}: element ${i} differs — ${a[i]} vs ${b[i]}`);
    }
  }
}

function expectFiniteState(state: SimState, label: string): void {
  for (const cord of state.cords) {
    for (const p of cord.points) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
        throw new Error(`${label}: non-finite point in cord ${cord.id}`);
      }
    }
  }
}

/** Two production SimStep instances = two attached cords in one world. */
function makeTwoCordWorld(): {
  driver: ReturnType<typeof createFixedTimestepDriver>;
  state: SimState;
} {
  const a = createRopeSimStep({ cord: { pin: PIN, segmentCount: SEGMENTS } });
  const b = createRopeSimStep({ cord: { pin: PIN, segmentCount: SEGMENTS } });
  // Each SimStep owns its own single-cord world shell (the M1 world model);
  // the harness merges them the same way the REN-2 stage harness does. The
  // per-step merge allocates — test-side only, never the production path.
  const both = (state: SimState, dt: number, input: SimInput): SimState => {
    const wa = a(state, dt, input);
    const wb = b(wa, dt, input);
    return { time: wb.time, cords: [wa.cords[0], wb.cords[0]] };
  };
  const driver = createFixedTimestepDriver(both, { timestep: DT, maxSubsteps: 5 });
  return { driver, state: { time: 0, cords: [] } };
}

describe('INT-3 — seated cords follow a dragged cube', () => {
  it('HARD-FOLLOW: seated pins ride the moving seat transform bitwise, two attached cords, no explosion', () => {
    const { driver } = makeTwoCordWorld();
    let state: SimState = { time: 0, cords: [] };
    const input: SimInput = { pointerRay: null, seatTarget: null };
    const seat: SeatInput = { index: END, position: { x: 0, y: 0, z: 0 } };

    // Both cords plug onto the same cube face (self-links are legal).
    const SOCKET: Vec3 = { x: 0.5, y: 0.42, z: 0.1 };
    seat.position.x = SOCKET.x;
    seat.position.y = SOCKET.y;
    seat.position.z = SOCKET.z;
    input.seatTarget = seat;
    for (let f = 0; f < 3; f += 1) state = driver.advance(state, FRAME, input).state;

    // The cube drag: a violent bounded path (well beyond hand scale).
    let frames = 0;
    for (let f = 0; f < 120; f += 1) {
      const p: Vec3 = {
        x: SOCKET.x + 0.7 * Math.sin(0.35 * f),
        y: SOCKET.y + 0.3 * Math.sin(0.5 * f + 1),
        z: SOCKET.z + 0.7 * Math.cos(0.28 * f),
      };
      seat.position.x = p.x;
      seat.position.y = p.y;
      seat.position.z = p.z;
      const frame = driver.advance(state, FRAME, input);
      state = frame.state;
      frames += frame.substeps;
      expect(frame.substeps).toBe(2);
      expectFiniteState(state, `drag frame ${f}`);
      // Both seated pins ride the transform EXACTLY (cords remain clamped
      // to their sockets — the hard-follow contract, bitwise).
      for (const cord of state.cords) {
        const end = cord.points[END];
        if (end.x !== p.x || end.y !== p.y || end.z !== p.z) {
          throw new Error(`cord ${cord.id} frame ${f}: pin at ${JSON.stringify(end)}, expected ${JSON.stringify(p)}`);
        }
      }
      // The anchors never moved.
      for (const cord of state.cords) {
        const anchor = cord.points[0];
        if (anchor.x !== PIN.x || anchor.y !== PIN.y || anchor.z !== PIN.z) {
          throw new Error(`cord ${cord.id} frame ${f}: anchor moved to ${JSON.stringify(anchor)}`);
        }
      }
    }
    expect(frames).toBe(240);
  });

  it('REGRESSION carry-over: the latched unchanged seatTarget never restarts the settle — frozen bitwise through the driver', () => {
    const { driver } = makeTwoCordWorld();
    let state: SimState = { time: 0, cords: [] };
    const input: SimInput = { pointerRay: null, seatTarget: null };
    const seat: SeatInput = { index: END, position: { x: 0.4, y: 0.4, z: 0.15 } };
    input.seatTarget = seat;
    for (let f = 0; f < 3; f += 1) state = driver.advance(state, FRAME, input).state;
    expect(state.cords.length).toBe(2); // the two attached cords are live

    // Run the (latched, unchanged) seatTarget until the cords fall asleep:
    // a frame whose points are bitwise-identical to the previous frame's.
    const prev: number[][] = state.cords.map((cord) => {
      const flat: number[] = [];
      for (const p of cord.points) flat.push(p.x, p.y, p.z);
      return flat;
    });
    let sleepFrame = -1;
    for (let f = 0; f < 300; f += 1) {
      state = driver.advance(state, FRAME, input).state;
      expect(state.cords.length).toBe(2);
      let unchanged = true;
      state.cords.forEach((cord, i) => {
        const flat: number[] = [];
        for (const p of cord.points) flat.push(p.x, p.y, p.z);
        for (let k = 0; k < flat.length; k += 1) {
          if (flat[k] !== prev[i][k]) {
            unchanged = false;
            break;
          }
        }
        prev[i] = flat;
      });
      if (unchanged) {
        sleepFrame = f;
        break;
      }
    }
    expect(sleepFrame).toBeGreaterThanOrEqual(0);
    expect(sleepFrame).toBeLessThanOrEqual(120); // the settle window in 60 fps frames

    // The production latch KEEPS re-sending the same transform forever. It
    // must be a no-op: the cords stay bitwise-frozen (asleep) for another
    // full second of frames — never an endless re-settle.
    const frozen: number[][] = prev.map((flat) => flat.slice());
    for (let f = 0; f < 120; f += 1) {
      state = driver.advance(state, FRAME, input).state;
      state.cords.forEach((cord, i) => {
        const flat: number[] = [];
        for (const p of cord.points) flat.push(p.x, p.y, p.z);
        expectBitwiseEqual(flat, frozen[i], `cord ${cord.id} latch frame ${f}`);
      });
    }
  });

  it('REGRESSION carry-over, rope level: setSeatPosition to a bitwise-identical position never wakes a settled rope', () => {
    const rope = makeRope();
    const SOCKET: Vec3 = { x: 0.9, y: 0.4, z: 0.2 };
    rope.carryEnd(END);
    for (let f = 0; f < 60; f += 1) {
      rope.setPinTarget(END, SOCKET);
      rope.step(DT);
    }
    rope.seat({ index: END, position: SOCKET });
    let guard = 0;
    while (!rope.isSettled() && guard < 3600) {
      rope.step(DT);
      guard += 1;
    }
    expect(rope.isSettled()).toBe(true);

    // The cube is at rest; the composition still re-sends its transform per
    // frame. Every re-send is a bitwise no-op: asleep stays true and the
    // state is frozen for a full second of steps.
    const frozen = positions(rope);
    for (let s = 0; s < 120; s += 1) {
      rope.setSeatPosition(END, SOCKET.x, SOCKET.y, SOCKET.z); // unchanged transform
      expect(rope.isSettled()).toBe(true);
      rope.step(DT);
      expectBitwiseEqual(positions(rope), frozen, `identical re-send step ${s}`);
    }

    // A GENUINE move still wakes and moves the pin (the guard is exact).
    const MOVED: Vec3 = { x: SOCKET.x + 0.05, y: SOCKET.y, z: SOCKET.z };
    rope.setSeatPosition(END, MOVED.x, MOVED.y, MOVED.z);
    expect(rope.isSettled()).toBe(false);
    rope.step(DT);
    const pin = readPoint(rope, END);
    expect(pin.x).toBe(MOVED.x);
    expect(pin.y).toBe(MOVED.y);
    expect(pin.z).toBe(MOVED.z);
  });

  it('post-drag re-settle is WINDOW-BOUNDED: gentle, violent, and over-stretched endings all re-sleep within the settle window', () => {
    const SOCKET: Vec3 = { x: 0.5, y: 0.42, z: 0.1 };
    const endings: Array<{ name: string; path: (f: number) => Vec3; final: Vec3 }> = [
      {
        name: 'gentle drift',
        path: (f) => ({ x: SOCKET.x + 0.004 * f * 0.06, y: SOCKET.y, z: SOCKET.z + 0.002 * f * 0.06 }),
        final: { x: SOCKET.x + 0.0144, y: SOCKET.y, z: SOCKET.z + 0.0072 },
      },
      {
        name: 'violent Lissajous',
        path: (f) => ({
          x: SOCKET.x + 0.7 * Math.sin(0.9 * f),
          y: SOCKET.y + 0.35 * Math.sin(1.3 * f + 1),
          z: SOCKET.z + 0.7 * Math.cos(0.7 * f),
        }),
        final: { x: SOCKET.x - 0.51, y: SOCKET.y + 0.1, z: SOCKET.z + 0.42 },
      },
      {
        // The cube is dragged PAST the cord's total length from the anchor
        // (|final − PIN| ≈ 2.67 > 1.6): the cord leashes/holds taut — the
        // documented INT-3 transient; INT-6 owns the auto-unplug.
        name: 'over-stretched beyond cord length',
        path: (f) => ({
          x: SOCKET.x + (2.4 - SOCKET.x) * (f / 359),
          y: SOCKET.y,
          z: SOCKET.z * (1 - f / 359),
        }),
        final: { x: 2.4, y: SOCKET.y, z: 0 },
      },
    ];

    for (const ending of endings) {
      const rope = makeRope();
      rope.carryEnd(END);
      for (let f = 0; f < 60; f += 1) {
        rope.setPinTarget(END, SOCKET);
        rope.step(DT);
      }
      rope.seat({ index: END, position: SOCKET });
      let guard = 0;
      while (!rope.isSettled() && guard < 3600) {
        rope.step(DT);
        guard += 1;
      }
      expect(rope.isSettled()).toBe(true);

      // The cube drag: one genuine seat move per frame for 3 sim-seconds.
      for (let f = 0; f < 360; f += 1) {
        const p = ending.path(f);
        rope.setSeatPosition(END, p.x, p.y, p.z);
        rope.step(DT);
        expect(rope.isFiniteState()).toBe(true);
        const pin = readPoint(rope, END);
        expect(pin.x).toBe(p.x);
        expect(pin.y).toBe(p.y);
        expect(pin.z).toBe(p.z);
      }

      // The drag stops (one last transform — the final cube position), then
      // the post-drag calm-down must land inside the settle window.
      rope.setSeatPosition(END, ending.final.x, ending.final.y, ending.final.z);
      let steps = 0;
      while (!rope.isSettled() && steps < 3600) {
        rope.step(DT);
        steps += 1;
        expect(rope.isFiniteState()).toBe(true);
      }
      expect(rope.isSettled()).toBe(true);
      // THE BOUND: re-sleep inside the approved 2.0 s settle window.
      expect(steps).toBeLessThanOrEqual(240);

      // Bitwise still afterwards, seated pin exact, cord intact.
      const frozen = positions(rope);
      for (let s = 0; s < 120; s += 1) {
        rope.step(DT);
        expectBitwiseEqual(positions(rope), frozen, `${ending.name} post-sleep step ${s}`);
      }
      const pin = readPoint(rope, END);
      expect(pin.x).toBe(ending.final.x);
      expect(pin.y).toBe(ending.final.y);
      expect(pin.z).toBe(ending.final.z);
      if (ending.name.startsWith('over-stretched')) {
        // The over-stretch never failed the cord: it holds taut, seated,
        // with every segment finite and the leash-length demand bounded
        // (measured: uniform ~50% over natural; hard bar < 100% = 2x rest).
        let worst = 0;
        for (let seg = 0; seg < SEGMENTS; seg += 1) {
          const a = readPoint(rope, seg);
          const b = readPoint(rope, seg + 1);
          const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
          worst = Math.max(worst, Math.abs(len - SEG_LEN) / SEG_LEN);
        }
        expect(worst).toBeLessThan(1.0);
      }
    }
  });

  it('determinism: identical seat+drag frame scripts through the production driver are bitwise-identical', () => {
    const runWorld = (): number[][] => {
      const step = createRopeSimStep({ cord: { pin: PIN, segmentCount: SEGMENTS } });
      const driver = createFixedTimestepDriver(step, { timestep: DT, maxSubsteps: 5 });
      let state: SimState = { time: 0, cords: [] };
      const input: SimInput = { pointerRay: null, seatTarget: null };
      const seat: SeatInput = { index: END, position: { x: 0.45, y: 0.42, z: 0.05 } };
      input.seatTarget = seat;
      const snapshots: number[][] = [];
      const snap = (): void => {
        const flat: number[] = [];
        for (const p of state.cords[0].points) flat.push(p.x, p.y, p.z);
        snapshots.push(flat);
      };
      for (let f = 0; f < 3; f += 1) {
        const frame = driver.advance(state, FRAME, input);
        state = frame.state;
        snap();
      }
      for (let f = 0; f < 120; f += 1) {
        seat.position.x = 0.45 + 0.5 * Math.sin(0.3 * f);
        seat.position.y = 0.42 + 0.2 * Math.sin(0.44 * f + 0.7);
        seat.position.z = 0.05 + 0.5 * Math.cos(0.24 * f);
        const frame = driver.advance(state, FRAME, input);
        state = frame.state;
        snap();
      }
      for (let f = 0; f < 90; f += 1) {
        const frame = driver.advance(state, FRAME, input); // latch holds the last transform
        state = frame.state;
        snap();
      }
      return snapshots;
    };
    const a = runWorld();
    const b = runWorld();
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i += 1) {
      expectBitwiseEqual(a[i], b[i], `determinism frame ${i}`);
    }
  });

  it('CARRIED cord whose seated end is on the dragged cube: the end stretches and LEASHES, never rips', () => {
    const rope = makeRope();
    const C: Vec3 = { x: 0.5, y: 0.5, z: 0 };
    rope.carryEnd(END);
    for (let f = 0; f < 60; f += 1) {
      rope.setPinTarget(END, C);
      rope.step(DT);
    }

    // The cube hosting the SEATED pin (the anchor) is dragged away along +x.
    // setPin is the seated-pin transport for the original anchor (a plug
    // event cannot seat it; its cube drag moves it exactly like INT-3's
    // socket transport moves a plugged end).
    let worstOvershoot = 0;
    for (let f = 1; f <= 300; f += 1) {
      const anchorX = f * 0.012; // recedes to 3.6 — far past the carried end
      rope.setPin(anchorX, PIN.y, PIN.z);
      rope.step(DT);
      expect(rope.isFiniteState()).toBe(true);
      const carried = readPoint(rope, END);
      const d = Math.hypot(carried.x - anchorX, carried.y - PIN.y, carried.z - PIN.z);
      worstOvershoot = Math.max(worstOvershoot, d - TOTAL);
      // The SIM-2 leash holds against the MOVED anchor on every step: the
      // cord stretches and leashes — it never extends past total length.
      expect(d).toBeLessThanOrEqual(TOTAL + LEASH_EPS);
    }
    expect(worstOvershoot).toBeLessThanOrEqual(LEASH_EPS);

    // Release: targets stop; the carried pin freezes where it converged;
    // the state stays finite (no unplug, no failure — INT-6's future).
    for (let s = 0; s < 120; s += 1) {
      rope.step(DT);
      expect(rope.isFiniteState()).toBe(true);
    }
  });
});

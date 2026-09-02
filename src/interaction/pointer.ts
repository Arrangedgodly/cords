/**
 * Interaction layer — maps DOM pointer events onto the sim's `SimInput`.
 * DOM-only, renderer-free: converting client pixels to a sim-space ray needs
 * the camera, so that conversion is injected (INT-1 plugs the render layer's
 * raycaster in at src/main.ts). Keeping input mapping renderer-free keeps it
 * testable headless.
 *
 * T-INT-5 — this is also the POINTER SIDE of the passive cursor-brush: the
 * move counter below is the "pointer moved this frame" signal the world's
 * brush pass consumes (see src/sim/brush.ts for the impulse math).
 */
import type { BrushInput, Ray3, SimInput } from '../sim';

/** Client-pixel → sim-space ray converter, supplied by the composition root. */
export type RayFromClient = (clientX: number, clientY: number) => Ray3 | null;

export interface PointerMapper {
  /** Snapshot for the current frame — pass to the SimStep. */
  readInput(): SimInput;
  dispose(): void;
}

export function createPointerMapper(rayFromClient: RayFromClient = () => null): PointerMapper {
  let lastPointer: { clientX: number; clientY: number } | null = null;
  // T-INT-5 — the passive cursor-brush source: a monotonic count of real
  // pointermove events, composed into `SimInput.brush` ONLY when it advanced
  // since the last read. That is Thor's zero-idle-cost rule made structural:
  // an idle pointer sends no brush field at all, so the world's consume check
  // is the whole idle cost. The impulse is position-based (push away from the
  // ray, never a motion vector), so several moves coalescing into one frame
  // is harmless — the frame brushes once, at the latest position. Moves with
  // a button held count too: during a drag the cord BODIES still brush (the
  // held end is a pin and never impulses — pins win).
  let moveCount = 0;
  let servedCount = 0;
  const brushShell: BrushInput = {
    move: 0,
    ray: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: -1 } },
  };

  const onPointerMove = (event: PointerEvent): void => {
    lastPointer = { clientX: event.clientX, clientY: event.clientY };
    moveCount += 1;
  };
  const onPointerLeave = (): void => {
    lastPointer = null;
  };
  window.addEventListener('pointermove', onPointerMove);
  document.documentElement.addEventListener('pointerleave', onPointerLeave);

  return {
    readInput(): SimInput {
      if (lastPointer === null) {
        servedCount = moveCount;
        return { pointerRay: null };
      }
      const { clientX, clientY } = lastPointer;
      const ray = rayFromClient(clientX, clientY);
      const input: SimInput = { pointerRay: ray };
      if (ray !== null && moveCount !== servedCount) {
        // A move arrived since the last read: hand the world ONE brush pass
        // for this frame. The shell (and the ray it aliases) are read-only
        // downstream; nothing allocates here in steady state.
        brushShell.move = moveCount;
        brushShell.ray = ray;
        input.brush = brushShell;
      }
      servedCount = moveCount;
      return input;
    },
    dispose() {
      window.removeEventListener('pointermove', onPointerMove);
      document.documentElement.removeEventListener('pointerleave', onPointerLeave);
    },
  };
}

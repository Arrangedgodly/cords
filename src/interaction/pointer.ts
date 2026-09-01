/**
 * Interaction layer — maps DOM pointer events onto the sim's `SimInput`.
 * DOM-only, renderer-free: converting client pixels to a sim-space ray needs
 * the camera, so that conversion is injected (INT-1 plugs the render layer's
 * raycaster in at src/main.ts). Keeping input mapping renderer-free keeps it
 * testable headless.
 */
import type { Ray3, SimInput } from '../sim';

/** Client-pixel → sim-space ray converter, supplied by the composition root. */
export type RayFromClient = (clientX: number, clientY: number) => Ray3 | null;

export interface PointerMapper {
  /** Snapshot for the current frame — pass to the SimStep. */
  readInput(): SimInput;
  dispose(): void;
}

export function createPointerMapper(rayFromClient: RayFromClient = () => null): PointerMapper {
  let lastPointer: { clientX: number; clientY: number } | null = null;

  const onPointerMove = (event: PointerEvent): void => {
    lastPointer = { clientX: event.clientX, clientY: event.clientY };
  };
  const onPointerLeave = (): void => {
    lastPointer = null;
  };
  window.addEventListener('pointermove', onPointerMove);
  document.documentElement.addEventListener('pointerleave', onPointerLeave);

  return {
    readInput(): SimInput {
      if (lastPointer === null) {
        return { pointerRay: null };
      }
      const { clientX, clientY } = lastPointer;
      return { pointerRay: rayFromClient(clientX, clientY) };
    },
    dispose() {
      window.removeEventListener('pointermove', onPointerMove);
      document.documentElement.removeEventListener('pointerleave', onPointerLeave);
    },
  };
}

import type { SimState, SimStep } from './types';

/**
 * ARC-2 placeholder solver: advances only the sim clock. It exists so the
 * composition root (src/main.ts) really steps a sim through the render loop
 * today — the boundary is exercised, not aspirational. SIM-1's Verlet core
 * replaces this body without touching any caller.
 */
export function createNoopStep(): SimStep {
  return (state: SimState, dt: number): SimState => ({
    time: state.time + dt,
    cords: state.cords,
  });
}

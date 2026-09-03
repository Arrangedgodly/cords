/**
 * Public surface of the sim core. Consumers (render, interaction, main)
 * import from here, never from internals — keeps the liftable core's API
 * reviewable in one place.
 */
export type {
  BrushInput,
  CordDespawnInput,
  CordPopInput,
  CordState,
  PinTargetInput,
  ReleaseJackInput,
  SeatInput,
  SimInput,
  SimState,
  SimStep,
  SpawnCordInput,
  Vec2,
} from './types';
export { createNoopStep } from './noopSim';
export { createVerletRope, DEFAULT_ROPE_CONFIG, resolveRopeConfig } from './rope';
export type { Rope, RopeConfig } from './rope';
export { createRopeSimStep } from './ropeStep';
export type { RopeSimStepConfig } from './ropeStep';
export { createCordWorldStep, DEFAULT_OVERSTRETCH_THRESHOLD } from './cordWorld';
export type { CordWorldConfig, CordWorldStep, OverStretchOptions } from './cordWorld';
export { createCordLifecycle, DEFAULT_GRACE_SECONDS, DEFAULT_IDLE_SECONDS } from './lifecycle';
export type {
  CordLifecycle,
  CordLifecycleOptions,
  CordLifecycleView,
  EndMode,
  LifecycleRejection,
  LifecycleState,
  LifecycleTransition,
  TransitionReason,
} from './lifecycle';
export {
  beginVanishRun,
  resolveVanishOptions,
  stepVanishRun,
  vanishInfoOf,
  DEFAULT_VANISH_PULL_SECONDS,
  DEFAULT_VANISH_PULL_SPEED,
  DEFAULT_VANISH_FALL_TIMEOUT_SECONDS,
  DEFAULT_VANISH_CONTACT_OFFSET,
} from './vanish';
export type {
  ResolvedVanishOptions,
  VanishAction,
  VanishEvent,
  VanishEventKind,
  VanishInfo,
  VanishOptions,
  VanishPhase,
  VanishRun,
  VanishStepArgs,
} from './vanish';
export { coilPoints, DEFAULT_COIL } from './coilSpawn';
export type { CoilParams } from './coilSpawn';
export {
  applyBrushToRope,
  brushImpulse,
  brushWeight,
  resolveBrushOptions,
  DEFAULT_BRUSH_RADIUS_REST_LENGTHS,
  DEFAULT_BRUSH_STRENGTH,
} from './brush';
export type {
  BrushOptions,
  BrushImpulseOut,
  ResolvedBrushOptions,
} from './brush';
export type {
  FixedTimestepConfig,
  FixedTimestepDriver,
  FrameAdvanceResult,
} from './fixedTimestep';
export {
  createFixedTimestepDriver,
  DEFAULT_MAX_SUBSTEPS,
  DEFAULT_TIMESTEP,
} from './fixedTimestep';

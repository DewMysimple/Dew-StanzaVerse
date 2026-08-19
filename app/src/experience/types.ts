import type * as THREE from "three";
import type { PaperConfig } from "../config/papers";

export type ExperiencePhase =
  | "loading"
  | "scroll"
  | "poem"
  | "full-paint"
  | "content"
  | "restart"
  | "fallback";

export interface ExperienceState {
  phase: ExperiencePhase;
  started: boolean;
  inTransition: boolean;
  sceneIndex: number | null;
  fog: { opaque: number; occulted: number };
}

export interface RevealConfig {
  positions: THREE.Vector2[];
  infos: THREE.Vector4[];
}

export interface PaperInstanceConfig {
  index: number;
  config: PaperConfig;
  matrix: THREE.Matrix4;
  proxy: THREE.Mesh;
  paintAtlasRemap: THREE.Vector4;
  sdfAtlasRemap: THREE.Vector4;
  simulationBox: THREE.Vector4;
  simulationRemap: THREE.Vector4;
  reveal: RevealConfig;
  /** Every authored sheet starts flat and rises only after its startAt checkpoint. */
  initialRotationZ: number;
  /** Only these sheets use the ink-front alpha during their reveal. */
  isTransparent: boolean;
  renderGroup: "paint" | "transparent";
}

export interface BrushSample {
  paperIndex: number;
  previousUv: THREE.Vector2;
  currentUv: THREE.Vector2;
  /** Approximate maximum on-screen paper dimension in CSS pixels. */
  projectedSize: number;
  radius: number;
  velocity: THREE.Vector2;
  pressed: boolean;
  force: number;
}

export interface PaintingTitleConfig {
  proxy: THREE.Object3D;
  worldPosition: THREE.Vector3;
  worldQuaternion: THREE.Quaternion;
  cta: string;
  sceneIndex: number;
  interactionBounds: THREE.Box2;
}

export interface ScrollSample {
  /** Browser scroll mapped directly to the complete baked camera timeline. */
  rawProgress: number;
  /** Frame-rate independent, capped-lag progress used by the camera. */
  dampedProgress: number;
  /** Source section progress: 0..1 main scene, 1..2 final ten-second tail. */
  sectionProgress: number;
  cameraTime: number;
  direction: -1 | 0 | 1;
  velocity: number;
  contentHeight: number;
  travelMultiplier: number;
  effectiveTravel: number;
}

export interface RenderPipeline {
  shadowProjection: boolean;
  ground: boolean;
  paper: boolean;
  vegetation: boolean;
  text: boolean;
  fogComposite: boolean;
}

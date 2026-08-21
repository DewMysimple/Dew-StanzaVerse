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
  /** Pointer velocity in normalized device coordinates, matching the source force pass. */
  ndcVelocity: THREE.Vector2;
  /** Source hover speed after normalization against the paper's screen projection. */
  normalizedSpeed: number;
  /** Source cursor multiplier: hover maps 0..0.08 to 0.2..1.8; press stays at 0.2. */
  sourceScale: number;
  /** Paper projection in CSS pixels, used to keep the brush circular on screen. */
  projectedSize: THREE.Vector2;
  /** Radius in the paper's complete simulation tile (paper + ground). */
  previousRadius: THREE.Vector2;
  currentRadius: THREE.Vector2;
  /** Visible desktop brush diameter after projection, exposed to QA. */
  visibleDiameter: number;
  /** Pixel dimensions of this paper's packed simulation tile. */
  simulationSize: THREE.Vector2;
  paperRatio: number;
  velocity: THREE.Vector2;
  pressed: boolean;
  /** Source brush intensity variation; velocity force is carried separately. */
  intensity: number;
}

export interface SimulationRegionInput {
  paperIndex: number;
  width: number;
  height: number;
}

export interface SimulationRegion {
  paperIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  atlasSize: number;
  remap: THREE.Vector4;
  texelSize: THREE.Vector2;
  ratio: number;
}

export interface SimulationInstanceState {
  paperIndex: number;
  remap: THREE.Vector4;
  fboSize: THREE.Vector2;
  ratio: number;
  center: THREE.Vector2;
  lastCenter: THREE.Vector2;
  scale: number;
  lastScale: number;
  force: THREE.Vector2;
  deceleration: number;
  attenuation: number;
  intensity: number;
  dt: number;
  active: boolean;
  wasActive: boolean;
  pressed: boolean;
}

export interface RaycastHit {
  kind: "paper" | "ground";
  paperIndex: number;
  sceneIndex: number;
  proxy: THREE.Object3D;
  uv: THREE.Vector2;
  point: THREE.Vector3;
  distance: number;
}

export interface GrassInstanceConfig {
  paperIndex: number;
  ground: THREE.Object3D;
  positions: Float32Array;
  reveal: Float32Array;
}

export interface ShadowProjectionPipeline {
  texture: THREE.Texture;
  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void;
  resize(width: number, height: number): void;
  reset(): void;
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

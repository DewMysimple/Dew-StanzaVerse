/**
 * 按纸片实际尺寸动态打包的 GPU 流体模拟。
 *
 * 原站为每张纸分配独立 tile，再把 tile 打包到正方形 FBO。这里保留相同
 * 数据流：external force → advection → divergence → pressure → gradient →
 * accumulation，同时让所有 pass 只在自己的 atlas region 内采样。
 */
import * as THREE from "three";
import {
  simVertexShader,
  simSplatFragment,
  simAdvectFragment,
  simDivergenceFragment,
  simPressureFragment,
  simGradientFragment,
  simAccumulationFragment,
} from "../../shaders/fluid";
import { IS_MOBILE } from "../../config/assets";
import { PAPERS_CONFIG } from "../../config/papers";
import { resources } from "../../core/Resources";
import type { BrushSample, SimulationInstanceState, SimulationRegion, SimulationRegionInput } from "../types";

const PRESSURE_ITERATIONS = 1;
const TILE_PADDING = 4;

interface PackedTile {
  paperIndex: number;
  width: number;
  height: number;
  x: number;
  y: number;
}

export class FluidSimulation {
  private _renderer: THREE.WebGLRenderer;
  private _camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private _scene = new THREE.Scene();
  private _mesh: THREE.Mesh | null = null;

  private _velocityA!: THREE.WebGLRenderTarget;
  private _velocityB!: THREE.WebGLRenderTarget;
  private _pressureA!: THREE.WebGLRenderTarget;
  private _pressureB!: THREE.WebGLRenderTarget;
  private _divergence!: THREE.WebGLRenderTarget;
  private _accumulationA!: THREE.WebGLRenderTarget;
  private _accumulationB!: THREE.WebGLRenderTarget;

  private _splat: THREE.ShaderMaterial;
  private _advect: THREE.ShaderMaterial;
  private _divergenceMat: THREE.ShaderMaterial;
  private _pressureMat: THREE.ShaderMaterial;
  private _gradientMat: THREE.ShaderMaterial;
  private _accumulationMat: THREE.ShaderMaterial;
  private _regions = new Map<number, SimulationRegion>();
  private _atlasSize = 1;
  private _configured = false;
  private _time = 0;
  private _lastSceneUv = new Map<number, THREE.Vector2>();
  private _lastPaperRadii = new Map<number, THREE.Vector2>();
  private _texelSize = new THREE.Vector2(1, 1);
  private _states = new Map<number, SimulationInstanceState>();

  constructor(renderer: THREE.WebGLRenderer) {
    this._renderer = renderer;
    const noiseTexture = resources.get<THREE.Texture>("noise/rgb-fractal");
    noiseTexture.wrapS = noiseTexture.wrapT = THREE.RepeatWrapping;

    this._splat = new THREE.ShaderMaterial({
      vertexShader: simVertexShader,
      fragmentShader: simSplatFragment,
      uniforms: {
        uInputTexture: { value: null },
        uPreviousPoint: { value: new THREE.Vector2() },
        uCurrentPoint: { value: new THREE.Vector2() },
        uVector: { value: new THREE.Vector2() },
        uPreviousRadius: { value: new THREE.Vector2(0.04, 0.04) },
        uCurrentRadius: { value: new THREE.Vector2(0.04, 0.04) },
        uIntensity: { value: 0.06 },
        uPressed: { value: 0 },
        uPaperIndex: { value: -1 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this._advect = new THREE.ShaderMaterial({
      vertexShader: simVertexShader,
      fragmentShader: simAdvectFragment,
      uniforms: {
        uInputTexture: { value: null },
        uNoiseTexture: { value: noiseTexture },
        uRandomDirection: { value: 0.8 },
        uFirstNoiseScale: { value: 1 },
        uSecondNoiseScale: { value: 2 },
        uVelocityThreshold: { value: 0.05 },
        uGapVelocityBoost: { value: 3 },
        uGapAmount: { value: new THREE.Vector2(0.468, 0.51) },
        uIntensityDim: { value: 0.001 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this._divergenceMat = new THREE.ShaderMaterial({
      vertexShader: simVertexShader,
      fragmentShader: simDivergenceFragment,
      uniforms: { uVelocity: { value: null }, uTexelSize: { value: this._texelSize } },
      depthTest: false,
      depthWrite: false,
    });
    this._pressureMat = new THREE.ShaderMaterial({
      vertexShader: simVertexShader,
      fragmentShader: simPressureFragment,
      uniforms: {
        uPressure: { value: null },
        uDivergence: { value: null },
        uTexelSize: { value: this._texelSize },
      },
      depthTest: false,
      depthWrite: false,
    });
    this._gradientMat = new THREE.ShaderMaterial({
      vertexShader: simVertexShader,
      fragmentShader: simGradientFragment,
      uniforms: {
        uPressure: { value: null },
        uVelocity: { value: null },
        uTexelSize: { value: this._texelSize },
      },
      depthTest: false,
      depthWrite: false,
    });
    this._accumulationMat = new THREE.ShaderMaterial({
      vertexShader: simVertexShader,
      fragmentShader: simAccumulationFragment,
      uniforms: {
        uVelocity: { value: null },
        uPrevious: { value: null },
      },
      depthTest: false,
      depthWrite: false,
    });
  }

  get texture(): THREE.Texture {
    return this._accumulationA.texture;
  }

  get atlasSize(): number {
    return this._atlasSize;
  }

  configureRegions(inputs: SimulationRegionInput[]): void {
    const maxTile = IS_MOBILE ? 1024 : 1200;
    const coefficient = IS_MOBILE ? 5 : 26;
    const maxTextureSize = this._renderer.capabilities.maxTextureSize;
    let tiles = inputs.map((input) => {
      const ratio = Math.max(input.width / Math.max(input.height, 0.001), 0.05);
      let width = THREE.MathUtils.clamp(Math.round(input.width * coefficient), 128, maxTile);
      let height = Math.max(64, Math.round(width / ratio));
      const scale = Math.min(1, maxTile / Math.max(width, height));
      width = Math.max(64, Math.round(width * scale));
      height = Math.max(64, Math.round(height * scale));
      return { paperIndex: input.paperIndex, width, height, x: 0, y: 0 };
    });

    let packed = this._packTiles(tiles, maxTextureSize);
    while (!packed && Math.max(...tiles.map((tile) => Math.max(tile.width, tile.height))) > 64) {
      tiles = tiles.map((tile) => ({
        ...tile,
        width: Math.max(64, Math.round(tile.width * 0.82)),
        height: Math.max(64, Math.round(tile.height * 0.82)),
      }));
      packed = this._packTiles(tiles, maxTextureSize);
    }
    if (!packed) throw new Error("Unable to pack watercolor simulation regions");

    this._atlasSize = packed.size;
    this._texelSize.set(1 / packed.size, 1 / packed.size);
    this._regions.clear();
    this._states.clear();
    packed.tiles.forEach((tile) => {
      const remap = new THREE.Vector4(
        tile.x / packed!.size,
        tile.y / packed!.size,
        tile.width / packed!.size,
        tile.height / packed!.size,
      );
      this._regions.set(tile.paperIndex, {
        ...tile,
        atlasSize: packed!.size,
        remap,
        texelSize: this._texelSize.clone(),
        ratio: tile.width / tile.height,
      });
      this._states.set(tile.paperIndex, {
        paperIndex: tile.paperIndex,
        remap: remap.clone(),
        fboSize: new THREE.Vector2(tile.width, tile.height),
        ratio: tile.width / tile.height,
        center: new THREE.Vector2(),
        lastCenter: new THREE.Vector2(),
        scale: 0,
        lastScale: 0,
        force: new THREE.Vector2(),
        deceleration: 0.98,
        attenuation: 0.96,
        intensity: 0,
        dt: 0.008,
        active: false,
        wasActive: false,
        pressed: false,
      });
    });

    this._allocateTargets(packed.size);
    this._createAtlasMesh([...this._regions.values()]);
    this._configured = true;
    this.reset();
  }

  regionForPaper(paperIndex: number): SimulationRegion {
    const region = this._regions.get(paperIndex);
    if (!region) throw new Error(`Missing simulation region for paper ${paperIndex}`);
    return region;
  }

  regionRemapForPaper(paperIndex: number): THREE.Vector4 {
    return this.regionForPaper(paperIndex).remap.clone();
  }

  regionRemap(sceneIndex: number): THREE.Vector4 {
    let paperIndex = PAPERS_CONFIG.findIndex((paper) => paper.sceneIndex === sceneIndex && paper.title);
    if (paperIndex < 0) paperIndex = PAPERS_CONFIG.findIndex((paper) => paper.sceneIndex === sceneIndex);
    return this.regionRemapForPaper(Math.max(paperIndex, 0));
  }

  /** Local QA probe: source channels are direction, displayed velocity, intensity. */
  readAccumulation(paperIndex: number, uv: THREE.Vector2): { direction: THREE.Vector2; wetness: number; pigment: number } {
    const region = this.regionForPaper(paperIndex);
    const x = THREE.MathUtils.clamp(Math.floor(region.x + uv.x * region.width), region.x, region.x + region.width - 1);
    const y = THREE.MathUtils.clamp(Math.floor(region.y + uv.y * region.height), region.y, region.y + region.height - 1);
    const pixel = new Uint16Array(4);
    this._renderer.readRenderTargetPixels(this._accumulationA, x, y, 1, 1, pixel);
    return {
      direction: new THREE.Vector2(THREE.DataUtils.fromHalfFloat(pixel[0]), THREE.DataUtils.fromHalfFloat(pixel[1])),
      wetness: THREE.DataUtils.fromHalfFloat(pixel[2]),
      pigment: THREE.DataUtils.fromHalfFloat(pixel[3]),
    };
  }

  splat(sample: BrushSample): void {
    if (!this._configured) return;
    const state = this._states.get(sample.paperIndex);
    if (!state) return;
    state.lastCenter.copy(state.center);
    state.center.copy(sample.currentUv);
    state.lastScale = state.scale;
    state.scale = sample.sourceScale;
    if (sample.pressed) {
      state.force.set(0.3, 0.3);
    } else {
      state.force.set(sample.ndcVelocity.x * 25, -sample.ndcVelocity.y * 25);
    }
    state.pressed = sample.pressed;
    state.deceleration = sample.pressed ? 1 : 0.98;
    state.attenuation = sample.pressed ? 0.98 : 0.96;
    state.dt = 0.008;
    state.intensity = sample.intensity;
    state.active = true;
    state.wasActive = true;
    this._syncStateAttributes();
    this._splat.uniforms.uInputTexture.value = this._velocityA.texture;
    (this._splat.uniforms.uPreviousPoint.value as THREE.Vector2).copy(sample.previousUv);
    (this._splat.uniforms.uCurrentPoint.value as THREE.Vector2).copy(sample.currentUv);
    (this._splat.uniforms.uPreviousRadius.value as THREE.Vector2).copy(sample.previousRadius);
    (this._splat.uniforms.uCurrentRadius.value as THREE.Vector2).copy(sample.currentRadius);
    (this._splat.uniforms.uVector.value as THREE.Vector2).copy(state.force);
    this._splat.uniforms.uIntensity.value = sample.intensity;
    this._splat.uniforms.uPressed.value = sample.pressed ? 1 : 0;
    this._splat.uniforms.uPaperIndex.value = sample.paperIndex;
    this._runPass(this._splat, this._velocityB);
    this._swapVelocity();
    this._lastPaperRadii.set(sample.paperIndex, sample.currentRadius.clone());
  }

  splatScene(sceneIndex: number, uv: THREE.Vector2, move: THREE.Vector2, force = 1): void {
    let paperIndex = PAPERS_CONFIG.findIndex((paper) => paper.sceneIndex === sceneIndex && paper.title);
    if (paperIndex < 0) paperIndex = PAPERS_CONFIG.findIndex((paper) => paper.sceneIndex === sceneIndex);
    paperIndex = Math.max(paperIndex, 0);
    const previousUv = this._lastSceneUv.get(sceneIndex)?.clone() ?? uv.clone();
    this._lastSceneUv.set(sceneIndex, uv.clone());
    const region = this.regionForPaper(paperIndex);
    const diameter = THREE.MathUtils.clamp(95 + move.length() * 0.15, 76, 114);
    const radius = new THREE.Vector2(diameter / region.width / 2, diameter / region.height / 2);
    const ndcVelocity = new THREE.Vector2(
      (move.x / Math.max(window.innerWidth, 1)) * 2,
      -(move.y / Math.max(window.innerHeight, 1)) * 2,
    );
    this.splat({
      paperIndex,
      previousUv,
      currentUv: uv.clone(),
      ndcVelocity,
      normalizedSpeed: THREE.MathUtils.clamp(move.length() / Math.max(window.innerWidth, window.innerHeight, 1), 0, 0.08),
      sourceScale: diameter / 95,
      projectedSize: new THREE.Vector2(window.innerWidth, window.innerHeight),
      previousRadius: this._lastPaperRadii.get(paperIndex)?.clone() ?? radius.clone(),
      currentRadius: radius,
      visibleDiameter: diameter,
      simulationSize: new THREE.Vector2(region.width, region.height),
      paperRatio: region.ratio,
      velocity: uv.clone().sub(previousUv),
      pressed: force > 1.2,
      intensity: 0.06,
    });
  }

  update(delta: number): void {
    if (!this._configured) return;
    const dt = Math.min(delta, 0.033);
    this._time += dt;

    // The bundle stores per-frame 60 Hz coefficients. Convert them to the
    // current frame duration so decay remains perceptually identical at
    // 60/120 Hz and under variable-rate QA capture.
    const sourceFrames = dt * 60;
    this._states.forEach((state) => {
      state.deceleration = Math.pow(state.pressed ? 1 : 0.98, sourceFrames);
      state.attenuation = Math.pow(state.pressed ? 0.98 : 0.96, sourceFrames);
    });
    this._advect.uniforms.uIntensityDim.value = 0.001 * sourceFrames;

    this._advect.uniforms.uInputTexture.value = this._velocityA.texture;
    this._syncStateAttributes();
    this._runPass(this._advect, this._velocityB);
    this._swapVelocity();

    this._divergenceMat.uniforms.uVelocity.value = this._velocityA.texture;
    this._runPass(this._divergenceMat, this._divergence);

    this._pressureMat.uniforms.uDivergence.value = this._divergence.texture;
    for (let index = 0; index < PRESSURE_ITERATIONS; index++) {
      this._pressureMat.uniforms.uPressure.value = this._pressureA.texture;
      this._runPass(this._pressureMat, this._pressureB);
      [this._pressureA, this._pressureB] = [this._pressureB, this._pressureA];
    }

    this._gradientMat.uniforms.uPressure.value = this._pressureA.texture;
    this._gradientMat.uniforms.uVelocity.value = this._velocityA.texture;
    this._runPass(this._gradientMat, this._velocityB);
    this._swapVelocity();

    this._accumulationMat.uniforms.uVelocity.value = this._velocityA.texture;
    this._accumulationMat.uniforms.uPrevious.value = this._accumulationA.texture;
    this._runPass(this._accumulationMat, this._accumulationB);
    [this._accumulationA, this._accumulationB] = [this._accumulationB, this._accumulationA];
    this._states.forEach((state) => {
      if (!state.active) {
        state.pressed = false;
        state.deceleration = 0.98;
        state.attenuation = 0.96;
      }
      state.active = false;
    });
    this._syncStateAttributes();
  }

  reset(): void {
    if (!this._configured) return;
    this._lastSceneUv.clear();
    this._lastPaperRadii.clear();
    this._states.forEach((state) => {
      state.center.set(0, 0);
      state.lastCenter.set(0, 0);
      state.scale = 0;
      state.lastScale = 0;
      state.force.set(0, 0);
      state.active = false;
      state.wasActive = false;
    });
    this._syncStateAttributes();
    this._clearTargets([
      this._velocityA,
      this._velocityB,
      this._pressureA,
      this._pressureB,
      this._divergence,
      this._accumulationA,
      this._accumulationB,
    ]);
  }

  private _packTiles(sourceTiles: PackedTile[], maxTextureSize: number): { size: number; tiles: PackedTile[] } | null {
    const area = sourceTiles.reduce((sum, tile) => sum + (tile.width + TILE_PADDING) * (tile.height + TILE_PADDING), 0);
    const largest = Math.max(...sourceTiles.map((tile) => Math.max(tile.width, tile.height))) + TILE_PADDING * 2;
    let size = THREE.MathUtils.ceilPowerOfTwo(Math.max(largest, Math.ceil(Math.sqrt(area * 1.15))));
    while (size <= maxTextureSize) {
      const tiles = sourceTiles.map((tile) => ({ ...tile })).sort((a, b) => b.height - a.height);
      let x = TILE_PADDING;
      let y = TILE_PADDING;
      let rowHeight = 0;
      let fits = true;
      for (const tile of tiles) {
        if (x + tile.width + TILE_PADDING > size) {
          x = TILE_PADDING;
          y += rowHeight + TILE_PADDING;
          rowHeight = 0;
        }
        if (y + tile.height + TILE_PADDING > size) {
          fits = false;
          break;
        }
        tile.x = x;
        tile.y = y;
        x += tile.width + TILE_PADDING;
        rowHeight = Math.max(rowHeight, tile.height);
      }
      if (fits) return { size, tiles: tiles.sort((a, b) => a.paperIndex - b.paperIndex) };
      size *= 2;
    }
    return null;
  }

  private _allocateTargets(size: number): void {
    if (this._configured) {
      [
        this._velocityA,
        this._velocityB,
        this._pressureA,
        this._pressureB,
        this._divergence,
        this._accumulationA,
        this._accumulationB,
      ].forEach((target) => target.dispose());
    }
    const options: THREE.WebGLRenderTargetOptions = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    };
    this._velocityA = new THREE.WebGLRenderTarget(size, size, options);
    this._velocityB = new THREE.WebGLRenderTarget(size, size, options);
    this._pressureA = new THREE.WebGLRenderTarget(size, size, options);
    this._pressureB = new THREE.WebGLRenderTarget(size, size, options);
    this._divergence = new THREE.WebGLRenderTarget(size, size, options);
    this._accumulationA = new THREE.WebGLRenderTarget(size, size, options);
    this._accumulationB = new THREE.WebGLRenderTarget(size, size, options);
  }

  private _createAtlasMesh(regions: SimulationRegion[]): void {
    if (this._mesh) {
      this._scene.remove(this._mesh);
      this._mesh.geometry.dispose();
    }
    const plane = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.copy(plane);
    geometry.instanceCount = regions.length;
    geometry.setAttribute(
      "aRegion",
      new THREE.InstancedBufferAttribute(new Float32Array(regions.flatMap((region) => region.remap.toArray())), 4),
    );
    geometry.setAttribute(
      "aPaperIndex",
      new THREE.InstancedBufferAttribute(new Float32Array(regions.map((region) => region.paperIndex)), 1),
    );
    geometry.setAttribute("aFboSize", new THREE.InstancedBufferAttribute(new Float32Array(regions.flatMap((region) => [region.width, region.height])), 2));
    geometry.setAttribute("aDeceleration", new THREE.InstancedBufferAttribute(new Float32Array(regions.map(() => 0.98)), 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aAttenuation", new THREE.InstancedBufferAttribute(new Float32Array(regions.map(() => 0.96)), 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aDt", new THREE.InstancedBufferAttribute(new Float32Array(regions.map(() => 0.008)), 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aWasActive", new THREE.InstancedBufferAttribute(new Float32Array(regions.map(() => 0)), 1).setUsage(THREE.DynamicDrawUsage));
    this._mesh = new THREE.Mesh(geometry, this._splat);
    this._mesh.frustumCulled = false;
    this._scene.add(this._mesh);
  }

  private _syncStateAttributes(): void {
    if (!this._mesh) return;
    const geometry = this._mesh.geometry as THREE.InstancedBufferGeometry;
    const deceleration = geometry.getAttribute("aDeceleration") as THREE.InstancedBufferAttribute;
    const attenuation = geometry.getAttribute("aAttenuation") as THREE.InstancedBufferAttribute;
    const dt = geometry.getAttribute("aDt") as THREE.InstancedBufferAttribute;
    const wasActive = geometry.getAttribute("aWasActive") as THREE.InstancedBufferAttribute;
    this._states.forEach((state, paperIndex) => {
      deceleration.setX(paperIndex, state.deceleration);
      attenuation.setX(paperIndex, state.attenuation);
      dt.setX(paperIndex, state.dt);
      wasActive.setX(paperIndex, state.wasActive ? 1 : 0);
    });
    deceleration.needsUpdate = true;
    attenuation.needsUpdate = true;
    dt.needsUpdate = true;
    wasActive.needsUpdate = true;
  }

  private _runPass(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget): void {
    if (!this._mesh) return;
    this._mesh.material = material;
    const previousTarget = this._renderer.getRenderTarget();
    const previousColor = this._renderer.getClearColor(new THREE.Color()).clone();
    const previousAlpha = this._renderer.getClearAlpha();
    this._renderer.setRenderTarget(target);
    this._renderer.setClearColor(0x000000, 0);
    this._renderer.clear(true, false, false);
    this._renderer.render(this._scene, this._camera);
    this._renderer.setRenderTarget(previousTarget);
    this._renderer.setClearColor(previousColor, previousAlpha);
  }

  private _swapVelocity(): void {
    [this._velocityA, this._velocityB] = [this._velocityB, this._velocityA];
  }

  private _clearTargets(targets: THREE.WebGLRenderTarget[]): void {
    const previousTarget = this._renderer.getRenderTarget();
    const previousColor = this._renderer.getClearColor(new THREE.Color()).clone();
    const previousAlpha = this._renderer.getClearAlpha();
    this._renderer.setClearColor(0x000000, 0);
    targets.forEach((target) => {
      this._renderer.setRenderTarget(target);
      this._renderer.clear(true, false, false);
    });
    this._renderer.setRenderTarget(previousTarget);
    this._renderer.setClearColor(previousColor, previousAlpha);
  }
}

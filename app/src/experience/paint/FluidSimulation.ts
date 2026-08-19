/**
 * GPU 流体模拟（Stable Fluids 精简版）。
 *
 * 原站为所有画纸维护一张图集化的模拟纹理（每张纸通过 simulationBox /
 * simulationRemap 映射到自己的区域），复刻版保持同样的图集思路：
 * 1024×682 的渲染目标划分为 3×2 共 6 个区域，对应 6 幅画作。
 *
 * 数据约定（与 paper/ground/fullpaint 着色器一致）：
 *   r/g = 速度向量, b = 速度大小, a = 墨迹强度
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
import { PAPERS_CONFIG } from "../../config/papers";
import { resources } from "../../core/Resources";
import type { BrushSample } from "../types";

const SIM_WIDTH = 960;
const SIM_HEIGHT = 800;
const COLS = 6;
const ROWS = 5;
const PRESSURE_ITERATIONS = 1;

interface Pass {
  material: THREE.ShaderMaterial;
  scene: THREE.Scene;
}

export class FluidSimulation {
  private _renderer: THREE.WebGLRenderer;
  private _camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private _quad: THREE.Mesh;

  private _velocityA: THREE.WebGLRenderTarget;
  private _velocityB: THREE.WebGLRenderTarget;
  private _pressureA: THREE.WebGLRenderTarget;
  private _pressureB: THREE.WebGLRenderTarget;
  private _divergence: THREE.WebGLRenderTarget;
  private _accumulationA: THREE.WebGLRenderTarget;
  private _accumulationB: THREE.WebGLRenderTarget;

  private _splat: THREE.ShaderMaterial;
  private _advect: THREE.ShaderMaterial;
  private _divergenceMat: THREE.ShaderMaterial;
  private _pressureMat: THREE.ShaderMaterial;
  private _gradientMat: THREE.ShaderMaterial;
  private _accumulationMat: THREE.ShaderMaterial;
  private _time = 0;
  private _lastSceneUv = new Map<number, THREE.Vector2>();

  private _texelSize = new THREE.Vector2(1 / SIM_WIDTH, 1 / SIM_HEIGHT);

  constructor(renderer: THREE.WebGLRenderer) {
    this._renderer = renderer;

    const rtOptions: THREE.WebGLRenderTargetOptions = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    };
    this._velocityA = new THREE.WebGLRenderTarget(SIM_WIDTH, SIM_HEIGHT, rtOptions);
    this._velocityB = new THREE.WebGLRenderTarget(SIM_WIDTH, SIM_HEIGHT, rtOptions);
    this._pressureA = new THREE.WebGLRenderTarget(SIM_WIDTH, SIM_HEIGHT, rtOptions);
    this._pressureB = new THREE.WebGLRenderTarget(SIM_WIDTH, SIM_HEIGHT, rtOptions);
    this._divergence = new THREE.WebGLRenderTarget(SIM_WIDTH, SIM_HEIGHT, rtOptions);
    this._accumulationA = new THREE.WebGLRenderTarget(SIM_WIDTH, SIM_HEIGHT, rtOptions);
    this._accumulationB = new THREE.WebGLRenderTarget(SIM_WIDTH, SIM_HEIGHT, rtOptions);

    const noiseTexture = resources.get<THREE.Texture>("noise/rgb-fractal");
    noiseTexture.wrapS = noiseTexture.wrapT = THREE.RepeatWrapping;

    this._splat = new THREE.ShaderMaterial({
      vertexShader: simVertexShader,
      fragmentShader: simSplatFragment,
      uniforms: {
        uInputTexture: { value: null },
        uNoiseTexture: { value: noiseTexture },
        uPreviousPoint: { value: new THREE.Vector2() },
        uCurrentPoint: { value: new THREE.Vector2() },
        uVector: { value: new THREE.Vector2() },
        uPreviousRadius: { value: 0.012 },
        uCurrentRadius: { value: 0.012 },
        uForce: { value: 1.0 },
        uAspect: { value: SIM_WIDTH / SIM_HEIGHT },
        uRegion: { value: new THREE.Vector4(0, 0, 1, 1) },
      },
      depthTest: false,
      depthWrite: false,
    });
    this._advect = new THREE.ShaderMaterial({
      vertexShader: simVertexShader,
      fragmentShader: simAdvectFragment,
      uniforms: {
        uInputTexture: { value: null },
        uDelta: { value: 0.016 },
        uTexelSize: { value: this._texelSize },
        uVelocityDissipation: { value: 0.985 },
        uIntensityDissipation: { value: 0.999 },
        uGrid: { value: new THREE.Vector2(COLS, ROWS) },
        uNoiseTexture: { value: noiseTexture },
        uTime: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this._divergenceMat = new THREE.ShaderMaterial({
      vertexShader: simVertexShader,
      fragmentShader: simDivergenceFragment,
      uniforms: {
        uVelocity: { value: null },
        uTexelSize: { value: this._texelSize },
        uGrid: { value: new THREE.Vector2(COLS, ROWS) },
      },
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
        uGrid: { value: new THREE.Vector2(COLS, ROWS) },
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
        uDelta: { value: 0.016 },
        uGrid: { value: new THREE.Vector2(COLS, ROWS) },
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
        uNoiseTexture: { value: noiseTexture },
        uDelta: { value: 0.016 },
        uTime: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });

    this._quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._splat);
    this._quad.frustumCulled = false;
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

  /** 供外部读取的模拟纹理（速度 + 墨迹强度） */
  get texture(): THREE.Texture {
    return this._accumulationA.texture;
  }

  /** 每张纸拥有独立的图集单元，避免同场景纸片互相污染。 */
  regionRemapForPaper(paperIndex: number): THREE.Vector4 {
    const safeIndex = Math.min(Math.max(paperIndex, 0), COLS * ROWS - 1);
    const col = safeIndex % COLS;
    const row = Math.floor(safeIndex / COLS);
    return new THREE.Vector4(col / COLS, row / ROWS, 1 / COLS, 1 / ROWS);
  }

  /** Full Paint 使用该场景的主标题纸片区域。 */
  regionRemap(sceneIndex: number): THREE.Vector4 {
    let paperIndex = PAPERS_CONFIG.findIndex((paper) => paper.sceneIndex === sceneIndex && paper.title);
    if (paperIndex < 0) paperIndex = PAPERS_CONFIG.findIndex((paper) => paper.sceneIndex === sceneIndex);
    return this.regionRemapForPaper(Math.max(paperIndex, 0));
  }

  /**
   * 笔刷注入。
   * @param sceneIndex 画作编号 1~6
   * @param uv         画作局部 uv（0~1）
   * @param move       指针位移（像素）
   */
  splat(sample: BrushSample): void {
    const region = this.regionRemapForPaper(sample.paperIndex);
    this._splat.uniforms.uInputTexture.value = this._velocityA.texture;
    (this._splat.uniforms.uPreviousPoint.value as THREE.Vector2).copy(sample.previousUv);
    (this._splat.uniforms.uCurrentPoint.value as THREE.Vector2).copy(sample.currentUv);
    (this._splat.uniforms.uRegion.value as THREE.Vector4).copy(region);
    const velocityScale = sample.pressed ? 0.3 : 50;
    (this._splat.uniforms.uVector.value as THREE.Vector2).copy(sample.velocity).multiplyScalar(velocityScale);
    this._splat.uniforms.uPreviousRadius.value = sample.radius;
    this._splat.uniforms.uCurrentRadius.value = sample.radius;
    this._splat.uniforms.uAspect.value = 1;
    this._splat.uniforms.uForce.value = sample.force;
    this._runPass(this._splat, this._velocityB);
    this._swapVelocity();
  }

  splatScene(sceneIndex: number, uv: THREE.Vector2, move: THREE.Vector2, force = 1): void {
    let paperIndex = PAPERS_CONFIG.findIndex((paper) => paper.sceneIndex === sceneIndex && paper.title);
    if (paperIndex < 0) paperIndex = PAPERS_CONFIG.findIndex((paper) => paper.sceneIndex === sceneIndex);
    paperIndex = Math.max(paperIndex, 0);
    const previousUv = this._lastSceneUv.get(sceneIndex)?.clone() ?? uv.clone();
    this._lastSceneUv.set(sceneIndex, uv.clone());
    const velocity = uv.clone().sub(previousUv);
    const radius = THREE.MathUtils.clamp(0.014 + move.length() * 0.00012, 0.014, 0.04);
    this.splat({
      paperIndex,
      previousUv,
      currentUv: uv.clone(),
      projectedSize: Math.max(window.innerWidth, window.innerHeight),
      radius,
      velocity,
      pressed: force > 1.2,
      force: THREE.MathUtils.clamp(force, 0.25, 1.6),
    });
  }

  update(delta: number): void {
    const dt = Math.min(delta, 0.033);
    this._time += dt;

    // 1. 平流
    this._advect.uniforms.uInputTexture.value = this._velocityA.texture;
    this._advect.uniforms.uDelta.value = dt;
    this._advect.uniforms.uTime.value = this._time;
    this._runPass(this._advect, this._velocityB);
    this._swapVelocity();

    // 2. 散度
    this._divergenceMat.uniforms.uVelocity.value = this._velocityA.texture;
    this._runPass(this._divergenceMat, this._divergence);

    // 3. 压力 Jacobi 迭代
    this._pressureMat.uniforms.uDivergence.value = this._divergence.texture;
    for (let i = 0; i < PRESSURE_ITERATIONS; i++) {
      this._pressureMat.uniforms.uPressure.value = this._pressureA.texture;
      this._runPass(this._pressureMat, this._pressureB);
      const tmp = this._pressureA;
      this._pressureA = this._pressureB;
      this._pressureB = tmp;
    }

    // 4. 梯度扣除
    this._gradientMat.uniforms.uPressure.value = this._pressureA.texture;
    this._gradientMat.uniforms.uVelocity.value = this._velocityA.texture;
    this._gradientMat.uniforms.uDelta.value = dt;
    this._runPass(this._gradientMat, this._velocityB);
    this._swapVelocity();

    // 5. 独立累积：保留渗入纸张的水彩，速度则自然衰减。
    this._accumulationMat.uniforms.uVelocity.value = this._velocityA.texture;
    this._accumulationMat.uniforms.uPrevious.value = this._accumulationA.texture;
    this._accumulationMat.uniforms.uDelta.value = dt;
    this._accumulationMat.uniforms.uTime.value = this._time;
    this._runPass(this._accumulationMat, this._accumulationB);
    const accumulation = this._accumulationA;
    this._accumulationA = this._accumulationB;
    this._accumulationB = accumulation;
  }

  reset(): void {
    this._lastSceneUv.clear();
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

  private _runPass(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget): void {
    this._quad.material = material;
    const scene = new THREE.Scene();
    scene.add(this._quad);
    this._renderer.setRenderTarget(target);
    this._renderer.render(scene, this._camera);
    this._renderer.setRenderTarget(null);
    scene.remove(this._quad);
  }

  private _swapVelocity(): void {
    const tmp = this._velocityA;
    this._velocityA = this._velocityB;
    this._velocityB = tmp;
  }

  private _clearTargets(targets: THREE.WebGLRenderTarget[]): void {
    const previous = this._renderer.getRenderTarget();
    const previousColor = this._renderer.getClearColor(new THREE.Color()).clone();
    const previousAlpha = this._renderer.getClearAlpha();
    this._renderer.setClearColor(0x000000, 0);
    targets.forEach((target) => {
      this._renderer.setRenderTarget(target);
      this._renderer.clear(true, false, false);
    });
    this._renderer.setRenderTarget(previous);
    this._renderer.setClearColor(previousColor, previousAlpha);
  }
}

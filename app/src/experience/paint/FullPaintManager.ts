/**
 * 全幅绘画模式（Full Paint）。
 * 长按画纸（桌面 0.3s / 移动端 0.6s）进入：该画作的 base/over 两层
 * 动态绘画视频铺满屏幕，墨迹晕开展现，此时在屏幕上涂抹直接驱动
 * 该画作对应的流体模拟区域 —— 视频随笔触"活"起来。
 * 对应原站 FullPaintManager + 全屏绘画四边形（29/30 号着色器）。
 */
import * as THREE from "three";
import gsap from "gsap";
import { fullpaintVertexShader, fullpaintFragmentShader } from "../../shaders/fullpaint";
import { audioManager } from "../audio/AudioManager";
import type { FluidSimulation } from "./FluidSimulation";
import { bus } from "../../core/EventBus";
import { resources } from "../../core/Resources";
import { createRevealConfig } from "../world/InkReveal";

export const FULLPAINT_EVENTS = {
  SHOW: "fullpaint-show",
  HIDE: "fullpaint-hide",
} as const;

export class FullPaintManager {
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);

  private _material: THREE.ShaderMaterial;
  private _simulation: FluidSimulation;
  private _visible = false;
  private _forced = false;
  private _sceneIndex: number | null = null;
  private _videoBase: HTMLVideoElement | null = null;
  private _videoOver: HTMLVideoElement | null = null;
  private _texBase: THREE.VideoTexture | null = null;
  private _texOver: THREE.VideoTexture | null = null;

  constructor(simulation: FluidSimulation) {
    this._simulation = simulation;

    const noise = resources.get<THREE.Texture>("noise/rgb-generated");
    noise.wrapS = noise.wrapT = THREE.RepeatWrapping;

    const reveal = createRevealConfig(window.innerWidth / window.innerHeight, "full-paint", 1.5);
    this._material = new THREE.ShaderMaterial({
      vertexShader: fullpaintVertexShader,
      fragmentShader: fullpaintFragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uAlpha: { value: 0 },
        uVisibleProgress: { value: 0 },
        uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
        uPaintTextureSize: { value: new THREE.Vector2(1920, 1080) },
        uColor: { value: new THREE.Color("#e9e6e0") },
        uPaintTexture: { value: null },
        uPaintTexture2: { value: null },
        uNoiseTexture: { value: noise },
        uSimulation: { value: null },
        uSimulationRemap: { value: new THREE.Vector4(0, 0, 1, 1) },
        uRevealPoints: { value: reveal.infos },
        uRevealPointsPos: { value: reveal.positions },
      },
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  get isVisible(): boolean {
    return this._visible;
  }

  get isForced(): boolean {
    return this._forced;
  }

  get sceneIndex(): number | null {
    return this._sceneIndex;
  }

  /** 视频元素缓存（懒加载，进入全幅绘画时才拉取） */
  private _videoCache = new Map<string, HTMLVideoElement>();

  private _getVideo(sceneIndex: number, layer: "base" | "over"): HTMLVideoElement {
    const key = `${layer}/${sceneIndex}`;
    let video = this._videoCache.get(key);
    if (!video) {
      const platform =
        "ontouchstart" in window || navigator.maxTouchPoints > 0 || window.innerWidth < 768
          ? "mobile"
          : "desktop";
      video = document.createElement("video");
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.crossOrigin = "anonymous";
      video.preload = "auto";
      video.src = `/assets/xp/videos/${platform}/${layer}/${sceneIndex}.mp4`;
      this._videoCache.set(key, video);
    }
    return video;
  }

  /** 进入全幅绘画 */
  show(sceneIndex: number): void {
    if (this._visible) return;
    this._visible = true;
    this._sceneIndex = sceneIndex;

    // 绑定该画作的两层视频纹理
    this._videoBase = this._getVideo(sceneIndex, "base");
    this._videoOver = this._getVideo(sceneIndex, "over");
    if (this._videoBase) {
      this._texBase = new THREE.VideoTexture(this._videoBase);
      this._texBase.encoding = THREE.sRGBEncoding;
      this._material.uniforms.uPaintTexture.value = this._texBase;
      const setSize = () =>
        this._material.uniforms.uPaintTextureSize.value.set(
          this._videoBase!.videoWidth || 1920,
          this._videoBase!.videoHeight || 1080,
        );
      if (this._videoBase.readyState >= 1) setSize();
      else this._videoBase.addEventListener("loadedmetadata", setSize, { once: true });
      this._videoBase.play().catch(() => {});
    }
    if (this._videoOver) {
      this._texOver = new THREE.VideoTexture(this._videoOver);
      this._texOver.encoding = THREE.sRGBEncoding;
      this._material.uniforms.uPaintTexture2.value = this._texOver;
      this._videoOver.play().catch(() => {});
    }

    this._material.uniforms.uSimulationRemap.value = this._simulation.regionRemap(sceneIndex);

    const u = this._material.uniforms;
    gsap.to(u.uAlpha, { value: 1, duration: 0.8, ease: "power2.out" });
    gsap.to(u.uVisibleProgress, { value: 3.8, duration: 1.9, ease: "none", delay: 0.21 });

    audioManager.switchThemeTo("loop-painting");
    bus.emit(FULLPAINT_EVENTS.SHOW);
  }

  /** 退出全幅绘画 */
  hide(): void {
    if (!this._visible) return;
    this._visible = false;
    const u = this._material.uniforms;
    gsap.to(u.uVisibleProgress, { value: 0, duration: 0.7, ease: "power2.in" });
    gsap.to(u.uAlpha, {
      value: 0,
      duration: 0.6,
      delay: 0.15,
      onComplete: () => {
        this._videoBase?.pause();
        this._videoOver?.pause();
        this._texBase?.dispose();
        this._texOver?.dispose();
        this._texBase = this._texOver = null;
        this._sceneIndex = null;
      },
    });
    audioManager.switchThemeTo("loop-main");
    bus.emit(FULLPAINT_EVENTS.HIDE);
  }

  update(): void {
    if (!this._visible) return;
    const sim = this._simulation.texture;
    if (this._material.uniforms.uSimulation.value !== sim) {
      this._material.uniforms.uSimulation.value = sim;
    }
    this._texBase && (this._texBase.needsUpdate = true);
    this._texOver && (this._texOver.needsUpdate = true);
  }

  resize(width: number, height: number): void {
    this._material.uniforms.uResolution.value.set(width, height);
  }
}

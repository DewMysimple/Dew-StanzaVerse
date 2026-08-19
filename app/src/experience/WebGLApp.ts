/**
 * WebGL 应用外壳：渲染器 + 渲染循环 + 多视图分层合成。
 *
 * 渲染顺序（对应原站 ViewManager 的分层）：
 *   1. 流体模拟推进
 *   2. 水彩主场景（滚动相机）—— 清屏绘制
 *   3. UI 覆盖层（漂浮诗句文字）—— 正交相机，不清屏
 *   4. 全幅绘画 —— 全屏四边形，不清屏
 *   5. 诗歌视图 —— 全屏四边形，不清屏
 */
import * as THREE from "three";
import gsap from "gsap";
import { scrollController } from "./scroll/ScrollController";
import type { WatercolorView } from "./world/WatercolorView";
import type { UIView } from "./world/UIView";
import type { PoemView } from "./world/PoemView";
import type { FullPaintManager } from "./paint/FullPaintManager";
import type { FluidSimulation } from "./paint/FluidSimulation";

interface WebGLAppOptions {
  renderer: THREE.WebGLRenderer;
  watercolorView: WatercolorView;
  uiView: UIView;
  poemView: PoemView;
  fullPaintManager: FullPaintManager;
  simulation: FluidSimulation;
  onFrame?: (delta: number) => void;
}

export class WebGLApp {
  renderer: THREE.WebGLRenderer;

  private _watercolor: WatercolorView;
  private _ui: UIView;
  private _poem: PoemView;
  private _fullPaint: FullPaintManager;
  private _simulation: FluidSimulation;
  private _onFrame?: (delta: number) => void;
  private _clock = new THREE.Clock();
  private _running = false;
  private _time = 0;

  /** 由 ExperienceManager 驱动 */
  fogState = { opaque: 0, occulted: 0 };

  constructor(options: WebGLAppOptions) {
    this._watercolor = options.watercolorView;
    this._ui = options.uiView;
    this._poem = options.poemView;
    this._fullPaint = options.fullPaintManager;
    this._simulation = options.simulation;
    this._onFrame = options.onFrame;
    // 渲染器由外部创建（KTX2 在资源加载前就需要 detectSupport）
    this.renderer = options.renderer;
  }

  get watercolorView(): WatercolorView {
    return this._watercolor;
  }

  start(): void {
    if (this._running) return;
    this._running = true;
    this._clock.start();
    gsap.ticker.add(this._tick);
  }

  stop(): void {
    this._running = false;
    gsap.ticker.remove(this._tick);
  }

  private _tick = (): void => {
    const delta = this._clock.getDelta();
    this._time += delta;

    scrollController.update(delta);
    this._onFrame?.(delta);
    this._simulation.update(delta);

    const sample = scrollController.sample;
    const triggerTime = sample.rawProgress * this._watercolor.scrollCamera.duration;
    this._watercolor.update(this._time, delta, sample.cameraTime, triggerTime, this.fogState);
    this._ui.update(scrollController.progress, this._time);
    this._fullPaint.update();

    const renderer = this.renderer;
    renderer.clear();

    // 1. 水彩主场景
    renderer.render(this._watercolor.scene, this._watercolor.scrollCamera.camera);

    // 2. UI 覆盖层（漂浮文字）
    if (this._ui.isVisible || this._ui.scene.visible) {
      renderer.render(this._ui.scene, this._ui.camera);
    }

    // 3. 全幅绘画
    if (this._fullPaint.isVisible) {
      renderer.render(this._fullPaint.scene, this._fullPaint.camera);
    }

    // 4. 诗歌视图
    if (this._poem.isVisible) {
      renderer.render(this._poem.scene, this._poem.camera);
    }
  };

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height);
    this._watercolor.resize(width, height);
    this._ui.resize(width, height);
    this._poem.resize(width, height);
    this._fullPaint.resize(width, height);
  }
}

/**
 * 绘画交互管理器。
 * - 指针在画布上移动时对画纸做射线检测，命中即在对应画作的
 *   流体模拟区域注入笔刷（splat）
 * - 长按（桌面 0.3s / 移动端 0.6s，与原站一致）进入全幅绘画模式
 * - 悬停在诗句文字上时通知光标组件显示 "See the poems"
 * - 点击文字 → 诗歌视图；点击画作主纸 → 全幅绘画
 */
import * as THREE from "three";
import { IS_MOBILE } from "../../config/assets";
import type { FluidSimulation } from "./FluidSimulation";
import type { FullPaintManager } from "./FullPaintManager";
import type { WatercolorView } from "../world/WatercolorView";
import type { BrushSample, RaycastHit } from "../types";

export const LONG_PRESS_TIME = IS_MOBILE ? 0.6 : 0.3;

const SOURCE_CURSOR_DIAMETER = 95;
const SOURCE_SPEED_MAX = 0.08;
const SOURCE_HOVER_SCALE_MIN = 0.2;
const SOURCE_HOVER_SCALE_MAX = 1.8;
const SOURCE_PRESS_SCALE = 0.2;

interface PaintCallbacks {
  isInteractionEnabled: () => boolean;
  isOverText: (ndcX: number, ndcY: number) => boolean;
  onTextClick: () => void;
  onCursorChange: (state: "default" | "text" | "paint") => void;
  getScrollProgress: () => number;
  onPointerMove: (x: number, y: number) => void;
}

export class PaintManager {
  private _simulation: FluidSimulation;
  private _fullPaint: FullPaintManager;
  private _view: WatercolorView;
  private _callbacks: PaintCallbacks;

  private _raycaster = new THREE.Raycaster();
  private _pointerTarget = new THREE.Vector2(-10, -10);
  private _pointerCurrent = new THREE.Vector2(-10, -10);
  private _pointerPrevious = new THREE.Vector2(-10, -10);
  private _pendingInputVelocity = new THREE.Vector2();
  private _lastInputAt = 0;
  private _client = new THREE.Vector2();
  private _pointerInitialized = false;
  private _pointerInside = false;
  private _pointerDown = false;
  private _pointerType = "mouse";
  private _reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  private _pressTimer: number | null = null;
  private _pressStart = new THREE.Vector2();
  private _downAt = 0;
  /** 按下时是否命中诗句文字（点击诗句不经过画纸长按链路，需要单独记录） */
  private _downOverText = false;
  private _downTitleScene: number | null = null;
  private _activePaperIndex: number | null = null;
  private _previousPaperUvs = new Map<number, THREE.Vector2>();
  private _previousPaperRadii = new Map<number, THREE.Vector2>();

  /** Last source-style brush sample, exposed to development QA only. */
  lastBrushSample: BrushSample | null = null;

  /** 当前悬停的画作编号（供调试/状态判断） */
  sceneIndex: number | null = null;

  constructor(
    simulation: FluidSimulation,
    fullPaint: FullPaintManager,
    view: WatercolorView,
    callbacks: PaintCallbacks,
  ) {
    this._simulation = simulation;
    this._fullPaint = fullPaint;
    this._view = view;
    this._callbacks = callbacks;
    this._bind();
  }

  private _bind(): void {
    window.addEventListener("pointermove", (e) => this._onMove(e));
    window.addEventListener("pointerdown", (e) => this._onDown(e));
    window.addEventListener("pointerup", (e) => this._onUp(e));
    window.addEventListener("pointercancel", () => this._onCancel());
    window.addEventListener("pointerleave", () => { this._pointerInside = false; });
  }

  private _ndc(e: PointerEvent): THREE.Vector2 {
    return new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  }

  private _onMove(e: PointerEvent): void {
    this._callbacks.onPointerMove(e.clientX, e.clientY);
    const ndc = this._ndc(e);
    const inputAt = performance.now();
    if (this._pointerInitialized) {
      const inputDelta = Math.max((inputAt - this._lastInputAt) / 1000, 1 / 240);
      const inputFrameCompensation = THREE.MathUtils.clamp((1 / 60) / inputDelta, 0.25, 4);
      this._pendingInputVelocity.copy(ndc).sub(this._pointerTarget).multiplyScalar(inputFrameCompensation);
    }
    this._lastInputAt = inputAt;
    this._pointerTarget.copy(ndc);
    this._client.set(e.clientX, e.clientY);
    this._pointerInside = true;
    this._pointerType = e.pointerType || "mouse";
    if (!this._pointerInitialized) {
      this._pointerCurrent.copy(ndc);
      this._pointerPrevious.copy(ndc);
      this._pointerInitialized = true;
    }
  }

  private _onDown(e: PointerEvent): void {
    this._onMove(e);
    this._pointerDown = true;
    this._pressStart.set(e.clientX, e.clientY);
    this._downAt = performance.now();

    if (!this._callbacks.isInteractionEnabled()) return;
    const ndc = this._ndc(e);
    // Scene titles render above the poem plane and therefore own overlapping
    // pixels on narrow mobile viewports.
    this._downTitleScene = this._view.hitTestTitle(ndc)?.sceneIndex ?? null;
    this._downOverText = this._downTitleScene == null && this._callbacks.isOverText(ndc.x, ndc.y);
    if (this._downTitleScene != null) return;

    const hit = this._raycastPapers(ndc);
    if (!hit) return;

    // 长按 → 全幅绘画
    this._pressTimer = window.setTimeout(() => {
      this._fullPaint.show(hit.sceneIndex);
      this._pressTimer = null;
    }, LONG_PRESS_TIME * 1000);
  }

  private _onUp(e: PointerEvent): void {
    const wasPressing = this._pressTimer != null;
    const downOverText = this._downOverText;
    const downTitleScene = this._downTitleScene;
    this._downOverText = false;
    this._downTitleScene = null;
    this._pointerDown = false;
    this._cancelPress();

    if (!this._callbacks.isInteractionEnabled()) return;
    // 小幅抬起视为点击
    const dist = Math.hypot(e.clientX - this._pressStart.x, e.clientY - this._pressStart.y);
    if (dist > 8) return;

    const ndc = this._ndc(e);
    const titleScene = downTitleScene ?? this._view.hitTestTitle(ndc)?.sceneIndex ?? null;
    if (titleScene != null) {
      this._fullPaint.show(titleScene);
      return;
    }

    // 点击诗句文字（按下或抬起位置命中笔画即可，不依赖画纸长按计时器）
    if (downOverText || this._callbacks.isOverText(ndc.x, ndc.y)) {
      this._callbacks.onTextClick();
      return;
    }

    // 未命中文字且未在长按画纸：无动作（长按已由 timer 触发时 FullPaint 接管）
    if (!wasPressing) return;
  }

  private _cancelPress(): void {
    if (this._pressTimer != null) {
      clearTimeout(this._pressTimer);
      this._pressTimer = null;
    }
  }

  private _onCancel(): void {
    this._pointerDown = false;
    this._pointerInside = false;
    this._downTitleScene = null;
    this._resetStrokeContinuity();
    this._cancelPress();
  }

  private _resetStrokeContinuity(): void {
    this._activePaperIndex = null;
  }

  /** Source-style continuous pointer sampling: damping and raycast happen every frame. */
  update(delta: number): void {
    if (!this._pointerInitialized || !this._pointerInside) {
      this.sceneIndex = null;
      this._view.setHoveredTitle(null);
      this._resetStrokeContinuity();
      return;
    }
    const alpha = 1 - Math.exp(-8 * Math.min(delta, 0.04));
    this._pointerPrevious.copy(this._pointerCurrent);
    this._pointerCurrent.lerp(this._pointerTarget, alpha);
    const move = new THREE.Vector2(
      (this._pointerCurrent.x - this._pointerPrevious.x) * window.innerWidth * 0.5,
      -(this._pointerCurrent.y - this._pointerPrevious.y) * window.innerHeight * 0.5,
    );
    const ndcVelocity = this._pointerCurrent.clone().sub(this._pointerPrevious);
    // The source curve was authored around a 60 Hz frame. Normalizing the
    // damped delta keeps the same 0.2..1.8 response at both 60 and 120 Hz.
    const frameCompensation = THREE.MathUtils.clamp((1 / 60) / Math.max(delta, 1 / 240), 0.25, 4);
    const pendingInputVelocity = this._pendingInputVelocity.clone();
    this._pendingInputVelocity.set(0, 0);

    if (this._fullPaint.isVisible && this._fullPaint.sceneIndex != null) {
      this._view.setHoveredTitle(null);
      if (!this._reducedMotion && move.lengthSq() > 0.002 && (this._pointerType === "mouse" || this._pointerDown)) {
        const uv = new THREE.Vector2(this._client.x / window.innerWidth, this._client.y / window.innerHeight);
        this._simulation.splatScene(this._fullPaint.sceneIndex, uv, move, this._pointerDown ? 1.55 : 1.1);
      }
      return;
    }

    if (!this._callbacks.isInteractionEnabled()) return;
    const titleHit = this._view.hitTestTitle(this._pointerCurrent);
    if (titleHit) {
      this.sceneIndex = titleHit.sceneIndex;
      this._view.setHoveredTitle(titleHit.sceneIndex);
      this._callbacks.onCursorChange("paint");
      this._resetStrokeContinuity();
      return;
    }
    this._view.setHoveredTitle(null);
    if (this._callbacks.isOverText(this._pointerCurrent.x, this._pointerCurrent.y)) {
      this._callbacks.onCursorChange("text");
      this.sceneIndex = null;
      this._resetStrokeContinuity();
      return;
    }

    const hit = this._raycastPapers(this._pointerCurrent);
    if (!hit) {
      this.sceneIndex = null;
      this._resetStrokeContinuity();
      this._callbacks.onCursorChange("default");
      return;
    }

    this.sceneIndex = hit.sceneIndex;
    this._callbacks.onCursorChange("paint");
    const mobileCanPaint = this._pointerType === "mouse" || this._pointerDown;
    if (!this._reducedMotion && mobileCanPaint && move.lengthSq() > 0.002) {
      const projectedSize = this._view.getHitProjectedSize(hit, this._view.scrollCamera.camera);
      const simulationBox = this._view.getSimulationBox(hit);
      const currentUv = this._view.mapHitUvToSimulation(hit);
      const storedPrevious = this._previousPaperUvs.get(hit.paperIndex);
      const storedRadius = this._previousPaperRadii.get(hit.paperIndex);
      const previousUv = this._activePaperIndex === hit.paperIndex && storedPrevious
        ? storedPrevious.clone()
        : currentUv.clone();
      const velocity = currentUv.clone().sub(previousUv);
      const largestProjectedSide = Math.max(projectedSize.x, projectedSize.y, 1);
      const sourceInputMove = new THREE.Vector2(
        pendingInputVelocity.x * window.innerWidth * 0.5,
        -pendingInputVelocity.y * window.innerHeight * 0.5,
      );
      const normalizedSpeed = THREE.MathUtils.clamp(
        Math.max(move.length() * frameCompensation, sourceInputMove.length()) / largestProjectedSide,
        0,
        SOURCE_SPEED_MAX,
      );
      const sourceScale = this._pointerDown
        ? SOURCE_PRESS_SCALE
        : THREE.MathUtils.mapLinear(
          normalizedSpeed,
          0,
          SOURCE_SPEED_MAX,
          SOURCE_HOVER_SCALE_MIN,
          SOURCE_HOVER_SCALE_MAX,
        );
      const visibleDiameter = SOURCE_CURSOR_DIAMETER * sourceScale;

      // Convert the desired screen-space circle into a region-local ellipse. The
      // shader evaluates this ellipse in the packed simulation tile, so its
      // projection remains circular even on tall or wide pieces of paper.
      const paperBoxWidth = Math.max(simulationBox.z - simulationBox.x, 1e-4);
      const paperBoxHeight = Math.max(simulationBox.w - simulationBox.y, 1e-4);
      const fullProjectedWidth = Math.max(projectedSize.x / paperBoxWidth, 1);
      const fullProjectedHeight = Math.max(projectedSize.y / paperBoxHeight, 1);
      const currentRadius = new THREE.Vector2(
        (visibleDiameter * 0.5) / fullProjectedWidth,
        (visibleDiameter * 0.5) / fullProjectedHeight,
      );
      const previousRadius = this._activePaperIndex === hit.paperIndex && storedRadius
        ? storedRadius.clone()
        : currentRadius.clone();
      const region = this._simulation.regionForPaper(hit.paperIndex);
      const sample: BrushSample = {
        paperIndex: hit.paperIndex,
        previousUv,
        currentUv,
        ndcVelocity: ndcVelocity.clone().multiplyScalar(frameCompensation),
        normalizedSpeed,
        sourceScale,
        projectedSize,
        previousRadius,
        currentRadius,
        visibleDiameter,
        simulationSize: new THREE.Vector2(region?.width ?? 1, region?.height ?? 1),
        paperRatio: fullProjectedWidth / fullProjectedHeight,
        velocity,
        pressed: this._pointerDown,
        intensity: 0.06,
      };
      this.lastBrushSample = sample;
      this._simulation.splat(sample);
      this._previousPaperRadii.set(hit.paperIndex, currentRadius);
    }
    this._previousPaperUvs.set(hit.paperIndex, this._view.mapHitUvToSimulation(hit));
    this._activePaperIndex = hit.paperIndex;
  }

  private _raycastPapers(ndc: THREE.Vector2): RaycastHit | null {
    this._raycaster.setFromCamera(ndc, this._view.scrollCamera.camera);
    return this._view.raycastPaper(this._raycaster);
  }
}

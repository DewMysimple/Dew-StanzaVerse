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

export const LONG_PRESS_TIME = IS_MOBILE ? 0.6 : 0.3;

interface PaintCallbacks {
  isInteractionEnabled: () => boolean;
  isOverText: (ndcX: number, ndcY: number) => boolean;
  onTextClick: () => void;
  onCursorChange: (state: "default" | "text" | "paint") => void;
  getScrollProgress: () => number;
}

export class PaintManager {
  private _simulation: FluidSimulation;
  private _fullPaint: FullPaintManager;
  private _view: WatercolorView;
  private _callbacks: PaintCallbacks;

  private _raycaster = new THREE.Raycaster();
  private _pointer = new THREE.Vector2(-10, -10);
  private _lastPointer = new THREE.Vector2();
  private _pressTimer: number | null = null;
  private _pressStart = new THREE.Vector2();
  private _downAt = 0;
  /** 按下时是否命中诗句文字（点击诗句不经过画纸长按链路，需要单独记录） */
  private _downOverText = false;

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
    window.addEventListener("pointercancel", () => this._cancelPress());
  }

  private _ndc(e: PointerEvent): THREE.Vector2 {
    return new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  }

  private _onMove(e: PointerEvent): void {
    const ndc = this._ndc(e);
    const move = new THREE.Vector2(e.clientX - this._lastPointer.x, e.clientY - this._lastPointer.y);
    this._lastPointer.set(e.clientX, e.clientY);
    this._pointer.copy(ndc);

    // 全幅绘画模式：屏幕 uv 直接驱动模拟
    if (this._fullPaint.isVisible && this._fullPaint.sceneIndex != null) {
      if (move.lengthSq() > 0.01) {
        const uv = new THREE.Vector2(e.clientX / window.innerWidth, e.clientY / window.innerHeight);
        this._simulation.splat(this._fullPaint.sceneIndex, uv, move, 1.4);
      }
      return;
    }

    if (!this._callbacks.isInteractionEnabled()) return;

    // 文字悬停
    const overText = this._callbacks.isOverText(ndc.x, ndc.y);
    if (overText) {
      this._callbacks.onCursorChange("text");
      this.sceneIndex = null;
      return;
    }

    // 画纸射线检测
    const hit = this._raycastPapers(ndc);
    if (hit) {
      this.sceneIndex = hit.sceneIndex;
      this._callbacks.onCursorChange("paint");
      if (move.lengthSq() > 0.01) {
        this._simulation.splat(hit.sceneIndex, hit.uv, move);
      }
    } else {
      this.sceneIndex = null;
      this._callbacks.onCursorChange("default");
    }
  }

  private _onDown(e: PointerEvent): void {
    this._pressStart.set(e.clientX, e.clientY);
    this._downAt = performance.now();

    if (!this._callbacks.isInteractionEnabled()) return;
    const ndc = this._ndc(e);
    // 记录按下点是否落在诗句文字上（点击文字不设长按计时器，但抬起时要用）
    this._downOverText = this._callbacks.isOverText(ndc.x, ndc.y);

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
    this._downOverText = false;
    this._cancelPress();

    if (!this._callbacks.isInteractionEnabled()) return;
    // 小幅抬起视为点击
    const dist = Math.hypot(e.clientX - this._pressStart.x, e.clientY - this._pressStart.y);
    if (dist > 8) return;

    // 点击诗句文字（按下或抬起位置命中笔画即可，不依赖画纸长按计时器）
    const ndc = this._ndc(e);
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

  private _raycastPapers(ndc: THREE.Vector2): { sceneIndex: number; uv: THREE.Vector2 } | null {
    this._raycaster.setFromCamera(ndc, this._view.scrollCamera.camera);
    const meshes = this._view.papers.filter((p) => p.revealed).map((p) => p.mesh);
    const hits = this._raycaster.intersectObjects(meshes, false);
    if (!hits.length || !hits[0].uv) return null;
    const mesh = hits[0].object as THREE.Mesh;
    const paper = this._view.papers.find((p) => p.mesh === mesh);
    if (!paper) return null;
    return { sceneIndex: paper.config.sceneIndex, uv: hits[0].uv.clone() };
  }
}

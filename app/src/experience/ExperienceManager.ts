/**
 * 体验管理器 —— 全局状态机与转场编排。
 * 对应原站 ExperienceManager（app.beautified.js 约 173,512 行）：
 *
 * transitionState: { fromView, toView, fromOverlay, toOverlay, inTransition, meta }
 * meta ∈ restart | showPoem | hidePoem | poemToOffers
 *
 * 状态流：
 *   Watercolor + UI
 *     ├─ 点击诗句     → Poem 全屏 → 返回 → Watercolor + UI
 *     ├─ 长按画纸     → FullPaint 展开 → Back → Watercolor + UI
 *     └─ 滚动到底     → poemToOffers → DOM 权益区（Restart 重置）
 *
 * 同时拥有 fogState（opaque / occulted），通过 GSAP 渐变驱动所有材质的
 * uFogState，实现进入权益区时场景被雾遮蔽的效果。
 */
import * as THREE from "three";
import gsap from "gsap";
import { bus, EVENTS } from "../core/EventBus";
import { scrollController } from "./scroll/ScrollController";
import { audioManager } from "./audio/AudioManager";
import { WebGLApp } from "./WebGLApp";
import { WatercolorView } from "./world/WatercolorView";
import { UIView } from "./world/UIView";
import { PoemView } from "./world/PoemView";
import { TextCanvas } from "./world/TextCanvas";
import { FluidSimulation } from "./paint/FluidSimulation";
import { FullPaintManager, FULLPAINT_EVENTS } from "./paint/FullPaintManager";
import { PaintManager } from "./paint/PaintManager";
import type { ExperiencePhase, ExperienceState } from "./types";

type TransitionMeta = "restart" | "showPoem" | "hidePoem" | "poemToOffers" | null;

interface TransitionState {
  inTransition: boolean;
  toView: string | null;
  fromView: string | null;
  toOverlay: string | null;
  fromOverlay: string | null;
  meta: TransitionMeta;
}

export class ExperienceManager {
  private _canvas: HTMLCanvasElement | null = null;
  private _webglApp: WebGLApp | null = null;
  private _watercolorView = new WatercolorView();
  private _textCanvas = new TextCanvas();
  private _uiView: UIView | null = null;
  private _poemView: PoemView | null = null;
  private _simulation: FluidSimulation | null = null;
  private _fullPaintManager: FullPaintManager | null = null;
  private _paintManager: PaintManager | null = null;

  private _hasStarted = false;
  private _showOffers = false;
  private _isOverPoem = false;
  private _fogState = { opaque: 0, occulted: 0 };
  private _state: ExperienceState = {
    phase: "loading",
    started: false,
    inTransition: false,
    sceneIndex: null,
    fog: this._fogState,
  };
  private _transitionState: TransitionState = {
    inTransition: false,
    toView: null,
    fromView: null,
    toOverlay: null,
    fromOverlay: null,
    meta: null,
  };
  private _currentTimeline: gsap.core.Timeline | null = null;

  get fogState(): { opaque: number; occulted: number } {
    return this._fogState;
  }

  get state(): ExperienceState {
    return this._state;
  }

  get textCanvas(): TextCanvas {
    return this._textCanvas;
  }

  get transitionState(): TransitionState {
    return this._transitionState;
  }

  get isOverPoem(): boolean {
    return this._isOverPoem;
  }

  /** 绘画交互是否可用（与原站 isPaintInteractionEnabled 的判定一致） */
  get isPaintInteractionEnabled(): boolean {
    return !(
      !this._hasStarted ||
      this._transitionState.inTransition ||
      this._showOffers ||
      this._transitionState.meta === "showPoem" ||
      this._poemView?.isVisible ||
      this._fullPaintManager?.isForced ||
      this._fullPaintManager?.isVisible
    );
  }

  /** 资源就绪后调用：构建全部模块（renderer 由入口创建，KTX2 依赖它） */
  init(canvas: HTMLCanvasElement, renderer: THREE.WebGLRenderer): void {
    this._canvas = canvas;

    this._simulation = new FluidSimulation(renderer);
    this._watercolorView.init(this._simulation);
    this._uiView = new UIView(this._textCanvas);
    this._uiView.init();
    this._poemView = new PoemView();
    this._fullPaintManager = new FullPaintManager(this._simulation);

    this._webglApp = new WebGLApp({
      renderer,
      watercolorView: this._watercolorView,
      uiView: this._uiView,
      poemView: this._poemView,
      fullPaintManager: this._fullPaintManager,
      simulation: this._simulation,
      onFrame: (delta) => this._paintManager?.update(delta),
    });

    this._paintManager = new PaintManager(this._simulation, this._fullPaintManager, this._watercolorView, {
      isInteractionEnabled: () => this.isPaintInteractionEnabled,
      isOverText: (x, y) => this.checkPoemIntersection(x, y),
      onTextClick: () => this.showFullscreenPoem(),
      onCursorChange: (state) => bus.emit("cursor-state", state),
      getScrollProgress: () => scrollController.progress,
      onPointerMove: (x, y) => {
        this._uiView?.setCursor(x, y);
        this._watercolorView.setPointer(x, y);
      },
    });

    bus.on(EVENTS.SHOW_OFFERS, () => this._handleShowOffers());
    bus.on(EVENTS.HIDE_OFFERS, () => this._handleHideOffers());

    // 全幅绘画显隐时联动 Back 按钮
    bus.on(FULLPAINT_EVENTS.SHOW, () => {
      this._setFullpaintBackVisible(true);
      document.getElementById("scroll-to-explore")?.classList.add("hidden");
      this._state.sceneIndex = this._fullPaintManager?.sceneIndex ?? null;
      this._setPhase("full-paint");
    });
    bus.on(FULLPAINT_EVENTS.HIDE, () => {
      this._setFullpaintBackVisible(false);
      this._state.sceneIndex = null;
      this._setPhase("scroll");
    });
  }

  /** 退出全幅绘画（Back 按钮调用） */
  hideFullPaint(): void {
    this._fullPaintManager?.hide();
    this._setFullpaintBackVisible(false);
  }

  /** Loader 完成后启动体验 */
  start(): void {
    this._hasStarted = true;
    this._state.started = true;
    this._setPhase("scroll");
    this._webglApp!.start();
    this._uiView!.show();
    audioManager.switchThemeTo("loop-main");
    audioManager.start();

    // 画布淡入
    gsap.to(this._canvas!, { opacity: 1, duration: 1.4, ease: "power2.out" });

    // “Scroll to explore” 提示
    const hint = document.getElementById("scroll-to-explore");
    hint?.classList.remove("hidden");
    const hideHint = () => {
      if (window.scrollY > 10) {
        hint?.classList.add("hidden");
        window.removeEventListener("scroll", hideHint);
      }
    };
    window.addEventListener("scroll", hideHint);

  }

  /** 展示全屏诗歌 */
  showFullscreenPoem(): void {
    if (this._transitionState.inTransition) return;
    this._fullPaintManager?.hide();
    this._fillTransitionState("Poem", null, "showPoem");
    this._setPhase("poem");

    const tl = gsap.timeline({
      onComplete: () => this._emptyTransitionState(),
    });
    tl.add(this._uiView!.hide(), 0);
    tl.add(() => audioManager.switchThemeTo("loop-poem"), 0);
    tl.add(this._poemView!.show(), 0.3);
    tl.add(() => this._setPoemBackVisible(true), 0.6);

    this._swapTimeline(tl);
  }

  /** 关闭全屏诗歌 */
  hideFullscreenPoem(): void {
    if (this._transitionState.inTransition && this._transitionState.meta !== "showPoem") return;
    if (this._transitionState.meta === "showPoem") {
      this._currentTimeline?.kill();
      this._emptyTransitionState();
    }
    this._fillTransitionState("Watercolor", "UI", "hidePoem");
    this._setPhase("scroll");

    const tl = gsap.timeline({
      onComplete: () => this._emptyTransitionState(),
    });
    tl.add(() => this._setPoemBackVisible(false), 0);
    tl.add(this._poemView!.hide(), 0);
    tl.add(() => audioManager.switchThemeTo("loop-main"), 0);
    tl.add(this._uiView!.show(), 0.4);

    this._swapTimeline(tl);
  }

  /** 重启体验（权益区 Restart 按钮） */
  restart(): void {
    if (this._transitionState.inTransition) return;
    this._fillTransitionState("XP", null, "restart");
    this._setPhase("restart");

    const tl = gsap.timeline({
      onComplete: () => this._emptyTransitionState(),
    });
    tl.add(this._uiView!.hide(), 0);
    tl.to(this._canvas!, { opacity: 0, duration: 0.6, ease: "power1.in" }, 0);
    tl.add(() => {
      scrollController.scrollToTop();
      this._watercolorView.hideAll();
      this._simulation?.reset();
      this._uiView!.reset();
      this._fullPaintManager?.hide();
      this._setPoemBackVisible(false);
      this._setFullpaintBackVisible(false);
      this._setPhase("scroll");
    }, 0.6);
    tl.to(this._canvas!, { opacity: 1, duration: 1.0, ease: "power2.out" }, 1.0);
    tl.add(this._uiView!.show(), 1.2);

    this._swapTimeline(tl);
  }

  /** 鼠标是否悬停在诗句文字上（供 PaintManager） */
  checkPoemIntersection(ndcX: number, ndcY: number): boolean {
    if (!this.isPaintInteractionEnabled || !this._uiView) return false;
    return this._uiView.checkTextIntersection(ndcX, ndcY, scrollController.progress);
  }

  /** 雾切换到遮蔽态（进入权益区） */
  switchFogToOcculted(duration = 1.1): void {
    gsap.to(this._fogState, { occulted: 1, duration, ease: "power1.out" });
  }

  /** 雾切换到基础态 */
  switchFogToBase(duration = 1.1): void {
    gsap.to(this._fogState, { occulted: 0, opaque: 0, duration, ease: "power1.inOut" });
  }

  /** 雾切换到全遮蔽（视图转场用） */
  switchFogToOpaque(duration = 0.8): void {
    gsap.to(this._fogState, { opaque: 1, duration, ease: "power1.inOut" });
  }

  setFullpaintBackVisible(visible: boolean): void {
    this._setFullpaintBackVisible(visible);
  }

  onResize(width: number, height: number): void {
    this._webglApp?.resize(width, height);
  }

  /** 每帧把 fogState 同步给渲染循环 */
  syncFrame(): void {
    if (this._webglApp) {
      this._webglApp.fogState.opaque = this._fogState.opaque;
      this._webglApp.fogState.occulted = this._fogState.occulted;
    }
  }

  private _handleShowOffers(): void {
    this._showOffers = true;
    this.switchFogToOcculted(1.1);
    // 权益区出现时隐藏漂浮文字
    this._uiView?.hide();
    this._setPhase("content");
  }

  private _handleHideOffers(): void {
    this._showOffers = false;
    this.switchFogToBase(1.1);
    if (this._hasStarted && !this._poemView?.isVisible) {
      this._uiView?.show();
    }
    this._setPhase("scroll");
  }

  private _setPoemBackVisible(visible: boolean): void {
    const btn = document.getElementById("poem-back");
    if (!btn) return;
    btn.classList.toggle("is-visible", visible);
    gsap.to(btn, { opacity: visible ? 1 : 0, duration: 0.4 });
  }

  private _setFullpaintBackVisible(visible: boolean): void {
    const btn = document.getElementById("fullpaint-back");
    if (!btn) return;
    btn.classList.toggle("is-visible", visible);
    gsap.to(btn, { opacity: visible ? 1 : 0, duration: 0.4 });
  }

  private _fillTransitionState(toView: string | null, toOverlay: string | null, meta: TransitionMeta): void {
    this._transitionState.fromView = "Watercolor";
    this._transitionState.fromOverlay = "UI";
    this._transitionState.toView = toView;
    this._transitionState.toOverlay = toOverlay;
    this._transitionState.inTransition = true;
    this._transitionState.meta = meta;
    this._state.inTransition = true;
  }

  private _emptyTransitionState(): void {
    this._transitionState.fromView = null;
    this._transitionState.fromOverlay = null;
    this._transitionState.toView = null;
    this._transitionState.toOverlay = null;
    this._transitionState.inTransition = false;
    this._transitionState.meta = null;
    this._state.inTransition = false;
  }

  private _setPhase(phase: ExperiencePhase): void {
    this._state.phase = phase;
    document.documentElement.dataset.experiencePhase = phase;
  }

  private _swapTimeline(tl: gsap.core.Timeline): void {
    this._currentTimeline?.kill();
    this._currentTimeline = tl;
  }
}

/**
 * 渲染器由 main.ts 统一创建（KTX2 在资源加载前就需要 detectSupport），
 * 经 init(canvas, renderer) 传入，全程只有一个 WebGL 上下文。
 */
export const experienceManager = new ExperienceManager();

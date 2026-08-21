/**
 * 加载画面（Loader Experience）。
 * 对应原站 LoaderExperience 模块：
 * - 注入双圆环 SVG（静态圆 + 进度圆，stroke-dasharray 290 与原站一致）
 * - 资源进度驱动 stroke-dashoffset 画圆
 * - 完成后文字变为 "Enter" 并可点击
 * - 点击后淡出加载层，发出 START_WATERCOLOR 事件启动体验
 */
import gsap from "gsap";
import { bus, EVENTS } from "../core/EventBus";
import { audioManager } from "../experience/audio/AudioManager";

const CIRCUMFERENCE = 290;

export class LoaderExperience {
  private _el: HTMLElement | null = null;
  private _middle: HTMLElement | null = null;
  private _text: HTMLElement | null = null;
  private _description: HTMLElement | null = null;
  private _animatedCircle: SVGCircleElement | null = null;
  private _ready = false;
  private _entered = false;

  init(): void {
    this._el = document.getElementById("loader");
    if (!this._el) return;
    this._middle = this._el.querySelector(".middle-w");
    this._text = this._el.querySelector(".loading-text");
    this._description = this._el.querySelector(".enter-description");

    // 注入双圆环（对应原站 .loader-circle / .static-circle / .animated-circle）
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("class", "loader-circle center");
    svg.setAttribute("viewBox", "0 0 100 100");

    const staticCircle = document.createElementNS(svgNS, "circle");
    staticCircle.setAttribute("class", "static-circle");
    staticCircle.setAttribute("cx", "50");
    staticCircle.setAttribute("cy", "50");
    staticCircle.setAttribute("r", "46");
    staticCircle.setAttribute("stroke", "#413a39");
    staticCircle.setAttribute("fill", "none");

    const animated = document.createElementNS(svgNS, "circle");
    animated.setAttribute("class", "animated-circle");
    animated.setAttribute("cx", "50");
    animated.setAttribute("cy", "50");
    animated.setAttribute("r", "46");
    animated.setAttribute("stroke", "#413a39");
    animated.setAttribute("fill", "none");

    svg.appendChild(staticCircle);
    svg.appendChild(animated);
    this._middle?.insertBefore(svg, this._middle.firstChild);
    this._animatedCircle = animated;

    bus.on(EVENTS.RESOURCES_PROGRESS, (p) => this.setProgress((p as number) ?? 0));
    bus.on(EVENTS.RESOURCES_COMPLETE, () => this._onComplete());
    // 入场事件可能来自点击，也可能来自 #autostart 调试入口
    bus.on(EVENTS.START_WATERCOLOR, () => this._fadeOut());

    this._middle?.addEventListener("click", () => this._onEnter());
  }

  /** 进度 0~1 → 画圆 */
  setProgress(progress: number): void {
    if (!this._animatedCircle || this._ready) return;
    this._animatedCircle.style.strokeDashoffset = `${CIRCUMFERENCE * (1 - Math.min(progress, 1))}`;
  }

  private _onComplete(): void {
    if (this._ready) return;
    this._ready = true;
    this.setProgress(1);
    this._animatedCircle!.style.strokeDashoffset = "0";

    // 文字 Loading → Enter，说明文字浮现，圆环可点击
    gsap.to(this._text, {
      opacity: 0,
      duration: 0.4,
      onComplete: () => {
        if (this._text) this._text.textContent = "Enter";
        gsap.to(this._text, { opacity: 1, duration: 0.4 });
      },
    });
    gsap.to(this._description, { opacity: 1, duration: 0.8, delay: 0.3 });
    this._middle?.classList.add("loaded");
  }

  private _onEnter(): void {
    if (!this._ready || this._entered) return;
    this._entered = true;
    audioManager.activateFromGesture();
    bus.emit(EVENTS.START_WATERCOLOR);
  }

  private _fadeOut(): void {
    if (!this._el || this._el.style.display === "none") return;
    gsap.to(this._el, {
      opacity: 0,
      duration: 0.9,
      ease: "power2.inOut",
      onComplete: () => {
        if (this._el) this._el.style.display = "none";
      },
    });
  }
}

export const loaderExperience = new LoaderExperience();

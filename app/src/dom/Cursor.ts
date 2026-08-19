/**
 * 自定义光标。
 * 对应原站 Cursor 模块：95px 双圆环跟随鼠标，
 * - pointerdown → 内圆放大（is-down）
 * - 悬停诗句   → 外圆放大 + 显示 "See the poems"（is-hover-text）
 * - 悬停画纸   → 外圆微放大（is-hover-paint）
 * 仅桌面端激活（触屏隐藏）。
 */
import gsap from "gsap";
import { bus, EVENTS } from "../core/EventBus";
import { IS_MOBILE } from "../config/assets";

type CursorState = "default" | "text" | "paint";

export class Cursor {
  private _el: HTMLElement | null = null;
  private _xTo: ((v: number) => void) | null = null;
  private _yTo: ((v: number) => void) | null = null;
  private _shown = false;

  init(): void {
    if (IS_MOBILE) return;
    this._el = document.getElementById("cursor");
    if (!this._el) return;

    // 元素 95×95，让圆心对准指针
    this._xTo = gsap.quickTo(this._el, "x", { duration: 0.45, ease: "power3.out" });
    this._yTo = gsap.quickTo(this._el, "y", { duration: 0.45, ease: "power3.out" });

    window.addEventListener("mousemove", (e) => {
      if (!this._shown) {
        this._shown = true;
        this._el!.classList.add("active");
        gsap.set(this._el, { x: e.clientX - 47.5, y: e.clientY - 47.5 });
      }
      this._xTo!(e.clientX - 47.5);
      this._yTo!(e.clientY - 47.5);
    });

    window.addEventListener("pointerdown", () => this._el!.classList.add("is-down"));
    window.addEventListener("pointerup", () => this._el!.classList.remove("is-down"));

    // PaintManager 经事件总线汇报悬停目标
    bus.on("cursor-state", (state) => this._setState((state as CursorState) ?? "default"));

    // 体验开始后去掉 loading 态
    bus.on(EVENTS.START_WATERCOLOR, () => this._el!.classList.remove("loading"));
  }

  private _setState(state: CursorState): void {
    if (!this._el) return;
    this._el.classList.toggle("is-hover-text", state === "text");
    this._el.classList.toggle("is-hover-paint", state === "paint");
  }
}

export const cursor = new Cursor();

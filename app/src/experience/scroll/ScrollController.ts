/**
 * 滚动控制器。
 * 原站使用 GSAP ScrollSmoother（Club 插件）；复刻版用自定义的
 * 线性插值平滑滚动替代，职责相同：
 * - 把 window.scrollY 平滑化为 currentScroll
 * - 换算成体验进度（0~1）与相机时间（秒）
 * - 越过体验区末尾时发出 进入/离开权益区 事件
 */
import { bus, EVENTS } from "../../core/EventBus";
import { CAMERA_ANIMATION_DURATION } from "../../config/papers";
import type { ScrollSample } from "../types";

const CAMERA_TAIL_SECONDS = 10;
const DAMPING_LAMBDA = 14;
const MAX_PROGRESS_LAG = 0.015;
const TRAVEL_MULTIPLIER = 2.5;

export class ScrollController {
  /** 平滑后的滚动位置（px） */
  current = 0;
  /** 目标滚动位置（px） */
  target = 0;

  private _xpHeight = 0;
  private _contentHeight = 0;
  private _effectiveTravel = 0;
  private _xpTop = 0;
  private _duration = CAMERA_ANIMATION_DURATION;
  private _offersShown = false;
  private _enabled = true;
  private _rawProgress = 0;
  private _dampedProgress = 0;
  private _sectionProgress = 0;
  private _velocity = 0;
  private _direction: -1 | 0 | 1 = 0;

  init(): void {
    this._layout();
    window.addEventListener("resize", () => this._layout());
  }

  private _layout(): void {
    const xpSection = document.getElementById("xp-section");
    const scrollSizer = xpSection?.querySelector<HTMLElement>(".xp-text-w");
    if (!xpSection || !scrollSizer) return;
    xpSection.style.removeProperty("height");
    xpSection.style.removeProperty("min-height");
    this._xpTop = xpSection.offsetTop;
    this._contentHeight = Math.max(scrollSizer.offsetHeight, window.innerHeight);
    this._xpHeight = this._contentHeight * TRAVEL_MULTIPLIER;
    // The source maps 0..1 to the main camera and 1..2 to its final ten seconds.
    this._effectiveTravel = this._xpHeight * 2;
    xpSection.style.minHeight = `${Math.ceil(this._effectiveTravel + window.innerHeight * 0.5)}px`;
  }

  /** 体验进度 0~1（仅覆盖体验区部分） */
  get progress(): number {
    return Math.min(this._sectionProgress, 1);
  }

  /** 相机时间（秒），映射进烘焙相机动画 */
  get cameraTime(): number {
    return this._dampedProgress * this._duration;
  }

  get sample(): ScrollSample {
    return {
      rawProgress: this._rawProgress,
      dampedProgress: this._dampedProgress,
      sectionProgress: this._sectionProgress,
      cameraTime: this.cameraTime,
      direction: this._direction,
      velocity: this._velocity,
      contentHeight: this._contentHeight,
      travelMultiplier: TRAVEL_MULTIPLIER,
      effectiveTravel: this._effectiveTravel,
    };
  }

  setCameraDuration(duration: number): void {
    if (Number.isFinite(duration) && duration > CAMERA_TAIL_SECONDS) this._duration = duration;
    this._layout();
  }

  /** 是否已经进入权益区 */
  get isShowingOffers(): boolean {
    return this._offersShown;
  }

  set enabled(value: boolean) {
    this._enabled = value;
  }

  update(delta = 1 / 60): void {
    this.target = window.scrollY;
    const localScroll = Math.max(0, this.target - this._xpTop);
    const sectionProgress = localScroll / Math.max(this._xpHeight, 1);
    const mainDuration = this._duration - CAMERA_TAIL_SECONDS;
    const rawCameraTime = sectionProgress <= 1
      ? Math.min(sectionProgress, 1) * mainDuration
      : mainDuration + Math.min(sectionProgress - 1, 1) * CAMERA_TAIL_SECONDS;
    const nextRaw = Math.min(Math.max(rawCameraTime / this._duration, 0), 1);
    const previousRaw = this._rawProgress;
    this._rawProgress = nextRaw;

    if (!this._enabled) {
      this._dampedProgress = nextRaw;
    } else {
      const safeDelta = Math.min(Math.max(delta, 0), 0.05);
      const alpha = 1 - Math.exp(-DAMPING_LAMBDA * safeDelta);
      this._dampedProgress += (nextRaw - this._dampedProgress) * alpha;
      this._dampedProgress = Math.min(
        Math.max(this._dampedProgress, nextRaw - MAX_PROGRESS_LAG),
        nextRaw + MAX_PROGRESS_LAG,
      );
      if (Math.abs(nextRaw - this._dampedProgress) < 0.00005) this._dampedProgress = nextRaw;
    }

    this.current = this._dampedProgress * this._duration;
    this._sectionProgress = this._cameraTimeToSectionProgress(this.cameraTime);
    this._velocity = delta > 0 ? (nextRaw - previousRaw) / delta : 0;
    this._direction = Math.abs(this._velocity) < 0.0001 ? 0 : this._velocity > 0 ? 1 : -1;

    const sectionBottom = this._xpTop + this._effectiveTravel;
    const inOffers = this.target > sectionBottom - window.innerHeight * 0.5;
    if (inOffers && !this._offersShown) {
      this._offersShown = true;
      bus.emit(EVENTS.SHOW_OFFERS);
    } else if (!inOffers && this._offersShown) {
      this._offersShown = false;
      bus.emit(EVENTS.HIDE_OFFERS);
    }
  }

  /** 重启体验：回到顶部 */
  scrollToTop(): void {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    this.current = 0;
    this.target = 0;
    this._rawProgress = 0;
    this._dampedProgress = 0;
    this._sectionProgress = 0;
  }

  scrollToCameraTime(time: number): void {
    const mainDuration = this._duration - CAMERA_TAIL_SECONDS;
    const sectionProgress = time <= mainDuration
      ? time / mainDuration
      : 1 + (time - mainDuration) / CAMERA_TAIL_SECONDS;
    window.scrollTo({ top: this._xpTop + sectionProgress * this._xpHeight, behavior: "instant" as ScrollBehavior });
  }

  private _cameraTimeToSectionProgress(time: number): number {
    const mainDuration = this._duration - CAMERA_TAIL_SECONDS;
    return time <= mainDuration
      ? Math.max(time / mainDuration, 0)
      : 1 + Math.min((time - mainDuration) / CAMERA_TAIL_SECONDS, 1);
  }
}

export const scrollController = new ScrollController();

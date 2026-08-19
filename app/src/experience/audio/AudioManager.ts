/**
 * 音频管理器。
 * 与原站一致：使用 HTML <audio> 元素而非 WebAudio 封装库，
 * 首次用户交互后才允许播放，GSAP 渐变 volume 做主题切换：
 * - loop-main     主场景环境声
 * - loop-poem     诗歌全屏时
 * - loop-painting 全幅绘画模式
 * - over-cta-*    按钮音效
 */
import gsap from "gsap";

type ThemeName = "loop-main" | "loop-poem" | "loop-painting";

const THEME_VOLUME: Record<ThemeName, number> = {
  "loop-main": 0.6,
  "loop-poem": 0.7,
  "loop-painting": 0.7,
};

export class AudioManager {
  private _themes = new Map<ThemeName, HTMLAudioElement>();
  private _sfx = new Map<string, HTMLAudioElement>();
  private _currentTheme: ThemeName | null = null;
  private _unlocked = false;
  private _muted = true;

  init(): void {
    (["loop-main", "loop-poem", "loop-painting"] as ThemeName[]).forEach((name) => {
      const el = document.querySelector<HTMLAudioElement>(`.xp-assets .${name}`);
      if (el) {
        el.volume = 0;
        this._themes.set(name, el);
      }
    });
    (["over-cta-back", "over-cta-painting"] as const).forEach((name) => {
      const el = document.querySelector<HTMLAudioElement>(`.xp-assets .${name}`);
      if (el) this._sfx.set(name, el);
    });

    // 首次交互解锁音频（浏览器自动播放策略）
    const unlock = () => {
      this._unlocked = true;
      if (!this._muted) this._playCurrent();
      document.removeEventListener("pointerdown", unlock);
    };
    document.addEventListener("pointerdown", unlock);
  }

  get muted(): boolean {
    return this._muted;
  }

  /** 声音开关 */
  setMuted(muted: boolean): void {
    this._muted = muted;
    if (muted) {
      this._themes.forEach((el) => gsap.to(el, { volume: 0, duration: 0.6, onComplete: () => el.pause() }));
    } else if (this._unlocked) {
      this._playCurrent();
    }
  }

  /** 切换主题声景（交叉淡入淡出） */
  switchThemeTo(name: ThemeName): void {
    if (this._currentTheme === name) return;
    const prev = this._currentTheme ? this._themes.get(this._currentTheme) : null;
    const next = this._themes.get(name);
    this._currentTheme = name;

    if (prev) gsap.to(prev, { volume: 0, duration: 1.2, onComplete: () => prev.pause() });
    if (next && !this._muted && this._unlocked) {
      next.play().catch(() => {});
      gsap.to(next, { volume: THEME_VOLUME[name], duration: 1.2 });
    }
  }

  playSfx(name: "over-cta-back" | "over-cta-painting"): void {
    if (this._muted || !this._unlocked) return;
    const el = this._sfx.get(name);
    if (el) {
      el.currentTime = 0;
      el.volume = 0.8;
      el.play().catch(() => {});
    }
  }

  private _playCurrent(): void {
    if (!this._currentTheme) return;
    const el = this._themes.get(this._currentTheme);
    if (el) {
      el.play().catch(() => {});
      gsap.to(el, { volume: THEME_VOLUME[this._currentTheme], duration: 1.2 });
    }
  }
}

export const audioManager = new AudioManager();

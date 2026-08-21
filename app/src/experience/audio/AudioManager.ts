/**
 * Audio lifecycle for the Experience.
 *
 * Playback is deliberately unlocked from the Enter click rather than from an
 * arbitrary first pointer event. That preserves the user's explicit gesture
 * through HTMLMediaElement.play(), while one manager owns theme, mute and page
 * visibility state.
 */
import gsap from "gsap";

type ThemeName = "loop-main" | "loop-poem" | "loop-painting";

const FADE_DURATION = 0.8;
const THEME_VOLUME = 1;

export class AudioManager {
  private _themes = new Map<ThemeName, HTMLAudioElement>();
  private _sfx = new Map<string, HTMLAudioElement>();
  private _currentTheme: ThemeName = "loop-main";
  private _unlocked = false;
  private _muted = true;
  private _desiredMuted = true;
  private _pageHidden = document.hidden;
  private _revealCall: gsap.core.Tween | null = null;

  init(): void {
    (["loop-main", "loop-poem", "loop-painting"] as ThemeName[]).forEach((name) => {
      const el = document.querySelector<HTMLAudioElement>(`.xp-assets .${name}`);
      if (!el) return;
      el.volume = 0;
      el.loop = true;
      el.preload = "auto";
      this._themes.set(name, el);
    });
    (["over-cta-back", "over-cta-painting"] as const).forEach((name) => {
      const el = document.querySelector<HTMLAudioElement>(`.xp-assets .${name}`);
      if (el) this._sfx.set(name, el);
    });
    document.addEventListener("visibilitychange", () => this._onVisibilityChange());
    this._syncToggle();
  }

  get muted(): boolean {
    return this._muted;
  }

  get currentTheme(): ThemeName {
    return this._currentTheme;
  }

  /** Begin the UI lifecycle; playback still waits for an explicit gesture. */
  start(): void {
    this._revealCall?.kill();
    this._revealCall = gsap.delayedCall(1.5, () => {
      document.getElementById("sound-toggle")?.classList.remove("hidden");
    });
  }

  /** Must be called synchronously from the Enter pointer/click handler. */
  activateFromGesture(): void {
    this._unlocked = true;
    this._desiredMuted = false;
    this._muted = false;
    this._themes.forEach((el) => el.load());
    this._syncToggle();
    void this._playCurrent(true);
  }

  /** Sound button: retrying here is also backed by a trusted user gesture. */
  setMuted(muted: boolean): void {
    this._desiredMuted = muted;
    this._muted = muted;
    if (!muted) this._unlocked = true;
    this._syncToggle();

    if (muted) {
      this._fadeAndPauseAll();
    } else if (!this._pageHidden) {
      void this._playCurrent(true);
    }
  }

  /** Cross-fade between the authored soundscapes. */
  switchThemeTo(name: ThemeName): void {
    if (this._currentTheme === name) {
      if (!this._muted && this._unlocked && !this._pageHidden) void this._playCurrent(false);
      return;
    }
    const previous = this._themes.get(this._currentTheme);
    const next = this._themes.get(name);
    this._currentTheme = name;

    if (previous) {
      gsap.killTweensOf(previous);
      gsap.to(previous, {
        volume: 0,
        duration: FADE_DURATION,
        ease: "sine.inOut",
        onComplete: () => previous.pause(),
      });
    }
    if (next && !this._muted && this._unlocked && !this._pageHidden) void this._playCurrent(false);
  }

  playSfx(name: "over-cta-back" | "over-cta-painting"): void {
    if (this._muted || !this._unlocked || this._pageHidden) return;
    const el = this._sfx.get(name);
    if (!el) return;
    el.currentTime = 0;
    el.volume = 0.8;
    void el.play().catch(() => undefined);
  }

  /** Read-only diagnostics used by local QA. */
  getDebugState(): { muted: boolean; unlocked: boolean; theme: ThemeName; paused: boolean; currentTime: number } {
    const current = this._themes.get(this._currentTheme);
    return {
      muted: this._muted,
      unlocked: this._unlocked,
      theme: this._currentTheme,
      paused: current?.paused ?? true,
      currentTime: current?.currentTime ?? 0,
    };
  }

  private async _playCurrent(fromGesture: boolean): Promise<void> {
    if (this._muted || this._pageHidden) return;
    const el = this._themes.get(this._currentTheme);
    if (!el) return;

    gsap.killTweensOf(el);
    try {
      await el.play();
      gsap.to(el, {
        volume: THEME_VOLUME,
        duration: FADE_DURATION,
        ease: "sine.inOut",
      });
    } catch {
      // A rejected play() keeps the UI honest. A later sound-button click calls
      // this method from another trusted gesture and therefore acts as retry.
      if (fromGesture) {
        this._muted = true;
        this._desiredMuted = true;
        this._syncToggle();
      }
    }
  }

  private _fadeAndPauseAll(): void {
    this._themes.forEach((el) => {
      gsap.killTweensOf(el);
      gsap.to(el, {
        volume: 0,
        duration: FADE_DURATION,
        ease: "sine.inOut",
        onComplete: () => el.pause(),
      });
    });
  }

  private _onVisibilityChange(): void {
    this._pageHidden = document.hidden;
    if (this._pageHidden) {
      this._fadeAndPauseAll();
    } else if (!this._desiredMuted && this._unlocked) {
      this._muted = false;
      this._syncToggle();
      void this._playCurrent(false);
    }
  }

  private _syncToggle(): void {
    const toggle = document.getElementById("sound-toggle");
    toggle?.classList.toggle("is-off", this._muted);
    toggle?.setAttribute("aria-pressed", String(!this._muted));
  }
}

export const audioManager = new AudioManager();

/**
 * 权益区与各 DOM 按钮的交互绑定。
 * - IntersectionObserver 滚动显现（.advantages-header / .a-title / .a-step-wrapper / .a-cta-wrapper 加 .show）
 * - FAQ 手风琴（GSAP 展开 content-wrapper 高度）
 * - Restart 按钮 → 重启体验
 * - Back 按钮 → 退出全幅绘画 / 全屏诗歌
 * - 声音开关 → 静音切换
 */
import gsap from "gsap";
import { bus, EVENTS } from "../core/EventBus";
import { audioManager } from "../experience/audio/AudioManager";
import { experienceManager } from "../experience/ExperienceManager";

export class Advantages {
  init(): void {
    // The final section is intentionally an empty local content slot. Keep the
    // legacy helpers tolerant of absent nodes, but do not instantiate observers
    // or FAQ interaction for content that no longer exists.
    this._setupButtons();
  }

  /** 滚动进入视口时显现 */
  private _setupReveal(): void {
    const targets = document.querySelectorAll<HTMLElement>(
      ".advantages-header, .advantages-content .a-title, .a-step-wrapper, .a-cta-wrapper",
    );
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("show");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.2 },
    );
    targets.forEach((el) => observer.observe(el));
  }

  /** FAQ 手风琴 */
  private _setupFaq(): void {
    document.querySelectorAll<HTMLElement>(".faq .question").forEach((question) => {
      const head = question.querySelector<HTMLElement>(".question-head");
      const wrapper = question.querySelector<HTMLElement>(".content-wrapper");
      const content = question.querySelector<HTMLElement>(".content");
      if (!head || !wrapper || !content) return;

      head.setAttribute("role", "button");
      head.setAttribute("tabindex", "0");
      head.setAttribute("aria-expanded", "false");

      const toggle = () => {
        const isOpen = question.classList.contains("open");
        if (isOpen) {
          question.classList.remove("open");
          head.setAttribute("aria-expanded", "false");
          gsap.to(wrapper, { height: 0, duration: 0.5, ease: "power2.inOut" });
        } else {
          question.classList.add("open");
          head.setAttribute("aria-expanded", "true");
          gsap.to(wrapper, { height: content.offsetHeight, duration: 0.5, ease: "power2.inOut" });
        }
      };
      head.addEventListener("click", toggle);
      head.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        toggle();
      });
    });
  }

  /** 按钮：Restart / Back ×2 / 声音开关 */
  private _setupButtons(): void {
    document.getElementById("restart-btn")?.addEventListener("click", () => {
      bus.emit(EVENTS.RESTART_WATERCOLOR);
    });

    document.getElementById("fullpaint-back")?.addEventListener("click", () => {
      audioManager.playSfx("over-cta-back");
      experienceManager.hideFullPaint();
    });

    document.getElementById("poem-back")?.addEventListener("click", () => {
      audioManager.playSfx("over-cta-back");
      experienceManager.hideFullscreenPoem();
    });

    const soundToggle = document.getElementById("sound-toggle");
    soundToggle?.addEventListener("click", () => {
      audioManager.setMuted(!audioManager.muted);
    });
  }
}

export const advantages = new Advantages();

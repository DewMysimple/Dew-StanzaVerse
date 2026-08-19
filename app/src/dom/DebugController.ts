import { SOURCE_MANIFEST } from "../config/sourceManifest";
import { scrollController } from "../experience/scroll/ScrollController";
import type { ExperienceState } from "../experience/types";
import { getDebugOptions } from "../experience/world/InkReveal";

export class DebugController {
  init(getState: () => ExperienceState): void {
    if (!getDebugOptions().enabled) return;

    const panel = document.createElement("aside");
    panel.className = "xp-debug";
    panel.setAttribute("aria-label", "Experience debug controls");
    panel.innerHTML = `<strong>XP source-verified</strong><span>${SOURCE_MANIFEST.verifiedAssetCount} assets</span>`;

    [0, 8, 16, 24, 34, 44, 55].forEach((time) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${time}s`;
      button.addEventListener("click", () => scrollController.scrollToCameraTime(time));
      panel.appendChild(button);
    });

    const state = document.createElement("output");
    panel.appendChild(state);
    document.body.appendChild(panel);
    window.setInterval(() => {
      const current = getState();
      state.textContent = `${current.phase} · scene ${current.sceneIndex ?? "—"}`;
    }, 250);
  }
}

export const debugController = new DebugController();

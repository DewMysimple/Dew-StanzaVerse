/**
 * 入口 —— 串联整个体验：
 *
 *   1. 创建唯一的 WebGL 渲染器（KTX2 转码器需要它 detectSupport）
 *   2. 初始化 DOM 组件（加载画面 / 光标 / 权益区 / 音频）
 *   3. 预载静态资源（视频在全幅绘画时才懒加载），进度喂给加载画面
 *   4. 等字体就绪、绘制文字画布
 *   5. 资源齐 → 构建体验模块；用户点击 Enter → START_WATERCOLOR 启动
 */
import "./style.css";
import * as THREE from "three";
import gsap from "gsap";
import { bus, EVENTS } from "./core/EventBus";
import { resources } from "./core/Resources";
import { STATIC_RESOURCES } from "./config/assets";
import { scrollController } from "./experience/scroll/ScrollController";
import { audioManager } from "./experience/audio/AudioManager";
import { experienceManager } from "./experience/ExperienceManager";
import { loaderExperience } from "./dom/LoaderExperience";
import { cursor } from "./dom/Cursor";
import { advantages } from "./dom/Advantages";
import { debugController } from "./dom/DebugController";

/** 移动端 100vh 修正（与原站 --vh 约定一致） */
function setVhVar(): void {
  document.documentElement.style.setProperty("--vh", `${window.innerHeight * 0.01}px`);
}
setVhVar();
window.addEventListener("resize", setVhVar);

const canvas = document.getElementById("xp-canvas") as HTMLCanvasElement;

function activateFallback(reason: string): void {
  document.documentElement.classList.add("is-fallback");
  document.documentElement.dataset.experiencePhase = "fallback";
  const fallback = document.getElementById("webgl-fallback");
  if (fallback) fallback.hidden = false;
  document.querySelectorAll<HTMLElement>(".advantages-header, .advantages-content .a-title, .a-step-wrapper, .a-cta-wrapper")
    .forEach((element) => element.classList.add("show"));
  console.info(`[experience fallback] ${reason}`);
}

// 唯一渲染器：alpha 透明清屏，CSS 渐变背景透出（对应原站 .xp-canvas 的 background）
let renderer: THREE.WebGLRenderer | null = null;
if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  activateFallback("reduced motion preference");
} else {
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
  } catch (error) {
    activateFallback(error instanceof Error ? error.message : "WebGL unavailable");
  }
}

if (renderer) {
const activeRenderer = renderer;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);
renderer.outputEncoding = THREE.LinearEncoding; // 着色器内自行 linearToSrgb
renderer.autoClear = false;

// KTX2 转码器（地面图集）
resources.setupKtx2(renderer);

// DOM 组件
loaderExperience.init();
cursor.init();
advantages.init();
debugController.init(() => experienceManager.state);
audioManager.init();
scrollController.init();

// 启动流程：资源预载 + 文字画布准备 → 构建体验模块
async function boot(): Promise<void> {
  try {
    await Promise.all([resources.preload(STATIC_RESOURCES), experienceManager.textCanvas.prepare()]);
    experienceManager.init(canvas, activeRenderer);
    // Development-only shortcut is scheduled from the completed boot promise,
    // avoiding a cache-dependent race with RESOURCES_COMPLETE.
    if (location.hash === "#autostart") {
      setTimeout(() => bus.emit(EVENTS.START_WATERCOLOR), 500);
    }
  } catch (err) {
    console.error("[boot] 初始化失败", err);
  }
}
boot();

// 全局事件
bus.on(EVENTS.START_WATERCOLOR, () => experienceManager.start());
bus.on(EVENTS.RESTART_WATERCOLOR, () => experienceManager.restart());

// 尺寸变化
window.addEventListener("resize", () => {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  experienceManager.onResize(window.innerWidth, window.innerHeight);
});

// 每帧把 ExperienceManager 的雾状态同步进渲染循环
gsap.ticker.add(() => experienceManager.syncFrame());

// 调试句柄只在开发环境存在，生产构建不暴露内部状态。
if (import.meta.env.DEV) {
  (window as unknown as { __xp: unknown }).__xp = {
    experienceManager,
    scrollController,
    resources,
    audioManager,
    bus,
    EVENTS,
  };
}
}

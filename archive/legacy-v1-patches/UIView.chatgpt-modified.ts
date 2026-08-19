/**
 * UI 覆盖层视图 —— 漂浮在 3D 场景上方的诗句文字。
 *
 * 对应原站的 "UI" 视图：独立的正交相机场景，渲染在水彩场景之上
 * （autoClear=false）。核心是一块与 DOM 中 .xp-text-sizer 同位置、
 * 同尺寸的四边形，用 TextCanvas 纹理 + 文字着色器绘制：
 * 滚动时窗口下移切换诗句，鼠标靠近时字符晕开，点击文字进入诗歌视图。
 */
import * as THREE from "three";
import gsap from "gsap";
import { resources } from "../../core/Resources";
import { textVertexShader, textFragmentShader } from "../../shaders/text";
import type { TextCanvas } from "../world/TextCanvas";

/** 文字四边形的 DOM 区域（与 .xp-text-w / .xp-text-sizer 的 CSS 对应） */
function getTextRect(isMobile: boolean): { x: number; y: number; w: number; h: number } {
  const w = Math.min(window.innerWidth * 0.8, 13 * 30); // max-width: 13em
  const h = isMobile ? 360 : 432;
  const x = window.innerWidth * 0.1;
  const y = window.innerHeight * 0.5 - (isMobile ? 140 : 168);
  return { x, y, w, h };
}

export class UIView {
  scene = new THREE.Scene();
  camera: THREE.OrthographicCamera;

  private _quad: THREE.Mesh | null = null;
  private _material: THREE.ShaderMaterial | null = null;
  private _textCanvas: TextCanvas;
  private _visible = false;
  private _rect = { x: 0, y: 0, w: 0, h: 0 };

  constructor(textCanvas: TextCanvas) {
    this._textCanvas = textCanvas;
    // 像素坐标、原点左上角（与 CSS 坐标一致：y 向下）
    this.camera = new THREE.OrthographicCamera(
      0,
      window.innerWidth,
      window.innerHeight, // top = 屏高, bottom = 0: (0,0) 对应屏幕左上角
      0,
      -1,
      1,
    );
  }

  init(): void {
    const noise = resources.get<THREE.Texture>("noise/rgb-fractal");
    noise.wrapS = noise.wrapT = THREE.RepeatWrapping;

    const rect = getTextRect(window.innerWidth < 768);
    this._rect = rect;

    this._material = new THREE.ShaderMaterial({
      vertexShader: textVertexShader,
      fragmentShader: textFragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        map: { value: this._textCanvas.texture },
        uNoise: { value: noise },
        uCursorPosition: { value: new THREE.Vector2(0.5, 0.5) },
        uCursorFactor: { value: 1 },
        uQuadRatio: { value: rect.w / rect.h },
        uScrollProgress: { value: 0 },
        uWindowHeight: { value: rect.h / Math.max(this._textCanvas.contentHeight, 1) },
        uUvScrollProgress: { value: 0 },
        uVisibleArea: { value: 1 },
        uClampFadeOverride: { value: 0 },
        uFadeProgress: { value: 0 },
        uFadeNoiseSize: { value: 2.2 },
        uWriteProgress: { value: 0 },
        uAlpha: { value: 0 },
      },
    });

    this._quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this._material);
    this._quad.frustumCulled = false;
    this._quad.position.z = -0.5; // near/far 之内
    this.scene.add(this._quad);
    this._layout();
  }

  /** 进入时的"书写"动画（对应原站 writeFadeIn：0.7 → 0，静止态为 0） */
  show(): gsap.core.Timeline {
    this._visible = true;
    const u = this._material!.uniforms;
    const tl = gsap.timeline();
    tl.to(u.uAlpha, { value: 1, duration: 0.8, ease: "power2.out" }, 0);
    tl.fromTo(u.uWriteProgress, { value: 0.7 }, { value: 0, duration: 1, ease: "power1.out" }, 0);
    tl.set(u.uFadeProgress, { value: 0 }, 0);
    tl.set(u.uClampFadeOverride, { value: 0 }, 0);
    return tl;
  }

  /** 淡出（对应原站 customFadeOut：0 → 0.97） */
  hide(): gsap.core.Timeline {
    this._visible = false;
    const u = this._material!.uniforms;
    const tl = gsap.timeline();
    tl.fromTo(u.uFadeProgress, { value: 0 }, { value: 0.97, duration: 1, ease: "none" }, 0);
    tl.to(u.uAlpha, { value: 0, duration: 0.6 }, 0.3);
    return tl;
  }

  /** 隐藏后重置（重启 / 再次进入） */
  reset(): void {
    const u = this._material!.uniforms;
    u.uFadeProgress.value = 0;
    u.uWriteProgress.value = 0;
    u.uAlpha.value = 0;
  }

  get isVisible(): boolean {
    return this._visible;
  }

  /** 文字命中检测（供 ExperienceManager.checkPoemIntersection） */
  checkTextIntersection(ndcX: number, ndcY: number, scrollProgress: number): boolean {
    if (!this._visible || !this._textCanvas.texture) return false;
    const px = (ndcX * 0.5 + 0.5) * window.innerWidth;
    const py = (1 - (ndcY * 0.5 + 0.5)) * window.innerHeight;
    const uv = {
      x: (px - this._rect.x) / this._rect.w,
      y: 1 - (py - this._rect.y) / this._rect.h,
    };
    return this._textCanvas.hitTest(uv, scrollProgress, this._material!.uniforms.uWindowHeight.value);
  }

  /** 更新鼠标位置（四边形内 uv 空间） */
  setCursor(px: number, py: number): void {
    if (!this._material) return;
    const uv = this._material.uniforms.uCursorPosition.value as THREE.Vector2;
    uv.set((px - this._rect.x) / this._rect.w, 1 - (py - this._rect.y) / this._rect.h);
  }

  update(scrollProgress: number, time: number): void {
    if (!this._material) return;
    this._material.uniforms.uScrollProgress.value = scrollProgress;
    // 与原站一致：噪声漂移由滚动距离驱动（而非时间）
    this._material.uniforms.uUvScrollProgress.value =
      (scrollProgress * this._textCanvas.contentHeight) / Math.max(this._rect.h, 1);
  }

  resize(width: number, height: number): void {
    this.camera.right = width;
    this.camera.top = height; // top=height / bottom=0
    this.camera.bottom = 0;
    this.camera.updateProjectionMatrix();
    this._rect = getTextRect(width < 768);
    this._layout();
  }

  private _layout(): void {
    if (!this._quad || !this._material) return;
    const { x, y, w, h } = this._rect;
    this._quad.scale.set(w, h, 1);
    // 正交相机以像素为单位、原点在左上角
    this._quad.position.set(x + w / 2, y + h / 2, 0);
    this._material.uniforms.uQuadRatio.value = w / h;
    this._material.uniforms.uWindowHeight.value = h / Math.max(this._textCanvas.contentHeight, 1);
  }
}

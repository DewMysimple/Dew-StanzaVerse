/**
 * 诗歌全屏视图 —— 点击漂浮诗句后进入。
 * 全屏四边形：纸张底色 + poem/text.png 文字 + 书写显现动画。
 * 对应原站 "Poem" 视图（原站用 MSDF 排版，复刻版用同款预渲染纹理）。
 */
import * as THREE from "three";
import gsap from "gsap";
import { resources } from "../../core/Resources";
import { poemVertexShader, poemFragmentShader } from "../../shaders/poem";

export class PoemView {
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);

  private _material: THREE.ShaderMaterial;
  private _visible = false;

  constructor() {
    const poemTexture = resources.get<THREE.Texture>("poem/texture");
    poemTexture.encoding = THREE.sRGBEncoding;
    poemTexture.flipY = false;
    const noise = resources.get<THREE.Texture>("noise/greyscale-fractal");
    noise.wrapS = noise.wrapT = THREE.RepeatWrapping;

    this._material = new THREE.ShaderMaterial({
      vertexShader: poemVertexShader,
      fragmentShader: poemFragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTextTexture: { value: poemTexture },
        uNoise: { value: noise },
        uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
        uTextSize: { value: new THREE.Vector2(2304, 2304) },
        uWriteProgress: { value: 0 },
        uAlpha: { value: 0 },
        uPaperColor: { value: new THREE.Color("#eceae3") },
        uInkColor: { value: new THREE.Color("#413a39") },
      },
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  get isVisible(): boolean {
    return this._visible;
  }

  show(): gsap.core.Timeline {
    this._visible = true;
    const u = this._material.uniforms;
    const tl = gsap.timeline();
    tl.to(u.uAlpha, { value: 1, duration: 0.9, ease: "power2.out" }, 0);
    tl.to(u.uWriteProgress, { value: 1, duration: 2.8, ease: "power1.inOut" }, 0.3);
    return tl;
  }

  hide(): gsap.core.Timeline {
    this._visible = false;
    const u = this._material.uniforms;
    const tl = gsap.timeline();
    tl.to(u.uWriteProgress, { value: 0, duration: 0.8, ease: "power2.in" }, 0);
    tl.to(u.uAlpha, { value: 0, duration: 0.6, ease: "power1.in" }, 0.2);
    return tl;
  }

  resize(width: number, height: number): void {
    this._material.uniforms.uResolution.value.set(width, height);
  }
}

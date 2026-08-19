import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { resources } from "../../core/Resources";
import { PAPERS_CONFIG } from "../../config/papers";
import { paintingTitleFragmentShader, paintingTitleVertexShader } from "../../shaders/paintingTitle";
import type { PaintingTitleConfig } from "../types";

interface FontChar {
  id: number;
  char: string;
  width: number;
  height: number;
  xoffset: number;
  yoffset: number;
  xadvance: number;
  x: number;
  y: number;
}

interface FontKerning { first: number; second: number; amount: number }
interface BmFont {
  chars: FontChar[];
  kernings?: FontKerning[];
  common: { base: number; lineHeight: number; scaleW: number; scaleH: number };
}

interface RuntimeTitle {
  config: PaintingTitleConfig;
  root: THREE.Group;
  material: THREE.ShaderMaterial;
  lineMaterial: THREE.MeshBasicMaterial;
  dotMaterial: THREE.MeshBasicMaterial;
  line: THREE.Mesh;
  alpha: number;
  hovered: boolean;
  textWidth: number;
}

const CTA = "Open the landscape";
// bmfont geometry is expressed in atlas pixels; this matches the source's
// stable, small editorial label after its text-layout normalization.
const SOURCE_SCALE = 0.12 / 1600;

export class PaintingTitles {
  readonly group = new THREE.Group();
  readonly configs: PaintingTitleConfig[] = [];

  private _items: RuntimeTitle[] = [];
  private _pointerNdc = new THREE.Vector2(10, 10);
  private _resolution = new THREE.Vector2(window.innerWidth, window.innerHeight);

  init(gltf: GLTF): void {
    const titleProxies = gltf.scene.getObjectByName("titles");
    const font = resources.get<BmFont>("canela/font");
    const atlas = resources.get<THREE.Texture>("canela/atlas");
    const noise = resources.get<THREE.Texture>("noise/rgb-fractal");
    if (!titleProxies || !font || !atlas) {
      console.warn("[PaintingTitles] GLB titles 或 Canela MSDF 资源缺失");
      return;
    }
    atlas.flipY = false;
    atlas.minFilter = THREE.LinearFilter;
    atlas.magFilter = THREE.LinearFilter;
    noise.wrapS = noise.wrapT = THREE.RepeatWrapping;

    titleProxies.children.forEach((proxy) => {
      const titleName = proxy.name.replaceAll("_", " ").toLowerCase();
      const paper = PAPERS_CONFIG.find((entry) => entry.title?.toLowerCase() === titleName);
      if (!paper) return;

      const { geometry, width } = this._createTextGeometry(font, CTA);
      const material = new THREE.ShaderMaterial({
        vertexShader: paintingTitleVertexShader,
        fragmentShader: paintingTitleFragmentShader,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          map: { value: atlas },
          uNoise: { value: noise },
          uColor: { value: new THREE.Color(0x000000) },
          uAlpha: { value: 0 },
          uTime: { value: 0 },
          uResolution: { value: this._resolution },
          uMouseNdc: { value: this._pointerNdc },
          uCenterNdc: { value: new THREE.Vector2() },
          uFogState: { value: new THREE.Vector2() },
          uHovered: { value: 0 },
        },
      });

      const root = new THREE.Group();
      proxy.getWorldPosition(root.position);
      proxy.getWorldQuaternion(root.quaternion);
      root.rotateY(Math.PI / 2);

      const text = new THREE.Mesh(geometry, material);
      text.renderOrder = 3;
      root.add(text);

      const lineMaterial = new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
      });
      const dotMaterial = lineMaterial.clone();
      const line = new THREE.Mesh(new THREE.PlaneGeometry(18, 1.4), lineMaterial);
      line.position.set(-width * 0.5 - 18, -1, 0.2);
      line.scale.x = 0.35;
      line.renderOrder = 4;
      const dot = new THREE.Mesh(new THREE.CircleGeometry(3.2, 18), dotMaterial);
      dot.position.set(-width * 0.5 - 31, -1, 0.2);
      dot.renderOrder = 4;
      root.add(line, dot);
      this.group.add(root);

      const config: PaintingTitleConfig = {
        proxy,
        worldPosition: root.position.clone(),
        worldQuaternion: root.quaternion.clone(),
        cta: paper.cta ?? CTA,
        sceneIndex: paper.sceneIndex,
        interactionBounds: new THREE.Box2(),
      };
      this.configs.push(config);
      this._items.push({ config, root, material, lineMaterial, dotMaterial, line, alpha: 0, hovered: false, textWidth: width });
    });
  }

  update(
    time: number,
    delta: number,
    camera: THREE.Camera,
    fogState: { opaque: number; occulted: number },
  ): void {
    const cameraSpace = new THREE.Vector3();
    const ndc = new THREE.Vector3();
    const fadeAlpha = 1 - Math.exp(-3.5 * Math.min(delta, 0.05));

    this._items.forEach((item) => {
      cameraSpace.copy(item.config.worldPosition).applyMatrix4(camera.matrixWorldInverse);
      ndc.copy(item.config.worldPosition).project(camera);
      const inView = cameraSpace.z < -0.1
        && Math.abs(ndc.x) < 1.18
        && Math.abs(ndc.y) < 1.12
        && ndc.z > -1
        && ndc.z < 1;
      const targetAlpha = inView ? 1 : 0;
      item.alpha += (targetAlpha - item.alpha) * fadeAlpha;

      const distanceScale = Math.max(-cameraSpace.z, 0.1) * SOURCE_SCALE;
      // The source camera follows a constrained baked path; a billboard keeps
      // the title coplanar with that moving view while preserving GLB position.
      item.root.quaternion.copy(camera.quaternion);
      item.root.scale.setScalar(distanceScale);
      const centerX = (ndc.x * 0.5 + 0.5) * this._resolution.x;
      const centerY = (-ndc.y * 0.5 + 0.5) * this._resolution.y;
      const width = THREE.MathUtils.clamp(item.textWidth * distanceScale * 52, 135, 260);
      item.config.interactionBounds.min.set(centerX - width * 0.62, centerY - 26);
      item.config.interactionBounds.max.set(centerX + width * 0.62, centerY + 26);

      item.material.uniforms.uTime.value = time;
      item.material.uniforms.uAlpha.value = item.alpha;
      item.material.uniforms.uCenterNdc.value.set(ndc.x, ndc.y);
      item.material.uniforms.uFogState.value.set(fogState.opaque, fogState.occulted);
      item.material.uniforms.uHovered.value = item.hovered ? 1 : 0;
      item.lineMaterial.opacity = item.alpha * (item.hovered ? 0.8 : 0.42);
      item.dotMaterial.opacity = item.alpha * (item.hovered ? 1 : 0.58);
      item.line.scale.x += ((item.hovered ? 1 : 0.35) - item.line.scale.x) * fadeAlpha * 2;
      item.root.visible = item.alpha > 0.005;
    });
  }

  resize(width: number, height: number): void {
    this._resolution.set(width, height);
  }

  setPointer(clientX: number, clientY: number): void {
    this._pointerNdc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  }

  hitTest(ndc: THREE.Vector2): PaintingTitleConfig | null {
    const point = new THREE.Vector2(
      (ndc.x * 0.5 + 0.5) * this._resolution.x,
      (-ndc.y * 0.5 + 0.5) * this._resolution.y,
    );
    const item = this._items.find((candidate) => candidate.alpha > 0.8 && candidate.config.interactionBounds.containsPoint(point));
    return item?.config ?? null;
  }

  setHovered(sceneIndex: number | null): void {
    this._items.forEach((item) => { item.hovered = item.config.sceneIndex === sceneIndex; });
  }

  hideAll(): void {
    this._items.forEach((item) => {
      item.alpha = 0;
      item.material.uniforms.uAlpha.value = 0;
      item.root.visible = false;
    });
  }

  private _createTextGeometry(font: BmFont, text: string): { geometry: THREE.BufferGeometry; width: number } {
    const chars = new Map(font.chars.map((char) => [char.id, char]));
    const kernings = new Map((font.kernings ?? []).map((entry) => [`${entry.first}:${entry.second}`, entry.amount]));
    const glyphs: Array<{ glyph: FontChar; x: number }> = [];
    let pen = 0;
    let previous = 0;
    Array.from(text).forEach((letter) => {
      const id = letter.codePointAt(0)!;
      const glyph = chars.get(id);
      if (!glyph) return;
      pen += kernings.get(`${previous}:${id}`) ?? 0;
      glyphs.push({ glyph, x: pen });
      pen += glyph.xadvance;
      previous = id;
    });
    const width = Math.max(pen, 1);
    const positions: number[] = [];
    const uvs: number[] = [];
    const layoutUvs: number[] = [];
    const indices: number[] = [];
    glyphs.forEach(({ glyph, x }, index) => {
      const left = x + glyph.xoffset - width * 0.5;
      const right = left + glyph.width;
      const top = font.common.base - glyph.yoffset;
      const bottom = top - glyph.height;
      const base = index * 4;
      positions.push(left, bottom, 0, right, bottom, 0, right, top, 0, left, top, 0);
      const u0 = glyph.x / font.common.scaleW;
      const u1 = (glyph.x + glyph.width) / font.common.scaleW;
      const v0 = glyph.y / font.common.scaleH;
      const v1 = (glyph.y + glyph.height) / font.common.scaleH;
      uvs.push(u0, v1, u1, v1, u1, v0, u0, v0);
      layoutUvs.push(
        (left + width * 0.5) / width, 0,
        (right + width * 0.5) / width, 0,
        (right + width * 0.5) / width, 1,
        (left + width * 0.5) / width, 1,
      );
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute("uv1", new THREE.Float32BufferAttribute(layoutUvs, 2));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    return { geometry, width };
  }
}

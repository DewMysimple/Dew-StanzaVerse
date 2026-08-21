import * as THREE from "three";
import { resources } from "../../core/Resources";
import { shadowFragmentShader, shadowVertexShader } from "../../shaders/shadow";
import type { ShadowProjectionPipeline } from "../types";

export interface ShadowSource {
  paperIndex: number;
  matrix: THREE.Matrix4;
  sdfAtlasRemap: THREE.Vector4;
  sdfScale: THREE.Vector2;
  sdfOriginSize: THREE.Vector2;
  sdfPlaneSize: THREE.Vector2;
  alpha: number;
}

export class ShadowProjection implements ShadowProjectionPipeline {
  private _scene = new THREE.Scene();
  private _mesh: THREE.InstancedMesh | null = null;
  private _sources: ShadowSource[] = [];
  private _target: THREE.WebGLRenderTarget;
  private _compositeScene = new THREE.Scene();
  private _compositeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor() {
    this._target = this._createTarget(window.innerWidth, window.innerHeight);
    const material = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}`,
      fragmentShader: `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D uShadowMap;
        uniform vec3 uGroundColor;
        uniform vec3 uSkyColor;
        uniform float uShadowStrength;
        float sineInOut(float t){return -0.5*(cos(3.141592653589793*t)-1.0);}
        void main(){
          float shadow=texture2D(uShadowMap,vUv).r;
          float base=clamp((vUv.y-0.5)/0.5,0.0,1.0);
          float progress=sineInOut(1.0-abs((base-0.5)*2.0));
          vec3 color=mix(uGroundColor,uSkyColor,progress);
          vec2 specular=(vUv-vec2(1.2,0.7))/vec2(0.82,0.67);
          float light=sineInOut(1.0-min(length(specular),1.0))*0.18;
          color+=light;
          color-=(1.0-shadow)*uShadowStrength;
          gl_FragColor=vec4(color,1.0);
        }
      `,
      uniforms: {
        uShadowMap: { value: this._target.texture },
        uGroundColor: { value: new THREE.Color("#b4b4b4") },
        uSkyColor: { value: new THREE.Color("#e4e4e4") },
        uShadowStrength: { value: 0.9 },
      },
    });
    this._compositeScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  }

  get texture(): THREE.Texture { return this._target.texture; }

  init(sources: ShadowSource[]): void {
    this._sources = sources;
    const plane = new THREE.PlaneGeometry(1, 1, 5, 5);
    plane.translate(0, -0.5, 0);
    plane.rotateX(Math.PI);
    plane.rotateY(Math.PI * 0.5);
    const geometry = new THREE.InstancedBufferGeometry().copy(plane);
    geometry.setAttribute("aSdfAtlasRemap", new THREE.InstancedBufferAttribute(new Float32Array(sources.flatMap((source) => source.sdfAtlasRemap.toArray())), 4));
    geometry.setAttribute("aSdfScale", new THREE.InstancedBufferAttribute(new Float32Array(sources.flatMap((source) => source.sdfScale.toArray())), 2));
    geometry.setAttribute("aSdfOriginSize", new THREE.InstancedBufferAttribute(new Float32Array(sources.flatMap((source) => source.sdfOriginSize.toArray())), 2));
    geometry.setAttribute("aSdfPlaneSize", new THREE.InstancedBufferAttribute(new Float32Array(sources.flatMap((source) => source.sdfPlaneSize.toArray())), 2));
    geometry.setAttribute("aAlpha", new THREE.InstancedBufferAttribute(new Float32Array(sources.map((source) => source.alpha)), 1).setUsage(THREE.DynamicDrawUsage));
    const material = new THREE.ShaderMaterial({
      vertexShader: shadowVertexShader,
      fragmentShader: shadowFragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NormalBlending,
      uniforms: {
        uSdfTexture: { value: resources.get<THREE.Texture>("atlas/sdf") },
        // Source directional light: target(0, 0, 90.3) - position(-1.16, .41, -.34) * 300.
        uLightDirection: { value: new THREE.Vector3(348, -123, 192.3).normalize() },
        uNoise: { value: 0 },
        uShadowSpread: { value: 3 },
        uShadowAttenuation: { value: 15 },
        uShadowSkew: { value: 0.4 },
      },
    });
    this._mesh = new THREE.InstancedMesh(geometry, material, sources.length);
    this._mesh.frustumCulled = false;
    sources.forEach((source, index) => this._mesh!.setMatrixAt(index, source.matrix));
    this._mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._scene.add(this._mesh);
  }

  updateSource(paperIndex: number, matrix: THREE.Matrix4, alpha: number): void {
    const index = this._sources.findIndex((source) => source.paperIndex === paperIndex);
    if (index < 0 || !this._mesh) return;
    this._sources[index].matrix.copy(matrix);
    this._sources[index].alpha = alpha;
    this._mesh.setMatrixAt(index, matrix);
    const attribute = this._mesh.geometry.getAttribute("aAlpha") as THREE.InstancedBufferAttribute;
    attribute.setX(index, alpha);
    attribute.needsUpdate = true;
    this._mesh.instanceMatrix.needsUpdate = true;
  }

  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    if (!this._mesh) return;
    const previous = renderer.getRenderTarget();
    const color = renderer.getClearColor(new THREE.Color()).clone();
    const alpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this._target);
    renderer.setClearColor(0xffffff, 1);
    renderer.clear(true, false, false);
    renderer.render(this._scene, camera);
    renderer.setRenderTarget(previous);
    renderer.setClearColor(color, alpha);
  }

  renderComposite(renderer: THREE.WebGLRenderer): void {
    renderer.render(this._compositeScene, this._compositeCamera);
  }

  resize(width: number, height: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this._target.setSize(Math.max(1, Math.round(width * dpr)), Math.max(1, Math.round(height * dpr)));
  }

  reset(): void {
    this._sources.forEach((source) => { source.alpha = 0; });
  }

  private _createTarget(width: number, height: number): THREE.WebGLRenderTarget {
    const target = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
    });
    target.texture.name = "source-shadow-projection";
    return target;
  }
}

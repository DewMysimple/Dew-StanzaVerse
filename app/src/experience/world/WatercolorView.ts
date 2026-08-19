/**
 * 水彩主视图 —— 体验的核心场景。
 *
 * 组装内容（全部来自 scene.glb + 图集资源）：
 * - 26 个画纸元素：GLB 网格 + Paper 着色器（SDF 裁切 / 墨迹显现 / 流体混色 / LUT）
 * - 每个元素的地面块（hasGround）：地面着色器，绘画时渗色
 * - 世界大地面（GLB "Ground" 网格）：常驻
 * - 树叶粒子（带 leaves 配置的元素）
 * - 烘焙相机：滚动驱动的长镜头
 *
 * The meshes keep their original GLB hierarchy, while every source-derived
 * instance value (atlas/SDF/reveal/ground transform) is restored explicitly.
 */
import * as THREE from "three";
import gsap from "gsap";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { resources } from "../../core/Resources";
import type { LutData } from "../../core/Resources";
import { PAPERS_CONFIG, GROUND_ATLAS, type PaperConfig } from "../../config/papers";
import { paperVertexShader, paperFragmentShader } from "../../shaders/paper";
import { groundVertexShader, groundFragmentShader } from "../../shaders/ground";
import { leavesVertexShader, leavesFragmentShader } from "../../shaders/world";
import { ScrollCamera } from "./ScrollCamera";
import type { FluidSimulation } from "../paint/FluidSimulation";
import { scrollController } from "../scroll/ScrollController";
import atlasSdfJson from "../../config/atlas-sdf.json";
import atlasTextureJson from "../../config/atlas-texture.json";
import { createRevealConfig, getDebugOptions } from "./InkReveal";
import type { PaperInstanceConfig, RenderPipeline } from "../types";
import { PaintingTitles } from "./PaintingTitles";

interface SdfEntry {
  pixelSize: { x: number; y: number };
  scale: { x: number; y: number };
  planeSize: { x: number; y: number };
  originSize: { x: number; y: number };
  atlasRemap: { x: number; y: number; z: number; w: number };
}

interface TextureEntry {
  atlasRemap: { x: number; y: number; z: number; w: number };
}

interface PreparedPaper {
  index: number;
  config: PaperConfig;
  mesh: THREE.Mesh;
  sdfData: SdfEntry;
  texData: TextureEntry;
  reveal: ReturnType<typeof createRevealConfig>;
  matrix: THREE.Matrix4;
  simulationBox: THREE.Vector4;
  simulationRemap: THREE.Vector4;
}

interface PaperEntry {
  index: number;
  config: PaperConfig;
  /** Hidden GLB authoring mesh retained only for raycasting and transforms. */
  mesh: THREE.Mesh;
  transform: THREE.Object3D;
  state: { alpha: number; curve: number; reveal: number; rotationZ: number };
  revealed: boolean;
  tween: gsap.core.Timeline | null;
}

interface GroundEntry {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  paperName: string;
}

export class WatercolorView {
  scene = new THREE.Scene();
  scrollCamera = new ScrollCamera();
  paintingTitles = new PaintingTitles();

  readonly pipeline: RenderPipeline = {
    shadowProjection: true,
    ground: true,
    paper: true,
    vegetation: true,
    text: true,
    fogComposite: true,
  };

  readonly instanceConfigs: PaperInstanceConfig[] = [];

  /** 全部画纸材质（供 PaintManager 射线检测与 uniform 更新） */
  papers: PaperEntry[] = [];

  private _simulation: FluidSimulation | null = null;
  private _sdfMap = new Map<string, SdfEntry>(atlasSdfJson as [string, SdfEntry][]);
  private _texMap = new Map<string, TextureEntry>(atlasTextureJson as [string, TextureEntry][]);
  private _paperMesh: THREE.InstancedMesh | null = null;
  private _paperMaterial: THREE.ShaderMaterial | null = null;
  private _paperUniforms: Record<string, { value: unknown }> | null = null;
  private _leavesMaterials: THREE.ShaderMaterial[] = [];
  private _groundMaterials: THREE.ShaderMaterial[] = [];
  private _grounds: GroundEntry[] = [];
  private _time = 0;

  init(simulation: FluidSimulation): void {
    this._simulation = simulation;
    const gltf = resources.get<GLTF>("watercolor/scene");
    if (!gltf) {
      console.error("[WatercolorView] scene.glb 未加载");
      return;
    }

    this.scrollCamera.init(gltf);
    scrollController.setCameraDuration(this.scrollCamera.duration);
    this.scene.add(gltf.scene);
    this.paintingTitles.init(gltf);
    this.scene.add(this.paintingTitles.group);

    // 共享纹理
    const atlasTexture = resources.get<THREE.Texture>("atlas/texture");
    atlasTexture.encoding = THREE.sRGBEncoding;
    atlasTexture.flipY = false;
    const maskTexture = resources.get<THREE.Texture>("atlas/texture_mask");
    maskTexture.flipY = false;
    const sdfTexture = resources.get<THREE.Texture>("atlas/sdf");
    sdfTexture.flipY = false;
    const normalTexture = resources.get<THREE.Texture>("watercolor/paper/normal");
    normalTexture.wrapS = normalTexture.wrapT = THREE.RepeatWrapping;
    const noiseTexture = resources.get<THREE.Texture>("noise/greyscale-fractal");
    noiseTexture.wrapS = noiseTexture.wrapT = THREE.RepeatWrapping;
    const noiseFinalTexture = resources.get<THREE.Texture>("noise/rgb-generated");
    noiseFinalTexture.wrapS = noiseFinalTexture.wrapT = THREE.RepeatWrapping;
    const inkLut = resources.get<LutData>("lut/ink");
    const dryLut = resources.get<LutData>("lut/dry");
    const inkLut3d = this._createLut3d(inkLut);
    const dryLut3d = this._createLut3d(dryLut);
    const groundAtlas = resources.get<THREE.Texture>("watercolor/ground");

    const prepared: PreparedPaper[] = [];

    // GLB meshes remain hidden authoring proxies. The visible papers are built
    // below from the source's single subdivided plane and instance matrices.
    PAPERS_CONFIG.forEach((config, index) => {
      const mesh = gltf.scene.getObjectByName(config.name) as THREE.Mesh | undefined;
      if (!mesh || !(mesh as THREE.Mesh).isMesh) {
        console.warn(`[WatercolorView] GLB 中找不到网格: ${config.name}`);
        return;
      }
      const sdfData = this._sdfMap.get(config.name);
      const texData = this._texMap.get(config.name);
      if (!sdfData || !texData) return;

      const reveal = createRevealConfig(sdfData.planeSize.y / sdfData.planeSize.x, config.name);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.geometry.computeBoundingBox();
      const bounds = mesh.geometry.boundingBox!;
      const width = Math.abs(bounds.min.z) + Math.abs(bounds.max.z);
      const height = Math.abs(bounds.min.y) + Math.abs(bounds.max.y);
      const transform = new THREE.Object3D();
      transform.position.copy(mesh.position);
      if (mesh.parent) transform.position.add(mesh.parent.position);
      transform.scale.set(1, height, width);
      transform.rotation.y = -(mesh.parent?.rotation.y ?? 0);
      transform.rotation.x -= Math.PI;
      transform.rotation.z = Math.PI / 2;
      transform.updateMatrix();

      const simulationBox = new THREE.Vector4(0, 0, 1, 1);
      const simulationRemap = simulation.regionRemapForPaper(index);
      const state = { alpha: 0, curve: 1, reveal: 0, rotationZ: -Math.PI / 2 };
      this.papers.push({ index, config, mesh, transform, state, revealed: false, tween: null });
      prepared.push({ index, config, mesh, sdfData, texData, reveal, matrix: transform.matrix.clone(), simulationBox, simulationRemap });
      this.instanceConfigs.push({
        index,
        config,
        matrix: transform.matrix.clone(),
        proxy: mesh,
        paintAtlasRemap: new THREE.Vector4(
          texData.atlasRemap.x,
          texData.atlasRemap.y,
          texData.atlasRemap.z,
          texData.atlasRemap.w,
        ),
        sdfAtlasRemap: new THREE.Vector4(
          sdfData.atlasRemap.x,
          sdfData.atlasRemap.y,
          sdfData.atlasRemap.z,
          sdfData.atlasRemap.w,
        ),
        simulationBox,
        simulationRemap,
        reveal,
        initialRotationZ: -Math.PI / 2,
        isTransparent: Boolean(config.transparency),
        renderGroup: config.transparency ? "transparent" : "paint",
      });

      if (config.hasGround) this._createGround(config, mesh, groundAtlas, noiseTexture, index);
      if (config.leaves) this._createLeaves(config, mesh);
    });

    const geometry = this._createPaperGeometry(prepared);
    this._paperMaterial = this._createPaperMaterial(
      prepared,
      atlasTexture,
      maskTexture,
      sdfTexture,
      normalTexture,
      noiseTexture,
      noiseFinalTexture,
      inkLut3d,
      dryLut3d,
    );
    this._paperMesh = new THREE.InstancedMesh(geometry, this._paperMaterial, prepared.length);
    this._paperMesh.frustumCulled = false;
    this._paperMesh.renderOrder = 1;
    prepared.forEach((paper, index) => this._paperMesh!.setMatrixAt(index, paper.matrix));
    this._paperMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this._paperMesh);

    // The source renderer builds its ground from per-paper instances. Keeping
    // the raw helper mesh visible creates the green horizontal slab seen in v1.
    const groundMesh = gltf.scene.getObjectByName("Ground") as THREE.Mesh | undefined;
    if (groundMesh) groundMesh.visible = false;

    // Raw authoring helpers are replaced by the runtime vegetation layer.
    ["Ribblehead-Viaduct-herb1", "Ribblehead-Viaduct-herb2"].forEach((name) => {
      const herb = gltf.scene.getObjectByName(name);
      if (herb) herb.visible = false;
    });
  }

  /** 每帧更新：阻尼相机使用 cameraTime，显现触发使用未阻尼 triggerTime。 */
  update(
    time: number,
    delta: number,
    cameraTime: number,
    triggerTime: number,
    fogState: { opaque: number; occulted: number },
  ): void {
    const frozenTime = getDebugOptions().freezeTime;
    this._time = frozenTime ?? time;
    this.scrollCamera.update(this._time, delta, cameraTime);
    this.paintingTitles.update(this._time, delta, this.scrollCamera.camera, fogState);

    const simTexture = this._simulation?.texture ?? null;
    const uniforms = this._paperMaterial?.uniforms;
    if (uniforms) {
      uniforms.uTime.value = this._time;
      (uniforms.uFogState.value as THREE.Vector2).set(fogState.opaque, fogState.occulted);
      if (simTexture && uniforms.uSimulationTexture.value !== simTexture) {
        uniforms.uSimulationTexture.value = simTexture;
      }
    }
    this.papers.forEach((paper) => {
      if (uniforms) {
        (uniforms.uAlpha.value as number[])[paper.index] = paper.state.alpha;
        (uniforms.uCurveCoef.value as number[])[paper.index] = paper.state.curve;
        (uniforms.uRevealProgress.value as number[])[paper.index] = paper.state.reveal;
      }
      if (!paper.revealed && triggerTime >= paper.config.startAt) {
        this._reveal(paper);
      }
      paper.transform.rotation.z = -paper.state.rotationZ;
      paper.transform.updateMatrix();
      this._paperMesh?.setMatrixAt(paper.index, paper.transform.matrix);
    });
    if (this._paperMesh) this._paperMesh.instanceMatrix.needsUpdate = true;

    this._leavesMaterials.forEach((mat) => {
      mat.uniforms.uTime.value = this._time;
    });

    this._groundMaterials.forEach((mat) => {
      mat.uniforms.uTime.value = this._time;
      mat.uniforms.uFogState.value.set(fogState.opaque, fogState.occulted);
      if (simTexture && mat.uniforms.uSimulation.value !== simTexture) {
        mat.uniforms.uSimulation.value = simTexture;
      }
    });
  }

  /** 全部隐藏（重启用） */
  hideAll(): void {
    this.papers.forEach((paper) => {
      paper.revealed = false;
      paper.tween?.kill();
      paper.state.alpha = 0;
      paper.state.curve = 1;
      paper.state.reveal = 0;
      paper.state.rotationZ = -Math.PI / 2;
    });
    this._grounds.forEach((ground) => {
      ground.mesh.visible = false;
      ground.material.uniforms.uAlpha.value = 0;
    });
    this.paintingTitles.hideAll();
  }

  resize(width: number, height: number): void {
    this.scrollCamera.resize(width, height);
    this.paintingTitles.resize(width, height);
    (this._paperMaterial?.uniforms.uResolution.value as THREE.Vector2 | undefined)?.set(width, height);
  }

  setPointer(clientX: number, clientY: number): void {
    this.scrollCamera.setPointer(clientX, clientY);
    this.paintingTitles.setPointer(clientX, clientY);
  }

  hitTestTitle(ndc: THREE.Vector2): { sceneIndex: number } | null {
    return this.paintingTitles.hitTest(ndc);
  }

  setHoveredTitle(sceneIndex: number | null): void {
    this.paintingTitles.setHovered(sceneIndex);
  }

  getRaycastPapers(camera: THREE.Camera): PaperEntry[] {
    const projection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(projection);
    return this.papers.filter((paper) => paper.revealed && frustum.intersectsObject(paper.mesh));
  }

  raycastPaper(
    raycaster: THREE.Raycaster,
  ): { paperIndex: number; sceneIndex: number; uv: THREE.Vector2 } | null {
    if (!this._paperMesh) return null;
    const hits = raycaster.intersectObject(this._paperMesh, false);
    for (const hit of hits) {
      if (hit.instanceId == null || !hit.uv) continue;
      const paper = this.papers[hit.instanceId];
      if (!paper?.revealed || paper.state.alpha < 0.01) continue;
      const uv = hit.uv.clone();
      uv.x = 1 - uv.x;
      return { paperIndex: paper.index, sceneIndex: paper.config.sceneIndex, uv };
    }
    return null;
  }

  getPaperProjectedSize(paperIndex: number, camera: THREE.Camera): number {
    const paper = this.papers[paperIndex];
    if (!paper) return Math.min(window.innerWidth, window.innerHeight);
    const corners = [
      new THREE.Vector3(0, -1, -0.5),
      new THREE.Vector3(0, -1, 0.5),
      new THREE.Vector3(0, 0, -0.5),
      new THREE.Vector3(0, 0, 0.5),
    ].map((corner) => corner.applyMatrix4(paper.transform.matrix).project(camera));
    const xs = corners.map((corner) => (corner.x * 0.5 + 0.5) * window.innerWidth);
    const ys = corners.map((corner) => (-corner.y * 0.5 + 0.5) * window.innerHeight);
    return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
  }

  private _reveal(paper: PaperEntry): void {
    paper.revealed = true;
    const tl = gsap.timeline();
    tl.fromTo(paper.state, { alpha: 0 }, { alpha: 1, duration: 0.01, ease: "none" }, 0);
    tl.fromTo(paper.state, { curve: 0 }, { curve: 1, duration: 10, ease: "power4.out" }, 0);
    tl.fromTo(
      paper.state,
      { rotationZ: -Math.PI / 2 },
      { rotationZ: 0, duration: 7, ease: "back.out(1.7)" },
      0,
    );
    tl.to(paper.state, { reveal: 15, duration: 15, ease: "none" }, 0);
    const ground = this._grounds.find((entry) => entry.paperName === paper.config.name);
    if (ground) {
      ground.mesh.visible = true;
      tl.to(ground.material.uniforms.uAlpha, { value: 1, duration: 0.4, ease: "sine.inOut" }, 0);
    }
    paper.tween = tl;
  }

  private _createPaperGeometry(papers: PreparedPaper[]): THREE.InstancedBufferGeometry {
    const plane = new THREE.PlaneGeometry(1, 1, 10, 10);
    plane.translate(0, -0.5, 0);
    plane.rotateY(-0.5 * Math.PI);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.copy(plane);
    geometry.instanceCount = papers.length;
    geometry.setAttribute("instance", new THREE.InstancedBufferAttribute(new Float32Array(papers.map((paper) => paper.index)), 1));
    geometry.setAttribute(
      "simulationBox",
      new THREE.InstancedBufferAttribute(new Float32Array(papers.flatMap((paper) => paper.simulationBox.toArray())), 4),
    );
    geometry.setAttribute(
      "simulationRemap",
      new THREE.InstancedBufferAttribute(new Float32Array(papers.flatMap((paper) => paper.simulationRemap.toArray())), 4),
    );
    geometry.setAttribute(
      "transparency",
      new THREE.InstancedBufferAttribute(new Float32Array(papers.map((paper) => paper.config.transparency ? 1 : 0)), 1),
    );
    plane.dispose();
    return geometry;
  }

  private _createPaperMaterial(
    papers: PreparedPaper[],
    atlasTexture: THREE.Texture,
    maskTexture: THREE.Texture,
    sdfTexture: THREE.Texture,
    normalTexture: THREE.Texture,
    noiseTexture: THREE.Texture,
    noiseFinalTexture: THREE.Texture,
    inkLut3d: THREE.Data3DTexture,
    dryLut3d: THREE.Data3DTexture,
  ): THREE.ShaderMaterial {
    const revealMatrices = papers.map((paper) => new THREE.Matrix4().fromArray(paper.reveal.infos.flatMap((point) => point.toArray())));
    const revealPositionMatrices = papers.map((paper) => new THREE.Matrix4().fromArray(
      paper.reveal.positions.flatMap((point) => [point.x, point.y, 0, 0]),
    ));
    const uniforms = {
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
      tNoiseTexture: { value: noiseTexture },
      uLighterColor: { value: new THREE.Color("#f2f0ea") },
      uNormalMapStrength: { value: 0.35 },
      uNormalMapScale: { value: 1 },
      uSdfPlaneSize: { value: papers.map((paper) => new THREE.Vector2(paper.sdfData.planeSize.x, paper.sdfData.planeSize.y)) },
      uSdfScale: { value: papers.map((paper) => new THREE.Vector2(paper.sdfData.scale.x, paper.sdfData.scale.y)) },
      uSdfOriginSize: { value: papers.map((paper) => new THREE.Vector2(paper.sdfData.originSize.x, paper.sdfData.originSize.y)) },
      uSdfAtlasRemap: { value: papers.map((paper) => new THREE.Vector4(
        paper.sdfData.atlasRemap.x,
        paper.sdfData.atlasRemap.y,
        paper.sdfData.atlasRemap.z,
        paper.sdfData.atlasRemap.w,
      )) },
      uSdfAtlasTexture: { value: sdfTexture },
      uInkLut3d: { value: inkLut3d },
      uDryLut3d: { value: dryLut3d },
      uLutEnable: { value: 1 },
      uLutSize: { value: inkLut3d.image.width },
      uPaintAtlasRemap: { value: papers.map((paper) => new THREE.Vector4(
        paper.texData.atlasRemap.x,
        paper.texData.atlasRemap.y,
        paper.texData.atlasRemap.z,
        paper.texData.atlasRemap.w,
      )) },
      uPaintAtlasTexture: { value: atlasTexture },
      uMaskAtlasTexture: { value: maskTexture },
      uPaintIntensity: { value: new THREE.Vector2(0.35, 1) },
      uNormalMapTexture: { value: normalTexture },
      uLighting: { value: {
        groundSpecularScale: new THREE.Vector2(30, 30),
        groundSpecularOffset: new THREE.Vector2(0, 0),
        groundSpecularStrength: 0.05,
        specularCenter: new THREE.Vector2(0.5, 0.62),
        specularScale: new THREE.Vector2(0.85, 0.85),
        specularOffset: new THREE.Vector2(0, 0),
        specularStrength: 0.12,
      } },
      uBackground: { value: {
        groundColor: new THREE.Color("#cfccc2"),
        skyColor: new THREE.Color("#f2f1ec"),
        progressRemap: new THREE.Vector2(0, 1),
      } },
      uNoiseTexture: { value: noiseTexture },
      uNoiseFinalTexture: { value: noiseFinalTexture },
      uRevealProgress: { value: new Array(papers.length).fill(0) },
      uRevealPoints: { value: revealMatrices },
      uRevealPointsPos: { value: revealPositionMatrices },
      uSimulationTexture: { value: null },
      uFogState: { value: new THREE.Vector2(0, 0) },
      uAlpha: { value: new Array(papers.length).fill(0) },
      uCurveCoef: { value: new Array(papers.length).fill(0) },
    };
    this._paperUniforms = uniforms;
    return new THREE.ShaderMaterial({
      vertexShader: paperVertexShader,
      fragmentShader: paperFragmentShader,
      defines: { INSTANCE_COUNT: papers.length },
      transparent: true,
      depthTest: true,
      depthWrite: true,
      side: THREE.FrontSide,
      uniforms,
    });
  }

  /** 画纸下方的地面块 */
  private _createGround(
    config: PaperConfig,
    paperMesh: THREE.Mesh,
    groundAtlas: THREE.Texture,
    noiseTexture: THREE.Texture,
    paperIndex: number,
  ): void {
    const atlasEntry = GROUND_ATLAS.find((g) => g.name === config.ground.texture)!;
    paperMesh.geometry.computeBoundingBox();
    const sourceSize = paperMesh.geometry.boundingBox!.getSize(new THREE.Vector3());
    // Exact production _computeSizes(): source geometry uses Z as its paper width.
    const width = sourceSize.z + 2 * config.ground.edges;
    const depth = config.ground.depth;

    const material = this._createGroundMaterial(atlasEntry, new THREE.Vector2(width, depth), groundAtlas, noiseTexture, 0, paperIndex);

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    const paperPos = new THREE.Vector3();
    paperMesh.getWorldPosition(paperPos);
    mesh.position.copy(paperPos);
    mesh.position.y += 0.01;

    // 对应原站：rotation.x = 1.5π, rotation.z = -0.5π + 纸张朝向
    const paperQuat = new THREE.Quaternion();
    paperMesh.getWorldQuaternion(paperQuat);
    const euler = new THREE.Euler().setFromQuaternion(paperQuat, "YXZ");
    mesh.rotation.set(1.5 * Math.PI, 0, -0.5 * Math.PI + euler.y);
    mesh.scale.set(width, depth, 1);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = -1;
    this.scene.add(mesh);
    this._grounds.push({ mesh, material, paperName: config.name });
  }

  private _createGroundMaterial(
    atlasEntry: { offset: { x: number; y: number }; size: { x: number; y: number } },
    boxSize: THREE.Vector2,
    groundAtlas: THREE.Texture,
    noiseTexture: THREE.Texture,
    baseAlpha: number,
    paperIndex = 0,
  ): THREE.ShaderMaterial {
    const simRemap = this._simulation!.regionRemapForPaper(paperIndex);
    const material = new THREE.ShaderMaterial({
      vertexShader: groundVertexShader,
      fragmentShader: groundFragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uAtlasTexture: { value: groundAtlas },
        uSimulation: { value: null },
        uNoise: { value: noiseTexture },
        uAtlasRemap: {
          value: new THREE.Vector4(atlasEntry.offset.x, atlasEntry.offset.y, atlasEntry.size.x, atlasEntry.size.y),
        },
        uBoxSize: { value: boxSize },
        uNoiseIntensity: { value: 1.31 },
        uNoiseScale: { value: 0.4 },
        uDimSlope: { value: 1.46 },
        uSimulationIntensity: { value: 1 },
        uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
        uTime: { value: 0 },
        uFogState: { value: new THREE.Vector2(0, 0) },
        tNoiseTexture: { value: noiseTexture },
        uAlpha: { value: 1 },
        uBaseAlpha: { value: baseAlpha },
        uSimulationBox: { value: new THREE.Vector4(0, 0, 1, 1) },
        uSimulationRemap: { value: simRemap },
      },
    });
    this._groundMaterials.push(material);
    return material;
  }

  /** 树叶粒子：在元素周围飘落 */
  private _createLeaves(config: PaperConfig, paperMesh: THREE.Mesh): void {
    const count = 30;
    const leaves = config.leaves!;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 3);
    const offsets = new Float32Array(count);
    const leafIndices = new Float32Array(count);

    const paperPos = new THREE.Vector3();
    paperMesh.getWorldPosition(paperPos);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = paperPos.x + (Math.random() - 0.5) * 4;
      positions[i * 3 + 1] = paperPos.y + Math.random() * leaves.amplitude * 2;
      positions[i * 3 + 2] = paperPos.z + (Math.random() - 0.5) * 4;
      seeds[i * 3] = Math.random();
      seeds[i * 3 + 1] = Math.random();
      seeds[i * 3 + 2] = Math.random();
      offsets[i] = Math.random();
      leafIndices[i] = Math.floor(Math.random() * 5);
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 3));
    geometry.setAttribute("aOffset", new THREE.BufferAttribute(offsets, 1));
    geometry.setAttribute("aLeafIndex", new THREE.BufferAttribute(leafIndices, 1));

    const material = new THREE.ShaderMaterial({
      vertexShader: leavesVertexShader,
      fragmentShader: leavesFragmentShader,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: leaves.size * 8 },
        uAmplitude: { value: leaves.amplitude },
        uDuration: { value: leaves.duration * 12 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
        uTexture: { value: resources.get<THREE.Texture>("leave/texture") },
        uColor: { value: new THREE.Color(leaves.color) },
        uGlobalAlpha: { value: 0.55 },
      },
    });
    this._leavesMaterials.push(material);

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    this.scene.add(points);
  }

  private _createLut3d(lut: LutData): THREE.Data3DTexture {
    const texture = new THREE.Data3DTexture(lut.data, lut.size, lut.size, lut.size);
    texture.format = THREE.RGBAFormat;
    texture.type = THREE.UnsignedByteType;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = texture.wrapT = texture.wrapR = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  }
}

import * as THREE from "three";
import { IS_MOBILE } from "../../config/assets";
import { resources } from "../../core/Resources";
import { grassFragmentShader, grassVertexShader } from "../../shaders/grass";
import type { GrassInstanceConfig } from "../types";

interface GrassPatch {
  config: GrassInstanceConfig;
  mesh: THREE.InstancedMesh;
  revealAttribute: THREE.InstancedBufferAttribute;
  states: ("none" | "rise" | "fall")[];
  hitPoint: THREE.Vector3 | null;
  hitRadius: number;
  lastHitAt: number;
}

interface BladeAtlasEntry {
  offset: [number, number];
  size: [number, number];
}

interface GrassPoint {
  x: number;
  z: number;
  scale: number;
  clusterBlade: number;
}

const BLADE_ATLAS: BladeAtlasEntry[] = [
  { offset: [0.0078125, 0.0078125], size: [0.0703125, 0.984375] },
  { offset: [0.28125, 0.0078125], size: [0.0625, 0.8515625] },
  { offset: [0.6796875, 0.0078125], size: [0.0625, 0.8046875] },
  { offset: [0.4375, 0.0078125], size: [0.0703125, 0.8125] },
  { offset: [0.7578125, 0.0078125], size: [0.0546875, 0.7890625] },
  { offset: [0.171875, 0.0078125], size: [0.09375, 0.8828125] },
  { offset: [0.09375, 0.0078125], size: [0.0625, 0.953125] },
  { offset: [0.5234375, 0.0078125], size: [0.0703125, 0.8125] },
  { offset: [0.609375, 0.0078125], size: [0.0546875, 0.8125] },
  { offset: [0.359375, 0.0078125], size: [0.0625, 0.84375] },
];

const mix = (from: number, to: number, ratio: number): number => (1 - ratio) * from + ratio * to;

export class GrassLayer {
  readonly group = new THREE.Group();
  readonly configs: GrassInstanceConfig[] = [];
  private _patches: GrassPatch[] = [];
  private _material: THREE.ShaderMaterial | null = null;

  constructor() {
    this.group.name = "SourceGrassLayer";
    this.group.visible = !IS_MOBILE;
  }

  init(): void {
    if (IS_MOBILE) return;
    const noise = resources.get<THREE.Texture>("grass/noise");
    noise.wrapS = noise.wrapT = THREE.RepeatWrapping;
    const blades = resources.get<THREE.Texture>("grass/blade-atlas");
    blades.flipY = true;
    const gradients = resources.get<THREE.Texture>("grass/color-gradients");
    gradients.encoding = THREE.sRGBEncoding;
    const fogNoise = resources.get<THREE.Texture>("noise/rgb-fractal");
    fogNoise.wrapS = fogNoise.wrapT = THREE.RepeatWrapping;
    this._material = new THREE.ShaderMaterial({
      vertexShader: grassVertexShader,
      fragmentShader: grassFragmentShader,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uWindDisplacement: { value: 3000 },
        uWindIntensity: { value: 3 },
        uWindSpeed: { value: 0.5 },
        uScale: { value: 5 },
        tNoise: { value: noise },
        tGrass: { value: blades },
        tGradient: { value: gradients },
        tNoiseTexture: { value: fogNoise },
        uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
        uFogState: { value: new THREE.Vector2() },
      },
    });
  }

  addGround(paperIndex: number, ground: THREE.Mesh, size: THREE.Vector2): void {
    if (IS_MOBILE || !this._material) return;
    const instances = this._createPoints(size);
    if (!instances.length) return;

    const source = new THREE.PlaneGeometry(0.1, 0.1, 1, 8);
    source.rotateY(-Math.PI * 0.5);
    source.translate(0, 0.05, 0);
    const geometry = new THREE.InstancedBufferGeometry().copy(source);
    const reveal = new Float32Array(instances.length);
    const remaps = new Float32Array(instances.length * 4);
    const gradients = new Float32Array(instances.length);
    geometry.setAttribute("aRevealProgress", new THREE.InstancedBufferAttribute(reveal, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aGrassTextureRemap", new THREE.InstancedBufferAttribute(remaps, 4));
    geometry.setAttribute("aGradient", new THREE.InstancedBufferAttribute(gradients, 1));
    const mesh = new THREE.InstancedMesh(geometry, this._material, instances.length);
    mesh.renderOrder = 200;
    mesh.frustumCulled = true;
    mesh.position.copy(ground.position);
    // The source copies the paper container transform. Ground Z stores
    // -PI/2 + the authored paper yaw, so this recovers that same yaw.
    mesh.rotation.y = ground.rotation.z + Math.PI * 0.5;
    const dummy = new THREE.Object3D();
    instances.forEach((instance, index) => {
      const bladeIndex = Math.floor(Math.random() * BLADE_ATLAS.length);
      const blade = BLADE_ATLAS[bladeIndex];
      const aspect = blade.size[0] / blade.size[1];
      dummy.position.set(instance.x, 0, instance.z);
      dummy.rotation.set(Math.random() - 0.5, 0, 0);
      dummy.scale.set(1, instance.scale, instance.scale * aspect * 3);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      remaps.set([blade.offset[0], 1 - blade.offset[1], blade.size[0], -blade.size[1]], index * 4);
      gradients[index] = (3 * instance.clusterBlade + Math.floor(3 * Math.random()) + 0.5) / 24;
    });
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
    const positions = new Float32Array(instances.length * 3);
    instances.forEach((instance, index) => positions.set([instance.x, 0, instance.z], index * 3));
    const config = { paperIndex, ground, positions, reveal };
    this.configs.push(config);
    this._patches.push({
      config,
      mesh,
      revealAttribute: geometry.getAttribute("aRevealProgress") as THREE.InstancedBufferAttribute,
      states: instances.map(() => "none"),
      hitPoint: null,
      hitRadius: Math.max(size.x, size.y) * 0.08,
      lastHitAt: -Infinity,
    });
  }

  setGroundHit(paperIndex: number | null, point: THREE.Vector3 | null): void {
    const now = performance.now();
    this._patches.forEach((patch) => {
      if (paperIndex === patch.config.paperIndex && point) {
        patch.hitPoint = point.clone();
        patch.lastHitAt = now;
      }
    });
  }

  update(time: number, delta: number, fogState: { opaque: number; occulted: number }): void {
    if (IS_MOBILE || !this._material) return;
    this._material.uniforms.uTime.value = time;
    (this._material.uniforms.uFogState.value as THREE.Vector2).set(fogState.opaque, fogState.occulted);
    const now = performance.now();
    const local = new THREE.Vector3();
    this._patches.forEach((patch) => {
      const activePoint = now - patch.lastHitAt < 100 ? patch.hitPoint : null;
      let changed = false;
      patch.mesh.updateWorldMatrix(true, false);
      for (let index = 0; index < patch.states.length; index++) {
        const matrix = new THREE.Matrix4();
        patch.mesh.getMatrixAt(index, matrix);
        local.setFromMatrixPosition(matrix).applyMatrix4(patch.mesh.matrixWorld);
        const distance = activePoint ? Math.hypot(activePoint.x - local.x, activePoint.z - local.z) : Infinity;
        let value = patch.config.reveal[index];
        if (value <= 0) patch.states[index] = "none";
        if (distance < patch.hitRadius) patch.states[index] = "rise";
        if (value >= 1) patch.states[index] = "fall";
        if (patch.states[index] === "rise") value = Math.min(value + delta / 1, 1);
        if (patch.states[index] === "fall") value = Math.max(value - delta / 3, 0);
        if (value !== patch.config.reveal[index]) {
          patch.config.reveal[index] = value;
          changed = true;
        }
      }
      if (changed) patch.revealAttribute.needsUpdate = true;
    });
  }

  resize(width: number, height: number): void {
    (this._material?.uniforms.uResolution.value as THREE.Vector2 | undefined)?.set(width, height);
  }

  reset(): void {
    this._patches.forEach((patch) => {
      patch.config.reveal.fill(0);
      patch.states.fill("none");
      patch.hitPoint = null;
      patch.revealAttribute.needsUpdate = true;
    });
  }

  private _createPoints(size: THREE.Vector2): GrassPoint[] {
    const edge: [number, number] = [0.6, 0.4];
    const centers = this._poissonPoints(Math.max(size.x - edge[0] * 2, 0.1), Math.max(size.y - edge[1] * 2, 0.1));
    const result: GrassPoint[] = [];
    centers.forEach((center) => {
      center[0] += edge[0];
      center[1] += edge[1];
      const clusterCount = Math.floor(mix(7, 25, Math.random()));
      const clusterBlade = Math.floor(8 * Math.random());
      for (let index = 0; index < clusterCount; index++) {
        const distribution = Math.random();
        const radiusX = mix(0.05 * edge[0], edge[0], distribution);
        const radiusZ = mix(0.05 * edge[1], edge[1], distribution);
        const angle = mix(0, Math.PI * 2, Math.random());
        const normalizedRadius = Math.hypot(radiusX, radiusZ) / Math.hypot(edge[0], edge[1]);
        const scale = mix(
          1,
          0.2,
          mix(
            1 - Math.pow(1 - normalizedRadius, 3),
            Math.random(),
            (1 - normalizedRadius + Math.random()) / 2,
          ),
        );
        const pointX = center[0] + Math.cos(angle) * radiusX;
        const pointZ = center[1] + Math.sin(angle) * radiusZ;
        result.push(this._mapPoint(pointX, pointZ, scale, clusterBlade, size));
      }
      const centerScale = mix(1, 0.2, mix(1, Math.random(), (1 + Math.random()) / 2));
      result.push(this._mapPoint(center[0], center[1], centerScale, clusterBlade, size));
    });
    return result;
  }

  private _mapPoint(x: number, z: number, scale: number, clusterBlade: number, size: THREE.Vector2): GrassPoint {
    const normalizedX = x / size.x;
    const normalizedZ = z / size.y;
    return {
      x: -size.y * normalizedZ,
      z: mix(-0.5 * size.x, 0.5 * size.x, normalizedX),
      scale,
      clusterBlade,
    };
  }

  /** Fixed-density PoissonDiskSampling.fill(), ported from bundle module 2630. */
  private _poissonPoints(width: number, height: number): [number, number][] {
    const minDistance = 1.8;
    const maxDistance = 2.8;
    const epsilon = 1e-14 * Math.max(1, (Math.max(width, height) / 128) | 0);
    const minWithEpsilon = minDistance + epsilon;
    const deltaDistance = Math.max(0, maxDistance - minWithEpsilon);
    const points: [number, number][] = [[Math.random() * width, Math.random() * height]];
    const process: [number, number][] = [points[0]];
    let current: [number, number] | null = null;
    while (process.length) {
      if (!current) current = process.shift()!;
      let accepted = false;
      for (let attempt = 0; attempt < 7; attempt++) {
        const distance = minWithEpsilon + deltaDistance * Math.random();
        const angle = Math.random() * Math.PI * 2;
        const candidate: [number, number] = [
          current[0] + Math.cos(angle) * distance,
          current[1] + Math.sin(angle) * distance,
        ];
        const inside = candidate[0] >= 0 && candidate[0] < width && candidate[1] >= 0 && candidate[1] < height;
        const clear = inside && points.every((point) => {
          const dx = point[0] - candidate[0];
          const dz = point[1] - candidate[1];
          return dx * dx + dz * dz >= minDistance * minDistance;
        });
        if (!clear) continue;
        points.push(candidate);
        process.push(candidate);
        accepted = true;
        break;
      }
      if (!accepted) current = null;
    }
    return points;
  }
}

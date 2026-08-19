/**
 * 滚动相机。
 * 原站把约克郡山谷场景中的相机运动烘焙进了 scene.glb 的
 * `Camera_Action_Baked` 动画（59.77 秒，仅 translation + rotation 两条轨道），
 * 滚动进度直接采样这条动画曲线 —— 这是"滚动即长镜头"的关键手法。
 *
 * 复刻版用 AnimationMixer 在暂停状态下按时间采样，再把动画节点的
 * 世界变换拷贝给渲染相机。
 */
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

export class ScrollCamera {
  camera!: THREE.PerspectiveCamera; // 在 init() 中创建

  private _mixer: THREE.AnimationMixer | null = null;
  private _action: THREE.AnimationAction | null = null;
  private _animatedNode: THREE.Object3D | null = null;
  private _root: THREE.Object3D | null = null;
  private _duration = 0;
  private _pointerTarget = new THREE.Vector2();
  private _pointerCurrent = new THREE.Vector2();
  private _reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /** 从 GLTF 场景初始化（gltf.scene 会被整体放进水彩场景） */
  init(gltf: GLTF): void {
    this._root = gltf.scene;
    this._animatedNode = gltf.scene.getObjectByName("Camera_Animation_Baked") ?? null;

    // 相机参数取自 GLB 中的相机定义（yfov 0.351 rad）
    const gltfCamera = gltf.cameras[0] as THREE.PerspectiveCamera | undefined;
    const fov = gltfCamera ? gltfCamera.fov : 20.1;
    this.camera = new THREE.PerspectiveCamera(fov, window.innerWidth / window.innerHeight, 0.1, 3200);

    const clip = gltf.animations.find((a) => a.name === "Camera_Action_Baked") ?? gltf.animations[0];
    if (clip && this._animatedNode) {
      this._duration = clip.duration;
      this._mixer = new THREE.AnimationMixer(this._root);
      this._action = this._mixer.clipAction(clip);
      this._action.play();
      this._mixer.setTime(0);
    }
  }

  get duration(): number {
    return this._duration;
  }

  setPointer(clientX: number, clientY: number): void {
    this._pointerTarget.set(
      (clientX / window.innerWidth) * 2 - 1,
      1 - (clientY / window.innerHeight) * 2,
    );
  }

  /** 按动画时间采样，并叠加原站开场镜头与轻量鼠标视差。 */
  update(time: number, delta: number, cameraTime: number): void {
    if (!this._mixer || !this._animatedNode) return;
    this._mixer.setTime(Math.min(Math.max(cameraTime, 0), this._duration - 0.001));
    this._root!.updateMatrixWorld(true);

    this._animatedNode.getWorldPosition(this.camera.position);
    this._animatedNode.getWorldQuaternion(this.camera.quaternion);

    const entryLinear = this._reducedMotion ? 1 : Math.min(Math.max(time / 5, 0), 1);
    const entry = 0.5 - 0.5 * Math.cos(Math.PI * entryLinear);
    this.camera.translateX(THREE.MathUtils.lerp(0.25, 0, entry));
    this.camera.translateZ(THREE.MathUtils.lerp(-0.85, 0.4, entry));
    this.camera.rotateY(THREE.MathUtils.lerp(-0.037 * Math.PI, 0, entry));

    if (!this._reducedMotion) {
      const alpha = 1 - Math.exp(-8 * Math.min(delta, 0.04));
      this._pointerCurrent.lerp(this._pointerTarget, alpha);
      this.camera.rotateX((this._pointerCurrent.y / 9.2) * 0.3);
      this.camera.rotateY((-this._pointerCurrent.x / 2.55) * 0.3);
    }
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
}

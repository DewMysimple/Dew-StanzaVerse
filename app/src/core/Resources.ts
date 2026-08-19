/**
 * 资源管理器。
 * 对应原站 bundle 中约 180,273 行注册的加载器体系
 * （gltf / obj / 3dl / texture / image / exr / json），
 * 复刻版保留 gltf / ktx2 / 3dl / texture / json / video / audio 七类，
 * 以命名空间 + 名称存取（如 "watercolor/scene"、"lut/ink"）。
 */
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { bus, EVENTS } from "./EventBus";

export interface ResourceItem {
  type: "gltf" | "ktx" | "3dl" | "texture" | "json" | "video" | "audio";
  path: string;
  name: string;
}

/** 3DL LUT 解析结果（对应原站 Gtt/Dtt 加载器的 { size, texture3D }） */
export interface LutData {
  size: number;
  /** RGBA Uint8 数据（已按原站算法归一化 + 通道重排） */
  data: Uint8Array<ArrayBuffer>;
}

const BASE_PATH = "/assets";

export class Resources {
  private _items = new Map<string, unknown>();
  private _gltfLoader = new GLTFLoader();
  private _textureLoader = new THREE.TextureLoader();
  private _ktx2Loader: KTX2Loader | null = null;
  private _fileLoader = new THREE.FileLoader();

  /** KTX2 需要在 renderer 就绪后 detectSupport */
  setupKtx2(renderer: THREE.WebGLRenderer): void {
    this._ktx2Loader = new KTX2Loader()
      .setTranscoderPath(`${BASE_PATH}/xp/libs/basis/`)
      .detectSupport(renderer);
  }

  /** 预载一组资源，回报总进度 */
  async preload(items: ResourceItem[]): Promise<void> {
    let loaded = 0;
    const total = items.length;
    await Promise.all(
      items.map(async (item) => {
        try {
          const result = await this._load(item);
          this._items.set(item.name, result);
        } catch (err) {
          console.error(`[Resources] 加载失败: ${item.name} (${item.path})`, err);
        } finally {
          loaded++;
          bus.emit(EVENTS.RESOURCES_PROGRESS, loaded / total);
        }
      }),
    );
    bus.emit(EVENTS.RESOURCES_COMPLETE);
  }

  get<T = unknown>(name: string): T {
    const item = this._items.get(name);
    if (item === undefined) console.warn(`[Resources] 资源不存在: ${name}`);
    return item as T;
  }

  has(name: string): boolean {
    return this._items.has(name);
  }

  private async _load(item: ResourceItem): Promise<unknown> {
    const url = `${BASE_PATH}${item.path}`;
    switch (item.type) {
      case "gltf":
        return this._gltfLoader.loadAsync(url) as Promise<GLTF>;
      case "ktx":
        return this._ktx2Loader!.loadAsync(url);
      case "texture": {
        const tex = await this._textureLoader.loadAsync(url);
        return tex;
      }
      case "json":
        this._fileLoader.setResponseType("json");
        return this._fileLoader.loadAsync(url);
      case "3dl": {
        this._fileLoader.setResponseType("text");
        const text = (await this._fileLoader.loadAsync(url)) as unknown as string;
        return this._parse3dl(text);
      }
      case "video": {
        const video = document.createElement("video");
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.crossOrigin = "anonymous";
        video.preload = "auto";
        video.src = url;
        await new Promise<void>((resolve, reject) => {
          video.addEventListener("canplaythrough", () => resolve(), { once: true });
          video.addEventListener("error", () => reject(new Error(`video error: ${url}`)), { once: true });
          video.load();
        });
        return video;
      }
      case "audio": {
        // 音频走 DOM <audio>（与原站一致），这里只登记路径
        return url;
      }
    }
  }

  /**
   * 解析 .3DL 色彩查找表 —— 1:1 复刻原站解析器（app.beautified.js 179907 行）：
   * 1. 去掉 # 注释与空行
   * 2. 首行是 shaper 预分级表，其数值个数 = 网格尺寸（ink=8，dry=32）
   * 3. 后续 size³ 行 RGB 整数，按 (o%r, ⌊o/r⌋%r, ⌊o/r²⌋%r) 重排进纹理坐标
   * 4. 归一化：找最大值 a，按 2^⌈log2(a)⌉（4096 或 1024）缩放到 0~255 的 Uint8
   */
  private _parse3dl(text: string): LutData {
    const lines = text
      .replace(/^#.*?(\n|\r)/gm, "")
      .replace(/^\s*?(\n|\r)/gm, "")
      .trim()
      .split(/[\n\r]+/g);

    const size = lines[0].trim().split(/\s+/g).length;
    const raw = new Array<number>(size * size * size * 4);
    let maxValue = 0;
    let o = 0;
    for (let s = 1; s < lines.length && o < size ** 3; s++) {
      const parts = lines[s].trim().split(/\s/);
      const c = parseFloat(parts[0]);
      const d = parseFloat(parts[1]);
      const f = parseFloat(parts[2]);
      maxValue = Math.max(maxValue, c, d, f);
      const h = (o % size) * size * size + (Math.floor(o / size) % size) * size + (Math.floor(o / (size * size)) % size);
      raw[4 * h + 0] = c;
      raw[4 * h + 1] = d;
      raw[4 * h + 2] = f;
      raw[4 * h + 3] = 1;
      o++;
    }

    const norm = Math.pow(2, Math.ceil(Math.log2(maxValue)));
    const data = new Uint8Array(size * size * size * 4);
    for (let g = 0; g < data.length; g += 4) {
      data[g + 0] = (255 * raw[g + 0]) / norm;
      data[g + 1] = (255 * raw[g + 1]) / norm;
      data[g + 2] = (255 * raw[g + 2]) / norm;
      data[g + 3] = 255;
    }
    return { size, data };
  }
}

export const resources = new Resources();

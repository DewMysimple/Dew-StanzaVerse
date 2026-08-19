import * as THREE from "three";
import type { RevealConfig } from "../types";

export interface DebugOptions {
  enabled: boolean;
  seed: number | null;
  freezeTime: number | null;
}

export function getDebugOptions(): DebugOptions {
  const params = new URLSearchParams(location.search);
  const seed = params.get("seed");
  const freeze = params.get("freeze");
  return {
    enabled: import.meta.env.DEV && params.get("debug") === "1",
    seed: seed == null ? null : Number(seed),
    freezeTime: freeze == null ? null : Number(freeze),
  };
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function hashName(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Exact port of V1 from the pristine production bundle (lines 161343+). */
export function createRevealConfig(planeRatio: number, name: string, scale = 1): RevealConfig {
  const debug = getDebugOptions();
  const random = debug.seed == null ? Math.random : mulberry32(debug.seed ^ hashName(name));
  const positions = Array.from({ length: 4 }, () => new THREE.Vector2());
  const infos = Array.from({ length: 4 }, () => new THREE.Vector4());
  const starts = [0, 0.2, 0.4, 0.6];
  const aspectFactor = Math.max(0, (planeRatio - 1) / 3);
  const usedStarts: number[] = [];

  infos.forEach((info, index) => {
    const position = positions[index];
    if (index === infos.length - 1) {
      position.set(0.5, 0.5);
      info.x = 0.95 * (1 + 2.5 * aspectFactor) * scale;
      info.y = 1.5 * starts[starts.length - 1];
      info.z = 4 * (1 + aspectFactor);
      info.z = Math.min(8, info.y + info.z) - info.y;
      return;
    }

    position.x = 0.1 + (0.9 * index) / (infos.length - 1);
    position.x += 0.2 * random() - 0.1;
    const minY = 0.4 + 0.3 * aspectFactor;
    position.y = minY + (1 - minY) * random();
    info.x = (0.6 + 0.4 * random()) * (1 + aspectFactor);
    do {
      info.y = starts[Math.floor(random() * starts.length)];
    } while (usedStarts.includes(info.y));
    usedStarts.push(info.y);
    info.z = 2.4 * (1 + aspectFactor);
    info.z = Math.min(5, info.y + info.z) - info.y;
  });

  return { positions, infos };
}

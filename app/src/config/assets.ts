/**
 * 资源清单 —— 与原站 bundle 中 "Watercolor" 视图的资源注册表一致
 * （app.beautified.js 约 168,337 行），另加视频/音频/MSDF。
 */
import type { ResourceItem } from "../core/Resources";

export const IS_MOBILE =
  "ontouchstart" in window || navigator.maxTouchPoints > 0 || window.innerWidth < 768;

/** 静态纹理/模型/LUT/图集 */
export const STATIC_RESOURCES: ResourceItem[] = [
  { type: "gltf", path: "/xp/models/scene.glb", name: "watercolor/scene" },
  { type: "texture", path: "/xp/textures/atlas/sdf.png", name: "atlas/sdf" },
  { type: "texture", path: "/xp/textures/atlas/texture.jpg", name: "atlas/texture" },
  { type: "texture", path: "/xp/textures/atlas/texture_mask.jpg", name: "atlas/texture_mask" },
  { type: "3dl", path: "/xp/lut/ink.3DL", name: "lut/ink" },
  { type: "3dl", path: "/xp/lut/dry.3DL", name: "lut/dry" },
  { type: "texture", path: "/xp/textures/paper/normal.jpg", name: "watercolor/paper/normal" },
  { type: "texture", path: "/xp/textures/paper/matcap.png", name: "watercolor/paper/matcap" },
  { type: "texture", path: "/xp/textures/paper/texture.jpg", name: "watercolor/paper/texture" },
  { type: "texture", path: "/xp/textures/noise.jpeg", name: "grass/noise" },
  { type: "texture", path: "/xp/textures/leaves.png", name: "leave/texture" },
  { type: "texture", path: "/xp/textures/noises/rgb-fractal.png", name: "noise/rgb-fractal" },
  { type: "texture", path: "/xp/textures/noises/greyscale-fractal.png", name: "noise/greyscale-fractal" },
  { type: "texture", path: "/xp/textures/noises/rgb-generated-compressed.png", name: "noise/rgb-generated" },
  { type: "ktx", path: "/xp/textures/grounds/atlas.ktx2", name: "watercolor/ground" },
  { type: "texture", path: "/xp/textures/grass/atlas.png", name: "grass/blade-atlas" },
  { type: "texture", path: "/xp/textures/grass/color-gradients.jpg", name: "grass/color-gradients" },
  { type: "texture", path: "/xp/poem/text.png", name: "poem/texture" },
  { type: "json", path: "/xp/msdf/CanelaText-Light/CanelaText-Light.json", name: "canela/font" },
  { type: "texture", path: "/xp/msdf/CanelaText-Light/CanelaText-Light.png", name: "canela/atlas" },
];

/** 视频纹理：桌面/移动 × base/over × 6 幅画（sceneIndex 1~6） */
export const VIDEO_RESOURCES: ResourceItem[] = (() => {
  const platform = IS_MOBILE ? "mobile" : "desktop";
  const items: ResourceItem[] = [];
  for (let i = 1; i <= 6; i++) {
    items.push({
      type: "video",
      path: `/xp/videos/${platform}/base/${i}.mp4`,
      name: `video/base/${i}`,
    });
    items.push({
      type: "video",
      path: `/xp/videos/${platform}/over/${i}.mp4`,
      name: `video/over/${i}`,
    });
  }
  return items;
})();

/**
 * 漂浮文字着色器 —— 基于原站 32_fragmentShader 的视觉算法，
 * 采样布局适配复刻版的 TextCanvas：
 *
 *   画布横向排列三个瓦片 [清晰 | 低模糊 | 高模糊]，
 *   每个瓦片包含完整的诗句堆叠；四边形在竖直方向上开一个
 *   随滚动移动的窗口（uWindowHeight 为窗口占内容总高的比例）。
 *
 * 视觉效果与原站一致：
 * - 上下边缘字符被噪声侵蚀、模糊并消散（clampFade）
 * - 鼠标附近字符被高斯环带扰动（dist）
 * - 进入/离开的"书写"与"淡出"动画（uWriteProgress / uFadeProgress）
 * - 三级模糊按噪声混合
 */

export const textVertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vUv = uv;
}
`;

export const textFragmentShader = /* glsl */ `
precision highp float;

uniform sampler2D map;
uniform sampler2D uNoise;

uniform vec2 uCursorPosition;   // 鼠标在四边形内的 uv
uniform float uCursorFactor;    // 鼠标扰动强度
uniform float uQuadRatio;       // 四边形宽高比
uniform float uScrollProgress;  // 滚动进度 0~1
uniform float uWindowHeight;    // 窗口高度占内容总高比例
uniform float uUvScrollProgress;
uniform float uVisibleArea;

uniform float uClampFadeOverride;
uniform float uFadeProgress;
uniform float uFadeNoiseSize;
uniform float uWriteProgress;
uniform float uAlpha;

varying vec2 vUv;

float cremap(float value, float start1, float stop1, float start2, float stop2) {
  float r = start2 + (stop2 - start2) * ((value - start1) / (stop1 - start1));
  return clamp(r, min(start2, stop2), max(start2, stop2));
}

float quarticInOut(float t) {
  return t < 0.5
    ? +8.0 * pow(t, 4.0)
    : -8.0 * pow(t - 1.0, 4.0) + 1.0;
}

float cubicIn(float t) {
  return t * t * t;
}

float cubicOut(float t) {
  float f = t - 1.0;
  return f * f * f + 1.0;
}

float quadraticOut(float t) {
  return -t * (t - 2.0);
}

/* 在指定瓦片（tileX0 = 0 / 1/3 / 2/3）中按滚动窗口采样文字 alpha */
float sampleAlpha(vec2 uv, float tileX0) {
  vec2 sampleUv;
  sampleUv.x = tileX0 + uv.x / 3.0;
  sampleUv.y = (1.0 - uv.y) * uWindowHeight + uScrollProgress * (1.0 - uWindowHeight);

  float texel = texture2D(map, sampleUv).a;
  if (uv.x < 0.0 || uv.x > 1.0) return 0.;
  return texel;
}

void main() {
  vec2 noiseBaseUv = vUv;

  // 鼠标扰动环带
  vec4 distNoise = texture2D(uNoise, (noiseBaseUv - vec2(0.6, uUvScrollProgress)) * 1.2);
  float distNoiseR = quarticInOut(distNoise.r);
  float size = 0.05;
  float dist = length((vUv - uCursorPosition) / vec2(1., uQuadRatio));
  dist = abs(0.15 - dist);
  dist = cremap(dist, 0., size / 2. + distNoiseR * size * 4., 1., 0.);
  dist = smoothstep(0., 1., dist) * distNoise.g;

  // 上下边缘消散
  float clampFadeNoise = texture2D(uNoise, noiseBaseUv * 0.7).r;
  clampFadeNoise = (clampFadeNoise - 0.5) * 2.;
  clampFadeNoise *= 0.2;

  float clampFade = abs(vUv.y + clampFadeNoise - 0.5) * 2. / uVisibleArea;
  float baseClampFade = clampFade;
  clampFade = mix(clampFade, 1., uClampFadeOverride);
  clampFade = cubicIn(clampFade);

  // 书写 / 淡出动画的位移噪声
  vec4 fadeDisplacementNoise = texture2D(uNoise, (noiseBaseUv - vec2(0., uUvScrollProgress)) * uFadeNoiseSize);

  float writeAnimationNoise = fadeDisplacementNoise.r;
  float writeAnimationProgress = min(uWriteProgress + quarticInOut(writeAnimationNoise) * 0.5 * cubicIn(uWriteProgress), 1.);

  float fadeDisplacementAmount = 0.2;
  float fadeProgress = pow(max(uFadeProgress - quarticInOut(fadeDisplacementNoise.b) * 0.5, 0.), 2.) * 4.;
  vec2 fadeDisplacement = (fadeDisplacementNoise.rg - 0.5) * 2. * fadeProgress * fadeDisplacementAmount;
  fadeDisplacement += (fadeDisplacementNoise.gb - 0.5) * 2. * writeAnimationProgress * fadeDisplacementAmount;

  dist *= smoothstep(0.5, 0., fadeProgress) * smoothstep(0.5, 0., writeAnimationProgress) * uCursorFactor;

  vec2 displacement = -(fadeDisplacementNoise.br - 0.5) * 2. * vec2(1., mix(0.1, 1., writeAnimationProgress));

  float displacementAmount = 0.15;
  displacementAmount *= max(clampFade * 0.4, dist * 0.2);
  displacement = displacement * displacementAmount - vec2(0.01, 0.);

  // 三级模糊混合
  float blurNoiseScale = 0.44;
  float noiseBlur = texture2D(uNoise, (noiseBaseUv - vec2(0.3, uUvScrollProgress)) * blurNoiseScale).g;
  noiseBlur = quarticInOut(noiseBlur);

  float clampFadeWithDist = mix(baseClampFade, 1., dist);
  float blurAmount = smoothstep(mix(0.5, 0.3, smoothstep(0.1, 0.4, clampFadeWithDist * clampFadeWithDist)), 1., noiseBlur) * mix(clampFadeWithDist, 0.7, dist);
  blurAmount = max(clampFade * 0.7, blurAmount);
  blurAmount = max(cubicOut(length(fadeDisplacement) * 15.), blurAmount);
  blurAmount = max(writeAnimationProgress, blurAmount);

  vec2 uv = vUv + displacement + fadeDisplacement * 0.5;
  float sharpTexture = sampleAlpha(uv, 0.0);
  float lowBlurTexture = sampleAlpha(uv, 1.0 / 3.0);
  float highBlurTexture = sampleAlpha(uv, 2.0 / 3.0);

  float sharpAmount = smoothstep(0.5, 0., blurAmount);
  float lowBlurAmount = smoothstep(0.5, 0., abs(blurAmount - 0.5));
  float highBlurAmount = smoothstep(0.5, 1.0, blurAmount);

  float alpha = sharpTexture * sharpAmount + lowBlurTexture * lowBlurAmount + highBlurTexture * highBlurAmount;
  alpha = min(alpha, 1.);

  alpha = cremap(alpha, quadraticOut(writeAnimationProgress) * 0.5, 1., 0., 1.);
  alpha *= (1. - uFadeProgress);
  alpha *= (1. - clampFade);
  alpha *= uAlpha;

  gl_FragColor = vec4(vec3(0.), alpha);
}
`;

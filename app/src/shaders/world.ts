/**
 * 背景与树叶着色器。
 *
 * background：全屏天空渐变（对应 paper 着色器里的 computeBackground 逻辑放大到整屏），
 *   叠加三态雾，保证画布从未被元素覆盖的区域也有呼吸感。
 * leaves：每个带 leaves 配置的元素挂一个 Points 粒子系统，
 *   叶子在元素附近飘落（正弦漂移 + 循环下落），用 leaves.png 着色。
 */
import { GLSL_UTILS, GLSL_FOG } from "./chunks";

export const backgroundVertexShader = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldPosition;
varying float vFogDepth;
void main() {
    vUv = uv;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vec4 mvPosition = viewMatrix * worldPosition;
    vFogDepth = -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
}
`;

export const backgroundFragmentShader = /* glsl */ `
precision highp float;

${GLSL_UTILS}
${GLSL_FOG}

varying vec2 vUv;
varying vec3 vWorldPosition;
varying float vFogDepth;

uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uFogState;
uniform sampler2D tNoiseTexture;
uniform vec3 uGroundColor;
uniform vec3 uSkyColor;
uniform vec2 uProgressRemap;

float sineInOut(float t) {
  return -0.5 * (cos(3.141592653589793 * t) - 1.0);
}

void main() {
    vec2 screenUv = gl_FragCoord.xy / uResolution;
    float baseProgress = cremap(screenUv.y, uProgressRemap.x, uProgressRemap.y, 0., 1.);
    float progress = 1. - abs((baseProgress - 0.5) * 2.);
    progress = sineInOut(progress);
    vec3 color = mix(uGroundColor, uSkyColor, progress);
    color = getFogColorWithRatio(uTime, vFogDepth, screenUv, uResolution, vWorldPosition, color, tNoiseTexture, uFogState.x, uFogState.y);
    gl_FragColor = vec4(color, 1.0);
    gl_FragColor = linearToSrgb(gl_FragColor);
}
`;

export const leavesVertexShader = /* glsl */ `
uniform float uTime;
uniform float uSize;
uniform float uAmplitude;
uniform float uDuration;
uniform float uPixelRatio;

attribute vec3 aSeed;      // 每片叶子的随机种子
attribute float aOffset;   // 相对元素中心的偏移
attribute float aLeafIndex;

varying float vAlpha;
varying vec2 vUvAngle;
varying float vLeafIndex;

void main() {
    // 循环下落：duration 秒一个周期
    float cycle = fract(uTime / uDuration + aSeed.x);
    vec3 pos = position;
    pos.y -= cycle * uAmplitude * 2.0;
    pos.x += sin(uTime * 2.0 + aSeed.y * 6.2831) * 0.15 * uAmplitude;
    pos.z += cos(uTime * 1.6 + aSeed.z * 6.2831) * 0.12 * uAmplitude;

    // 顶部淡入、底部淡出
    vAlpha = smoothstep(0.0, 0.15, cycle) * smoothstep(1.0, 0.8, cycle);
    vUvAngle = vec2(aSeed.y * 6.2831 + uTime * 0.8, 0.0);
    vLeafIndex = aLeafIndex;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = uSize * uPixelRatio * 120.0 / max(-mvPosition.z, 0.1);
}
`;

export const leavesFragmentShader = /* glsl */ `
precision highp float;

uniform sampler2D uTexture;
uniform vec3 uColor;
uniform float uGlobalAlpha;

varying float vAlpha;
varying vec2 vUvAngle;
varying float vLeafIndex;

void main() {
    // 以点中心旋转 uv，让叶子边落边转
    vec2 uv = gl_PointCoord - 0.5;
    float angle = vUvAngle.x;
    uv = vec2(cos(angle) * uv.x - sin(angle) * uv.y, sin(angle) * uv.x + cos(angle) * uv.y);
    uv += 0.5;
    uv.x = (uv.x + vLeafIndex) / 5.0;

    vec4 texel = texture2D(uTexture, uv);
    float alpha = texel.a * vAlpha * uGlobalAlpha;
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(texel.rgb * uColor, alpha);
}
`;

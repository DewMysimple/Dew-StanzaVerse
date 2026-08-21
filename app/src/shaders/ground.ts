/**
 * 地面（Ground）着色器。
 * 移植自 07_vertexShader / 08_fragmentShader，同样从实例化改为每网格独立材质：
 * - 从 ktx2 地面图集中按 remap 取样（带平铺）
 * - 噪声扰动的盒状 SDF 让地面边缘柔和消隐
 * - 流体模拟让画过的地面微微"渗色"（blend）
 * - 三态雾
 *
 * 简化：原站从阴影 RT 读 uShadowMap，复刻版默认纯白（无投影）。
 */
import { GLSL_UTILS, GLSL_FOG } from "./chunks";

export const groundVertexShader = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldPosition;
varying float vFogDepth;
varying vec2 vSimulationUv;

uniform vec4 uSimulationBox;
uniform vec4 uSimulationRemap;

float remap(float value, float start1, float stop1, float start2, float stop2) {
  return start2 + (stop2 - start2) * ((value - start1) / (stop1 - start1));
}

vec2 remapAtlasUv(vec2 uv, vec4 boxSize, vec4 atlasRemap) {
    vec2 _uv = uv;
    _uv.x = remap(_uv.x, 0., 1., boxSize.x, boxSize.z);
    _uv.y = remap(_uv.y, 1., 0., boxSize.y, boxSize.w);
    _uv.x = remap(_uv.x, 0., 1., atlasRemap.x, atlasRemap.x + atlasRemap.z);
    _uv.y = remap(_uv.y, 0., 1., atlasRemap.y, atlasRemap.y + atlasRemap.w);
    return _uv;
}

void main() {
    vUv = uv;
    vSimulationUv = remapAtlasUv(uv, uSimulationBox, uSimulationRemap);

    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;

    vec4 mvPosition = viewMatrix * worldPosition;
    vFogDepth = -mvPosition.z;

    gl_Position = projectionMatrix * mvPosition;
}
`;

export const groundFragmentShader = /* glsl */ `
precision highp float;

${GLSL_UTILS}
${GLSL_FOG}

varying vec2 vUv;
varying vec3 vWorldPosition;
varying float vFogDepth;
varying vec2 vSimulationUv;

uniform sampler2D uAtlasTexture;
uniform sampler2D uSimulation;
uniform sampler2D uNoise;
uniform vec4 uAtlasRemap;
uniform vec2 uBoxSize;

uniform float uNoiseIntensity;
uniform float uNoiseScale;
uniform float uDimSlope;
uniform float uSimulationIntensity;
uniform float uShadowIntensity;
uniform sampler2D uShadowMap;

uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uFogState;
uniform sampler2D tNoiseTexture;
uniform float uAlpha;
uniform float uBaseAlpha;

float sdBox( in vec2 p, in vec2 b ) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

void main() {
    float geometryRatio = uBoxSize.x / uBoxSize.y;
	vec2 screenUv = gl_FragCoord.xy / uResolution;

    vec4 data = texture2D(uSimulation, vSimulationUv);

    // 图集平铺取样
    vec2 groundUv = vUv;
    groundUv *= uBoxSize * 0.1;
    groundUv.x /= (uAtlasRemap.z / uAtlasRemap.w);
    groundUv = fract(groundUv);
    groundUv.x = remap(groundUv.x, 0., 1., uAtlasRemap.x + 0.01, uAtlasRemap.x + uAtlasRemap.z - 0.01);
    groundUv.y = remap(groundUv.y, 0., 1., uAtlasRemap.y + 0.01, uAtlasRemap.y + uAtlasRemap.w - 0.01);
    vec4 texel = texture2D(uAtlasTexture, groundUv);

    float blend = smoothstep(0., 0.1, data.b) * uSimulationIntensity;

    // 噪声扰动的盒状边缘
    vec2 noiseUv = vUv * vec2(geometryRatio, 1.) * uNoiseScale;
    vec4 noiseValue = texture2D(uNoise, noiseUv);

    vec2 sdfUv = vUv;
    sdfUv.y = 1. - sdfUv.y;
    sdfUv -= 0.5;
    sdfUv.x *= geometryRatio;
    sdfUv += 0.5;
    float boxDist = sdBox(sdfUv - 0.5, vec2(geometryRatio, 1.) / 2.);
    boxDist = min(boxDist, sdBox(sdfUv - vec2(0.5, 0.), vec2(geometryRatio, 2.) / 2.));
    boxDist += (noiseValue.r - 0.5) * uNoiseIntensity;
    boxDist = smoothstep(0., -uDimSlope, boxDist);

    float shadow = texture2D(uShadowMap, screenUv).r;
    vec3 color = texel.rgb - (1.0 - shadow) * uShadowIntensity;
	color = getFogColorWithRatio(uTime, vFogDepth, screenUv, uResolution, vWorldPosition, color, tNoiseTexture, uFogState.x, uFogState.y);

    gl_FragColor = vec4(color, min(blend, 1.0) * boxDist * uAlpha);
	gl_FragColor = linearToSrgb(gl_FragColor);
}
`;

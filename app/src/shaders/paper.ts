/**
 * 画纸（Paper）着色器 —— 体验的核心视觉。
 * 移植自提取的 09_vertexShader / 10_fragmentShader，
 * 保持原版 InstancedMesh、实例属性和 uniform 数组结构：GLB 网格只提供
 * 变换与射线代理，可见纸面统一使用 10×10 细分平面。
 *
 * - SDF 图集做纸张形状裁切
 * - 墨迹多点晕开显现（computeInkReveal）
 * - 流体模拟纹理驱动 base/over 两层视频绘画混合 + UV 扰动
 * - 双层 LUT（ink/dry）按墨迹强度逐像素调色
 * - 法线贴图 + 光照 + 背景渐变
 * - 三态雾
 */
import { GLSL_UTILS, GLSL_FOG, GLSL_INK_REVEAL } from "./chunks";

export const paperVertexShader = /* glsl */ `
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define REVEAL_POINTS_COUNT 4

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

varying vec2 vUv;
varying vec3 vNormal;
varying vec4 vMvPosition;
varying float vFogDepth;
varying vec3 vWorldPosition;
varying vec2 vSimulationUv;
varying vec2 vSdfPlaneSize;
varying vec2 vSdfScale;
varying vec2 vSdfOriginSize;
varying vec4 vSdfAtlasRemap;
varying vec4 vPaintAtlasRemap;
varying float vRevealProgress;
varying vec4 vRevealPoints[REVEAL_POINTS_COUNT];
varying vec2 vRevealPointsPos[REVEAL_POINTS_COUNT];
varying float vTransparency;
varying float vAlpha;

attribute float instance;
attribute vec4 simulationBox;
attribute vec4 simulationRemap;
attribute float transparency;

uniform float uAlpha[INSTANCE_COUNT];
uniform float uCurveCoef[INSTANCE_COUNT];
uniform float uRevealProgress[INSTANCE_COUNT];
uniform vec4 uPaintAtlasRemap[INSTANCE_COUNT];
uniform vec2 uSdfPlaneSize[INSTANCE_COUNT];
uniform vec2 uSdfScale[INSTANCE_COUNT];
uniform vec2 uSdfOriginSize[INSTANCE_COUNT];
uniform vec4 uSdfAtlasRemap[INSTANCE_COUNT];
uniform mat4 uRevealPoints[INSTANCE_COUNT];
uniform mat4 uRevealPointsPos[INSTANCE_COUNT];

vec3 computeInstanceNormal(vec3 transformedNormal, mat4 matrix) {
    mat3 m = mat3(matrix);
    transformedNormal /= vec3(dot(m[0], m[0]), dot(m[1], m[1]), dot(m[2], m[2]));
    return m * transformedNormal;
}

void main() {
    int index = int(instance);
    vUv = uv;
    vAlpha = uAlpha[index];
    vPaintAtlasRemap = uPaintAtlasRemap[index];
    vRevealProgress = uRevealProgress[index];
    vSdfPlaneSize = uSdfPlaneSize[index];
    vSdfScale = uSdfScale[index];
    vSdfOriginSize = uSdfOriginSize[index];
    vSdfAtlasRemap = uSdfAtlasRemap[index];
    vTransparency = transparency;
    vRevealPoints[0] = uRevealPoints[index][0];
    vRevealPoints[1] = uRevealPoints[index][1];
    vRevealPoints[2] = uRevealPoints[index][2];
    vRevealPoints[3] = uRevealPoints[index][3];
    vRevealPointsPos[0] = uRevealPointsPos[index][0].xy;
    vRevealPointsPos[1] = uRevealPointsPos[index][1].xy;
    vRevealPointsPos[2] = uRevealPointsPos[index][2].xy;
    vRevealPointsPos[3] = uRevealPointsPos[index][3].xy;
    vSimulationUv = remapAtlasUv(1. - uv, simulationBox, simulationRemap);

    vec3 _position = position;

    // 纸张弯曲：沿 uv.y 的余弦波让纸面微微鼓起
    vec2 _uv = uv;
    _uv.y = (_uv.y + .5) * .5;
    float _coef = uCurveCoef[index];
    _coef = cos(_coef * PI2 - PI_HALF);
    _position.x += cos(_uv.y * PI2) * .2 * _coef;

    vNormal = computeInstanceNormal(normal, instanceMatrix);

    vec4 worldPosition = modelMatrix * instanceMatrix * vec4(_position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vMvPosition = viewMatrix * worldPosition;
    vFogDepth = -vMvPosition.z;

    gl_Position = projectionMatrix * vMvPosition;
}
`;

export const paperFragmentShader = /* glsl */ `
precision highp float;
precision mediump sampler3D;

${GLSL_UTILS}
${GLSL_FOG}
${GLSL_INK_REVEAL}

uniform sampler2D uSdfAtlasTexture;

// SDF 距离读取（对应原站 getSdfFromAtlas）
const float BASE = 255.;
const float BASE_2 = BASE * BASE;
const float BASE_3 = BASE * BASE * BASE;

float getSdfFromAtlas(vec2 uv, vec2 scale, vec2 originSize, vec4 atlasRemap, sampler2D sdfTexture) {
    vec2 center = atlasRemap.xy + atlasRemap.zw / 2.;
    uv = 1. - uv;
    uv = remapAtlasUv(uv, atlasRemap);
    uv = ((uv - center) / scale) + center;
    vec4 value = texture2D(sdfTexture, uv) * BASE;
    float pixelDistance = ((value.x * BASE_2 + value.y * BASE + value.z) - (BASE_3 / 2.)) / 1000.;
    float compensatedDist = pixelDistance / (max(originSize.x, originSize.y) * 0.5);
    return compensatedDist;
}

// Global
varying vec2 vUv;
varying vec3 vNormal;
varying vec4 vMvPosition;
varying float vFogDepth;
varying vec3 vWorldPosition;

uniform float uTime;
uniform vec2 uResolution;
uniform sampler2D tNoiseTexture;
uniform vec3 uLighterColor;
uniform float uNormalMapStrength;
uniform float uNormalMapScale;

// SDF 与图集数据由顶点阶段按实例选择
varying vec2 vSdfPlaneSize;
varying vec2 vSdfScale;
varying vec2 vSdfOriginSize;
varying vec4 vSdfAtlasRemap;

// LUT 调色
uniform sampler3D uInkLut3d;
uniform sampler3D uDryLut3d;
uniform float uLutEnable;
uniform float uLutSize;

// Paint
varying vec4 vPaintAtlasRemap;
uniform sampler2D uPaintAtlasTexture;
uniform sampler2D uMaskAtlasTexture;
uniform vec2 uPaintIntensity;

// Light
uniform sampler2D uNormalMapTexture;

struct Lighting {
    vec2 groundSpecularScale;
    vec2 groundSpecularOffset;
    float groundSpecularStrength;
    vec2 specularCenter;
    vec2 specularScale;
    vec2 specularOffset;
    float specularStrength;
};
uniform Lighting uLighting;

struct Background {
    vec3 groundColor;
    vec3 skyColor;
    vec2 progressRemap;
};
uniform Background uBackground;

// Reveal
uniform sampler2D uNoiseTexture;
uniform sampler2D uNoiseFinalTexture;
varying float vRevealProgress;
varying vec4 vRevealPoints[REVEAL_POINTS_COUNT];
varying vec2 vRevealPointsPos[REVEAL_POINTS_COUNT];

// Simulation
uniform sampler2D uSimulationTexture;
varying vec2 vSimulationUv;

// Fog
uniform vec2 uFogState;

// 透明纸张（background_2 这类）在显现时对 alpha 也做墨迹擦除
varying float vTransparency;
varying float vAlpha;

float sineInOut(float t) {
  return -0.5 * (cos(3.141592653589793 * t) - 1.0);
}

float computeLighting(Lighting lightingConfig, float screenRatio, vec2 screenUv, vec3 worldPosFromCamera) {
    vec2 specularVector = (screenUv - (lightingConfig.specularCenter + lightingConfig.specularOffset)) / lightingConfig.specularScale;
    specularVector.x *= screenRatio;
    float specular = 1.0 - min(length(specularVector), 1.0);
    specular = sineInOut(specular);
    float lighting = lightingConfig.specularStrength * specular;

    vec2 groundSpecularVector = (worldPosFromCamera.xz - lightingConfig.groundSpecularOffset) / lightingConfig.groundSpecularScale;
    float groundSpecular = 1.0 - min(length(groundSpecularVector), 1.0);
    groundSpecular = sineInOut(groundSpecular);
    lighting += lightingConfig.groundSpecularStrength * groundSpecular;

    return lighting;
}

vec3 computeBackground(Background backgroundConfig, vec2 screenUv) {
    float baseProgress = cremap(screenUv.y, backgroundConfig.progressRemap.x, backgroundConfig.progressRemap.y, 0., 1.);
    float progress = 1. - abs((baseProgress - 0.5) * 2.);
    progress = sineInOut(progress);
    return mix(backgroundConfig.groundColor, backgroundConfig.skyColor, progress);
}

mat3 getTangentFrame(vec3 eye_pos, vec3 surf_norm, vec2 uv) {
	vec3 q0 = dFdx(eye_pos.xyz);
	vec3 q1 = dFdy(eye_pos.xyz);
	vec2 st0 = dFdx(uv.st);
	vec2 st1 = dFdy(uv.st);
	vec3 N = surf_norm;
	vec3 q1perp = cross(q1, N);
	vec3 q0perp = cross(N, q0);
	vec3 T = q1perp * st0.x + q0perp * st1.x;
	vec3 B = q1perp * st0.y + q0perp * st1.y;
	float det = max(dot(T, T), dot(B, B));
	float scale = (det == 0.0) ? 0.0 : inversesqrt(det);
	return mat3(T * scale, B * scale, N);
}

void main() {

	vec2 uv = vUv;
	vec3 normal = vNormal;

	float planeRatio = vSdfPlaneSize.y / vSdfPlaneSize.x;
	float dist = getSdfFromAtlas(uv, vSdfScale, vSdfOriginSize, vSdfAtlasRemap, uSdfAtlasTexture);

	//// 法线贴图
	vec2 normalMapUv = uNormalMapScale * uv;
	normalMapUv.x *= planeRatio;
	normalMapUv *= vSdfPlaneSize.x * .1;

	float baseNormalRiseProgress = dot(normal, vec3(0., 1., 0.));

	mat3 tbn = getTangentFrame(vMvPosition.xyz, normal, normalMapUv);
	vec3 mapN = texture2D(uNormalMapTexture, normalMapUv).xyz * 2.0 - 1.0;
	mapN.xy *= mix(uNormalMapStrength, 0., baseNormalRiseProgress * baseNormalRiseProgress);
	normal = normalize(tbn * mapN);

	//// 光照与背景
	float transformedNormalRiseProgress = dot(normal, vec3(0., 1., 0.));
	vec2 screenUv = gl_FragCoord.xy / uResolution;
	float ratio = uResolution.x / uResolution.y;
	vec3 background = computeBackground(uBackground, screenUv);
	float lighting = computeLighting(uLighting, ratio, screenUv, vWorldPosition - cameraPosition);
	vec3 color = mix(uLighterColor, background + lighting, transformedNormalRiseProgress);

	//// 流体模拟驱动的绘画混合
	vec4 data = texture2D(uSimulationTexture, vSimulationUv);
	vec2 dir = -data.rg;
	float vel = data.b;
	float intensity = data.a;
	float blend = smoothstep(0., 0.1, vel);
	float offset = smoothstep(0.05, 0.15, vel);

	vec2 paintOffsetUv = uv;
	float textureEdge = min(smoothstep(0., -0.05, dist), smoothstep(1., 0.95, vUv.y));
	paintOffsetUv += normalize(dir + vec2(0.0001)) * smoothstep(0.001, 0.05, vel) * 0.01 * textureEdge;
	paintOffsetUv.x = 1. - paintOffsetUv.x;
	paintOffsetUv = remapAtlasUv(paintOffsetUv, vPaintAtlasRemap);

	vec2 paintUv = uv;
	paintUv.x = 1. - paintUv.x;
	paintUv = remapAtlasUv(paintUv, vPaintAtlasRemap);

	vec4 texelOffset = texture2D(uPaintAtlasTexture, paintOffsetUv);
	vec4 texel = texture2D(uPaintAtlasTexture, paintUv);
	texel = mix(texel, texelOffset, offset);
	float mixValue = mix(uPaintIntensity.x, uPaintIntensity.y, intensity) * blend;
	vec3 baseColor = texel.rgb;

	float maxProgress = 0.55;
	if(vTransparency > 0.5)
		maxProgress = 0.4;

	vec4 inkReveal = computeInkReveal(color, baseColor, uv, vRevealProgress, planeRatio, uNoiseFinalTexture, vRevealPoints, vRevealPointsPos, maxProgress);
	vec3 inkColor = inkReveal.xyz;

	// LUT：dry（干笔）与 ink（水墨）两张查找表按墨迹强度插值
	float pixelWidth = 1.0 / uLutSize;
	float halfPixelWidth = 0.5 / uLutSize;
	color = mix(inkColor, baseColor, mixValue);
	vec3 uvw = vec3(halfPixelWidth) + color * (1.0 - pixelWidth);
	vec3 lutColor = mix(texture(uDryLut3d, uvw).rgb, texture(uInkLut3d, uvw).rgb, mixValue);
	color = mix(color, lutColor, uLutEnable);

	// 形状遮罩（图集 alpha 通道）
	float distAlpha = texture2D(uMaskAtlasTexture, paintUv).r;

	// 抗锯齿边缘
	float uvY = 1. - vUv.y;
	float uvAlpha = clamp(uvY / fwidth(uvY) + 0.5, 0.0, 1.0);

	color = getFogColorWithRatio(uTime, vFogDepth, screenUv, uResolution, vWorldPosition, color, tNoiseTexture, uFogState.x, uFogState.y);

	float alpha = distAlpha * uvAlpha * vAlpha;
	if(vTransparency > 0.5)
		alpha *= inkReveal.a;

	gl_FragColor = vec4(color, alpha);
	gl_FragColor = linearToSrgb(gl_FragColor);

	if(gl_FragColor.a < 0.01)
		discard;
}
`;

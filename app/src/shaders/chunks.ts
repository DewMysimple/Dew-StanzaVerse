/**
 * 公共 GLSL 代码块。
 * fog / remap / 图集 UV 重映射等函数 1:1 移植自原站提取的着色器
 * （study/extracted-shaders/10_fragmentShader.glsl 中的雾函数与参数表）。
 */

/** 基础数学工具 */
export const GLSL_UTILS = /* glsl */ `
float remap(float value, float start1, float stop1, float start2, float stop2) {
  return start2 + (stop2 - start2) * ((value - start1) / (stop1 - start1));
}

float cremap(float value, float start1, float stop1, float start2, float stop2) {
  float r = start2 + (stop2 - start2) * ((value - start1) / (stop1 - start1));
  return clamp(r, min(start2, stop2), max(start2, stop2));
}

vec2 remapAtlasUv(vec2 uv, vec4 atlasRemap) {
    vec2 _uv = uv;
    _uv.x = remap(_uv.x, 0., 1., atlasRemap.x, atlasRemap.x + atlasRemap.z);
    _uv.y = remap(_uv.y, 0., 1., atlasRemap.y, atlasRemap.y + atlasRemap.w);
    return _uv;
}

vec2 remapAtlasUv(vec2 uv, vec4 boxSize, vec4 atlasRemap) {
    vec2 _uv = uv;
    _uv.x = remap(_uv.x, 0., 1., boxSize.x, boxSize.z);
    _uv.y = remap(_uv.y, 1., 0., boxSize.y, boxSize.w);
    _uv.x = remap(_uv.x, 0., 1., atlasRemap.x, atlasRemap.x + atlasRemap.z);
    _uv.y = remap(_uv.y, 0., 1., atlasRemap.y, atlasRemap.y + atlasRemap.w);
    return _uv;
}

float quarticInOut(float t) {
  return t < 0.5
    ? +8.0 * pow(t, 4.0)
    : -8.0 * pow(t - 1.0, 4.0) + 1.0;
}

float sdCircle(vec2 p, float r) {
  return length(p) - r;
}

/* 线性空间 → sRGB（原站依赖 three 内置的 LinearTosRGB，这里自带实现） */
vec4 linearToSrgb(vec4 c) {
  vec3 lo = c.rgb * 12.92;
  vec3 hi = 1.055 * pow(c.rgb, vec3(1.0 / 2.4)) - 0.055;
  vec3 srgb = mix(lo, hi, step(0.0031308, c.rgb));
  return vec4(srgb, c.a);
}
`;

/**
 * 雾系统：base / occulted / opaque 三态参数与混合。
 * uFogState = (opaqueRatio, occultedRatio)，由 ExperienceManager 的 fogState 驱动。
 */
export const GLSL_FOG = /* glsl */ `
vec3 getFogColor(float time, float depth, vec2 uv, vec2 resolution, vec3 worldPosition, vec3 color, sampler2D noiseTexture, vec3 fogColor, float noiseSpeed, vec2 noiseScale, float noiseStrength, vec2 fogAmountRangeY, vec2 fogDensityRangeY, vec2 fogAmountRangeZ, vec2 fogDensityRangeZ, vec3 mainSdf, vec2 sdfRemap) {
  worldPosition.z -= time * noiseSpeed * .1;

  vec2 noiseUv = worldPosition.yz;
  noiseUv *= 0.05 * noiseScale;

  float noise = texture2D(noiseTexture, noiseUv).r;
  noise = quarticInOut(noise);
  if(worldPosition.y < 0.01)
    noise = 1.;
  if(worldPosition.x > 900.)
    noise = 1.;

  float screenRatio = resolution.x / resolution.y;
  vec2 adjustedUvs = ((uv - 0.5) / vec2(1., screenRatio)) + 0.5;
  adjustedUvs.x += step(screenRatio, 1.) * -.5; // 竖屏修正
  float sdf = sdCircle(adjustedUvs - mainSdf.xy, mainSdf.z);
  sdf = smoothstep(sdfRemap.x, sdfRemap.y, sdf);

  float noiseSdf = sdf * remap(noise, 0., 1., 1. - noiseStrength, 1.);

  float fogAmountZ = mix(fogAmountRangeZ.x, fogAmountRangeZ.y, noiseSdf);
  float fogDensityZ = mix(fogDensityRangeZ.x, fogDensityRangeZ.y, noiseSdf);
  float fogFactorZ = 1.0 - exp(-fogDensityZ * fogDensityZ * depth * depth);

  float fogPosY = worldPosition.y;
  float fogDensityY = mix(fogDensityRangeY.y, fogDensityRangeY.x, noiseSdf);
  float fogAmountY = mix(fogAmountRangeY.x, fogAmountRangeY.y, noiseSdf);
  float fogFactorY = exp(-fogDensityY * fogDensityY * fogPosY * fogPosY);

  float fogAmount = clamp(fogFactorZ * fogAmountZ, 0.0, 1.0);
  fogAmount = max(fogAmount, clamp(fogFactorY * fogAmountY, 0.0, 1.0));
  fogAmount = clamp(fogAmount + sdf * 0.2, 0., 1.);

  return mix(color, fogColor, fogAmount);
}

struct FogSettings {
    float noiseSpeed;
    vec2 noiseScale;
    float noiseStrength;
    vec2 fogAmountRangeY;
    vec2 fogDensityRangeY;
    vec2 fogAmountRangeZ;
    vec2 fogDensityRangeZ;
    vec3 mainSdf;
    vec2 sdfRemap;
    vec3 fogColor;
};

FogSettings mixFogSettings(FogSettings from, FogSettings to, float ratio) {
    FogSettings settings;
    settings.noiseSpeed = mix(from.noiseSpeed, to.noiseSpeed, ratio);
    settings.noiseScale = mix(from.noiseScale, to.noiseScale, ratio);
    settings.noiseStrength = mix(from.noiseStrength, to.noiseStrength, ratio);
    settings.fogAmountRangeY = mix(from.fogAmountRangeY, to.fogAmountRangeY, ratio);
    settings.fogDensityRangeY = mix(from.fogDensityRangeY, to.fogDensityRangeY, ratio);
    settings.fogAmountRangeZ = mix(from.fogAmountRangeZ, to.fogAmountRangeZ, ratio);
    settings.fogDensityRangeZ = mix(from.fogDensityRangeZ, to.fogDensityRangeZ, ratio);
    settings.mainSdf = mix(from.mainSdf, to.mainSdf, ratio);
    settings.sdfRemap = mix(from.sdfRemap, to.sdfRemap, ratio);
    settings.fogColor = mix(from.fogColor, to.fogColor, ratio);
    return settings;
}

FogSettings getBaseSettings() {
    FogSettings baseSettings;
    baseSettings.noiseSpeed = 3.;
    baseSettings.noiseScale = vec2(0.6, 0.2);
    baseSettings.noiseStrength = 0.88;
    baseSettings.fogAmountRangeY = vec2(0.1, 1.39);
    baseSettings.fogDensityRangeY = vec2(0.01, 0.81);
    baseSettings.fogAmountRangeZ = vec2(0.01, 0.99);
    baseSettings.fogDensityRangeZ = vec2(20.0, 277.42);
    baseSettings.mainSdf = vec3(0.79, 0.63, 0.85);
    baseSettings.sdfRemap = vec2(-0.48, -0.06);
    baseSettings.fogColor = vec3(0.796, 0.796, 0.761);
    return baseSettings;
}

FogSettings getOccultedSettings(FogSettings baseSettings) {
    FogSettings occultedSettings;
    occultedSettings.noiseSpeed = baseSettings.noiseSpeed;
    occultedSettings.noiseScale = baseSettings.noiseScale;
    occultedSettings.noiseStrength = baseSettings.noiseStrength;
    occultedSettings.fogAmountRangeY = vec2(0.65, 1.16);
    occultedSettings.fogDensityRangeY = vec2(0.65, 0.81);
    occultedSettings.fogAmountRangeZ = baseSettings.fogAmountRangeZ;
    occultedSettings.fogDensityRangeZ = vec2(20.0, 161.29);
    occultedSettings.mainSdf = vec3(0.64, 0.62, 0.84);
    occultedSettings.sdfRemap = vec2(-0.84, -0.45);
    occultedSettings.fogColor = vec3(0.796, 0.796, 0.761);
    return occultedSettings;
}

FogSettings getOpaqueSettings(FogSettings baseSettings) {
    FogSettings opaqueSettings;
    opaqueSettings.noiseSpeed = baseSettings.noiseSpeed;
    opaqueSettings.noiseScale = baseSettings.noiseScale;
    opaqueSettings.noiseStrength = baseSettings.noiseStrength;
    opaqueSettings.fogAmountRangeY = vec2(0.65, 1.16);
    opaqueSettings.fogDensityRangeY = vec2(0.65, 0.81);
    opaqueSettings.fogAmountRangeZ = vec2(1, 1.3);
    opaqueSettings.fogDensityRangeZ = vec2(100, 300);
    opaqueSettings.mainSdf = vec3(0.5, 0.5, 0);
    opaqueSettings.sdfRemap = baseSettings.sdfRemap;
    opaqueSettings.fogColor = vec3(0.714, 0.714, 0.714);
    return opaqueSettings;
}

vec3 getFogColorWithRatio(float time, float depth, vec2 uv, vec2 resolution, vec3 worldPosition, vec3 color, sampler2D noiseTexture, float opaqueRatio, float occultedRatio) {
    FogSettings baseSettings = getBaseSettings();
    FogSettings opaqueSettings = getOpaqueSettings(baseSettings);
    FogSettings occultedSettings = getOccultedSettings(baseSettings);

    FogSettings settings = baseSettings;
    settings = mixFogSettings(settings, occultedSettings, occultedRatio);
    settings = mixFogSettings(settings, opaqueSettings, opaqueRatio);

    return getFogColor(time, depth, uv, resolution, worldPosition, color, noiseTexture, settings.fogColor, settings.noiseSpeed, settings.noiseScale, settings.noiseStrength, settings.fogAmountRangeY, settings.fogDensityRangeY, settings.fogAmountRangeZ, settings.fogDensityRangeZ, settings.mainSdf, settings.sdfRemap);
}
`;

/** 墨迹晕开显现（纸张与全幅绘画共用，移植自 computeInkReveal） */
export const GLSL_INK_REVEAL = /* glsl */ `
#ifndef INK_REVEAL_POINTS
#define INK_REVEAL_POINTS
#define REVEAL_POINTS_COUNT 4

vec2 rotateUV(vec2 uv, float rotation)
{
    float mid = 0.5;
    return vec2(
        cos(rotation) * (uv.x - mid) + sin(rotation) * (uv.y - mid) + mid,
        cos(rotation) * (uv.y - mid) - sin(rotation) * (uv.x - mid) + mid
    );
}

float easeQuartOut(float t) {
	float invT = t - 1.0;
	return invT * invT * invT * (1.0 - t) + 1.0;
}

float inkCircle(vec2 diff, float radius) {
	return length(diff) - radius;
}

float getInkMask(float noise, vec2 pos, vec2 startPoint, float progress, float power, float sharpRatioMin, float sharpRatioMax) {
	float sdf = -inkCircle(pos + startPoint, 1.) + progress;
	float baseSdf = sdf;
	float intensity = pow(sdf, power) * noise;
	if(baseSdf < 0.)
		intensity = 0.;
	intensity = cremap(intensity, sharpRatioMin, sharpRatioMax, 0.0, 1.0);
	return intensity;
}

float getInkIntensity(vec2 pos, vec2 startPoint, float progressMask, float progressIntensity) {
	float sdf = -inkCircle(pos + startPoint, 0.) + progressMask;
	float dist = max(0., 1. - sdf);
	dist = cremap(dist, .6, 1., 0., 1.) * (1. - progressIntensity);
	dist = (.8 + 1.2 * pow(dist, 4.));
	return dist;
}

vec4 computeInkReveal(vec3 bgColor, vec3 paintColor, vec2 uv, float progress, float planeRatio, sampler2D noiseTexture, vec4 points[REVEAL_POINTS_COUNT], vec2 pointsPos[REVEAL_POINTS_COUNT], float progressMax) {
	vec2 pos_0 = uv;
	pos_0.x *= planeRatio;
	pos_0.x -= planeRatio * .5 - .5;

	float _progress = progress;
	if(planeRatio >= 1.)
		_progress *= planeRatio * 1.;

	vec4 noiseColor = texture2D(noiseTexture, pos_0);
	float noise1 = noiseColor.x;
	float noise2 = noiseColor.y;
	float noise3 = noiseColor.z;

	float power = 5.0;
	float sharpRatioMin = .90;
	float sharpRatioMax = 1.0;

	vec3 inkColor = bgColor;
	float globalIntensity = 0.;

	for(int i = 0; i < REVEAL_POINTS_COUNT; ++i) {
		vec4 point = points[i];
		vec2 startPoint = -pointsPos[i];
		startPoint.x *= planeRatio;
		startPoint.x += planeRatio * .5 - .5;

		float scale = point.x;
		float startTime = point.y;
		float stepDuration = point.z;

		float _progressMask = cremap(progress, startTime, startTime + stepDuration, 0., progressMax);
		_progressMask = easeQuartOut(_progressMask / progressMax) * progressMax;
		_progressMask *= scale;

		float impairCoef = mod(float(i), 2.);
		float _noise1 = mix(noise1, noise2, impairCoef);
		float _noise2 = mix(noise2, noise3, impairCoef);
		float _progress2Coef = mix(.85, .92, impairCoef);

		float intensity1 = getInkMask(_noise1, pos_0, startPoint, _progressMask, power, sharpRatioMin, sharpRatioMax);
		float intensity2 = getInkMask(_noise2, pos_0, startPoint, _progressMask * _progress2Coef, power, sharpRatioMin, sharpRatioMax);

		float _progressIntensity = cremap(progress, startTime + stepDuration * .5, startTime + stepDuration, 0., 1.);
		intensity1 *= getInkIntensity(pos_0, startPoint, _progressMask, _progressIntensity);
		intensity2 *= getInkIntensity(pos_0, startPoint, _progressMask, _progressIntensity);

		float alpha = .5 + .5 * float(i) / float(REVEAL_POINTS_COUNT);
		inkColor = mix(inkColor, paintColor, intensity1 * alpha);
		inkColor = mix(inkColor, paintColor, intensity2 * alpha);

		float _intensity = (intensity1 + intensity2) * alpha;
		globalIntensity = (1.0 - step(_intensity, globalIntensity)) * _intensity + step(_intensity, globalIntensity) * globalIntensity;
	}

	return vec4(inkColor.xyz, globalIntensity);
}
#endif
`;

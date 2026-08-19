precision highp float;
precision mediump sampler3D;
#define GLSLIFY 1

struct SDFData {
    vec2 pixelSize;
    vec2 planeSize;
    vec2 scale;
    vec2 originSize;
    vec4 atlasRemap;
};

float cremap(float value, float start1, float stop1, float start2, float stop2) {
  float r = start2 + (stop2 - start2) * ((value - start1) / (stop1 - start1));
  return clamp(r, min(start2, stop2), max(start2, stop2));
}

float remap(float value, float start1, float stop1, float start2, float stop2) {
  return start2 + (stop2 - start2) * ((value - start1) / (stop1 - start1));
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

const float BASE = 255.;
const float BASE_2_3903765079 = BASE * BASE;
const float BASE_3_3903765079 = BASE * BASE * BASE;

float getSdfFromAtlas(vec2 uv, SDFData sdfData, sampler2D sdfTexture) {
    vec2 center = sdfData.atlasRemap.xy + sdfData.atlasRemap.zw / 2.;
    uv = 1. - uv;
    uv = remapAtlasUv(uv, sdfData.atlasRemap);
    uv = ((uv - center) / sdfData.scale) + center;
    float planeRatio = sdfData.planeSize.x / sdfData.planeSize.y;
    vec4 value = texture2D(sdfTexture, uv) * BASE;
    float pixelDistance = ((value.x * BASE_2_3903765079 + value.y * BASE + value.z) - (BASE_3_3903765079 / 2.)) / 1000.;
    float compensatedDist = pixelDistance / (max(sdfData.originSize.x, sdfData.originSize.y) * 0.5);
    return compensatedDist;
}

vec2 rotateUV(vec2 uv, float rotation)
{
    float mid = 0.5;
    return vec2(
        cos(rotation) * (uv.x - mid) + sin(rotation) * (uv.y - mid) + mid,
        cos(rotation) * (uv.y - mid) - sin(rotation) * (uv.x - mid) + mid
    );
}

vec2 rotateUV(vec2 uv, float rotation, vec2 mid)
{
    return vec2(
      cos(rotation) * (uv.x - mid.x) + sin(rotation) * (uv.y - mid.y) + mid.x,
      cos(rotation) * (uv.y - mid.y) - sin(rotation) * (uv.x - mid.x) + mid.y
    );
}

vec2 rotateUV(vec2 uv, float rotation, float mid)
{
    return vec2(
      cos(rotation) * (uv.x - mid) + sin(rotation) * (uv.y - mid) + mid,
      cos(rotation) * (uv.y - mid) - sin(rotation) * (uv.x - mid) + mid
    );
}

// #pragma glslify: easeQuartOut = require(glsl-easings/quartic-out)
// Fix to avoid negative x in pow(x, y) which doesnt work on mac hardware
float easeQuartOut(float t) {
	float invT = t - 1.0;
	return invT * invT * invT * (1.0 - t) + 1.0;
}

#define PI 3.141592653589793
#define REVEAL_POINTS_COUNT 4

float if_gt_870892966(float value1, float value2, float result1, float result2) {
	float coef = (1.0 - step(value1, value2));
	return mix(result2, result1, coef);
}

float circle(vec2 diff, float radius) {
	return length(diff) - radius;
}

float getInkMask(float noise, vec2 pos, vec2 startPoint, float progress, float power, float sharpRatioMin, float sharpRatioMax) {
	float sdf = -circle(pos + startPoint, 1.) + progress;
	float baseSdf = sdf;
	float intensity = pow(sdf, power) * noise;
	if(baseSdf < 0.)
		intensity = 0.;
	intensity = cremap(intensity, sharpRatioMin, sharpRatioMax, 0.0, 1.0);
	return intensity;
}

float getInkIntensity(vec2 pos, vec2 startPoint, float progressMask, float progressIntensity) {
	float sdf = -circle(pos + startPoint, 0.) + progressMask;
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
	// _progress = .3; /// debug

	if(planeRatio >= 1.)
		_progress *= planeRatio * 1.;
	// _progress *= 1.4;

	vec2 uv1 = pos_0 * 10.;
	vec2 uv2 = rotateUV(pos_0, PI * .3) * 12.;
	vec2 uv3 = rotateUV(pos_0, PI * .6) * 14.;

	/** noise texture **/
	vec4 noiseColor = texture2D(noiseTexture, pos_0);
	float noise1 = noiseColor.x;
	float noise2 = noiseColor.y;
	float noise3 = noiseColor.z;
	/**/

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

		globalIntensity = if_gt_870892966(_intensity, globalIntensity, _intensity, globalIntensity);
	}

	// inkColor = vec3(noise1, noise2, noise3);

	return vec4(inkColor.xyz, globalIntensity);
}

float quarticInOut(float t) {
  return t < 0.5
    ? +8.0 * pow(t, 4.0)
    : -8.0 * pow(t - 1.0, 4.0) + 1.0;
}

float sdCircle(vec2 p, float r) {
  return length(p) - r;
}

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
  adjustedUvs.x += step(screenRatio, 1.) * -.5; // on portrait only
  float sdf = sdCircle(adjustedUvs - mainSdf.xy, mainSdf.z);
  sdf = smoothstep(sdfRemap.x, sdfRemap.y, sdf);

  float noiseSdf = sdf * remap(noise, 0., 1., 1. - noiseStrength, 1.);

  float fogAmountZ = mix(fogAmountRangeZ.x, fogAmountRangeZ.y, noiseSdf);
  // float fogDensityZ = mix(fogDensityRangeZ.x, fogDensityRangeZ.y, noiseSdf) / 1000.;
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

// Global
varying vec2 vUv;
varying float vTransparency;
varying float vAlpha;
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

// Blending
uniform float uDisplacementStrength;
uniform sampler3D uInkLut3d;
uniform sampler3D uDryLut3d;
uniform float uLutEnable;
uniform float uLutSize;

// Paint
varying vec4 vPaintAtlasRemap;
uniform sampler2D uPaintAtlasTexture;
uniform sampler2D uMaskAtlasTexture;
uniform vec2 uPaintIntensity;

// Sdf
varying vec2 vSdfPlaneSize;
varying vec2 vSdfScale;
varying vec2 vSdfOriginSize;
varying vec4 vSdfAtlasRemap;
uniform sampler2D uSdfAtlasTexture;
varying float vSdfAlpha;

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

#ifndef PI
#define PI 3.141592653589793
#endif

float sineInOut(float t) {
  return -0.5 * (cos(PI * t) - 1.0);
}

// WITH ground specular
float computeLighting(Lighting lightingConfig, float screenRatio, vec2 screenUv, vec3 worldPosFromCamera) {
    vec2 specularVector = (screenUv - (lightingConfig.specularCenter + lightingConfig.specularOffset)) / lightingConfig.specularScale;
    specularVector.x *= screenRatio;
    float specular = 1.0-min(length(specularVector), 1.0);
    specular = sineInOut(specular);
    float lighting = lightingConfig.specularStrength * specular;

    vec2 groundSpecularVector = (worldPosFromCamera.xz - lightingConfig.groundSpecularOffset) / lightingConfig.groundSpecularScale;
    float groundSpecular = 1.0-min(length(groundSpecularVector), 1.0);
    groundSpecular = sineInOut(groundSpecular);
    lighting += lightingConfig.groundSpecularStrength * groundSpecular;

    return lighting;
}

// WITHOUT ground specular
float computeLighting(Lighting lightingConfig, float screenRatio, vec2 screenUv) {
    vec2 specularVector = (screenUv - (lightingConfig.specularCenter + lightingConfig.specularOffset)) / lightingConfig.specularScale;
    specularVector.x *= screenRatio;
    float specular = 1.0-min(length(specularVector), 1.0);
    specular = sineInOut(specular);
    float lighting = lightingConfig.specularStrength * specular;

    return lighting;
}

vec3 computeBackground(Background backgroundConfig, vec2 screenUv) {
    float baseProgress = cremap(screenUv.y, backgroundConfig.progressRemap.x, backgroundConfig.progressRemap.y, 0., 1.);
    float progress = 1. - abs((baseProgress - 0.5) * 2.);
    progress = sineInOut(progress);

    return mix(backgroundConfig.groundColor, backgroundConfig.skyColor, progress);
}

// Reveal
#define REVEAL_POINTS_COUNT 4
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

vec3 packNormalToRGB(const in vec3 normal) {
	return normalize(normal) * 0.5 + 0.5;
}

float getColorIntensity(vec3 color) {
	return color.r * .3 + color.g * .59 + color.b * .11;
}

vec4 getSdfFromAtlas2(vec2 uv, SDFData sdfData, sampler2D sdfTexture) {
	vec2 center = sdfData.atlasRemap.xy + sdfData.atlasRemap.zw / 2.;
	uv = 1. - uv;
	uv = remapAtlasUv(uv, sdfData.atlasRemap);
	uv = ((uv - center) / sdfData.scale) + center;
	float planeRatio = sdfData.planeSize.x / sdfData.planeSize.y;
	vec4 value = texture2D(sdfTexture, uv);
	return value;
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

	SDFData sdfData;
	sdfData.planeSize = vSdfPlaneSize;
	sdfData.scale = vSdfScale;
	sdfData.originSize = vSdfOriginSize;
	sdfData.atlasRemap = vSdfAtlasRemap;

	vec2 uv = vUv;
	vec3 normal = vNormal;

	// TODO: fix the border right uv issue properly
	// float patchOffsetX = .001;
	// uv.x = uv.x * (1. - patchOffsetX) + patchOffsetX;
	//

	//// global

	float planeRatio = sdfData.planeSize.y / sdfData.planeSize.x;
	float dist = getSdfFromAtlas(uv, sdfData, uSdfAtlasTexture);

	//// normal map

	vec2 normalMapUv = uNormalMapScale * uv;
	normalMapUv.x *= planeRatio;
	normalMapUv *= sdfData.planeSize.x * .1;

	float baseNormalRiseProgress = dot(normal, vec3(0., 1., 0.));

	mat3 tbn = getTangentFrame(vMvPosition.xyz, normal, normalMapUv);

	vec3 mapN = texture2D(uNormalMapTexture, normalMapUv).xyz * 2.0 - 1.0;
	mapN.xy *= mix(uNormalMapStrength, 0., baseNormalRiseProgress * baseNormalRiseProgress);
	normal = normalize(tbn * mapN);

	//// ground lighting

	float transformedNormalRiseProgress = dot(normal, vec3(0., 1., 0.));

	vec2 screenUv = gl_FragCoord.xy / uResolution;
	float ratio = uResolution.x / uResolution.y;
	vec3 background = computeBackground(uBackground, screenUv);
	float lighting = computeLighting(uLighting, ratio, screenUv, vWorldPosition - cameraPosition);

	vec3 color = mix(uLighterColor, background + lighting, transformedNormalRiseProgress);

	#ifdef RENDER_PAINT

	//// simulation

	vec2 simulationUv = vSimulationUv;
	vec4 data = texture2D(uSimulationTexture, simulationUv);
	vec2 dir = -data.rg;
	float vel = data.b;
	float intensity = data.a;
	float blend = smoothstep(0., 0.1, vel);
	float offset = smoothstep(0.05, 0.15, vel);

	vec2 paintOffsetUv = uv;

	vec2 _vel = -dir;
    float velLength = length(_vel);
    _vel = _vel * .5 + .5;

	// paintOffsetUv += normalize(_vel) * 0.01;
	// paintOffsetUv -= 0.01 * .5;

	float textureEdge = min(smoothstep(0., -0.05, dist), smoothstep(1., 0.95, vUv.y));
	paintOffsetUv += normalize(dir) * smoothstep(0.001, 0.05, vel) * 0.01 * textureEdge;

	paintOffsetUv.x = 1. - paintOffsetUv.x;
	paintOffsetUv = remapAtlasUv(paintOffsetUv, vPaintAtlasRemap);

	vec2 paintUv = uv;
	paintUv.x = 1. - paintUv.x;
	paintUv = remapAtlasUv(paintUv, vPaintAtlasRemap);

	vec4 texelOffset = texture2D(uPaintAtlasTexture, paintOffsetUv);
	vec4 texel = texture2D(uPaintAtlasTexture, paintUv);
	texel = mix(texel, texelOffset, offset);
	float mixValue = mix(uPaintIntensity.x, uPaintIntensity.y, intensity) * blend;
	// float mixValue = max(vel, min(1., velLength)) * .5 + min(1., velLength) * .5;
	vec3 baseColor = texel.rgb;

	float maxProgress = 0.55;
	if(vTransparency > 0.5)
		maxProgress = 0.4;
	// REVEAL
	vec4 inkReveal = computeInkReveal(color, baseColor, uv, vRevealProgress, planeRatio, uNoiseFinalTexture, vRevealPoints, vRevealPointsPos, maxProgress);
	// vec4 inkReveal = vec4(baseColor, 1.);
	vec3 inkColor = inkReveal.xyz;

	// BLENDING
	float pixelWidth = 1.0 / uLutSize;
	float halfPixelWidth = 0.5 / uLutSize;
	color = mix(inkColor, baseColor, mixValue);
	vec3 uvw = vec3(halfPixelWidth) + color * (1.0 - pixelWidth);
	vec3 lutColor = mix(texture(uDryLut3d, uvw).rgb, texture(uInkLut3d, uvw).rgb, mixValue);
	color = mix(color, lutColor, uLutEnable);
	// BLENDING - END

	#endif

	// SDF MASK
	// float edgeAlpha = mix(1. - texel.a, dist, vSdfAlpha);
	// float distAlpha = 1. - clamp(edgeAlpha / fwidth(edgeAlpha) + 0.5, 0.0, 1.0);
	// SDF MASK - END

	// IMAGE MASK
	float distAlpha = texture2D(uMaskAtlasTexture, paintUv).r;
	// IMAGE MASK - END

	// ANTIALIASING
	float uvY = 1. - vUv.y;
	float uvAlpha = clamp(uvY / fwidth(uvY) + 0.5, 0.0, 1.0);
	// ANTIALIASING - END

	color = getFogColorWithRatio(uTime, vFogDepth, screenUv, uResolution, vWorldPosition, color, tNoiseTexture, uFogState.x, uFogState.y);

	float alpha = distAlpha * uvAlpha * vAlpha;
	if(vTransparency > 0.5)
		alpha *= inkReveal.a;

	//// FINAL COLOR
	gl_FragColor = vec4(color, alpha);
	gl_FragColor = LinearTosRGB(gl_FragColor);

	//// DEBUG
	// gl_FragColor = getSdfFromAtlas2(vUv, sdfData, uSdfAtlasTexture);
	// gl_FragColor = vec4(vec3(1. - distAlpha), 1.);
	// gl_FragColor = vec4(texel.rgb, 1.);
	// gl_FragColor = vec4(vec3(distAlpha), 1.);

	// gl_FragColor = vec4(vec3(uvAlpha), 1.);
	// gl_FragColor = vec4(inkColor, step(dist, 0.) * vAlpha);
	// gl_FragColor = vec4(vec3(data.a * blend), step(dist, 0.));
	// gl_FragColor = vec4(paperColor, step(dist, 0.));
    // gl_FragColor = vec4(packNormalToRGB(normal), step(dist, 0.));
    // gl_FragColor = vec4(normalColor.rgb, step(dist, 0.));
	// gl_FragColor = vec4(matcapColor, step(dist, 0.));
	// gl_FragColor.rgb = vec3(data.a);
	// gl_FragColor.rgb = vec3(abs(dot(normal, vec3(0., 1., 0.)) - dot(vNormal, vec3(0., 1., 0.))));
	// gl_FragColor.rgb = vec3(downProgress);

	/** debug simulation **/

	// float opacity = max(data.z, min(1., velLength)) * 1. + min(1., velLength) * 1.;
	// gl_FragColor = vec4(mix(vec3(1.), baseColor, opacity), 1.);

	#ifdef DEBUG_SIMULATION

    color = vec3(_vel.x, _vel.y, 1.0);
    color = mix(vec3(1.0), color, velLength);

    gl_FragColor = vec4(color,  1.0);

	#endif

	/**/

	if(gl_FragColor.a < 0.01)
		discard;
}
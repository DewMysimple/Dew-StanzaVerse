#define GLSLIFY 1

struct SDFData {
    vec2 pixelSize;
    vec2 planeSize;
    vec2 scale;
    vec2 originSize;
    vec4 atlasRemap;
};

float remap(float value, float start1, float stop1, float start2, float stop2) {
  return start2 + (stop2 - start2) * ((value - start1) / (stop1 - start1));
}

float rand(vec2 co){
	return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
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
const float BASE_2_1460171947 = BASE * BASE;
const float BASE_3_1460171947 = BASE * BASE * BASE;

float getSdfFromAtlas(vec2 uv, SDFData sdfData, sampler2D sdfTexture) {
    vec2 center = sdfData.atlasRemap.xy + sdfData.atlasRemap.zw / 2.;
    uv = 1. - uv;
    uv = remapAtlasUv(uv, sdfData.atlasRemap);
    uv = ((uv - center) / sdfData.scale) + center;
    float planeRatio = sdfData.planeSize.x / sdfData.planeSize.y;
    vec4 value = texture2D(sdfTexture, uv) * BASE;
    float pixelDistance = ((value.x * BASE_2_1460171947 + value.y * BASE + value.z) - (BASE_3_1460171947 / 2.)) / 1000.;
    float compensatedDist = pixelDistance / (max(sdfData.originSize.x, sdfData.originSize.y) * 0.5);
    return compensatedDist;
}

float exponentialOut(float t) {
  return t == 1.0 ? t : 1.0 - pow(2.0, -10.0 * t);
}

float cremap(float value, float start1, float stop1, float start2, float stop2) {
  float r = start2 + (stop2 - start2) * ((value - start1) / (stop1 - start1));
  return clamp(r, min(start2, stop2), max(start2, stop2));
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
uniform float uTime;
uniform sampler2D tNoiseTexture;
varying vec3 vWorldPosition;
varying float vFogDepth;

// Sdf
varying vec2 vSdfPixelSize;
varying vec2 vSdfPlaneSize;
varying vec2 vSdfScale;
varying vec2 vSdfOriginSize;
varying vec4 vSdfAtlasRemap;
uniform sampler2D uSdfTexture;

// Params 
varying float vAlpha;
uniform float uDepth;
uniform float uShadowSize;
uniform float uCutoutShadowIntensity;
uniform float uPaperShadowIntensity;
uniform float uNoise;
uniform vec3 uLightColor;
uniform vec3 uShadowColor;

// Coordinates
varying vec2 vUv;
varying vec3 vTangentViewPos;
varying vec3 vTangentFragPos;

uniform vec2 uResolution;
uniform sampler2D uShadowMap;
uniform vec2 uFogState;

void main() {
	SDFData sdfData;
	sdfData.pixelSize = vSdfPixelSize;
	sdfData.planeSize = vSdfPlaneSize;
	sdfData.scale = vSdfScale;
	sdfData.originSize = vSdfOriginSize;
	sdfData.atlasRemap = vSdfAtlasRemap;

	vec2 screenUv = gl_FragCoord.xy / uResolution;

	// TODO : Same lighting as ground
	vec3 viewDir = normalize(vTangentViewPos - vTangentFragPos);

	float planeRatio = vSdfPlaneSize.x / vSdfPlaneSize.y;

	vec2 offset = viewDir.xy / viewDir.z * uDepth * vec2(-1, 1);
	offset.x *= planeRatio;
	vec2 layerUv = vUv + offset / vSdfPlaneSize.x;
	vec2 random = vec2(rand(layerUv), rand(layerUv + 1.));

	float shadowDist = getSdfFromAtlas(layerUv + (random - 0.5) * uNoise, sdfData, uSdfTexture);
	float compensatedDist = shadowDist * max(vSdfPlaneSize.x, vSdfPlaneSize.y);

	float shadowFromCutout = smoothstep(uShadowSize, -uShadowSize, compensatedDist);

	vec2 shadowUvs = gl_FragCoord.xy / uResolution;
	float shadowFromMap = texture2D(uShadowMap, shadowUvs).r;
	float shadow = min(mix(1., shadowFromCutout, uCutoutShadowIntensity), mix(1., shadowFromMap, uPaperShadowIntensity));

	float dist = getSdfFromAtlas(vUv, sdfData, uSdfTexture);
	float distAlpha = clamp(dist / fwidth(dist) + 0.5, 0.0, 1.0);

	vec3 color = uLightColor - (1. - shadow);

	color = getFogColorWithRatio(uTime, vFogDepth, screenUv, uResolution, vWorldPosition, color, tNoiseTexture, uFogState.x, uFogState.y);

	float alpha = (1. - distAlpha) * vAlpha;

	gl_FragColor = vec4(color, alpha);
	gl_FragColor = LinearTosRGB(gl_FragColor);
}
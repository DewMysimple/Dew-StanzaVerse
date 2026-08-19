#define GLSLIFY 1

float remap(float value, float start1, float stop1, float start2, float stop2) {
  return start2 + (stop2 - start2) * ((value - start1) / (stop1 - start1));
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

varying vec2 vUv;
varying vec4 vAtlasRemap;
varying vec2 vBoxSize;
varying vec2 vSimulationUv;
varying float vAlpha;
varying vec3 vWorldPosition;

uniform sampler2D uAtlasTexture;
uniform sampler2D uSimulation;
uniform sampler2D uNoise;

uniform float uNoiseIntensity; // 0.1
uniform float uNoiseScale; // 1
uniform float uDimSlope; // 0.4
uniform float uShadowIntensity; // 0.2
uniform float uSimulationIntensity; // 2

uniform vec2 uResolution;
uniform sampler2D uShadowMap;

uniform float uTime;
uniform vec2 uFogState;
uniform sampler2D tNoiseTexture;
varying float vFogDepth;

float sdBox( in vec2 p, in vec2 b ) {
    vec2 d = abs(p)-b;
    return length(max(d,0.0)) + min(max(d.x,d.y),0.0);
}

void main() {
    float geometryRatio = vBoxSize.x / vBoxSize.y;
	vec2 screenUv = gl_FragCoord.xy / uResolution;

    vec4 data = texture2D(uSimulation, vSimulationUv);

    vec2 groundUv = vUv;
    groundUv *= vBoxSize * 0.1;
    groundUv.x /= (vAtlasRemap.z / vAtlasRemap.w);
    groundUv = fract(groundUv);

    groundUv.x = remap(groundUv.x, 0., 1., vAtlasRemap.x + 0.01, vAtlasRemap.x + vAtlasRemap.z - 0.01);
    groundUv.y = remap(groundUv.y, 0., 1., vAtlasRemap.y + 0.01, vAtlasRemap.y + vAtlasRemap.w - 0.01);
    vec4 texel = texture2D(uAtlasTexture, groundUv);

    // float blend = smoothstep(0., 0.01, vel);
    float blend = smoothstep(0., 0.1, data.b) * uSimulationIntensity;

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

    vec2 shadowUvs = gl_FragCoord.xy / uResolution;
    float shadow = texture2D(uShadowMap, shadowUvs).r;

    vec3 color = texel.rgb - (1. - shadow) * uShadowIntensity;

	color = getFogColorWithRatio(uTime, vFogDepth, screenUv, uResolution, vWorldPosition, color, tNoiseTexture, uFogState.x, uFogState.y);
    
    gl_FragColor = vec4(color, blend * boxDist * vAlpha);

	gl_FragColor = LinearTosRGB(gl_FragColor);
}
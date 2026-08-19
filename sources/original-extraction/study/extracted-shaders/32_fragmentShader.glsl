precision highp float;
#define GLSLIFY 1

uniform sampler2D map;
uniform sampler2D uNoise;

uniform vec2 uCursorPosition;
uniform float uCursorFactor;
uniform float uTileRatio;
uniform float uQuadRatio;
uniform float uTextRatio;
uniform float uScrollProgress;
uniform float uUvScrollProgress;
uniform float uVisibleArea;

uniform vec4 uSharpUvs;
uniform vec4 uLowBlurUvs;
uniform vec4 uHighBlurUvs;

uniform float uClampFadeOverride;
uniform float uFadeProgress;
uniform float uFadeNoiseSize;
uniform float uWriteProgress;

varying vec2 vUv;

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

float sampleAlpha(vec2 uv, vec4 uvRemap) {
  float quadToTextRatio = uQuadRatio / uTextRatio;
  vec2 sampleUvs = uv;
  sampleUvs.x = ((sampleUvs.x - 0.5) * quadToTextRatio) + 0.5;
  vec2 boundUvs = sampleUvs;
  sampleUvs.x = remap(sampleUvs.x, 0., 1., uvRemap.x, uvRemap.z);
  sampleUvs.y = remap(sampleUvs.y, 0., 1., uvRemap.y, uvRemap.w);
  sampleUvs.y = 1. - sampleUvs.y;
  sampleUvs.y /= uTextRatio;
  sampleUvs.y *= uTileRatio;
  sampleUvs.y = sampleUvs.y;
  sampleUvs.y += uScrollProgress * (uvRemap.w - uvRemap.y);
  
  float texel = texture2D(map, sampleUvs).a;
  if (boundUvs.x < -0.05) return 0.;
  if (boundUvs.x > 0.95) return 0.;
  return texel;
}

void main() {
  // Noise uv
  float quadToTextRatio = uQuadRatio / uTextRatio;
  vec2 noiseBaseUv = vUv;
  noiseBaseUv.x = ((noiseBaseUv.x - 0.5) * quadToTextRatio) + 0.5;

  // Area blur
  vec4 distNoise = texture2D(uNoise, (noiseBaseUv - vec2(0.6, uUvScrollProgress)) * 1.2);
  float distNoiseR = quarticInOut(distNoise.r);
  float size = 0.05;
  float dist = length((vUv - uCursorPosition) / vec2(1., uQuadRatio));
  dist = abs(0.15 - dist);
  dist = cremap(dist, 0., size / 2. + distNoiseR * size * 4., 1., 0.);
	dist = smoothstep(0., 1., dist) * distNoise.g;

  // Clamp noise
  float clampFadeNoise = texture2D(uNoise, noiseBaseUv * 0.7).r;
  clampFadeNoise = (clampFadeNoise - 0.5) * 2.;
  clampFadeNoise *= 0.2;

  // Top & Bottom factor
  float clampFade = abs(vUv.y + clampFadeNoise - 0.5) * 2. / uVisibleArea;
  float baseClampFade = clampFade;
  clampFade = mix(clampFade, 1., uClampFadeOverride);
  clampFade = cubicIn(clampFade);

  // Displacement noise
  vec4 fadeDisplacementNoise = texture2D(uNoise, (noiseBaseUv - vec2(0., uUvScrollProgress)) * uFadeNoiseSize);

  // Write animation
  float writeAnimationNoise = fadeDisplacementNoise.r;
  float writeAnimationProgress = min(uWriteProgress + quarticInOut(writeAnimationNoise) * 0.5 * cubicIn(uWriteProgress), 1.);

  float fadeDisplacementAmount = 0.2;
  float fadeProgress = pow(max(uFadeProgress - quarticInOut(fadeDisplacementNoise.b) * 0.5, 0.), 2.) * 4.;
  vec2 fadeDisplacement = (fadeDisplacementNoise.rg - 0.5) * 2. * fadeProgress * fadeDisplacementAmount;
  fadeDisplacement += (fadeDisplacementNoise.gb - 0.5) * 2. * writeAnimationProgress * fadeDisplacementAmount;

  dist *= smoothstep(0.5, 0., fadeProgress) * smoothstep(0.5, 0., writeAnimationProgress) * uCursorFactor;

  // Displacement
  vec2 displacement = -(fadeDisplacementNoise.br - 0.5) * 2. * vec2(1., mix(0.1, 1., writeAnimationProgress));

  float displacementAmount = 0.15;
  // displacementAmount *= clampFade * 0.7;
  displacementAmount *= max(clampFade * 0.4, dist * 0.2);
  // displacementAmount = max(displacementAmount, writeAnimationProgress * 0.07);
  displacement = displacement * displacementAmount - vec2(0.01, 0.);

  // Blur
  float blurNoiseScale = 0.44;
  float noiseBlur = texture2D(uNoise, (noiseBaseUv - vec2(0.3, uUvScrollProgress)) * blurNoiseScale).g;
  noiseBlur = quarticInOut(noiseBlur);
  
  float clampFadeWithDist = mix(baseClampFade, 1., dist);
  float blurAmount = smoothstep(mix(0.5, 0.3, smoothstep(0.1, 0.4, clampFadeWithDist * clampFadeWithDist)), 1., noiseBlur) * mix(clampFadeWithDist, 0.7, dist);
  // blurAmount = max(clampFade * 2., blurAmount);
  blurAmount = max(clampFade * 0.7, blurAmount);
  // blurAmount = max(dist * 0.7, blurAmount);
  blurAmount = max(cubicOut(length(fadeDisplacement) * 15.), blurAmount);
  blurAmount = max(writeAnimationProgress, blurAmount);

  // Samples
  vec2 uv = vUv + displacement + fadeDisplacement * 0.5;
  float sharpTexture = sampleAlpha(uv, uSharpUvs);
  #ifdef ANTIALIASING
    sharpTexture = sharpTexture - 0.5;
    sharpTexture = clamp(sharpTexture / fwidth(sharpTexture) + 0.5, 0.0, 1.0);
  #endif
  float lowBlurTexture = sampleAlpha(uv, uLowBlurUvs);
  float highBlurTexture = sampleAlpha(uv, uHighBlurUvs);

  float sharpAmount = smoothstep(0.5, 0., blurAmount);
  float lowBlurAmount = smoothstep(0.5, 0., abs(blurAmount - 0.5));
  float highBlurAmount = smoothstep(0.5,1.0, blurAmount);

  float alpha = sharpTexture * sharpAmount + lowBlurTexture * lowBlurAmount + highBlurTexture * highBlurAmount;
  alpha = min(alpha, 1.);

  alpha = cremap(alpha, quadraticOut(writeAnimationProgress) * 0.5, 1., 0., 1.);
  // alpha = cremap(alpha, writeAnimationProgress * 0.5, 1., 0., 1.);
  alpha *= (1. - uFadeProgress);
  alpha *= (1. - clampFade);

  // gl_FragColor = mix(sharpTexture, highBlurTexture, blurAmount);
  // gl_FragColor = vec4(vec3(sharpTexture, lowBlurTexture * 2., cubicOut(highBlurTexture * 2.)), 1.);
  gl_FragColor = vec4(vec3(0.), alpha);
  // gl_FragColor = vec4(vec3(dist), 1.);

  // gl_FragColor = vec4(vec3(uFadeProgress), 1.);
}

import { GLSL_FOG, GLSL_UTILS } from "./chunks";

export const paintingTitleVertexShader = /* glsl */ `
varying vec2 vUv;
varying vec2 vLayoutUv;
varying vec3 vWorldPosition;
varying float vFogDepth;
attribute vec2 uv1;

void main() {
  vUv = uv;
  vLayoutUv = uv1;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec4 mv = viewMatrix * world;
  vWorldPosition = world.xyz;
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

export const paintingTitleFragmentShader = /* glsl */ `
precision highp float;

${GLSL_UTILS}
${GLSL_FOG}

varying vec2 vUv;
varying vec2 vLayoutUv;
varying vec3 vWorldPosition;
varying float vFogDepth;

uniform sampler2D map;
uniform sampler2D uNoise;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uTime;
uniform vec2 uResolution;
uniform vec2 uMouseNdc;
uniform vec2 uCenterNdc;
uniform vec2 uFogState;
uniform float uHovered;

float median3(float r, float g, float b) {
  return max(min(r, g), min(max(r, g), b));
}

void main() {
  vec3 texel = texture2D(map, vUv).rgb;
  float signedDistance = median3(texel.r, texel.g, texel.b) - 0.5;
  float sharp = clamp(signedDistance / max(fwidth(signedDistance), 0.0001) + 0.5, 0.0, 1.0);

  vec2 noiseUv = vLayoutUv * vec2(2.2, 0.72) + vec2(uTime * 0.004, 0.0);
  vec3 noise = texture2D(uNoise, noiseUv).rgb;
  float mouseDistance = length(uMouseNdc - uCenterNdc);
  float mouseFocus = 1.0 - smoothstep(0.0, 0.35, mouseDistance);
  float feather = mix(0.78, 1.0, noise.g);
  feather = mix(feather, 1.0, max(mouseFocus, uHovered));

  vec2 screenUv = gl_FragCoord.xy / uResolution;
  vec3 color = getFogColorWithRatio(
    uTime,
    vFogDepth,
    screenUv,
    uResolution,
    vWorldPosition,
    uColor,
    uNoise,
    uFogState.x,
    uFogState.y
  );
  float alpha = sharp * feather * uAlpha * (1.0 - max(uFogState.x, uFogState.y));
  if (alpha < 0.01) discard;
  gl_FragColor = linearToSrgb(vec4(color, alpha));
}
`;

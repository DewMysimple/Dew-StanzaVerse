import { GLSL_FOG, GLSL_UTILS } from "./chunks";

export const grassVertexShader = /* glsl */ `
attribute vec4 aGrassTextureRemap;
attribute float aGradient;
attribute float aRevealProgress;

uniform float uTime;
uniform float uWindDisplacement;
uniform float uWindIntensity;
uniform float uWindSpeed;
uniform float uScale;
uniform sampler2D tNoise;

varying vec2 vUv;
varying float vGradient;
varying vec3 vWorldPosition;
varying float vFogDepth;

vec4 permute(vec4 x) {
    return mod(((x * 34.0) + 1.0) * x, 289.0);
}

vec2 fade(vec2 t) {
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

float cnoise(vec2 P) {
    vec4 Pi = floor(P.xyxy) + vec4(0.0, 0.0, 1.0, 1.0);
    vec4 Pf = fract(P.xyxy) - vec4(0.0, 0.0, 1.0, 1.0);
    Pi = mod(Pi, 289.0);
    vec4 ix = Pi.xzxz;
    vec4 iy = Pi.yyww;
    vec4 fx = Pf.xzxz;
    vec4 fy = Pf.yyww;
    vec4 i = permute(permute(ix) + iy);
    vec4 gx = 2.0 * fract(i * 0.0243902439) - 1.0;
    vec4 gy = abs(gx) - 0.5;
    vec4 tx = floor(gx + 0.5);
    gx = gx - tx;
    vec2 g00 = vec2(gx.x, gy.x);
    vec2 g10 = vec2(gx.y, gy.y);
    vec2 g01 = vec2(gx.z, gy.z);
    vec2 g11 = vec2(gx.w, gy.w);
    vec4 norm = 1.79284291400159 - 0.85373472095314
      * vec4(dot(g00, g00), dot(g01, g01), dot(g10, g10), dot(g11, g11));
    g00 *= norm.x;
    g01 *= norm.y;
    g10 *= norm.z;
    g11 *= norm.w;
    float n00 = dot(g00, vec2(fx.x, fy.x));
    float n10 = dot(g10, vec2(fx.y, fy.y));
    float n01 = dot(g01, vec2(fx.z, fy.z));
    float n11 = dot(g11, vec2(fx.w, fy.w));
    vec2 fadeXY = fade(Pf.xy);
    vec2 nX = mix(vec2(n00, n01), vec2(n10, n11), fadeXY.x);
    return 2.3 * mix(nX.x, nX.y, fadeXY.y);
}

mat4 rotate3d(vec3 axis, float angle) {
    axis = normalize(axis);
    float s = sin(angle);
    float c = cos(angle);
    float oc = 1.0 - c;
    return mat4(
      oc * axis.x * axis.x + c, oc * axis.x * axis.y - axis.z * s, oc * axis.z * axis.x + axis.y * s, 0.0,
      oc * axis.x * axis.y + axis.z * s, oc * axis.y * axis.y + c, oc * axis.y * axis.z - axis.x * s, 0.0,
      oc * axis.z * axis.x - axis.y * s, oc * axis.y * axis.z + axis.x * s, oc * axis.z * axis.z + c, 0.0,
      0.0, 0.0, 0.0, 1.0
    );
}

void main() {
    float time = uTime * uWindSpeed;
    vUv = aGrassTextureRemap.xy + vec2(uv.x, 1.0 - uv.y) * aGrassTextureRemap.zw;
    vGradient = aGradient;
    vec4 center = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float reveal = aRevealProgress;
    float wind = cnoise(center.xz * uWindDisplacement + time) * reveal;
    float centerDist = (1.0 / wind) * 1.0 / uWindIntensity;
    mat4 rotationMatrix = rotate3d(vec3(1.0, 0.0, 0.0), -0.5 * uv.y / centerDist);
    vec4 transformed = vec4(position, 1.0);
    transformed.xyz *= uScale;
    transformed.z *= reveal;
    transformed.z *= mix(1.0, 0.2, uv.y);
    transformed.z -= centerDist;
    transformed = rotationMatrix * transformed;
    transformed.z += centerDist;
    vec4 worldPosition = modelMatrix * instanceMatrix * vec4(transformed.xyz, 1.0);
    vWorldPosition = worldPosition.xyz;
    vec4 mvPosition = viewMatrix * worldPosition;
    vFogDepth = -mvPosition.z;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * transformed;
}
`;

export const grassFragmentShader = /* glsl */ `
precision highp float;
${GLSL_UTILS}
${GLSL_FOG}

uniform float uTime;
uniform sampler2D tNoiseTexture;
uniform vec2 uResolution;
uniform sampler2D tGrass;
uniform sampler2D tGradient;
uniform vec2 uFogState;

varying vec2 vUv;
varying float vGradient;
varying vec3 vWorldPosition;
varying float vFogDepth;

void main() {
    vec4 blade = texture2D(tGrass, vUv);
    vec3 color = texture2D(tGradient, vec2(vGradient, blade.r)).rgb;
    vec2 screenUv = gl_FragCoord.xy / uResolution;
    color = getFogColorWithRatio(
      uTime, vFogDepth, screenUv, uResolution, vWorldPosition, color,
      tNoiseTexture, uFogState.x, uFogState.y
    );
    gl_FragColor = linearToSrgb(vec4(color, blade.a));
    if (gl_FragColor.a < 0.01) discard;
}
`;

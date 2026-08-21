export const shadowVertexShader = /* glsl */ `
attribute vec4 aSdfAtlasRemap;
attribute vec2 aSdfScale;
attribute vec2 aSdfOriginSize;
attribute vec2 aSdfPlaneSize;
attribute float aAlpha;

uniform vec3 uLightDirection;

varying vec2 vUv;
varying vec4 vSdfAtlasRemap;
varying vec2 vSdfScale;
varying vec2 vSdfOriginSize;
varying vec2 vSdfPlaneSize;
varying float vDistanceFromFloor;
varying float vAlpha;

vec3 projectToGround(vec3 normal, vec3 point, vec3 direction, vec3 rayPoint) {
    float ndotu = dot(normal, direction);
    vec3 w = rayPoint - point;
    float si = -dot(normal, w) / ndotu;
    return w + si * direction + point;
}

void main() {
    vec3 transformed = position;
    transformed.z *= aSdfScale.x;
    vec4 world = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
    vec3 projected = projectToGround(vec3(0.0, 1.0, 0.0), vec3(0.0), uLightDirection, world.xyz);
    projected.y += 0.01;
    gl_Position = projectionMatrix * viewMatrix * vec4(projected, 1.0);
    vDistanceFromFloor = abs((instanceMatrix * vec4(position, 1.0)).y);
    vUv = uv;
    vSdfAtlasRemap = aSdfAtlasRemap;
    vSdfScale = aSdfScale;
    vSdfOriginSize = aSdfOriginSize;
    vSdfPlaneSize = aSdfPlaneSize;
    vAlpha = aAlpha;
}
`;

export const shadowFragmentShader = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying vec4 vSdfAtlasRemap;
varying vec2 vSdfScale;
varying vec2 vSdfOriginSize;
varying vec2 vSdfPlaneSize;
varying float vDistanceFromFloor;
varying float vAlpha;

uniform sampler2D uSdfTexture;
uniform float uNoise;
uniform float uShadowSpread;
uniform float uShadowAttenuation;
uniform float uShadowSkew;

float remap(float value, float a, float b, float c, float d) { return c + (d - c) * ((value - a) / (b - a)); }
float cremap(float value, float a, float b, float c, float d) { return clamp(remap(value, a, b, c, d), min(c,d), max(c,d)); }
float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898,78.233))) * 43758.5453); }
const float BASE = 255.0;
const float BASE2 = BASE * BASE;
const float BASE3 = BASE * BASE * BASE;

float getSdf(vec2 uv) {
    vec2 center = vSdfAtlasRemap.xy + vSdfAtlasRemap.zw * 0.5;
    uv = 1.0 - uv;
    uv = vSdfAtlasRemap.xy + uv * vSdfAtlasRemap.zw;
    uv = ((uv - center) / vSdfScale) + center;
    vec4 value = texture2D(uSdfTexture, uv) * BASE;
    float pixels = ((value.x * BASE2 + value.y * BASE + value.z) - BASE3 * 0.5) / 1000.0;
    return pixels / (max(vSdfOriginSize.x, vSdfOriginSize.y) * 0.5);
}

float sourceShadow(vec2 st, float floorDistance) {
    vec2 random = (vec2(rand(st), rand(st + 1.0)) - 0.5) * uNoise * floorDistance / vSdfAtlasRemap.zw;
    vec2 uv = ((st - 0.5) * vec2(vSdfScale.x, 1.0)) + 0.5 + random;
    float distance = getSdf(uv);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) distance = 1000.0;
    float shadow = smoothstep(uShadowSpread * floorDistance, -uShadowSpread * floorDistance, distance);
    return 1.0 - (shadow - floorDistance);
}

void main() {
    float floorDistance = cremap(vDistanceFromFloor, 0.0, uShadowAttenuation, 0.0, 1.0);
    floorDistance = floorDistance == 1.0 ? 1.0 : 1.0 - pow(2.0, -10.0 * floorDistance);
    float planeRatio = vSdfOriginSize.x / max(vSdfOriginSize.y, 0.0001);
    float skew = uShadowSkew / max(vSdfPlaneSize.x * planeRatio, 0.0001);
    float a = sourceShadow(vUv + vec2(floorDistance * skew, 0.0), floorDistance);
    float b = sourceShadow(vUv - vec2(floorDistance * skew, 0.0), floorDistance);
    float alpha = (1.0 - (a + b) * 0.5) * vAlpha;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(vec3(0.0), alpha);
}
`;

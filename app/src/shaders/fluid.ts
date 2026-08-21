/**
 * 图集化 Stable Fluids passes。
 *
 * 每个实例是一张纸（包含它的地面区域）的独立模拟 tile。顶点着色器把
 * 单位平面映射进动态打包后的 atlas；片元阶段通过 vRegion 把所有邻域
 * 采样限制在当前 tile 内，避免相邻纸片串色。
 */

export const simVertexShader = /* glsl */ `
attribute vec4 aRegion;
attribute float aPaperIndex;
attribute vec2 aFboSize;
attribute float aDeceleration;
attribute float aAttenuation;
attribute float aDt;
attribute float aWasActive;

varying vec2 vLocalUv;
varying vec2 vSimulationUv;
varying vec4 vRegion;
varying float vPaperIndex;
varying vec2 vFboSize;
varying float vDeceleration;
varying float vAttenuation;
varying float vDt;
varying float vWasActive;

void main() {
    vLocalUv = uv;
    vRegion = aRegion;
    vPaperIndex = aPaperIndex;
    vFboSize = aFboSize;
    vDeceleration = aDeceleration;
    vAttenuation = aAttenuation;
    vDt = aDt;
    vWasActive = aWasActive;
    vSimulationUv = aRegion.xy + uv * aRegion.zw;
    vec2 clip = vSimulationUv * 2.0 - 1.0;
    gl_Position = vec4(clip, 0.0, 1.0);
}
`;

/** Source external-force pass: ratio-corrected ellipse in the active tile. */
export const simSplatFragment = /* glsl */ `
precision highp float;

varying vec2 vLocalUv;
varying vec2 vSimulationUv;
varying float vPaperIndex;

uniform sampler2D uInputTexture;
uniform vec2 uPreviousPoint;
uniform vec2 uCurrentPoint;
uniform vec2 uVector;
uniform vec2 uPreviousRadius;
uniform vec2 uCurrentRadius;
uniform float uIntensity;
uniform float uPressed;
uniform float uPaperIndex;

float cross2d(vec2 a, vec2 b) {
    return a.x * b.y - a.y * b.x;
}

float sdUnevenCapsule(vec2 p, vec2 pa, vec2 pb, float ra, float rb) {
    p -= pa;
    pb -= pa;
    float h = dot(pb, pb);
    if (h < 0.00000001) return length(p) - max(ra, rb);

    vec2 q = vec2(dot(p, vec2(pb.y, -pb.x)), dot(p, pb)) / h;
    q.x = abs(q.x);
    float radiusDelta = ra - rb;
    vec2 c = vec2(sqrt(max(h - radiusDelta * radiusDelta, 0.0)), radiusDelta);
    float k = cross2d(c, q);
    float m = dot(c, q);
    float n = dot(q, q);
    if (k < 0.0) return sqrt(h * n) - ra;
    if (k > c.x) return sqrt(h * (n + 1.0 - 2.0 * q.y)) - rb;
    return m - ra;
}

void main() {
    vec4 data = texture2D(uInputTexture, vSimulationUv);
    if (abs(vPaperIndex - uPaperIndex) > 0.25) {
        gl_FragColor = data;
        return;
    }

    // The source pass carries the previous centre and size so fast movement
    // becomes one continuous uneven capsule.  Work in an aspect-corrected
    // metric so the capsule still projects as a circular brush on screen.
    vec2 largestRadius = max(max(uPreviousRadius, uCurrentRadius), vec2(0.00001));
    float metricRadius = max(largestRadius.x, largestRadius.y);
    vec2 metricAxis = max(largestRadius / metricRadius, vec2(0.00001));
    vec2 point = vLocalUv / metricAxis;
    vec2 previousPoint = uPreviousPoint / metricAxis;
    vec2 currentPoint = uCurrentPoint / metricAxis;
    vec2 previousMetricRadius = uPreviousRadius / metricAxis;
    vec2 currentMetricRadius = uCurrentRadius / metricAxis;
    float previousRadius = max(previousMetricRadius.x, previousMetricRadius.y);
    float currentRadius = max(currentMetricRadius.x, currentMetricRadius.y);
    float travel = length(currentPoint - previousPoint);

    float distanceToStroke;
    if (travel < 0.00001) {
        distanceToStroke = length(point - currentPoint) - currentRadius;
    } else if (previousRadius - currentRadius >= travel) {
        distanceToStroke = length(point - previousPoint) - previousRadius;
    } else if (currentRadius - previousRadius >= travel) {
        distanceToStroke = length(point - currentPoint) - currentRadius;
    } else {
        distanceToStroke = sdUnevenCapsule(
            point,
            previousPoint,
            currentPoint,
            previousRadius,
            currentRadius
        );
    }

    float sdf = max(0.0, -distanceToStroke / max(max(previousRadius, currentRadius), 0.00001));
    float forceLength = length(uVector);
    vec2 radial = normalize((point - currentPoint) + vec2(0.00001)) * forceLength;
    vec2 injected = uPressed > 0.5
        ? radial * sdf * uVector.x
        : mix(uVector, radial, 0.2) * sdf;
    float shouldUpdate = step(0.0001, sdf) * step(0.0001, forceLength);
    float intensity = mix(data.b, min(data.b + uIntensity, 1.0), shouldUpdate);
    gl_FragColor = vec4(data.rg + injected, intensity, 1.0);
}
`;

export const simAdvectFragment = /* glsl */ `
precision highp float;

varying vec2 vLocalUv;
varying vec2 vSimulationUv;
varying vec4 vRegion;
varying vec2 vFboSize;
varying float vDeceleration;
varying float vDt;
varying float vWasActive;

uniform sampler2D uInputTexture;
uniform sampler2D uNoiseTexture;
uniform float uRandomDirection;
uniform float uFirstNoiseScale;
uniform float uSecondNoiseScale;
uniform float uVelocityThreshold;
uniform float uGapVelocityBoost;
uniform vec2 uGapAmount;
uniform float uIntensityDim;

float cubicInOut(float t) {
    return t < 0.5 ? 4.0 * t * t * t : 0.5 * pow(2.0 * t - 2.0, 3.0) + 1.0;
}

void main() {
    if (vWasActive < 0.5) { gl_FragColor = vec4(0.0); return; }
    vec2 ratio = max(vFboSize.x, vFboSize.y) / max(vFboSize, vec2(1.0));
    vec3 baseData = texture2D(uInputTexture, vSimulationUv).xyz;
    vec2 velocity = baseData.xy;
    float intensity = baseData.z;
    float speed = length(velocity);
    vec3 noise1 = texture2D(uNoiseTexture, vLocalUv * uFirstNoiseScale).rgb;
    vec3 noise2 = texture2D(uNoiseTexture, vLocalUv * uSecondNoiseScale).rgb;
    vec2 noiseDirection = normalize((noise1.gb - 0.5) * 2.0 + vec2(0.00001));
    float threshold = cubicInOut(noise1.r) * uVelocityThreshold;
    bool belowThreshold = speed < threshold;
    if (belowThreshold) velocity *= smoothstep(uGapAmount.x, uGapAmount.y, noise2.r);
    vec2 offset = mix(velocity, noiseDirection * length(velocity), uRandomDirection) * vDt * ratio;
    if (belowThreshold) offset *= mix(0.0, uGapVelocityBoost, noise1.r);
    vec2 sourceUv = clamp(vSimulationUv - offset, vRegion.xy, vRegion.xy + vRegion.zw);
    vec3 advected = texture2D(uInputTexture, sourceUv).xyz;
    float dim = 1.0 + smoothstep(0.001, 0.0, length(offset)) * 3.0;
    float nextIntensity = max(max(advected.z, intensity) - uIntensityDim * dim, 0.0);
    gl_FragColor = vec4(advected.xy * vDeceleration, nextIntensity, 0.0);
}
`;

export const simDivergenceFragment = /* glsl */ `
precision highp float;

varying vec2 vSimulationUv;
varying float vDt;
varying vec4 vRegion;

uniform sampler2D uVelocity;
uniform vec2 uTexelSize;

vec2 clampToRegion(vec2 value) {
    return clamp(value, vRegion.xy + uTexelSize, vRegion.xy + vRegion.zw - uTexelSize);
}

void main() {
    float right = texture2D(uVelocity, clampToRegion(vSimulationUv + vec2(uTexelSize.x * 2.0, 0.0))).r;
    float left = texture2D(uVelocity, clampToRegion(vSimulationUv - vec2(uTexelSize.x * 2.0, 0.0))).r;
    float top = texture2D(uVelocity, clampToRegion(vSimulationUv + vec2(0.0, uTexelSize.y * 2.0))).g;
    float bottom = texture2D(uVelocity, clampToRegion(vSimulationUv - vec2(0.0, uTexelSize.y * 2.0))).g;
    gl_FragColor = vec4(0.25 * (right - left + top - bottom), 0.0, 0.0, 1.0);
}
`;

export const simPressureFragment = /* glsl */ `
precision highp float;

varying vec2 vSimulationUv;
varying vec4 vRegion;

uniform sampler2D uPressure;
uniform sampler2D uDivergence;
uniform vec2 uTexelSize;

vec2 clampToRegion(vec2 value) {
    return clamp(value, vRegion.xy + uTexelSize, vRegion.xy + vRegion.zw - uTexelSize);
}

void main() {
    float right = texture2D(uPressure, clampToRegion(vSimulationUv + vec2(uTexelSize.x * 2.0, 0.0))).r;
    float left = texture2D(uPressure, clampToRegion(vSimulationUv - vec2(uTexelSize.x * 2.0, 0.0))).r;
    float top = texture2D(uPressure, clampToRegion(vSimulationUv + vec2(0.0, uTexelSize.y * 2.0))).r;
    float bottom = texture2D(uPressure, clampToRegion(vSimulationUv - vec2(0.0, uTexelSize.y * 2.0))).r;
    float divergence = texture2D(uDivergence, vSimulationUv).r;
    gl_FragColor = vec4((right + left + top + bottom) * 0.25 - divergence, 0.0, 0.0, 1.0);
}
`;

export const simGradientFragment = /* glsl */ `
precision highp float;

varying vec2 vSimulationUv;
varying vec4 vRegion;
varying float vDt;

uniform sampler2D uPressure;
uniform sampler2D uVelocity;
uniform vec2 uTexelSize;

vec2 clampToRegion(vec2 value) {
    return clamp(value, vRegion.xy + uTexelSize, vRegion.xy + vRegion.zw - uTexelSize);
}

void main() {
    float right = texture2D(uPressure, clampToRegion(vSimulationUv + vec2(uTexelSize.x, 0.0))).r;
    float left = texture2D(uPressure, clampToRegion(vSimulationUv - vec2(uTexelSize.x, 0.0))).r;
    float top = texture2D(uPressure, clampToRegion(vSimulationUv + vec2(0.0, uTexelSize.y))).r;
    float bottom = texture2D(uPressure, clampToRegion(vSimulationUv - vec2(0.0, uTexelSize.y))).r;
    vec4 data = texture2D(uVelocity, vSimulationUv);
    vec2 velocity = data.rg - vec2(right - left, top - bottom) * 0.5 * vDt;
    gl_FragColor = vec4(velocity, data.b, 1.0);
}
`;

export const simAccumulationFragment = /* glsl */ `
precision highp float;

varying vec2 vLocalUv;
varying vec2 vSimulationUv;
varying float vAttenuation;
varying float vWasActive;

uniform sampler2D uVelocity;
uniform sampler2D uPrevious;

void main() {
    if (vWasActive < 0.5) { gl_FragColor = vec4(0.0); return; }
    vec4 velocity = texture2D(uVelocity, vSimulationUv);
    vec4 previous = texture2D(uPrevious, vSimulationUv);
    float sourceVelocity = length(velocity.rg);
    float displayedVelocity = max(smoothstep(sourceVelocity, 0.0, 0.01), previous.b * vAttenuation);
    vec2 direction = sourceVelocity > 0.001 ? velocity.rg : previous.rg;
    gl_FragColor = vec4(direction, displayedVelocity, velocity.b);
}
`;

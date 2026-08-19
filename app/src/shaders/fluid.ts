/**
 * 流体模拟着色器组 —— 稳定的 Stom 式 GPU 流体（Stable Fluids）精简实现。
 *
 * 原站的模拟是完整的 Navier-Stokes 求解（平流 → 散度 → 压力 Jacobi 迭代 →
 * 梯度扣除，见提取的 01-04 号着色器），全部画纸共享一张图集化的模拟纹理。
 * 复刻版保持相同的数据约定，供 paper/ground/fullpaint 着色器消费：
 *
 *   速度纹理: r/g = 速度方向向量, b = 速度大小, a = 墨迹强度（累积并缓慢衰减）
 *
 * 每帧流程：splat（笔刷注入）→ advect（平流+衰减）→ divergence →
 *           pressure（多次 Jacobi）→ gradientSubtract。
 */

/** 所有模拟 pass 共用的全屏顶点着色器 */
export const simVertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** 连续胶囊笔刷：覆盖上一帧与当前帧之间的整段轨迹。 */
export const simSplatFragment = /* glsl */ `
precision highp float;
varying vec2 vUv;

uniform sampler2D uInputTexture;
uniform sampler2D uNoiseTexture;
uniform vec2 uPreviousPoint;
uniform vec2 uCurrentPoint;
uniform vec2 uVector;
uniform float uPreviousRadius;
uniform float uCurrentRadius;
uniform float uForce;
uniform float uAspect;
uniform vec4 uRegion;

void main() {
    vec4 data = texture2D(uInputTexture, vUv);
    vec2 regionMax = uRegion.xy + uRegion.zw;
    float inside = step(uRegion.x, vUv.x) * step(uRegion.y, vUv.y)
      * step(vUv.x, regionMax.x) * step(vUv.y, regionMax.y);
    if (inside < 0.5) {
      gl_FragColor = data;
      return;
    }
    vec2 localUv = (vUv - uRegion.xy) / uRegion.zw;
    vec2 a = uPreviousPoint;
    vec2 b = uCurrentPoint;
    vec2 segment = b - a;
    vec2 fromStart = localUv - a;
    segment.x *= uAspect;
    fromStart.x *= uAspect;
    float segmentSq = max(dot(segment, segment), 0.0000001);
    float along = clamp(dot(fromStart, segment) / segmentSq, 0.0, 1.0);
    vec2 closest = mix(a, b, along);
    vec2 delta = localUv - closest;
    delta.x *= uAspect;
    float radius = mix(uPreviousRadius, uCurrentRadius, along);
    float paperNoise = texture2D(uNoiseTexture, localUv * 5.7 + closest.yx * 1.9).r;
    float brokenEdge = radius * mix(0.78, 1.16, paperNoise);
    float brush = 1.0 - smoothstep(brokenEdge * 0.28, brokenEdge, length(delta));
    brush *= mix(0.78, 1.0, paperNoise);

    vec2 velocity = data.rg + uVector * brush * uForce;
    float pigment = max(data.b, clamp(brush * (0.32 + uForce * 0.42), 0.0, 1.0));

    gl_FragColor = vec4(velocity, pigment, 1.0);
}
`;

/** 平流 + 衰减 */
export const simAdvectFragment = /* glsl */ `
precision highp float;
varying vec2 vUv;

uniform sampler2D uInputTexture;
uniform float uDelta;
uniform vec2 uTexelSize;
uniform float uVelocityDissipation;
uniform float uIntensityDissipation;
uniform vec2 uGrid;
uniform sampler2D uNoiseTexture;
uniform float uTime;

void main() {
    vec4 data = texture2D(uInputTexture, vUv);
    vec2 velocity = data.rg;

    // 半拉格朗日回溯源点
    vec2 cell = floor(vUv * uGrid);
    vec2 cellMin = cell / uGrid + uTexelSize * 1.5;
    vec2 cellMax = (cell + 1.0) / uGrid - uTexelSize * 1.5;
    vec2 sourceUv = clamp(vUv - velocity * uDelta * uTexelSize * 100.0, cellMin, cellMax);
    vec4 advected = texture2D(uInputTexture, sourceUv);

    vec2 noiseUv = vUv * vec2(7.0, 5.0) + vec2(uTime * 0.013, -uTime * 0.009);
    vec2 noise = texture2D(uNoiseTexture, noiseUv).rg * 2.0 - 1.0;
    float speed = length(advected.rg);
    vec2 newVelocity = (advected.rg + noise * smoothstep(0.002, 0.05, speed) * 0.0018)
      * uVelocityDissipation;
    float gaps = smoothstep(0.468, 0.51, texture2D(uNoiseTexture, noiseUv * 2.0 + 0.17).b);
    float pigment = advected.b * uIntensityDissipation;
    pigment *= mix(0.997, 1.0, gaps);
    gl_FragColor = vec4(newVelocity, pigment, 1.0);
}
`;

/** 散度 */
export const simDivergenceFragment = /* glsl */ `
precision highp float;
varying vec2 vUv;

uniform sampler2D uVelocity;
uniform vec2 uTexelSize;
uniform vec2 uGrid;

void main() {
    vec2 cell = floor(vUv * uGrid);
    vec2 mn = cell / uGrid + uTexelSize;
    vec2 mx = (cell + 1.0) / uGrid - uTexelSize;
    float v0 = texture2D(uVelocity, clamp(vUv + vec2(uTexelSize.x * 2.0, 0.0), mn, mx)).r;
    float v1 = texture2D(uVelocity, clamp(vUv - vec2(uTexelSize.x * 2.0, 0.0), mn, mx)).r;
    float v2 = texture2D(uVelocity, clamp(vUv + vec2(0.0, uTexelSize.y * 2.0), mn, mx)).g;
    float v3 = texture2D(uVelocity, clamp(vUv - vec2(0.0, uTexelSize.y * 2.0), mn, mx)).g;
    float div = 0.25 * (v0 - v1 + v2 - v3);
    gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
}
`;

/** 压力 Jacobi 迭代（对应原站 02_fragmentShader 的泊松求解） */
export const simPressureFragment = /* glsl */ `
precision highp float;
varying vec2 vUv;

uniform sampler2D uPressure;
uniform sampler2D uDivergence;
uniform vec2 uTexelSize;
uniform vec2 uGrid;

void main() {
    vec2 cell = floor(vUv * uGrid);
    vec2 mn = cell / uGrid + uTexelSize;
    vec2 mx = (cell + 1.0) / uGrid - uTexelSize;
    float p0 = texture2D(uPressure, clamp(vUv + vec2(uTexelSize.x * 2.0, 0.0), mn, mx)).r;
    float p1 = texture2D(uPressure, clamp(vUv - vec2(uTexelSize.x * 2.0, 0.0), mn, mx)).r;
    float p2 = texture2D(uPressure, clamp(vUv + vec2(0.0, uTexelSize.y * 2.0), mn, mx)).r;
    float p3 = texture2D(uPressure, clamp(vUv - vec2(0.0, uTexelSize.y * 2.0), mn, mx)).r;
    float div = texture2D(uDivergence, vUv).r;

    float newP = (p0 + p1 + p2 + p3) / 4.0 - div;
    gl_FragColor = vec4(newP, 0.0, 0.0, 1.0);
}
`;

/** 梯度扣除（对应原站 04_fragmentShader） */
export const simGradientFragment = /* glsl */ `
precision highp float;
varying vec2 vUv;

uniform sampler2D uPressure;
uniform sampler2D uVelocity;
uniform vec2 uTexelSize;
uniform float uDelta;
uniform vec2 uGrid;

void main() {
    vec2 cell = floor(vUv * uGrid);
    vec2 mn = cell / uGrid + uTexelSize;
    vec2 mx = (cell + 1.0) / uGrid - uTexelSize;
    float p0 = texture2D(uPressure, clamp(vUv + vec2(uTexelSize.x, 0.0), mn, mx)).r;
    float p1 = texture2D(uPressure, clamp(vUv - vec2(uTexelSize.x, 0.0), mn, mx)).r;
    float p2 = texture2D(uPressure, clamp(vUv + vec2(0.0, uTexelSize.y), mn, mx)).r;
    float p3 = texture2D(uPressure, clamp(vUv - vec2(0.0, uTexelSize.y), mn, mx)).r;

    vec4 d = texture2D(uVelocity, vUv);
    vec2 v = d.rg;
    vec2 gradP = vec2(p0 - p1, p2 - p3) * 0.5;
    v = v - gradP * uDelta * 10.0;

    gl_FragColor = vec4(v, d.b, 1.0);
}
`;

/** 显示用的独立累积缓存：RG 方向、B 速度、A 已渗入颜料。 */
export const simAccumulationFragment = /* glsl */ `
precision highp float;
varying vec2 vUv;

uniform sampler2D uVelocity;
uniform sampler2D uPrevious;
uniform sampler2D uNoiseTexture;
uniform float uDelta;
uniform float uTime;

void main() {
    vec4 velocity = texture2D(uVelocity, vUv);
    vec4 previous = texture2D(uPrevious, vUv);
    float speed = length(velocity.rg);
    vec2 noise = texture2D(uNoiseTexture, vUv * 9.0 + vec2(uTime * 0.007, 0.0)).rg * 2.0 - 1.0;
    vec2 direction = mix(previous.rg, velocity.rg + noise * speed * 0.045, min(1.0, uDelta * 10.0));
    float displayedSpeed = max(previous.b * exp(-8.0 * uDelta), speed);
    float deposit = smoothstep(0.018, 0.22, velocity.b + speed * 1.8);
    float intensity = max(previous.a * exp(-0.001 * uDelta), deposit);
    gl_FragColor = vec4(direction, displayedSpeed, intensity);
}
`;

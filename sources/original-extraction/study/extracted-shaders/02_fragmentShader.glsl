precision highp float;
#define GLSLIFY 1
uniform sampler2D pressure;
uniform sampler2D divergence;

varying vec2 vPx;

varying vec4 vRemap;
varying vec2 vSimulationUv;

void main(){
    vec2 clampMin = vec2(vRemap.x + vPx.x, vRemap.y + vPx.y);
    vec2 clampMax = vec2(vRemap.z + vRemap.x - vPx.x, vRemap.w + vRemap.y - vPx.y);

    // poisson equation
    float p0 = texture2D(pressure, clamp(vSimulationUv+vec2(vPx.x * 2.0, 0), clampMin, clampMax)).r;
    float p1 = texture2D(pressure, clamp(vSimulationUv-vec2(vPx.x * 2.0, 0), clampMin, clampMax)).r;
    float p2 = texture2D(pressure, clamp(vSimulationUv+vec2(0, vPx.y * 2.0), clampMin, clampMax)).r;
    float p3 = texture2D(pressure, clamp(vSimulationUv-vec2(0, vPx.y * 2.0), clampMin, clampMax)).r;
    float div = texture2D(divergence, vSimulationUv).r;

    float newP = (p0 + p1 + p2 + p3) / 4.0 - div;
    gl_FragColor = vec4(newP);
}

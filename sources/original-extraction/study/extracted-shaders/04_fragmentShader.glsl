precision highp float;
#define GLSLIFY 1
uniform sampler2D pressure;
uniform sampler2D velocity;

varying float vDt;
varying vec2 vPx;

varying vec2 vSimulationUv;
varying vec4 vRemap;

void main(){
    float step = 1.;

    vec2 clampMin = vec2(vRemap.x + vPx.x, vRemap.y + vPx.y);
    vec2 clampMax = vec2(vRemap.z + vRemap.x - vPx.x, vRemap.w + vRemap.y - vPx.y);

    float p0 = texture2D(pressure, clamp(vSimulationUv+vec2(vPx.x * step, 0), clampMin, clampMax)).r;
    float p1 = texture2D(pressure, clamp(vSimulationUv-vec2(vPx.x * step, 0), clampMin, clampMax)).r;
    float p2 = texture2D(pressure, clamp(vSimulationUv+vec2(0, vPx.y * step), clampMin, clampMax)).r;
    float p3 = texture2D(pressure, clamp(vSimulationUv-vec2(0, vPx.y * step), clampMin, clampMax)).r;

    vec3 d = texture2D(velocity, vSimulationUv).xyz;
    vec2 v = d.xy;
    vec2 gradP = vec2(p0 - p1, p2 - p3) * 0.5;
    v = v - gradP * vDt;
    gl_FragColor = vec4(v, d.z, 1.0);
}

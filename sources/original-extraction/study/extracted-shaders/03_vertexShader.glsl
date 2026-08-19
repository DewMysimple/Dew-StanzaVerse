

float remap(float value, float start1, float stop1, float start2, float stop2) {
  return start2 + (stop2 - start2) * ((value - start1) / (stop1 - start1));
}

attribute vec4 atlasRange;
attribute float instance;
attribute vec3 position;
attribute vec2 uv;

varying vec2 vSimulationUv;
varying vec2 vUv;
varying vec4 vRemap;

uniform float dt[INSTANCE_COUNT];
uniform vec2 px[INSTANCE_COUNT];

varying float vDt;
varying vec2 vPx;

precision highp float;
#define GLSLIFY 1

void main(){
    vec3 pos = position;
    vUv = pos.xy + 0.5;

    pos.x = (pos.x + 0.5) * atlasRange.z + atlasRange.x;
    pos.y = (pos.y + 0.5) * atlasRange.w + atlasRange.y;

    vSimulationUv = pos.xy;
    vRemap = atlasRange;

    vDt = dt[int(instance)];
    vPx = px[int(instance)];

    pos.x = remap(pos.x, 0., 1., -1., 1.);
    pos.y = remap(pos.y, 0., 1., -1., 1.);

    gl_Position = vec4(pos, 1.0);
}

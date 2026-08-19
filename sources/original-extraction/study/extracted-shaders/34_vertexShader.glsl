#define GLSLIFY 1
varying vec2 vUv;
varying vec2 vSimulationUv;

uniform vec4 uSimulationRemap;

uniform float uRatio;

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

void main() {
    vec2 simulationUv = uv;
    simulationUv.y = ((simulationUv.y - 0.5) / uRatio) + 0.5;
    simulationUv.y = 1. - simulationUv.y;
    simulationUv = remapAtlasUv(simulationUv, uSimulationRemap);

    gl_Position = vec4(position, 1.);
    vSimulationUv = simulationUv;
	vUv = uv;
}
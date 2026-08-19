#define GLSLIFY 1

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

attribute vec4 simulationBox;
attribute vec4 simulationRemap;
attribute vec2 size;
attribute float instance;

varying vec2 vUv;
varying vec4 vAtlasRemap;
varying vec2 vBoxSize;
varying vec2 vSimulationUv;
varying vec3 vWorldPosition;

uniform bool uVisible[INSTANCE_COUNT];
uniform vec4 uAtlasRemap[INSTANCE_COUNT];

uniform float uAlpha[INSTANCE_COUNT];
varying float vAlpha;

varying float vFogDepth;

vec3 inverseTransformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( vec4( dir, 0.0 ) * matrix ).xyz );
}

void main() {
    vec4 worldPosition = modelMatrix * instanceMatrix * vec4(position, 1.0);
    if (!uVisible[int(instance)]) worldPosition *= 0.;
    vec4 mvPosition = viewMatrix * worldPosition;

    vWorldPosition = worldPosition.xyz;
    vFogDepth = -mvPosition.z;

    vAtlasRemap = uAtlasRemap[int(instance)];
    vAlpha = uAlpha[int(instance)];

    vBoxSize = size;

    vUv = uv;
    vSimulationUv = remapAtlasUv(uv, simulationBox, simulationRemap);

    gl_Position = projectionMatrix * mvPosition;
}
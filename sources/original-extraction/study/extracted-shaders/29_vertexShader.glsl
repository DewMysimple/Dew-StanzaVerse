#define GLSLIFY 1
varying vec2 vUv;
varying vec2 vSimulationUv;

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

uniform vec2 uResolution;
uniform vec4 uSimulationRemap;
uniform float uScale;

#define REVEAL_POINTS_COUNT 4
uniform mat4 uRevealPoints;
varying vec4 vRevealPoints[REVEAL_POINTS_COUNT];
uniform mat4 uRevealPointsPos;
varying vec2 vRevealPointsPos[REVEAL_POINTS_COUNT];

void main() {
    vUv = uv;

	float ratio = uResolution.x / uResolution.y;
    vec2 simulationUv = uv;
    simulationUv.y = 1. - simulationUv.y;
    simulationUv = remapAtlasUv(simulationUv, uSimulationRemap);
	vSimulationUv = simulationUv;

    mat4 revealPoints = uRevealPoints;
	vRevealPoints[0] = revealPoints[0];
	vRevealPoints[1] = revealPoints[1];
	vRevealPoints[2] = revealPoints[2];
	vRevealPoints[3] = revealPoints[3];

    mat4 revealPointsPos = uRevealPointsPos;
	vRevealPointsPos[0] = revealPointsPos[0].xy;
	vRevealPointsPos[1] = revealPointsPos[1].xy;
	vRevealPointsPos[2] = revealPointsPos[2].xy;
	vRevealPointsPos[3] = revealPointsPos[3].xy;

	vec3 transformedPosition = position.xyz * uScale;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformedPosition, 1.0);
}
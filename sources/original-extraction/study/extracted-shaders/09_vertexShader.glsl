#define GLSLIFY 1

struct SDFData {
    vec2 pixelSize;
    vec2 planeSize;
    vec2 scale;
    vec2 originSize;
    vec4 atlasRemap;
};

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

vec3 computeInstanceNormal(vec3 transformedNormal, mat4 instanceMatrix) {
    mat3 m = mat3( instanceMatrix );
    transformedNormal /= vec3( dot( m[ 0 ], m[ 0 ] ), dot( m[ 1 ], m[ 1 ] ), dot( m[ 2 ], m[ 2 ] ) );
    transformedNormal = m * transformedNormal;
    return transformedNormal;
}

#define PI 3.141592

attribute float instance;

// Global
varying vec2 vUv;
uniform float uAlpha[INSTANCE_COUNT];
varying float vAlpha;
uniform float uCurveCoef[INSTANCE_COUNT];
varying vec3 vNormal;
varying vec4 vMvPosition;
varying float vFogDepth;
varying vec3 vWorldPosition;

// Paint
uniform vec4 uPaintAtlasRemap[INSTANCE_COUNT];
varying vec4 vPaintAtlasRemap;

// Sdf
uniform SDFData uSdfData[INSTANCE_COUNT];
varying vec2 vSdfPlaneSize;
varying vec2 vSdfScale;
varying vec2 vSdfOriginSize;
varying vec4 vSdfAtlasRemap;
varying float vSdfAlpha;

// Reveal
#define REVEAL_POINTS_COUNT 4
uniform float uRevealProgress[INSTANCE_COUNT];
varying float vRevealProgress;
uniform mat4 uRevealPoints[INSTANCE_COUNT];
varying vec4 vRevealPoints[REVEAL_POINTS_COUNT];
uniform mat4 uRevealPointsPos[INSTANCE_COUNT];
varying vec2 vRevealPointsPos[REVEAL_POINTS_COUNT];

// Simulation
attribute float transparency;
varying float vTransparency;
attribute vec4 simulationBox;
attribute vec4 simulationRemap;
varying vec2 vSimulationUv;

void main() {

    vUv = uv;

    int INDEX = int(instance);
    vAlpha = uAlpha[INDEX];
    vPaintAtlasRemap = uPaintAtlasRemap[INDEX];
    vRevealProgress = uRevealProgress[INDEX];

    vTransparency = transparency;

    SDFData sdfData = uSdfData[INDEX];
    vSdfPlaneSize = sdfData.planeSize;
    vSdfScale = sdfData.scale;
    vSdfOriginSize = sdfData.originSize;
    vSdfAtlasRemap = sdfData.atlasRemap;

    mat4 revealPoints = uRevealPoints[INDEX];
    vRevealPoints[0] = revealPoints[0];
    vRevealPoints[1] = revealPoints[1];
    vRevealPoints[2] = revealPoints[2];
    vRevealPoints[3] = revealPoints[3];

    mat4 revealPointsPos = uRevealPointsPos[INDEX];
    vRevealPointsPos[0] = revealPointsPos[0].xy;
    vRevealPointsPos[1] = revealPointsPos[1].xy;
    vRevealPointsPos[2] = revealPointsPos[2].xy;
    vRevealPointsPos[3] = revealPointsPos[3].xy;

    vec4 _simulationBox = simulationBox;
    // _simulationBox.w *= vSdfPlaneSize.x / vSdfPlaneSize.y;
    vSimulationUv = remapAtlasUv(1. - uv, _simulationBox, simulationRemap);

    vec3 _position = position;

    vec2 _uv = uv;
    _uv.y = (_uv.y + .5) * .5;
    float _coef = uCurveCoef[INDEX];

    ///// debug coef curve
    // _coef = uv.y;
    // _coef = cos(_coef * PI * 2. - PI * .5);
    // _position.x += _coef * 2.;

    ///// final coef curve
    _coef = cos(_coef * PI * 2. - PI * .5);
    _position.x += cos(_uv.y * PI * 2.) * .2 * _coef;
    // _position.y += - abs(_coef) * .05 * (1. - uv.y);

    vNormal = computeInstanceNormal(normal, instanceMatrix);

    vSdfAlpha = SDF_ALPHA[int(instance)] ? 1. : 0.;

    vec4 worldPosition = modelMatrix * instanceMatrix * vec4(_position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vMvPosition = viewMatrix * worldPosition;
    vFogDepth = -vMvPosition.z;

    gl_Position = projectionMatrix * vMvPosition;
}
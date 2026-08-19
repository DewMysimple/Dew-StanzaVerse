#define GLSLIFY 1

struct SDFData {
    vec2 pixelSize;
    vec2 planeSize;
    vec2 scale;
    vec2 originSize;
    vec4 atlasRemap;
};

// Coordinates
varying vec2 vUv;
varying vec3 vTangentViewPos;
varying vec3 vTangentFragPos;
varying vec3 vWorldPosition;
varying float vFogDepth;

attribute vec4 tangent;
attribute float instance;

uniform bool uVisible[INSTANCE_COUNT];

// Params 
uniform float uDepth;
uniform float uAlpha[INSTANCE_COUNT];
varying float vAlpha;

// SDFData
uniform SDFData uSdfData[INSTANCE_COUNT];

varying vec2 vSdfPixelSize;
varying vec2 vSdfPlaneSize;
varying vec2 vSdfScale;
varying vec2 vSdfOriginSize;
varying vec4 vSdfAtlasRemap;

void main() {
  mat4 worldMatrix = modelMatrix * instanceMatrix;
  vec4 worldPosition = worldMatrix * vec4(position, 1.0);

  vWorldPosition = worldPosition.xyz;

  if(!uVisible[int(instance)])
    worldPosition *= 0.;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;

  vAlpha = uAlpha[int(instance)];

  SDFData sdfData = uSdfData[int(instance)];
  vSdfPixelSize = sdfData.pixelSize;
  vSdfPlaneSize = sdfData.planeSize;
  vSdfScale = sdfData.scale;
  vSdfOriginSize = sdfData.originSize;
  vSdfAtlasRemap = sdfData.atlasRemap;

  // Possible to calculate that cpu side
  vec3 transformedNormal = normalize(mat3(worldMatrix) * -normal.xyz);

  vec3 transformedTangent = normalize(mat3(worldMatrix) * -tangent.xyz);

  vec3 bitangent = normalize(cross(transformedNormal, transformedTangent) * tangent.w);

  mat3 tangentMatrix = mat3(transformedTangent, bitangent, transformedNormal);
  tangentMatrix = transpose(tangentMatrix);

  vTangentViewPos = tangentMatrix * cameraPosition;
  vTangentFragPos = tangentMatrix * worldPosition.xyz;

  vUv = uv;

  vec4 mvPosition = viewMatrix * worldPosition;
  vFogDepth = -mvPosition.z;

//   vec3 viewDir = normalize(vTangentViewPos - vTangentFragPos);
//   vec2 offset = viewDir.xy / viewDir.z * uDepth * vec2(-1, 1);
}
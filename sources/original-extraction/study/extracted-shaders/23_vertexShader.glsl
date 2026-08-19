#define GLSLIFY 1
varying vec2 vUv;
varying vec3 vWorldPosition;
varying vec2 vNdcCenter;
varying float vFogDepth;

void main() {
  vec4 ndcCenter = modelViewMatrix * vec4(vec3(0.), 1.0);
  vec3 transformed = position;

  ndcCenter = projectionMatrix * ndcCenter;

  vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
  vWorldPosition = worldPosition.xyz;

  vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
  vFogDepth = -mvPosition.z;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);

  vUv = uv;
  vNdcCenter = ndcCenter.xy / ndcCenter.w;
}
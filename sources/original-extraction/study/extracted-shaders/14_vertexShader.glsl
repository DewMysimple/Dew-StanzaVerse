#define GLSLIFY 1
varying vec2 vUv;
varying float vFogDepth;

varying vec3 vWorldPosition;

void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

    gl_Position = projectionMatrix * mvPosition;
    vFogDepth = -mvPosition.z;

    vWorldPosition = worldPosition.xyz;
    vUv = uv;
}
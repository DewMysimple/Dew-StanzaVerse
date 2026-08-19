#define GLSLIFY 1
varying vec2 vUv;
varying vec3 vWorldPosition;
varying float vFogDepth;

uniform mat4 uProjectionInverse;
uniform mat4 uViewMatrixInv;

vec3 worldPosFromDepth(float depth) {
    float z = depth * 2.0 - 1.0;

    vec4 clipSpacePosition = vec4(vUv * 2.0 - 1.0, z, 1.0);
    vec4 viewSpacePosition = uProjectionInverse * clipSpacePosition;

    // Perspective division
    viewSpacePosition /= viewSpacePosition.w;

    vec4 worldSpacePosition = uViewMatrixInv * viewSpacePosition;

    return worldSpacePosition.xyz;
}

void main() {
    vec4 mvPosition = vec4(position, 1.0);
    mvPosition = modelViewMatrix * mvPosition;

    gl_Position = vec4(position, 1.);
    vUv = uv;

    vFogDepth = -mvPosition.z;
    vWorldPosition = worldPosFromDepth(1.0);
}
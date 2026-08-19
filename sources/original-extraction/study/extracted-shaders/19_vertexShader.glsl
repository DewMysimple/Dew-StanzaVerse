#define GLSLIFY 1
attribute float aIndices;
attribute float aRandomScale;
attribute float aRandomTexture;
attribute vec3 aRandomRotate;

varying float vRandomTexture;
varying float vFadeOut;
varying vec2 vUv;
varying vec3 vWorldPosition;
varying float vFogDepth;

uniform float uParticleSize;
uniform float uDuration;
uniform float uAmplitude;
uniform float uSize;
uniform float uRotationSpeed;
uniform float uLifeTime;
uniform float uSpeedReveal;
uniform sampler2D uPass1Texture;

#define PI 3.141592

mat4 rotate3d(vec3 axis, float angle) {
    axis = normalize(axis);
    float s = sin(angle);
    float c = cos(angle);
    float oc = 1.0 - c;
    return mat4(oc * axis.x * axis.x + c, oc * axis.x * axis.y - axis.z * s, oc * axis.z * axis.x + axis.y * s, 0.0, oc * axis.x * axis.y + axis.z * s, oc * axis.y * axis.y + c, oc * axis.y * axis.z - axis.x * s, 0.0, oc * axis.z * axis.x - axis.y * s, oc * axis.y * axis.z + axis.x * s, oc * axis.z * axis.z + c, 0.0, 0.0, 0.0, 0.0, 1.0);
}

void main() {
    vec2 pass1Uv = uv;
    pass1Uv.y = 1. - pass1Uv.y;
    pass1Uv.x = mod(aIndices, uSize) / uSize;
    pass1Uv.y = floor(aIndices / uSize) / uSize;

    vec4 data = texture2D(uPass1Texture, pass1Uv);

    float speedReveal = data.r * uSpeedReveal;
    float angle = data.g;
    float lifetime = data.b * uLifeTime;

    float projection = (1.0 - pow(uDuration, -lifetime)) * uAmplitude;

    float posX = projection * cos(angle);
    float posY = projection * sin(angle);

    mat4 rotationMatrix = rotate3d(vec3(aRandomRotate.x, aRandomRotate.y, aRandomRotate.z), projection * aRandomScale * uRotationSpeed);

    vec4 _position = rotationMatrix * vec4(position * uParticleSize, 1.0);
    _position *= aRandomScale * speedReveal;

    _position.y -= posY;
    _position.z -= posX;

    vec4 worldPosition = modelMatrix * instanceMatrix * vec4(_position.xyz, 1.0);
    vWorldPosition = worldPosition.xyz;

    vec4 mvPosition = viewMatrix * worldPosition;
    vFogDepth = -mvPosition.z;

    vRandomTexture = aRandomTexture;
    vFadeOut = 1.0 - projection;
    vUv = uv;

    gl_Position = projectionMatrix * mvPosition;
}
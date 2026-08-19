precision highp float;
#define GLSLIFY 1

varying vec2 vUv;

uniform float uTime;
uniform float uDelta;
uniform float uSize;
uniform float uCurrentIndex;
uniform float uAngle;
uniform float uVelocity;
uniform float uMaxForce;

uniform sampler2D uInputTexture;
uniform sampler2D uBaseTexture;

void main() {
    vec2 uv = vUv;

    float index = floor((uv.x - .5) * uSize) + floor(uv.y * uSize * uSize);

    vec4 baseData = texture2D(uBaseTexture, uv);
    vec4 data = texture2D(uInputTexture, uv);

    float speed = data.r;
    float angle = data.g;

    float lifetime = data.b;

    if(uTime == 0.) {
        lifetime += baseData.b;
    }

    lifetime += uDelta * baseData.a;

    if(uCurrentIndex == index) { // Initialize this particle
        speed = clamp(uVelocity, 0.0, uMaxForce);
        angle = uAngle;
        lifetime = 0.;
    }

    gl_FragColor = vec4(speed, angle, lifetime, 1.0);
}
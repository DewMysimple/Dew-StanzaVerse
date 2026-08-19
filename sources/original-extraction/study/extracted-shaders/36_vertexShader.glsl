#define GLSLIFY 1
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.);
}
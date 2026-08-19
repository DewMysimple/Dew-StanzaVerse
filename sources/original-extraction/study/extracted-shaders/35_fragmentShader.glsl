#define GLSLIFY 1
uniform sampler2D map;
uniform vec2 mapResize;
varying vec2 vUv;

void main() {
    vec2 uv = ((vUv - 0.5) * mapResize) + 0.5;
    uv.y = clamp(uv.y, -0.1, 0.99);
    vec4 texel = texture2D(map, uv);
    float alpha = texel.a;
    if (abs(uv.x - 0.5) > 0.5 || abs(uv.y - 0.5) > 0.5) {
        alpha = 0.;
    } 
    gl_FragColor = vec4(vec3(1. - alpha), 1.);
}
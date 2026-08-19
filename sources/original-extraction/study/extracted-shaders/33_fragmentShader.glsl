#define GLSLIFY 1
varying vec2 vUv;
varying vec2 vSimulationUv;

uniform sampler2D uSimulation;
uniform float uSimulationAlpha;
uniform sampler2D uPaperTexture;

uniform float uRatio;
uniform vec3 uColor;

#ifdef BACKGROUND_TEXTURE
    uniform sampler2D uTexture;
    uniform float uTextureRatio;
#else
    uniform vec3 uPaintColor1;
    uniform vec3 uPaintColor2;
#endif

float cremap(float value, float start1, float stop1, float start2, float stop2) {
  float r = start2 + (stop2 - start2) * ((value - start1) / (stop1 - start1));
  return clamp(r, min(start2, stop2), max(start2, stop2));
}

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

float sdBox( in vec2 p, in vec2 b )
{
    vec2 d = abs(p)-b;
    return length(max(d,0.0)) + min(max(d.x,d.y),0.0);
}

void main() {
    vec4 data = texture2D(uSimulation, vSimulationUv);
	vec2 dir = -data.rg;
	float vel = data.b;
	float blend = smoothstep(0., 0.1, vel);
	float offset = smoothstep(0.05, 0.15, vel);
    
    vec2 paperUv = vUv;
    paperUv.x *= uRatio;
    paperUv *= 3.;
    vec4 paperTexture = texture2D(uPaperTexture, paperUv);

    #ifdef BACKGROUND_TEXTURE
        vec2 textureUv = vUv;
        if (uRatio > uTextureRatio) textureUv.y /= uTextureRatio;
        if (uRatio <= uTextureRatio) textureUv.x /= uTextureRatio;

        float sdf = sdBox(textureUv - 0.5, vec2(0.5, 0.5));
        sdf = smoothstep(0., -0.05, sdf);

        textureUv += normalize(dir) * smoothstep(0.001, 0.05, vel) * 0.01 * sdf;

        vec4 texel = texture2D(uTexture, textureUv);
        vec3 backgroundColor = texel.rgb * mix(uColor, vec3(1.), 0.3);
    #else
        vec3 backgroundColor = mix(uPaintColor1, uPaintColor2, data.a);
    #endif

    vec3 color = mix(uColor, backgroundColor, blend * uSimulationAlpha);
    color *= mix(vec3(1.), paperTexture.rgb, uSimulationAlpha);

    gl_FragColor = vec4(color, 1.);
}
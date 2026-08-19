/**
 * 诗歌全屏视图着色器。
 * 原站 Poem 视图使用 MSDF 字体图集（xp/msdf/CanelaText-Light）在 WebGL 中
 * 排版整首诗；复刻版改用预渲染的 poem/text.png（原站同款资源），
 * 以"书写"动画 + 噪声侵蚀的方式显现。
 */
import { GLSL_UTILS } from "./chunks";

export const poemVertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const poemFragmentShader = /* glsl */ `
precision highp float;

${GLSL_UTILS}

varying vec2 vUv;

uniform sampler2D uTextTexture;   // poem/text.png：透明底黑字
uniform sampler2D uNoise;
uniform vec2 uResolution;
uniform vec2 uTextSize;
uniform float uWriteProgress;     // 0→1 书写显现
uniform float uAlpha;
uniform vec3 uPaperColor;         // 纸张底色
uniform vec3 uInkColor;           // 墨色

float cubicInLocal(float t) {
  return t * t * t;
}

vec2 getTextureContainUv(vec2 baseUv, vec2 resolution, vec2 textureInfos) {
	vec2 uv = baseUv;
	vec2 scale = vec2(1.);
	float textureRatio = resolution.x / resolution.y;
	float imageRatio = textureInfos.x / textureInfos.y;
	float diffRatio = imageRatio / textureRatio;
	// contain：完整显示文字图
	scale.x *= step(1., diffRatio) + (1.0 - step(1., diffRatio)) * diffRatio;
	scale.y *= step(1., diffRatio) / diffRatio + (1.0 - step(1., diffRatio));
	vec2 offset = vec2((scale.x - 1.0) * 0.5, (scale.y - 1.0) * 0.5);
	uv /= scale;
	uv += offset / scale;
	return uv;
}

void main() {
    // 纸张底色带轻微噪点纹理
    float paperNoise = texture2D(uNoise, vUv * 2.0).r;
    vec3 paper = uPaperColor * (0.97 + paperNoise * 0.05);

    // 文字采样（contain 适配）
    vec2 textUv = getTextureContainUv(vUv, uResolution, uTextSize);
    float textAlpha = texture2D(uTextTexture, textUv).a;

    // 书写动画：从左到右 + 噪声侵蚀边缘
    float noise = quarticInOut(texture2D(uNoise, vUv * 1.3).g);
    float writeEdge = uWriteProgress * 1.3;
    float writeMask = 1. - cremap(vUv.x + noise * 0.25, writeEdge - 0.25, writeEdge, 0., 1.);

    // 上下边缘消散
    float clampFade = cubicInLocal(abs(vUv.y - 0.5) * 2.0 / 0.9);
    float edgeFade = 1. - clampFade * 0.85;

    float ink = textAlpha * writeMask * edgeFade;
    vec3 color = mix(paper, uInkColor, ink);

    gl_FragColor = vec4(color, uAlpha);
    gl_FragColor = linearToSrgb(gl_FragColor);
}
`;

/**
 * 全幅绘画（Full Paint）着色器 —— 移植自 29_vertexShader / 30_fragmentShader。
 * 长按照画纸后进入：该画作的视频纹理铺满屏幕，
 * 墨迹显现动画 + 流体模拟扰动 base/over 两层视频的混合。
 */
import { GLSL_UTILS, GLSL_INK_REVEAL } from "./chunks";

export const fullpaintVertexShader = /* glsl */ `
varying vec2 vUv;

float remap(float value, float start1, float stop1, float start2, float stop2) {
  return start2 + (stop2 - start2) * ((value - start1) / (stop1 - start1));
}

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const fullpaintFragmentShader = /* glsl */ `
precision highp float;

${GLSL_UTILS}
${GLSL_INK_REVEAL}

varying vec2 vUv;

uniform float uAlpha;
uniform float uVisibleProgress;
uniform vec2 uResolution;
uniform vec2 uPaintTextureSize;
uniform vec3 uColor;
uniform sampler2D uPaintTexture;
uniform sampler2D uPaintTexture2;
uniform sampler2D uNoiseTexture;
uniform sampler2D uSimulation;
uniform vec4 uSimulationRemap;

uniform vec4 uRevealPoints[REVEAL_POINTS_COUNT];
uniform vec2 uRevealPointsPos[REVEAL_POINTS_COUNT];

vec2 getTextureCoverUv(vec2 baseUv, vec2 resolution, vec2 textureInfos, vec2 textureScale)
{
	vec2 uv = baseUv;
	vec2 scale = textureScale;
	vec2 offset = vec2(0.);

	float textureRatio = resolution.x / resolution.y;
	float imageRatio = textureInfos.x / textureInfos.y;
    float diffRatio = imageRatio / textureRatio;

    scale.x *= (1.0 - step(1., diffRatio)) + step(1., diffRatio) * diffRatio;
    scale.y *= (1.0 - step(1., diffRatio)) / diffRatio + step(1., diffRatio);

	offset.x += (scale.x - 1.0) * 0.5;
	offset.y += (scale.y - 1.0) * 0.5;

	uv /= scale;
	uv += offset / scale;

	return uv;
}

void main() {
    // 全屏 quad 的 uv 映射进该画作在模拟图集中的区域
    vec2 simulationUv = vUv;
    simulationUv.y = 1. - simulationUv.y;
    simulationUv = remapAtlasUv(simulationUv, uSimulationRemap);

    vec4 data = texture2D(uSimulation, simulationUv);
	vec2 dir = -data.rg;
	float vel = data.b;
	float blend = smoothstep(0., 0.1, vel);

    float ratio = uResolution.x / uResolution.y;

    vec2 paintUv = getTextureCoverUv(vUv, uResolution, uPaintTextureSize, vec2(1.));
    vec3 paintColor = texture2D(uPaintTexture, paintUv).rgb;
    vec3 paintColor2 = texture2D(uPaintTexture2, paintUv).rgb;

    vec3 color = mix(paintColor, paintColor2, blend);
    color *= 1. + (blend - 0.5) * 0.1;

    vec4 inkColor = computeInkReveal(uColor, color, vUv, uVisibleProgress, ratio, uNoiseTexture, uRevealPoints, uRevealPointsPos, 0.65);

    gl_FragColor = vec4(inkColor.rgb, uAlpha);
    gl_FragColor = linearToSrgb(gl_FragColor);
}
`;

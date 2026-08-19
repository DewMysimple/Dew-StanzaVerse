#define GLSLIFY 1
varying vec2 vUv;
varying vec2 vSimulationUv;

#ifndef lt
#define lt(x, y) (1.0 - step(y, x))
#endif

#ifndef ge
#define ge(x, y) step(y, x)
#endif

vec2 getTextureCoverUv(vec2 baseUv, vec2 resolution, vec2 textureInfos, vec2 textureScale)
{
	vec2 uv = baseUv;
	vec2 scale = textureScale;
	vec2 offset = vec2(0.);
	
	float textureRatio = resolution.x / resolution.y;
	float imageRatio = textureInfos.x / textureInfos.y;
    float diffRatio = imageRatio / textureRatio;
    
    scale.x *= lt(diffRatio, 1.) + ge(diffRatio, 1.) * diffRatio;
    scale.y *= lt(diffRatio, 1.) / diffRatio + ge(diffRatio, 1.);
	
	offset.x += (scale.x - 1.0) * 0.5;
	offset.y += (scale.y - 1.0) * 0.5;

	uv /= scale;
	uv += offset / scale;

	return uv;
}

struct SDFData {
    vec2 pixelSize;
    vec2 planeSize;
    vec2 scale;
    vec2 originSize;
    vec4 atlasRemap;
};

float cremap(float value, float start1, float stop1, float start2, float stop2) {
  float r = start2 + (stop2 - start2) * ((value - start1) / (stop1 - start1));
  return clamp(r, min(start2, stop2), max(start2, stop2));
}

float remap(float value, float start1, float stop1, float start2, float stop2) {
  return start2 + (stop2 - start2) * ((value - start1) / (stop1 - start1));
}

vec2 rotateUV(vec2 uv, float rotation)
{
    float mid = 0.5;
    return vec2(
        cos(rotation) * (uv.x - mid) + sin(rotation) * (uv.y - mid) + mid,
        cos(rotation) * (uv.y - mid) - sin(rotation) * (uv.x - mid) + mid
    );
}

vec2 rotateUV(vec2 uv, float rotation, vec2 mid)
{
    return vec2(
      cos(rotation) * (uv.x - mid.x) + sin(rotation) * (uv.y - mid.y) + mid.x,
      cos(rotation) * (uv.y - mid.y) - sin(rotation) * (uv.x - mid.x) + mid.y
    );
}

vec2 rotateUV(vec2 uv, float rotation, float mid)
{
    return vec2(
      cos(rotation) * (uv.x - mid) + sin(rotation) * (uv.y - mid) + mid,
      cos(rotation) * (uv.y - mid) - sin(rotation) * (uv.x - mid) + mid
    );
}

// #pragma glslify: easeQuartOut = require(glsl-easings/quartic-out)
// Fix to avoid negative x in pow(x, y) which doesnt work on mac hardware
float easeQuartOut(float t) {
	float invT = t - 1.0;
	return invT * invT * invT * (1.0 - t) + 1.0;
}

#define PI 3.141592653589793
#define REVEAL_POINTS_COUNT 4

float if_gt_1062606552(float value1, float value2, float result1, float result2) {
	float coef = (1.0 - step(value1, value2));
	return mix(result2, result1, coef);
}

float circle(vec2 diff, float radius) {
	return length(diff) - radius;
}

float getInkMask(float noise, vec2 pos, vec2 startPoint, float progress, float power, float sharpRatioMin, float sharpRatioMax) {
	float sdf = -circle(pos + startPoint, 1.) + progress;
	float baseSdf = sdf;
	float intensity = pow(sdf, power) * noise;
	if(baseSdf < 0.)
		intensity = 0.;
	intensity = cremap(intensity, sharpRatioMin, sharpRatioMax, 0.0, 1.0);
	return intensity;
}

float getInkIntensity(vec2 pos, vec2 startPoint, float progressMask, float progressIntensity) {
	float sdf = -circle(pos + startPoint, 0.) + progressMask;
	float dist = max(0., 1. - sdf);
	dist = cremap(dist, .6, 1., 0., 1.) * (1. - progressIntensity);
	dist = (.8 + 1.2 * pow(dist, 4.));
	return dist;
}

vec4 computeInkReveal(vec3 bgColor, vec3 paintColor, vec2 uv, float progress, float planeRatio, sampler2D noiseTexture, vec4 points[REVEAL_POINTS_COUNT], vec2 pointsPos[REVEAL_POINTS_COUNT], float progressMax) {
	vec2 pos_0 = uv;
	pos_0.x *= planeRatio;
	pos_0.x -= planeRatio * .5 - .5;

	float _progress = progress;
	// _progress = .3; /// debug

	if(planeRatio >= 1.)
		_progress *= planeRatio * 1.;
	// _progress *= 1.4;

	vec2 uv1 = pos_0 * 10.;
	vec2 uv2 = rotateUV(pos_0, PI * .3) * 12.;
	vec2 uv3 = rotateUV(pos_0, PI * .6) * 14.;

	/** noise texture **/
	vec4 noiseColor = texture2D(noiseTexture, pos_0);
	float noise1 = noiseColor.x;
	float noise2 = noiseColor.y;
	float noise3 = noiseColor.z;
	/**/

	float power = 5.0;
	float sharpRatioMin = .90;
	float sharpRatioMax = 1.0;

	vec3 inkColor = bgColor;
	float globalIntensity = 0.;

	for(int i = 0; i < REVEAL_POINTS_COUNT; ++i) {
		vec4 point = points[i];
		vec2 startPoint = -pointsPos[i];
		startPoint.x *= planeRatio;
		startPoint.x += planeRatio * .5 - .5;

		float scale = point.x;
		float startTime = point.y;
		float stepDuration = point.z;

		float _progressMask = cremap(progress, startTime, startTime + stepDuration, 0., progressMax);
		_progressMask = easeQuartOut(_progressMask / progressMax) * progressMax;
		_progressMask *= scale;

		float impairCoef = mod(float(i), 2.);
		float _noise1 = mix(noise1, noise2, impairCoef);
		float _noise2 = mix(noise2, noise3, impairCoef);
		float _progress2Coef = mix(.85, .92, impairCoef);

		float intensity1 = getInkMask(_noise1, pos_0, startPoint, _progressMask, power, sharpRatioMin, sharpRatioMax);
		float intensity2 = getInkMask(_noise2, pos_0, startPoint, _progressMask * _progress2Coef, power, sharpRatioMin, sharpRatioMax);

		float _progressIntensity = cremap(progress, startTime + stepDuration * .5, startTime + stepDuration, 0., 1.);
		intensity1 *= getInkIntensity(pos_0, startPoint, _progressMask, _progressIntensity);
		intensity2 *= getInkIntensity(pos_0, startPoint, _progressMask, _progressIntensity);

		float alpha = .5 + .5 * float(i) / float(REVEAL_POINTS_COUNT);
		inkColor = mix(inkColor, paintColor, intensity1 * alpha);
		inkColor = mix(inkColor, paintColor, intensity2 * alpha);

		float _intensity = (intensity1 + intensity2) * alpha;

		globalIntensity = if_gt_1062606552(_intensity, globalIntensity, _intensity, globalIntensity);
	}

	// inkColor = vec3(noise1, noise2, noise3);

	return vec4(inkColor.xyz, globalIntensity);
}

uniform float uAlpha;
uniform float uVisibleProgress;
uniform vec2 uResolution;
uniform vec2 uPaintTextureSize;
uniform vec3 uColor;
uniform sampler2D uPaintTexture;
uniform sampler2D uPaintTexture2;
uniform sampler2D uNoiseTexture;
uniform sampler2D uSimulation;

varying vec4 vRevealPoints[REVEAL_POINTS_COUNT];
varying vec2 vRevealPointsPos[REVEAL_POINTS_COUNT];

#define REVEAL_POINTS_COUNT 4

void main() {
    vec4 data = texture2D(uSimulation, vSimulationUv);
	vec2 dir = -data.rg;
	float vel = data.b;
	float blend = smoothstep(0., 0.1, vel);

    float ratio = uResolution.x / uResolution.y;
    float paintRatio = uPaintTextureSize.x / uPaintTextureSize.y;
    float diffRatio = paintRatio / ratio;

    vec2 paintUv = getTextureCoverUv(vUv, uResolution, uPaintTextureSize, vec2(1.));
    vec3 paintColor = texture2D(uPaintTexture, paintUv).rgb;
    vec3 paintColor2 = texture2D(uPaintTexture2, paintUv).rgb;

    vec3 color = mix(paintColor, paintColor2, blend);
    color *= 1. + (blend - 0.5) * 0.1;

    vec4 inkColor = computeInkReveal(uColor, color, vUv, uVisibleProgress, ratio, uNoiseTexture, vRevealPoints, vRevealPointsPos, 0.65);

    float alpha = uAlpha;
    // alpha *= uVisibleProgress;

    gl_FragColor = inkColor;
}
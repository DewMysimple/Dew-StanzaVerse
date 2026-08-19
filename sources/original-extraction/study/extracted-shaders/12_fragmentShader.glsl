#define GLSLIFY 1

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

float rand(vec2 co){
	return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
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

const float BASE = 255.;
const float BASE_2_2315452051 = BASE * BASE;
const float BASE_3_2315452051 = BASE * BASE * BASE;

float getSdfFromAtlas(vec2 uv, SDFData sdfData, sampler2D sdfTexture) {
    vec2 center = sdfData.atlasRemap.xy + sdfData.atlasRemap.zw / 2.;
    uv = 1. - uv;
    uv = remapAtlasUv(uv, sdfData.atlasRemap);
    uv = ((uv - center) / sdfData.scale) + center;
    float planeRatio = sdfData.planeSize.x / sdfData.planeSize.y;
    vec4 value = texture2D(sdfTexture, uv) * BASE;
    float pixelDistance = ((value.x * BASE_2_2315452051 + value.y * BASE + value.z) - (BASE_3_2315452051 / 2.)) / 1000.;
    float compensatedDist = pixelDistance / (max(sdfData.originSize.x, sdfData.originSize.y) * 0.5);
    return compensatedDist;
}

float exponentialOut(float t) {
  return t == 1.0 ? t : 1.0 - pow(2.0, -10.0 * t);
}

// Sdf
varying vec2 vSdfPixelSize;
varying vec2 vSdfPlaneSize;
varying vec2 vSdfScale;
varying vec2 vSdfOriginSize;
varying vec4 vSdfAtlasRemap;

uniform sampler2D uSdfTexture;

// Params
varying float vAlpha;
uniform float uNoise; // 0.3
uniform float uShadowSpread; // 0.05
uniform float uShadowAttenuation; // 1
uniform float uShadowSkew; // 0.3

varying vec2 vUv;
varying float vDistanceFromFloor;

float getShadow(vec2 st, float distFromFloor, SDFData sdfData) {
	vec2 random = vec2(rand(st), rand(st + 1.));
	vec2 uv = ((st - 0.5) * vec2(sdfData.scale.x, 1.)) + 0.5;
	random = (random - 0.5) * uNoise * distFromFloor / sdfData.atlasRemap.zw;
	uv = uv + random;
	float dist = getSdfFromAtlas(uv, sdfData, uSdfTexture);
	if (uv.x < 0. || uv.x > 1.) dist = 1000.;
	if (uv.y < 0. || uv.y > 1.) dist = 1000.;
	float shadow = smoothstep(uShadowSpread * distFromFloor, -uShadowSpread * distFromFloor, dist);
	float attenuation = distFromFloor;
	shadow = 1. - (shadow - attenuation); 
	return shadow;
}

void main() {
	SDFData sdfData;
    sdfData.pixelSize = vSdfPixelSize;
    sdfData.planeSize = vSdfPlaneSize;
    sdfData.scale = vSdfScale;
    sdfData.originSize = vSdfOriginSize;
    sdfData.atlasRemap = vSdfAtlasRemap;

	float distFromFloor = cremap(vDistanceFromFloor, 0., uShadowAttenuation, 0., 1.);
	distFromFloor = exponentialOut(distFromFloor);

	float planeRatio = vSdfOriginSize.x / vSdfOriginSize.y;
	float skew = uShadowSkew / (vSdfPlaneSize.x * planeRatio);
	vec2 uv1 = vUv + vec2(distFromFloor, 0.) * skew;
	vec2 uv2 = vUv - vec2(distFromFloor, 0.) * skew;

	float shadow1 = getShadow(uv1, distFromFloor, sdfData);
	float shadow2 = getShadow(uv2, distFromFloor, sdfData);
	
	float alpha = 1. - (shadow1 + shadow2) / 2.;
	alpha *= vAlpha;

	if (alpha < 0.01) discard;

	gl_FragColor = vec4(vec3(0.), alpha);
}
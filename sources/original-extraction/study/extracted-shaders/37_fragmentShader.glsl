precision highp float;
#define GLSLIFY 1

uniform sampler2D map;
uniform vec3 diffuse;
uniform float opacity;

uniform float uTime;
uniform vec3 uColor;
uniform float uProgress;
uniform float uforce;
uniform vec2 uResolution;
uniform float uDpr;
uniform float uNoiseSpread;
uniform float uNoiseSpread2;
uniform float uNoisePrecision;
uniform float uOffset;
uniform float uPosX;
uniform float uColorDivider;
uniform vec3 uBkgColor;

varying vec2 vUv;

#define _PerlinPrecision 8.0
#define _PerlinOctaves 8.0
#define _PerlinSeed 0.0

float rnd(vec2 xy) {
    return fract(sin(dot(xy, vec2(12.9898-_PerlinSeed, 78.233+_PerlinSeed)))* (43758.5453+_PerlinSeed));
}

float inter(float a, float b, float x) {
    //return a*(1.0-x) + b*x; // Linear interpolation

    float f = (1.0 - cos(x * 3.1415927)) * 0.5; // Cosine interpolation
    return a*(1.0-f) + b*f;
}

float perlin(vec2 uv, float _Precision) {
    float a,b,c,d, coef1,coef2, t, p;

    t = _Precision;					// Precision
    p = 0.0;								// Final heightmap value

    for (float i=0.0; i<_PerlinOctaves; i++) {
        a = rnd(vec2(floor(t*uv.x)/t, floor(t*uv.y)/t));	//	a----b
        b = rnd(vec2(ceil(t*uv.x)/t, floor(t*uv.y)/t));		//	|    |
        c = rnd(vec2(floor(t*uv.x)/t, ceil(t*uv.y)/t));		//	c----d
        d = rnd(vec2(ceil(t*uv.x)/t, ceil(t*uv.y)/t));

        if((ceil(t*uv.x)/t) == 1.0)
        {
            b = rnd(vec2(0.0, floor(t*uv.y)/t));
            d = rnd(vec2(0.0, ceil(t*uv.y)/t));
        }

        coef1 = fract(t*uv.x);
        coef2 = fract(t*uv.y);
        p += inter(inter(a,b,coef1), inter(c,d,coef1), coef2) * (1.0/pow(2.0,(i+0.6)));
        t *= 2.0;
    }
    return p;
}

void main() {

  vec4 diffuseColor = vec4( diffuse, opacity );

  #include <map_fragment>
  // vec2 uv = gl_FragCoord.xy / uResolution.xy - 0.5 * uDpr;
// texture
  // vec4 texture = texture2D(map, vUv);

  // Uvs
  vec2 uv = gl_FragCoord.xy / (uResolution.xy);
  vec2 st = uv;
  // make it square
  st.x *= uResolution.x / uResolution.y;
  float noise = perlin(st, uNoisePrecision);

  // displacement 1
  vec2 texCoord = vUv;
  vec2 displacementCenter = vec2(uPosX, .5);
  vec2 displacement = normalize(texCoord - displacementCenter);
  float distanceR = length(displacement);

  float radius = noise / 2. * uProgress;
  float percent = 0.;

  if (distanceR < radius) {
    percent = 1.0 - distanceR / (radius / 1.);
    percent = pow(percent, uOffset);
    displacement *= percent * uNoiseSpread;
    texCoord -= displacement;
  }

  vec4 textureDisplace1 = texture2D(map, texCoord);

  // displacement 2
  texCoord = vUv;
  vec2 displacement2 = normalize(texCoord - displacementCenter);
  float distanceR2 = length(displacement2);

  float radius2 = noise / 2. * (uProgress - 0.);
  percent = 0.;

  if (distanceR2 < radius2) {
    percent = 1.0 - distanceR2 / (radius2 / 1.);
    percent = pow(percent, uOffset);
    displacement2 *= percent * uNoiseSpread2;
    texCoord -= displacement2;
  }

  vec4 textureDisplace2 = texture2D(map, texCoord);

  // vec4 bkg = vec4(uBkgColor, 0.5);

  gl_FragColor = textureDisplace1 * textureDisplace2;
}

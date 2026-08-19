#define GLSLIFY 1

struct SDFData {
    vec2 pixelSize;
    vec2 planeSize;
    vec2 scale;
    vec2 originSize;
    vec4 atlasRemap;
};

attribute float instance;

uniform bool uVisible[INSTANCE_COUNT];

// SDFData
uniform SDFData uSdfData[INSTANCE_COUNT];

varying vec2 vSdfPixelSize;
varying vec2 vSdfPlaneSize;
varying vec2 vSdfScale;
varying vec2 vSdfOriginSize;
varying vec4 vSdfAtlasRemap;

uniform vec3 uLightDirection;

uniform float uAlpha[INSTANCE_COUNT];
varying float vAlpha;

varying vec2 vUv;
varying float vDistanceFromFloor;

// Implementation from https://gist.github.com/TimSC/8c25ca941d614bf48ebba6b473747d72
vec3 projectToGround(vec3 planeNormal, vec3 planePoint, vec3 rayDirection, vec3 rayPoint ) {
    float ndotu = dot(planeNormal, rayDirection);
    vec3 w = rayPoint - planePoint;
    float si = -dot(planeNormal, w) / ndotu;
    vec3 Psi = w + si * rayDirection + planePoint;
    return Psi;
}

void main() {
    SDFData sdfData = uSdfData[int(instance)];
    vSdfPixelSize = sdfData.pixelSize;
    vSdfPlaneSize = sdfData.planeSize;
    vSdfScale = sdfData.scale;
    vSdfOriginSize = sdfData.originSize;
    vSdfAtlasRemap = sdfData.atlasRemap;

    vAlpha = uAlpha[int(instance)];

	vec3 transformedPosition = position;
	transformedPosition.z *= sdfData.scale.x;

	vec4 worldPosition = modelMatrix * instanceMatrix * vec4(transformedPosition, 1.0);
  	if (!uVisible[int(instance)]) worldPosition *= 0.;
	vec4 projectedPosition = vec4(projectToGround(vec3(0., 1., 0.), vec3(0., 0., 0.), uLightDirection, worldPosition.xyz), worldPosition.w);
	projectedPosition.y += 0.01;

	gl_Position = projectionMatrix * viewMatrix * projectedPosition;
	
	vDistanceFromFloor = abs((instanceMatrix * vec4(position, 1.0)).y);
	vUv = uv;
}
// Infinite ground grid with derivative-based ("pristine") anti-aliased lines,
// level-of-detail blending by screen density (1/5/10/50 mm), a distance fade
// relative to the camera–target distance and a grazing-angle fade. No moiré,
// no visible fade edge, blends into the background.
import { useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

const vertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uTarget;
  uniform float uCamDist;
  uniform float uFade;      // extra distance (mm) from settings
  uniform float uCoarse;    // 0 = fine, 1 = coarse
  uniform vec3 uMinor;
  uniform vec3 uMajor;
  varying vec3 vWorld;

  // Anti-aliased grid lines of a given cell size; fades out as cells get too dense on screen.
  float level(vec2 p, float cell, float widthPx) {
    vec2 uv = p / cell;
    vec2 d = max(fwidth(uv), vec2(1e-5));
    vec2 g = abs(fract(uv - 0.5) - 0.5) / d;
    float line = 1.0 - min(min(g.x, g.y) - (widthPx * 0.5 - 0.5), 1.0);
    float density = max(d.x, d.y);          // cells per pixel
    float lod = 1.0 - smoothstep(0.22, 0.45, density); // gone below ~2–4 px per cell
    return clamp(line, 0.0, 1.0) * lod;
  }

  void main() {
    vec2 p = vWorld.xz;
    float a1 = uCoarse > 0.5 ? 0.0 : level(p, 1.0, 1.0) * 0.30;
    float a5 = uCoarse > 0.5 ? 0.0 : level(p, 5.0, 1.0) * 0.55;
    float a10 = level(p, 10.0, 1.15) * 0.85;
    float a50 = level(p, 50.0, 1.3);
    float minor = max(a1, a5);
    float major = max(a10, a50);

    // Distance fade: full within ~1.5x the camera distance, gone by ~4x (+ setting).
    float d = length(vWorld.xz - uTarget.xz);
    float r0 = uCamDist * 1.5, r1 = uCamDist * 4.0 + uFade * 0.25;
    float distFade = exp(-3.0 * pow(clamp((d - r0) / max(r1 - r0, 1.0), 0.0, 1.0), 2.0)) * (1.0 - smoothstep(r1 * 0.85, r1, d));

    // Grazing-angle fade: lines vanish as the view becomes parallel to the ground.
    vec3 viewDir = normalize(cameraPosition - vWorld);
    float angleFade = smoothstep(0.05, 0.3, abs(viewDir.y));

    float fade = distFade * angleFade;
    float alpha = max(minor, major) * fade;
    if (alpha < 0.003) discard;
    vec3 col = mix(uMinor, uMajor, step(minor, major));
    gl_FragColor = vec4(col, alpha);
    #include <colorspace_fragment>
  }
`;

export function GroundGrid({ coarse, fade }: { coarse: boolean; fade: number }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: {
          uTarget: { value: new THREE.Vector3() },
          uCamDist: { value: 200 },
          uFade: { value: 600 },
          uCoarse: { value: 0 },
          uMinor: { value: new THREE.Color("#3b454c") },
          uMajor: { value: new THREE.Color("#58666f") },
        },
        transparent: true,
        depthWrite: false,
      }),
    [],
  );

  useFrame(({ camera, controls }) => {
    const target = (controls as unknown as { target?: THREE.Vector3 } | null)?.target ?? new THREE.Vector3();
    const u = material.uniforms;
    u.uTarget.value.copy(target);
    u.uCamDist.value = (camera as THREE.OrthographicCamera).isOrthographicCamera
      ? 400 / (camera as THREE.OrthographicCamera).zoom
      : camera.position.distanceTo(target);
    u.uFade.value = fade;
    u.uCoarse.value = coarse ? 1 : 0;
  });

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} renderOrder={-1} raycast={() => null} material={material}>
      <planeGeometry args={[20000, 20000]} />
    </mesh>
  );
}

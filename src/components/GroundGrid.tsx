// Infinite ground grid with derivative-based ("pristine") anti-aliased lines. The fine
// spacing follows the snap increment and steps up (x5, x10, ...) once lines would be
// closer than ~4 px; a level gets brighter the wider it is on screen. Distance fade
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
  uniform vec3 uMinor;
  uniform vec3 uMajor;
  varying vec3 vWorld;

  uniform float uStep;      // fine spacing in mm (= snap increment)

  // Anti-aliased line coverage for a given cell size (pixel-width lines, no moiré).
  float coverage(vec2 p, float cell) {
    vec2 uv = p / cell;
    vec2 d = max(fwidth(uv), vec2(1e-5));
    vec2 g = abs(fract(uv - 0.5) - 0.5) / d;
    return clamp(1.0 - min(g.x, g.y), 0.0, 1.0);
  }

  // One grid level. Its strength depends only on its on-screen spacing: invisible below
  // ~4 px, faint "fine" at ~6 px, full "major" from ~60 px. So the 10x lines are always
  // brighter than the fine ones and a level smoothly takes over as you zoom out.
  float level(vec2 p, float cell, float wpp, out float strength) {
    float px = cell / wpp;
    float show = smoothstep(4.0, 6.5, px);
    strength = clamp(log(px / 6.0) / log(10.0), 0.0, 1.0);
    return coverage(p, cell) * show;
  }

  void main() {
    vec2 p = vWorld.xz;
    float wpp = max(length(vec2(dFdx(p.x), dFdy(p.x))), length(vec2(dFdx(p.y), dFdy(p.y))));
    float step0 = max(uStep, 0.1);
    // First decade whose lines are at least ~4 px apart.
    float n0 = max(0.0, floor(log(4.0 * wpp / step0) / log(10.0)));
    float alpha = 0.0, strength = 0.0;
    for (int i = 0; i < 3; i++) {
      float base = step0 * pow(10.0, n0 + float(i));
      for (int j = 0; j < 2; j++) {
        float cell = base * (j == 0 ? 1.0 : 5.0);
        float st;
        float c = level(p, cell, wpp, st);
        float a = c * mix(0.16, 0.55, st);
        if (a > alpha) { alpha = a; strength = st; }
      }
    }

    // Distance fade: full within ~1.5x the camera distance, gone by ~4x (+ setting).
    float d = length(vWorld.xz - uTarget.xz);
    float r0 = uCamDist * 1.5, r1 = uCamDist * 4.0 + uFade * 0.25;
    float distFade = exp(-3.0 * pow(clamp((d - r0) / max(r1 - r0, 1.0), 0.0, 1.0), 2.0)) * (1.0 - smoothstep(r1 * 0.85, r1, d));

    // Grazing-angle fade: lines vanish as the view becomes parallel to the ground.
    vec3 viewDir = normalize(cameraPosition - vWorld);
    float angleFade = smoothstep(0.05, 0.3, abs(viewDir.y));

    float fade = distFade * angleFade;
    alpha *= fade;
    if (alpha < 0.003) discard;
    vec3 col = mix(uMinor, uMajor, strength);
    gl_FragColor = vec4(col, alpha);
    #include <colorspace_fragment>
  }
`;

export function GroundGrid({ fade, step }: { fade: number; step: number }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: {
          uTarget: { value: new THREE.Vector3() },
          uCamDist: { value: 200 },
          uFade: { value: 600 },
          uStep: { value: 1 },
          uMinor: { value: new THREE.Color("#3e4950") },
          uMajor: { value: new THREE.Color("#56646d") },
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
    u.uStep.value = step > 0 ? step : 1;
  });

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} renderOrder={-1} raycast={() => null} material={material}>
      <planeGeometry args={[20000, 20000]} />
    </mesh>
  );
}

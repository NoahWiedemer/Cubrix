import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { create } from "zustand";
import { useApp } from "../core/store";

/** Layer used to render feature meshes into the outline mask. */
const MASK_LAYER = 1;

/** Live feature meshes by id, so the outline pass knows what to draw. */
export const useMeshObjects = create<{ meshes: Record<string, THREE.Mesh> }>(() => ({ meshes: {} }));

export function registerMesh(id: string, mesh: THREE.Mesh | null) {
  if (mesh) mesh.layers.enable(MASK_LAYER);
  useMeshObjects.setState((s) => {
    if (mesh ? s.meshes[id] === mesh : !s.meshes[id]) return s;
    const meshes = { ...s.meshes };
    if (mesh) meshes[id] = mesh;
    else delete meshes[id];
    return { meshes };
  });
}

const fragment = /* glsl */ `
  uniform sampler2D mask;
  uniform vec2 texel;
  uniform float radius;
  uniform vec3 selColor;
  uniform vec3 hovColor;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(mask, vUv);
    float dSel = 100.0;
    float dHov = 100.0;
    float zSel = 1.0;
    float zHov = 1.0;
    for (int x = -6; x <= 6; x++) {
      for (int y = -6; y <= 6; y++) {
        vec2 o = vec2(float(x), float(y));
        float d = length(o);
        if (d > radius + 1.0) continue;
        vec4 m = texture2D(mask, vUv + o * texel);
        if (m.r > 0.5 && d < dSel) { dSel = d; zSel = m.b; }
        if (m.g > 0.5 && d < dHov) { dHov = d; zHov = m.b; }
      }
    }
    // Outer ring only, with a one-pixel anti-aliased falloff. The ring is not drawn
    // over surfaces that are in front of the outlined object (b = depth, a = coverage).
    bool behindSel = c.a < 0.5 || c.b > zSel + 1e-5;
    bool behindHov = c.a < 0.5 || c.b > zHov + 1e-5;
    float aSel = (c.r > 0.5 || !behindSel) ? 0.0 : clamp(radius + 0.5 - dSel, 0.0, 1.0);
    float hr = max(radius * 0.5, 1.0);
    float aHov = (c.g > 0.5 || c.r > 0.5 || !behindHov) ? 0.0 : clamp(hr + 0.5 - dHov, 0.0, 1.0) * 0.5;
    gl_FragColor = aSel > 0.0 ? vec4(selColor, aSel) : vec4(hovColor, aHov);
  }
`;

/** Writes (selected, hovered, window depth, coverage) for the outline shader. */
function maskMaterial(sel: number, hov: number) {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      void main() { gl_FragColor = vec4(${sel.toFixed(1)}, ${hov.toFixed(1)}, gl_FragCoord.z, 1.0); }
    `,
    toneMapped: false,
  });
}

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/**
 * Takes over rendering: draws the scene, then a crisp screen-space outline
 * (~1.75 CSS px at any zoom) around selected meshes and a fainter one on hover.
 * Occluded parts are hidden because the mask is depth-tested against all meshes.
 */
export function SelectionOutline() {
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);

  const target = useMemo(
    () =>
      new THREE.WebGLRenderTarget(1, 1, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        type: THREE.FloatType,
        depthBuffer: true,
      }),
    [],
  );
  const mats = useMemo(
    () => ({
      other: maskMaterial(0, 0),
      sel: maskMaterial(1, 0),
      hov: maskMaterial(0, 1),
    }),
    [],
  );
  const overlay = useMemo(() => {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        mask: { value: target.texture },
        texel: { value: new THREE.Vector2() },
        radius: { value: 2 },
        selColor: { value: new THREE.Color("#6ee7c5") },
        hovColor: { value: new THREE.Color("#6ee7c5") },
      },
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
    return { scene, material, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) };
  }, [target]);

  useEffect(() => {
    const w = Math.round(size.width * dpr);
    const h = Math.round(size.height * dpr);
    target.setSize(w, h);
    overlay.material.uniforms.texel.value.set(1 / w, 1 / h);
    overlay.material.uniforms.radius.value = 1.75 * dpr;
  }, [size, dpr, target, overlay]);

  useEffect(() => () => target.dispose(), [target]);

  const clear = useMemo(() => new THREE.Color(), []);

  useFrame(({ scene, camera }) => {
    gl.autoClear = true;
    gl.render(scene, camera);

    const { selection, hoveredId } = useApp.getState();
    const meshes = useMeshObjects.getState().meshes;
    const hasHover = !!hoveredId && !selection.includes(hoveredId) && !!meshes[hoveredId];
    if (!selection.some((id) => meshes[id]) && !hasHover) return;

    // Mask pass: feature meshes only, others write depth so hidden parts stay hidden.
    const restore: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [];
    for (const [id, mesh] of Object.entries(meshes)) {
      restore.push([mesh, mesh.material]);
      mesh.material = selection.includes(id) ? mats.sel : id === hoveredId ? mats.hov : mats.other;
    }
    const prevMask = camera.layers.mask;
    const prevAlpha = gl.getClearAlpha();
    gl.getClearColor(clear);
    camera.layers.set(MASK_LAYER);
    const bg = scene.background;
    scene.background = null;
    gl.setRenderTarget(target);
    gl.setClearColor(0x000000, 0);
    gl.clear();
    gl.render(scene, camera);
    gl.setRenderTarget(null);
    scene.background = bg;
    gl.setClearColor(clear, prevAlpha);
    camera.layers.mask = prevMask;
    for (const [mesh, material] of restore) mesh.material = material;

    gl.autoClear = false;
    gl.render(overlay.scene, overlay.camera);
    gl.autoClear = true;
  }, 1);

  return null;
}

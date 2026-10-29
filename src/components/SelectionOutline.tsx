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

// The mask targets are multisampled, so after resolve each channel holds the pixel's
// coverage fraction (r sel, g hover, a any body) and b holds depth × coverage. That gives
// sub-pixel edge positions: the ring is anti-aliased on both sides and meets the
// (MSAA-smoothed) body edge without stair steps.
const fragment = /* glsl */ `
  uniform sampler2D mask;
  uniform sampler2D xray;
  uniform vec2 texel;
  uniform float radius;
  uniform vec3 selColor;
  uniform vec3 hovColor;
  varying vec2 vUv;
  bool insideHov(vec4 m) { return m.g > 0.98; }
  float depthOf(vec4 m) { return m.a > 0.001 ? m.b / m.a : 1.0; }
  void main() {
    vec4 c = texture2D(mask, vUv);   // depth-tested: r sel, g hover, b depth, a coverage
    vec4 cx = texture2D(xray, vUv);  // selected only, unoccluded
    float dSel = 100.0;
    float dHov = 100.0;
    float zSel = 1.0;
    float zHov = 1.0;
    float seen = 0.0;
    for (int x = -R; x <= R; x++) {
      for (int y = -R; y <= R; y++) {
        vec2 o = vec2(float(x), float(y));
        float d = length(o);
        if (d > radius + 1.5) continue;
        vec2 uv = vUv + o * texel;
        vec4 m = texture2D(mask, uv);
        vec4 mx = texture2D(xray, uv);
        // Approximate distance to the silhouette edge, shifted by the pixel's coverage.
        if (mx.r > 0.02) {
          float e = d + 0.5 - mx.r;
          if (e < dSel) { dSel = e; zSel = depthOf(mx); seen = m.r / mx.r; }
        }
        if (m.g > 0.02) {
          float e = d + 0.5 - m.g;
          if (e < dHov) { dHov = e; zHov = depthOf(m); }
        }
      }
    }
    // Full silhouette of the selection: solid where its edge is visible, dimmed where
    // it is hidden behind or inside another body; occluded areas get a faint ghost fill.
    float cover = cx.r;
    bool frontOfRing = c.a > 0.5 && depthOf(c) < zSel - 1e-5;
    float ring = clamp(radius - dSel, 0.0, 1.0) * (1.0 - cover);
    float aSel = ring * ((seen > 0.5 && !frontOfRing) ? 1.0 : 0.45);
    float ghost = cover > 0.5 && c.r < 0.5 * cover ? 0.1 * cover : 0.0;
    bool behindHov = c.a < 0.5 || depthOf(c) > zHov + 1e-5;
    // Hover: a bit thinner than the selection and ~65 % of its strength.
    float hr = max(radius * 0.8, 1.2);
    float aHov = (insideHov(c) || cover > 0.5 || !behindHov) ? 0.0 : clamp(hr - dHov, 0.0, 1.0) * (1.0 - c.g) * 0.65;
    float a = max(aSel, ghost);
    gl_FragColor = a > 0.002 ? vec4(selColor, a) : vec4(hovColor, aHov);
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

const box = new THREE.Box3();
const corner = new THREE.Vector3();

/** Screen rectangle (CSS px, bottom-left origin) covering the given meshes, padded for the ring. */
function screenRect(meshes: THREE.Mesh[], camera: THREE.Camera, gl: THREE.WebGLRenderer) {
  if (!meshes.length) return null;
  const size = gl.getSize(new THREE.Vector2());
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const m of meshes) {
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    box.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld);
    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera);
      // Behind the camera: fall back to the full screen.
      if (corner.z > 1) return null;
      minX = Math.min(minX, corner.x);
      maxX = Math.max(maxX, corner.x);
      minY = Math.min(minY, corner.y);
      maxY = Math.max(maxY, corner.y);
    }
  }
  const pad = 8;
  const x = Math.max(0, Math.floor(((minX + 1) / 2) * size.x) - pad);
  const y = Math.max(0, Math.floor(((minY + 1) / 2) * size.y) - pad);
  const w = Math.min(size.x, Math.ceil(((maxX + 1) / 2) * size.x) + pad) - x;
  const h = Math.min(size.y, Math.ceil(((maxY + 1) / 2) * size.y) + pad) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

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
        samples: 4,
      }),
    [],
  );
  const xrayTarget = useMemo(
    () =>
      new THREE.WebGLRenderTarget(1, 1, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        type: THREE.FloatType,
        depthBuffer: true,
        samples: 4,
      }),
    [],
  );
  const mats = useMemo(
    () => ({
      other: maskMaterial(0, 0),
      skip: new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false }),
      sel: maskMaterial(1, 0),
      hov: maskMaterial(0, 1),
    }),
    [],
  );
  const overlay = useMemo(() => {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        mask: { value: target.texture },
        xray: { value: xrayTarget.texture },
        texel: { value: new THREE.Vector2() },
        radius: { value: 2 },
        selColor: { value: new THREE.Color("#6ee7c5") },
        hovColor: { value: new THREE.Color("#6ee7c5") },
      },
      vertexShader: vertex,
      fragmentShader: fragment,
      defines: { R: 4 },
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
    xrayTarget.setSize(w, h);
    overlay.material.uniforms.texel.value.set(1 / w, 1 / h);
    overlay.material.uniforms.radius.value = 1.75 * dpr;
    // Loop bound = ring radius + 2 px (compile-time constant).
    overlay.material.defines.R = Math.ceil(1.75 * dpr) + 2;
    overlay.material.needsUpdate = true;
  }, [size, dpr, target, xrayTarget, overlay]);

  useEffect(() => () => {
    target.dispose();
    xrayTarget.dispose();
  }, [target, xrayTarget]);

  const clear = useMemo(() => new THREE.Color(), []);

  useFrame(({ scene, camera }) => {
    gl.autoClear = true;
    gl.render(scene, camera);

    const { selection, hoveredId, workspace } = useApp.getState();
    if (workspace === "preview") return; // pure render view
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
    // X-ray pass: selected bodies only, ignoring everything in front of them.
    for (const [id, mesh] of Object.entries(meshes)) mesh.material = selection.includes(id) ? mats.sel : mats.skip;
    gl.setRenderTarget(xrayTarget);
    gl.clear();
    gl.render(scene, camera);
    gl.setRenderTarget(null);
    scene.background = bg;
    gl.setClearColor(clear, prevAlpha);
    camera.layers.mask = prevMask;
    for (const [mesh, material] of restore) mesh.material = material;

    // Only shade the screen area around the selection/hover (plus the ring).
    const rect = screenRect(
      Object.entries(meshes).filter(([id]) => selection.includes(id) || id === hoveredId).map(([, m]) => m),
      camera,
      gl,
    );
    gl.autoClear = false;
    if (rect) {
      gl.setScissorTest(true);
      gl.setScissor(rect.x, rect.y, rect.w, rect.h);
    }
    gl.render(overlay.scene, overlay.camera);
    gl.setScissorTest(false);
    gl.autoClear = true;
  }, 1);

  return null;
}

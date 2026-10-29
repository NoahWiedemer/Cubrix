// Library thumbnails rendered from the real kernel meshes (default parameters),
// once per session, with one small shared offscreen renderer.
import * as THREE from "three";
import { getCommand } from "../core/commands";
import { getGeometry } from "../cad/kernel";
import type { Feature } from "../core/document";

const SIZE = 160;
let renderer: THREE.WebGLRenderer | null = null;
const cache = new Map<string, Promise<string>>();

/** Default-parameter feature for a primitive type (as the library would create it). */
export function defaultFeature(type: string): Feature {
  const cmd = getCommand(`primitive.${type}`)!;
  const params = Object.fromEntries(
    Object.entries(cmd.params)
      .filter(([, spec]) => "default" in spec && typeof spec.default === "number")
      .map(([k, spec]) => [k, (spec as { default: number }).default]),
  );
  return { id: `thumb-${type}`, name: type, type, visible: true, params, transform: { position: [0, 0, 0], rotation: [0, 0, 0] } } as Feature;
}

function render(geometry: THREE.BufferGeometry): string {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(SIZE, SIZE);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
  }
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight("#eef3f6", "#0a0c0e", 1.2));
  const key = new THREE.DirectionalLight("#ffffff", 2.2);
  key.position.set(3, 5, 4);
  scene.add(key);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: "#a9b2b9", roughness: 0.55, metalness: 0.05 }));
  // CAD frame is Z-up.
  const group = new THREE.Group();
  group.rotation.x = -Math.PI / 2;
  group.add(mesh);
  scene.add(group);
  const box = new THREE.Box3().setFromObject(group);
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 1000);
  const dir = new THREE.Vector3(1, 0.8, 1.2).normalize();
  camera.position.copy(center).addScaledVector(dir, radius / Math.sin(THREE.MathUtils.degToRad(15)) * 1.05);
  camera.lookAt(center);
  renderer.render(scene, camera);
  (mesh.material as THREE.Material).dispose();
  return renderer.domElement.toDataURL("image/png");
}

export function thumbnail(type: string): Promise<string> {
  let p = cache.get(type);
  if (!p) {
    p = getGeometry(defaultFeature(type)).then((e) => render(e.geometry));
    cache.set(type, p);
  }
  return p;
}

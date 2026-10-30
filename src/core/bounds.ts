import * as THREE from "three";
import { geometryKey, type Feature, type Transform } from "./document";
import type { GeometryEntry } from "../cad/kernel";

export function transformMatrix(t: Transform): THREE.Matrix4 {
  const d = THREE.MathUtils.degToRad;
  const q = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(d(t.rotation[0]), d(t.rotation[1]), d(t.rotation[2]), "XYZ"),
  );
  return new THREE.Matrix4().compose(new THREE.Vector3(...t.position), q, new THREE.Vector3(1, 1, 1));
}

/** `inner` expressed in the frame of `outer` applied on top (positions in mm, rotations in degrees). */
export function composeTransform(outer: Transform, inner: Transform): Transform {
  const m = transformMatrix(outer).multiply(transformMatrix(inner));
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  m.decompose(pos, quat, new THREE.Vector3());
  const e = new THREE.Euler().setFromQuaternion(quat, "XYZ");
  const r = (v: number) => Math.round(v * 1000) / 1000 + 0;
  const deg = (v: number) => r(THREE.MathUtils.radToDeg(v));
  return { position: [r(pos.x), r(pos.y), r(pos.z)], rotation: [deg(e.x), deg(e.y), deg(e.z)] };
}

/** Id of the virtual object that stands for a multi-selection (gizmo preview). */
export const SELECTION_ID = "__selection";

const boxCache = new WeakMap<GeometryEntry, Map<string, THREE.Box3>>();

/** Exact world-space bounding box of a feature (null while its mesh is still computing). */
export function worldBox(
  f: Feature,
  entries: Record<string, GeometryEntry>,
  transform: Transform = f.transform,
): THREE.Box3 | null {
  const entry = entries[geometryKey(f)];
  if (!entry) return null;
  const tKey = JSON.stringify(transform);
  let perEntry = boxCache.get(entry);
  if (!perEntry) boxCache.set(entry, (perEntry = new Map()));
  const hit = perEntry.get(tKey);
  if (hit) return hit;
  const m = transformMatrix(transform);
  const pos = entry.geometry.getAttribute("position");
  const v = new THREE.Vector3();
  const box = new THREE.Box3();
  for (let i = 0; i < pos.count; i++) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(m));
  if (perEntry.size > 32) perEntry.clear();
  perEntry.set(tKey, box);
  return box;
}

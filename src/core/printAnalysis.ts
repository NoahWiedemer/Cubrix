// Mesh-based print analysis: volume, overhang area, best orientation.
import * as THREE from "three";
import type { GeometryEntry } from "../cad/kernel";
import type { PrinterProfile, Transform, Vec3 } from "./document";
import { transformMatrix } from "./bounds";

/** "Manuell": free build volume (the default for new projects). */
export const MANUAL = "Manuell";

export const PRINTERS: PrinterProfile[] = [
  { name: "Bambu Lab A1 mini", volume: [180, 180, 180] },
  { name: "Bambu Lab A1", volume: [256, 256, 256] },
  { name: "Bambu Lab P1S / X1C", volume: [256, 256, 256] },
  { name: "Bambu Lab H2D", volume: [325, 320, 325] },
  { name: "Prusa MINI+", volume: [180, 180, 180] },
  { name: "Prusa MK4S", volume: [250, 210, 220] },
  { name: "Prusa CORE One", volume: [250, 220, 270] },
  { name: "Creality Ender 3 V3", volume: [220, 220, 250] },
  { name: "Creality K1", volume: [220, 220, 250] },
  { name: "Creality K1 Max", volume: [300, 300, 300] },
  { name: "Elegoo Neptune 4 Pro", volume: [225, 225, 265] },
  { name: "Anycubic Kobra 3", volume: [250, 250, 260] },
  { name: "Snapmaker Original", volume: [125, 125, 125] },
  { name: "Snapmaker A150", volume: [160, 160, 145] },
  { name: "Snapmaker A250", volume: [230, 250, 235] },
];

/** Enclosed volume in mm³ (signed tetrahedron sum; transform-invariant). */
export function meshVolume(entry: GeometryEntry): number {
  const pos = entry.geometry.getAttribute("position");
  const idx = entry.geometry.getIndex()!;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let v = 0;
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(pos, idx.getX(i));
    b.fromBufferAttribute(pos, idx.getX(i + 1));
    c.fromBufferAttribute(pos, idx.getX(i + 2));
    v += a.dot(b.clone().cross(c)) / 6;
  }
  return Math.abs(v);
}

/** Area (mm²) facing down steeper than 45° and not resting on the bed, for a rotation. */
export function overhangArea(entry: GeometryEntry, rotation: THREE.Quaternion): { overhang: number; contact: number; height: number } {
  const pos = entry.geometry.getAttribute("position");
  const idx = entry.geometry.getIndex()!;
  const pts: THREE.Vector3[] = [];
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const p = new THREE.Vector3().fromBufferAttribute(pos, i).applyQuaternion(rotation);
    pts.push(p);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  let overhang = 0, contact = 0;
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < idx.count; i += 3) {
    const a = pts[idx.getX(i)], b = pts[idx.getX(i + 1)], c = pts[idx.getX(i + 2)];
    n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
    const area = n.length() / 2;
    if (area === 0) continue;
    n.normalize();
    const low = Math.max(a.z, b.z, c.z) - minZ < 0.05;
    if (n.z < -0.999 && low) contact += area;
    else if (n.z < -Math.SQRT1_2) overhang += area;
  }
  return { overhang, contact, height: maxZ - minZ };
}

const CANDIDATES: Vec3[] = [
  [0, 0, 0], [90, 0, 0], [-90, 0, 0], [180, 0, 0], [0, 90, 0], [0, -90, 0],
];

/** Picks the axis-aligned orientation with the least overhang (then most bed contact, then lowest). */
export function bestOrientation(entry: GeometryEntry): Vec3 {
  let best = CANDIDATES[0];
  let bestScore = Infinity;
  for (const rot of CANDIDATES) {
    const q = new THREE.Quaternion().setFromRotationMatrix(transformMatrix({ position: [0, 0, 0], rotation: rot }));
    const r = overhangArea(entry, q);
    const score = r.overhang * 10 - r.contact * 2 + r.height;
    if (score < bestScore - 1e-6) {
      bestScore = score;
      best = rot;
    }
  }
  return best;
}

export function rotationOf(t: Transform) {
  return new THREE.Quaternion().setFromRotationMatrix(transformMatrix({ position: [0, 0, 0], rotation: t.rotation }));
}

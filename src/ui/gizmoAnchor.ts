// Where the transform gizmo sits on a body. Pure, and deliberately independent of the
// camera: orbiting, panning or zooming never moves the handles.
import * as THREE from "three";

/** Bodies whose gizmo anchors at the bottom centre instead of a corner. */
const ROUND = new Set(["cylinder", "sphere", "torus", "cone", "tube", "hemisphere"]);

/**
 * Move handles: the min-x/min-y bottom corner of the bounding box (CAD frame, Z up);
 * round bodies use the bottom centre. Rotate handles stay at the centre.
 */
export function gizmoAnchor(box: THREE.Box3, type: string, mode: "move" | "rotate"): THREE.Vector3 {
  const c = box.getCenter(new THREE.Vector3());
  if (mode === "rotate") return c;
  if (ROUND.has(type)) return new THREE.Vector3(c.x, c.y, box.min.z);
  return new THREE.Vector3(box.min.x, box.min.y, box.min.z);
}

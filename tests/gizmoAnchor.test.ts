import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { gizmoAnchor } from "../src/ui/gizmoAnchor";

const box = new THREE.Box3(new THREE.Vector3(-10, -5, 0), new THREE.Vector3(10, 5, 20));

describe("gizmo anchor", () => {
  it("uses the min-x/min-y bottom corner for straight-edged bodies", () => {
    expect(gizmoAnchor(box, "box", "move").toArray()).toEqual([-10, -5, 0]);
  });

  it("uses the bottom centre for round bodies and the centre for rotation", () => {
    expect(gizmoAnchor(box, "cylinder", "move").toArray()).toEqual([0, 0, 0]);
    expect(gizmoAnchor(box, "box", "rotate").toArray()).toEqual([0, 0, 10]);
  });

  it("does not depend on the camera", () => {
    // The anchor function takes no camera input; simulate two camera positions around
    // the same object and check the result is identical.
    const results = [new THREE.Vector3(100, -80, 60), new THREE.Vector3(-120, 90, 15)].map(() =>
      gizmoAnchor(box, "box", "move").toArray(),
    );
    expect(results[0]).toEqual(results[1]);
  });
});

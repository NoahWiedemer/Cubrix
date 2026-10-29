import { describe, expect, it } from "vitest";
import { scaleFeature } from "../src/core/scale";
import type { Feature } from "../src/core/document";

const box = { id: "b", name: "Q", type: "box", visible: true, params: { width: 20, depth: 10, height: 30 }, transform: { position: [10, 5, 0], rotation: [0, 0, 0] } } as Feature;

describe("Skalieren", () => {
  it("backt den Faktor in die Maße und hält die Ankerecke fest", () => {
    // Anchor = min-x/min-y bottom corner of the box: (0, 0, 0).
    const s = scaleFeature(box, [2, 1, 0.5], [0, 0, 0]);
    expect(s.type === "box" && s.params).toEqual({ width: 40, depth: 10, height: 15 });
    // Centre of the base moves from x=10 to x=20, so the min-x edge stays at 0.
    expect(s.transform.position).toEqual([20, 5, 0]);
  });

  it("skaliert runde Körper radial mit dem Mittel aus X und Y", () => {
    const cyl = { ...box, type: "cylinder", params: { diameter: 20, height: 10 } } as Feature;
    const s = scaleFeature(cyl, [1.5, 1.5, 2], [10, 5, 0]);
    expect(s.type === "cylinder" && s.params).toEqual({ diameter: 30, height: 20 });
    expect(s.transform.position).toEqual([10, 5, 0]);
  });

  it("skaliert Boolean-Kinder samt Position", () => {
    const b = { ...box, type: "boolean", op: "union", transform: { position: [0, 0, 0], rotation: [0, 0, 0] }, children: [box, { ...box, transform: { position: [0, 0, 10], rotation: [0, 0, 0] } }] } as Feature;
    const s = scaleFeature(b, [1, 1, 2], [0, 0, 0]);
    if (s.type !== "boolean") throw new Error();
    expect(s.children[1].transform.position).toEqual([0, 0, 20]);
    expect(s.children[1].type === "box" && s.children[1].params.height).toBe(60);
  });
});

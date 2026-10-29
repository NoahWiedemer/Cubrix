import { beforeAll, describe, expect, it } from "vitest";
import opencascade from "replicad-opencascadejs";
import { measureVolume, setOC } from "replicad";
import { buildPlaced } from "../src/cad/build";
import { scaleFeature } from "../src/core/scale";
import type { BooleanOp, Feature, Vec3 } from "../src/core/document";

beforeAll(async () => {
  setOC((await (opencascade as unknown as () => Promise<unknown>)()) as Parameters<typeof setOC>[0]);
}, 60_000);

const T = (position: Vec3, rotation: Vec3 = [0, 0, 0]) => ({ position, rotation });
const box = (pos: Vec3, rot: Vec3 = [0, 0, 0]): Feature => ({ id: "b", name: "Q", type: "box", visible: true, params: { width: 20, depth: 14, height: 10 }, transform: T(pos, rot) });
const cyl = (pos: Vec3): Feature => ({ id: "c", name: "Z", type: "cylinder", visible: true, params: { diameter: 16, height: 18 }, transform: T(pos) });
const bool = (op: BooleanOp, a: Feature, b: Feature, pos: Vec3 = [5, -3, 2]): Feature => ({ id: "x", name: "B", type: "boolean", op, visible: true, transform: T(pos), children: [a, b] });

/** Scales by k around the min corner of the result's bounding box and compares. */
function check(f: Feature, k = 1.5) {
  const before = buildPlaced(f);
  const bb = before.boundingBox;
  const anchor = bb.bounds[0] as Vec3;
  const after = buildPlaced(scaleFeature(f, [k, k, k], anchor));
  const ab = after.boundingBox;
  for (let i = 0; i < 3; i++) {
    expect(ab.bounds[0][i]).toBeCloseTo(bb.bounds[0][i], 2); // anchor stays
    expect(ab.bounds[1][i] - ab.bounds[0][i]).toBeCloseTo((bb.bounds[1][i] - bb.bounds[0][i]) * k, 2);
  }
  expect(measureVolume(after) / measureVolume(before)).toBeCloseTo(k ** 3, 2);
}

describe("Skalieren von Boolean-Körpern", () => {
  it("Schnittmenge zweier versetzter Körper", () => check(bool("intersect", box([0, 0, 0]), cyl([6, 4, -3]))));
  it("Vereinigung", () => check(bool("union", box([0, 0, 0]), cyl([12, 6, 4]))));
  it("Differenz", () => check(bool("subtract", box([0, 0, 0]), cyl([4, 2, 3]))));
  it("Verschachtelt mit gedrehtem Teil", () =>
    check(bool("union", bool("subtract", box([0, 0, 0], [0, 0, 30]), cyl([3, 1, 2])), box([15, 5, 6], [20, 0, 45]))));
});

describe("Nicht-proportional auf Boolean", () => {
  it("wird proportional mit dem gezogenen Faktor ausgeführt", () => {
    const f = bool("intersect", box([0, 0, 0]), cyl([6, 4, -3]));
    const before = buildPlaced(f);
    const after = buildPlaced(scaleFeature(f, [1.5, 1, 1], before.boundingBox.bounds[0] as Vec3));
    expect(measureVolume(after) / measureVolume(before)).toBeCloseTo(1.5 ** 3, 2);
  });
});

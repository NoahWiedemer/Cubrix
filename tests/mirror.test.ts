import { beforeAll, describe, expect, it } from "vitest";
import opencascade from "replicad-opencascadejs";
import { measureVolume, setOC } from "replicad";
import { buildLocal } from "../src/cad/build";
import type { Feature } from "../src/core/document";

beforeAll(async () => {
  setOC((await (opencascade as unknown as () => Promise<unknown>)()) as Parameters<typeof setOC>[0]);
}, 60_000);

const wedge = (mirror?: "x" | "y"): Feature =>
  ({ id: "w", name: "Keil", type: "wedge", visible: true, params: { width: 30, depth: 20, height: 20 }, transform: { position: [0, 0, 0], rotation: [0, 0, 0] }, ...(mirror ? { mirror } : {}) }) as Feature;

/** Height of the solid near the left (−X) and right (+X) end. */
function heights(f: Feature) {
  const s = buildLocal(f);
  const top = (x: number) => {
    const slab = s.intersect(buildLocal({ ...wedge(), id: "c", type: "box", params: { width: 2, depth: 40, height: 40 }, transform: { position: [x, 0, 0], rotation: [0, 0, 0] } } as Feature).translate(x, 0, 0));
    return slab.boundingBox.bounds[1][2];
  };
  return { v: measureVolume(s), left: top(-13), right: top(13) };
}

describe("Spiegeln", () => {
  it("spiegelt die Geometrie (Keil hoch links → hoch rechts), Volumen gleich", () => {
    const a = heights(wedge());
    const b = heights(wedge("x"));
    expect(b.v).toBeCloseTo(a.v, 3);
    expect(a.left).toBeGreaterThan(a.right);
    expect(b.right).toBeGreaterThan(b.left);
  });
});

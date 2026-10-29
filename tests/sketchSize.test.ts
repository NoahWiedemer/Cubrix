import { describe, expect, it } from "vitest";
import { getCommand, type DocumentCommand } from "../src/core/commands";
import "../src/core/commandDefs";
import { createDocument, type Feature, type ModelDocument } from "../src/core/document";
import { profileBounds } from "../src/core/scale";

const sketch: Feature = {
  id: "s",
  name: "Skizze 1",
  type: "sketch",
  visible: true,
  transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
  shapes: [{ kind: "rect", x: -10, y: -5, w: 20, h: 10 }, { kind: "circle", cx: 0, cy: 0, r: 2 }],
};
const run = (doc: ModelDocument, params: Record<string, unknown>) =>
  (getCommand("shape.setSize") as DocumentCommand).apply(doc, { id: "s", ...params }, { doc, selection: ["s"], source: "user" })!.doc;

describe("Skizze: Breite, Tiefe, Höhe", () => {
  const doc0 = { ...createDocument("T", { starter: false }), features: [sketch] };

  it("Höhe > 0 zieht in 3D, 0 macht wieder flach (gleiches Objekt)", () => {
    const up = run(doc0, { height: 8 });
    expect(up.features[0]).toMatchObject({ id: "s", type: "extrude", height: 8 });
    const flat = run(up, { height: 0 });
    expect(flat.features[0]).toMatchObject({ id: "s", type: "sketch" });
  });

  it("Breite und Tiefe bleiben jederzeit änderbar, auch mehrfach", () => {
    let d = run(doc0, { width: 40 });
    d = run(d, { height: 5 });
    d = run(d, { depth: 30 });
    d = run(d, { width: 25 });
    const f = d.features[0];
    if (f.type !== "extrude") throw new Error("expected extrude");
    const b = profileBounds(f.profile)!;
    expect(b.maxX - b.minX).toBeCloseTo(25, 5);
    expect(b.maxY - b.minY).toBeCloseTo(30, 5);
    expect((b.minX + b.maxX) / 2).toBeCloseTo(0, 5); // centre kept
  });
});

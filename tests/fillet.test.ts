import { beforeAll, describe, expect, it } from "vitest";
import opencascade from "replicad-opencascadejs";
import { measureVolume, setOC } from "replicad";
import { buildLocal, EdgeTreatmentError } from "../src/cad/build";
import { getCommand } from "../src/core/commands";
import type { Feature } from "../src/core/document";
import "../src/core/commandDefs";
import { createDocument } from "../src/core/document";

beforeAll(async () => {
  setOC((await (opencascade as unknown as () => Promise<unknown>)()) as Parameters<typeof setOC>[0]);
}, 60_000);

const T = { position: [0, 0, 0], rotation: [0, 0, 0] } as Feature["transform"];
const box = (extra: Partial<Feature> = {}) =>
  ({ id: "b", name: "Quader", type: "box", visible: true, transform: T, params: { width: 20, depth: 20, height: 20 }, ...extra }) as Feature;
const cyl = (extra: Partial<Feature> = {}) =>
  ({ id: "c", name: "Zylinder", type: "cylinder", visible: true, transform: T, params: { diameter: 20, height: 20 }, ...extra }) as Feature;

describe("Kanten abrunden / fasen (Kernel)", () => {
  it("rundet einen Quader ab", () => {
    expect(buildLocal(box()).faces.length).toBe(6);
    expect(buildLocal(box({ fillet: 2 })).faces.length).toBe(26); // 6 + 12 edge + 8 corner faces
  });
  it("rundet einen Zylinder ab", () => {
    expect(buildLocal(cyl({ fillet: 2 })).faces.length).toBeGreaterThan(buildLocal(cyl()).faces.length);
  });
  it("fast einen Quader", () => {
    expect(buildLocal(box({ chamfer: 2 })).faces.length).toBe(26);
  });
  it("rundet ein Boolean-Ergebnis ab", () => {
    const f = {
      id: "x", name: "Platte", type: "boolean", op: "subtract", visible: true, transform: T, fillet: 1,
      children: [box(), { ...cyl({ params: { diameter: 6, height: 30 } }), transform: { position: [0, 0, -5], rotation: [0, 0, 0] } }],
    } as Feature;
    expect(buildLocal(f).faces.length).toBeGreaterThan(10);
  });
  it("meldet zu große Radien verständlich", () => {
    expect(() => buildLocal(box({ fillet: 15 }))).toThrow(EdgeTreatmentError);
    expect(() => buildLocal(box({ fillet: 15 }))).toThrow(/zu groß/);
  });
  it("meldet Kugeln ohne Kanten", () => {
    const sphere = { id: "s", name: "Kugel", type: "sphere", visible: true, transform: T, params: { diameter: 20 }, fillet: 2 } as Feature;
    expect(() => buildLocal(sphere)).toThrow(/keine Kanten/);
  });
});

describe("object.fillet (Befehl)", () => {
  const cmd = getCommand("object.fillet")!;
  if (cmd.kind !== "document") throw new Error("expected document command");
  it("setzt den Radius und behält eine vorhandene Fase", () => {
    const doc = createDocument();
    const id = doc.features[0].id;
    doc.features[0] = { ...doc.features[0], chamfer: 1 };
    const res = cmd.apply(doc, { id, radius: 3 }, { doc, selection: [id], source: "user" })!;
    expect(res.doc.features[0]).toMatchObject({ fillet: 3, chamfer: 1 });
  });
  it("lehnt zu große Radien mit klarer Meldung ab", () => {
    const doc = createDocument();
    const id = doc.features[0].id;
    expect(() => cmd.apply(doc, { id, radius: 10 }, { doc, selection: [id], source: "user" })).toThrow(/zu groß/);
  });
});

describe("Fase und Abrundung kombiniert", () => {
  it("Quader mit Fase 1 mm und Abrundung 0,5 mm", () => {
    const plain = buildLocal(box());
    const chamfered = buildLocal(box({ chamfer: 1 }));
    const both = buildLocal(box({ chamfer: 1, fillet: 0.5 }));
    // Outer size unchanged, both passes remove material, the fillet adds faces.
    expect(both.boundingBox.width).toBeCloseTo(20, 3);
    expect(measureVolume(both)).toBeLessThan(measureVolume(chamfered));
    expect(measureVolume(chamfered)).toBeLessThan(measureVolume(plain));
    expect(both.faces.length).toBeGreaterThan(chamfered.faces.length);
  });
  it("Befehle ändern nur ihren eigenen Wert", () => {
    const doc = { ...createDocument("T", { starter: false }), features: [box()] };
    const ctx = { doc, selection: ["b"], source: "user" as const };
    const a = getCommand("object.chamfer")!;
    const r1 = (a as any).apply(doc, { id: "b", radius: 1 }, ctx);
    const r2 = (getCommand("object.fillet") as any).apply(r1.doc, { id: "b", radius: 0.5 }, { ...ctx, doc: r1.doc });
    expect(r2.doc.features[0]).toMatchObject({ chamfer: 1, fillet: 0.5 });
  });
});

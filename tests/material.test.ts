import { describe, expect, it } from "vitest";
import { getCommand, type DocumentCommand } from "../src/core/commands";
import "../src/core/commandDefs";
import { createDocument, geometryKey, type ModelDocument } from "../src/core/document";
import { MATERIALS, materialOf } from "../src/core/materials";
import { parseProject } from "../src/core/projectFile";

const ctx = (doc: ModelDocument, selection: string[]) => ({ doc, selection, source: "user" as const });
const setMaterial = getCommand("object.setMaterial") as DocumentCommand;

describe("Aussehen / Material", () => {
  it("setzt das Material für mehrere Objekte in einem Schritt", () => {
    const d0 = createDocument("T");
    const d1 = (getCommand("primitive.box") as DocumentCommand).apply(d0, { position: [40, 0, 0] }, ctx(d0, []))!.doc;
    const ids = d1.features.map((f) => f.id);
    const r = setMaterial.apply(d1, { ids, material: "silk" }, ctx(d1, []))!;
    expect(r.doc.features.map((f) => f.material)).toEqual(["silk", "silk"]);
    expect(r.label).toBe("2 Objekte: Seide");
    expect(setMaterial.apply(r.doc, { ids, material: "silk" }, ctx(r.doc, []))).toBeNull();
    // Matt is the default and is not stored.
    expect(setMaterial.apply(r.doc, { ids: [ids[0]], material: "matte" }, ctx(r.doc, []))!.doc.features[0].material).toBeUndefined();
  });
  it("ändert die Geometrie nicht (kein Neuberechnen)", () => {
    const d = createDocument("T");
    const r = setMaterial.apply(d, { material: "metal" }, ctx(d, [d.features[0].id]))!;
    expect(geometryKey(r.doc.features[0])).toBe(geometryKey(d.features[0]));
  });
  it("lehnt unbekannte Materialien ab und kennt alle Presets", () => {
    const d = createDocument("T");
    expect(() => setMaterial.apply(d, { material: "gold" }, ctx(d, [d.features[0].id]))).toThrow(/Unbekanntes Material/);
    expect(MATERIALS.map((m) => m.id)).toEqual(["matte", "glossy", "metal", "silk", "clear", "wood"]);
    expect(materialOf(undefined).id).toBe("matte");
    expect(materialOf("clear").opacity).toBeLessThan(1);
  });
  it("wird im Projekt gespeichert", () => {
    const d = createDocument("T");
    const r = setMaterial.apply(d, { material: "wood" }, ctx(d, [d.features[0].id]))!;
    // A bare document parses as a project too (v1); the material survives the round trip.
    const back = parseProject(JSON.stringify(r.doc)).file.document;
    expect(back.features[0].material).toBe("wood");
  });
});

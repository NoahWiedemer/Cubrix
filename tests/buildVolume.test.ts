import { describe, expect, it } from "vitest";
import { getCommand, type DocumentCommand } from "../src/core/commands";
import "../src/core/commandDefs";
import { createDocument, type ModelDocument } from "../src/core/document";
import { volumeEdges } from "../src/ui/buildVolume";

const setPrinter = (doc: ModelDocument, params: Record<string, unknown>) =>
  (getCommand("printer.set") as DocumentCommand).apply(doc, params, { doc, selection: [], source: "user" })?.doc ?? doc;

/** Every edge of the wireframe lies on the box given by the document's printer volume. */
function expectMatches(doc: ModelDocument) {
  const [w, d, h] = doc.printer.volume;
  for (const e of volumeEdges(w, d, h))
    for (const p of [e.a, e.b]) {
      expect(Math.abs(Math.abs(p[0]) - w / 2)).toBeLessThan(1e-9);
      expect(Math.abs(Math.abs(p[2]) - d / 2)).toBeLessThan(1e-9);
      expect([0, h]).toContain(p[1]);
    }
}

describe("Bauraum-Drahtgitter folgt dem Drucker", () => {
  it("Preset → manuell geändert → Preset", () => {
    let doc = createDocument("T", { starter: false });
    doc = setPrinter(doc, { name: "Bambu Lab A1 mini" });
    expectMatches(doc);
    doc = setPrinter(doc, { name: "Manuell", volume: [300, 150, 90] });
    expect(doc.printer).toEqual({ name: "Manuell", volume: [300, 150, 90] });
    expectMatches(doc);
    doc = setPrinter(doc, { name: "Prusa MK4S" });
    expect(doc.printer.volume).toEqual([250, 210, 220]);
    expectMatches(doc);
  });
});

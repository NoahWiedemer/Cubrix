import { describe, expect, it } from "vitest";
import { getCommand, type ActionCommand, type DocumentCommand } from "../src/core/commands";
import "../src/core/commandDefs";
import { createDocument, type ModelDocument } from "../src/core/document";

const ctx = (doc: ModelDocument, selection: string[]) => ({ doc, selection, source: "user" as const });

describe("Kopieren / Einfügen", () => {
  it("fügt bei jedem Einfügen 10 mm weiter versetzt ein, mit neuen IDs", async () => {
    const doc = createDocument("T");
    const id = doc.features[0].id;
    await (getCommand("edit.copy") as ActionCommand).perform({}, ctx(doc, [id]));
    const paste = getCommand("edit.paste") as DocumentCommand;
    const d1 = paste.apply(doc, {}, ctx(doc, []))!.doc;
    const d2 = paste.apply(d1, {}, ctx(d1, []))!.doc;
    expect(d2.features).toHaveLength(3);
    expect(d2.features[1].transform.position).toEqual([10, 10, 0]);
    expect(d2.features[2].transform.position).toEqual([20, 20, 0]);
    expect(new Set(d2.features.map((f) => f.id)).size).toBe(3);
  });

  it("Ausschneiden + Einfügen legt das Objekt wieder an dieselbe Stelle", () => {
    const doc = createDocument("T");
    const id = doc.features[0].id;
    const cut = (getCommand("edit.cut") as DocumentCommand).apply(doc, {}, ctx(doc, [id]))!.doc;
    expect(cut.features).toHaveLength(0);
    const back = (getCommand("edit.paste") as DocumentCommand).apply(cut, {}, ctx(cut, []))!.doc;
    expect(back.features[0].transform.position).toEqual([0, 0, 0]);
  });
});

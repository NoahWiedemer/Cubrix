import { beforeAll, describe, expect, it } from "vitest";
import opencascade from "replicad-opencascadejs";
import { setOC } from "replicad";
import { buildLocal } from "../src/cad/build";
import { getCommand, type DocumentCommand } from "../src/core/commands";
import "../src/core/commandDefs";
import { createDocument, findFeature, groupsOf, type ModelDocument } from "../src/core/document";

beforeAll(async () => {
  setOC((await (opencascade as unknown as () => Promise<unknown>)()) as Parameters<typeof setOC>[0]);
}, 60_000);

const ctx = (doc: ModelDocument, selection: string[] = []) => ({ doc, selection, source: "user" as const });
const run = (id: string, doc: ModelDocument, p: Record<string, unknown>, sel: string[] = []) => (getCommand(id) as DocumentCommand).apply(doc, p, ctx(doc, sel))!;

function threeBoxes() {
  let d = createDocument("T");
  d = run("primitive.box", d, { width: 20, depth: 20, height: 20, position: [40, 0, 0] }).doc;
  d = run("primitive.cylinder", d, { diameter: 20, height: 20, position: [-40, 0, 0] }).doc;
  return d;
}

describe("Gruppen", () => {
  it("gruppiert Objekte an Ort und Stelle und benennt die Gruppe", () => {
    const d = threeBoxes();
    const [a, b, c] = d.features.map((f) => f.id);
    const r = run("group.create", d, { memberIds: [b, c], name: "Halter" });
    expect(r.doc.features.map((f) => f.type)).toEqual(["box", "group"]);
    const g = r.doc.features[1];
    expect(g.name).toBe("Halter");
    expect(r.selection).toEqual([g.id]);
    expect(groupsOf(r.doc, c).map((x) => x.name)).toEqual(["Halter"]);
    expect(findFeature(r.doc, c)?.transform.position).toEqual([-40, 0, 0]);
    expect(a).toBeTruthy();
  });
  it("hebt die Gruppierung auf und behält die Lage (auch nach dem Verschieben der Gruppe)", () => {
    const d = threeBoxes();
    const ids = d.features.map((f) => f.id);
    let r = run("group.create", d, {}, ids.slice(1));
    const gid = r.selection![0];
    r = run("object.move", r.doc, { ids: [gid], delta: [0, 10, 5] });
    const back = run("group.ungroup", r.doc, { id: gid });
    expect(back.doc.features.map((f) => f.transform.position)).toEqual([[0, 0, 0], [40, 10, 5], [-40, 10, 5]]);
  });
  it("Gruppen lassen sich verschachteln, löschen und mit createMany anlegen", () => {
    const d = threeBoxes();
    const ids = d.features.map((f) => f.id);
    const inner = run("group.create", d, { memberIds: ids.slice(0, 2), name: "Innen" });
    const outer = run("group.create", inner.doc, { memberIds: [inner.selection![0], ids[2]], name: "Außen" });
    expect(outer.doc.features).toHaveLength(1);
    expect(groupsOf(outer.doc, ids[0]).map((g) => g.name)).toEqual(["Außen", "Innen"]);
    const del = run("object.delete", outer.doc, { ids: [ids[0], ids[1]] });
    // The emptied inner group disappears.
    expect(groupsOf(del.doc, ids[2]).map((g) => g.name)).toEqual(["Außen"]);
    expect(findFeature(del.doc, inner.selection![0])).toBeUndefined();
    const many = run("shapes.createMany", createDocument("T"), { shapes: [{ type: "box", position: [0, 0, 0] }, { type: "sphere", position: [20, 0, 0] }], groupName: "ESP32 DevKit" });
    const g = many.doc.features.find((f) => f.type === "group")!;
    expect(g.name).toBe("ESP32 DevKit");
    expect(g.type === "group" && g.children.length).toBe(2);
  });
  it("baut eine Gruppe als ein Teil aus ihren Mitgliedern (für Export und Maße)", () => {
    const d = threeBoxes();
    const r = run("group.create", d, {}, d.features.map((f) => f.id));
    const s = buildLocal(r.doc.features[0]);
    const [[x0], [x1]] = s.boundingBox.bounds;
    expect(Math.round(x1 - x0)).toBe(100);
  });
  it("Bestandteile eines Verbunds lassen sich nicht gruppieren", () => {
    const d = threeBoxes();
    const ids = d.features.map((f) => f.id);
    const b = run("boolean.subtract", d, { targetId: ids[0], toolIds: [ids[1]] });
    expect(() => run("group.create", b.doc, { memberIds: [ids[0], ids[1]] })).toThrow(/Verbund/);
  });
});

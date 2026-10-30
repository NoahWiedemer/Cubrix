import { describe, expect, it } from "vitest";
import { getCommand, type DocumentCommand } from "../src/core/commands";
import "../src/core/commandDefs";
import { createDocument, findFeature, groupsOf, type Feature, type GroupFeature, type ModelDocument } from "../src/core/document";
import { worldTransform } from "../src/core/bounds";
import { dropWhere, rangeRows, stepRow, visibleRows } from "../src/ui/treeNav";

const ctx = (doc: ModelDocument, selection: string[] = []) => ({ doc, selection, source: "user" as const });
const run = (id: string, doc: ModelDocument, p: Record<string, unknown>, sel: string[] = []) => (getCommand(id) as DocumentCommand).apply(doc, p, ctx(doc, sel))!;
const T = (x: number) => ({ position: [x, 0, 0], rotation: [0, 0, 0] }) as Feature["transform"];
const box = (id: string, x: number) => ({ id, name: id, type: "box", visible: true, transform: T(x), params: { width: 10, depth: 10, height: 10 } }) as Feature;
const group = (id: string, children: Feature[], x = 0) => ({ id, name: id, type: "group", visible: true, transform: T(x), children }) as GroupFeature;
const doc = (...features: Feature[]) => ({ ...createDocument("T"), features }) as ModelDocument;

describe("Objektliste per Tastatur", () => {
  const d = doc(box("a", 0), group("g", [box("b", 0), box("c", 0)]), box("d", 0));
  it("zeigt nur aufgeklappte Kinder und läuft Zeile für Zeile", () => {
    expect(visibleRows(d.features, () => false).map((r) => r.id)).toEqual(["a", "g", "d"]);
    const rows = visibleRows(d.features, (id) => id === "g");
    expect(rows.map((r) => r.id)).toEqual(["a", "g", "b", "c", "d"]);
    expect(stepRow(rows, "g", 1)).toBe("b");
    expect(stepRow(rows, "a", -1)).toBe("a");
    expect(stepRow(rows, undefined, 1)).toBe("a");
    expect(stepRow(rows, undefined, -1)).toBe("d");
    expect(rangeRows(rows, "c", "a")).toEqual(["a", "g", "b", "c"]);
  });
  it("Drop: Mitte einer Gruppe heißt hinein", () => {
    expect(dropWhere(0.5, true)).toBe("into");
    expect(dropWhere(0.1, true)).toBe("before");
    expect(dropWhere(0.5, false)).toBe("after");
  });
});

describe("In und aus Gruppen ziehen", () => {
  it("behält die Lage im Raum, auch bei verschobener Gruppe", () => {
    const d = doc(box("a", 5), group("g", [box("b", 1), box("c", 2)], 100));
    const inside = run("group.move", d, { ids: ["a"], groupId: "g" }).doc;
    const a = findFeature(inside, "a")!;
    expect(a.transform.position).toEqual([-95, 0, 0]);
    expect(worldTransform(groupsOf(inside, "a").map((g) => g.transform), a.transform).position).toEqual([5, 0, 0]);
    const out = run("group.move", inside, { ids: ["b"], groupId: "" }).doc;
    expect(findFeature(out, "b")!.transform.position).toEqual([101, 0, 0]);
    expect(groupsOf(out, "b")).toEqual([]);
  });
  it("sortiert um, löst leere Gruppen auf und verhindert Zyklen", () => {
    const d = doc(box("a", 0), group("g", [box("b", 0)]), box("c", 0));
    expect(run("group.move", d, { ids: ["c"], groupId: "", index: 0 }).doc.features.map((f) => f.id)).toEqual(["c", "a", "g"]);
    expect(run("group.move", d, { ids: ["b"], groupId: "" }).doc.features.map((f) => f.id)).toEqual(["a", "c", "b"]);
    const nested = doc(group("o", [group("i", [box("x", 0)])]));
    expect(() => run("group.move", nested, { ids: ["o"], groupId: "i" })).toThrow(/in sich selbst/);
  });
});

describe("Befehle auf Gruppenmitgliedern", () => {
  it("verschieben, löschen und duplizieren wirken in der Gruppe", () => {
    const d = doc(group("g", [box("b", 1), box("c", 2)]));
    expect(findFeature(run("object.move", d, { ids: ["b"], delta: [1, 0, 0] }).doc, "b")!.transform.position[0]).toBe(2);
    const dup = run("object.duplicate", d, { ids: ["b"] }).doc;
    expect((dup.features[0] as GroupFeature).children).toHaveLength(3);
  });
  it("die gemeinsame Bewegung rechnet in den Rahmen der Gruppe um", () => {
    const d = doc(group("g", [box("b", 1)], 100));
    const r = run("objects.transformBy", d, { ids: ["b"], position: [0, 0, 7] });
    expect(findFeature(r.doc, "b")!.transform.position).toEqual([1, 0, 7]);
  });
});

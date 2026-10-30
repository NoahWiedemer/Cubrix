import { beforeAll, describe, expect, it } from "vitest";
import opencascade from "replicad-opencascadejs";
import { measureVolume, setOC } from "replicad";
import { buildLocal, largestEdge, listEdges } from "../src/cad/build";
import { getCommand, type DocumentCommand } from "../src/core/commands";
import "../src/core/commandDefs";
import { createDocument, geometryKey, type EdgeOp, type Feature, type ModelDocument } from "../src/core/document";

beforeAll(async () => {
  setOC((await (opencascade as unknown as () => Promise<unknown>)()) as Parameters<typeof setOC>[0]);
}, 60_000);

const T = { position: [0, 0, 0], rotation: [0, 0, 0] } as Feature["transform"];
const box = (extra: Partial<Feature> = {}) =>
  ({ id: "b", name: "Quader", type: "box", visible: true, transform: T, params: { width: 40, depth: 30, height: 20 }, ...extra }) as Feature;
const full = 40 * 30 * 20;
const ops = (...o: EdgeOp[]) => ({ edgeOps: o }) as Partial<Feature>;

describe("Einzelne Kanten", () => {
  it("listet die Kanten eines Quaders mit stabilen Referenzen", () => {
    const edges = listEdges(box());
    expect(edges).toHaveLength(12);
    expect(edges.every((e) => e.ref.mid.every((v) => v >= 0 && v <= 1))).toBe(true);
    expect(edges[0].points.length).toBeGreaterThanOrEqual(2);
  });
  it("rundet per Filter nur die oberen oder senkrechten Kanten", () => {
    const top = buildLocal(box(ops({ kind: "fillet", size: 3, filter: "top" })));
    expect(top.faces.length).toBe(6 + 4);
    const vert = buildLocal(box(ops({ kind: "chamfer", size: 3, filter: "vertical" })));
    expect(vert.faces.length).toBe(10);
    expect(measureVolume(vert)).toBeCloseTo(full - 4 * (0.5 * 3 * 3) * 20, 0);
  });
  it("wirkt mit gewählten Kanten nur dort und übersteht eine Größenänderung", () => {
    const edge = listEdges(box()).find((e) => Math.abs(e.ref.dir[2]) > 0.9)!;
    const op: EdgeOp = { kind: "chamfer", size: 2, refs: [edge.ref] };
    expect(measureVolume(buildLocal(box(ops(op))))).toBeCloseTo(full - 0.5 * 2 * 2 * 20, 0);
    const bigger = box({ params: { width: 80, depth: 30, height: 20 }, ...ops(op) } as Partial<Feature>);
    expect(measureVolume(buildLocal(bigger))).toBeCloseTo(80 * 30 * 20 - 0.5 * 2 * 2 * 20, 0);
  });
  it("Schritte bauen aufeinander auf und wirken mit dem Aushöhlen zusammen", () => {
    const s = buildLocal(box({ ...ops({ kind: "fillet", size: 5, filter: "vertical" }, { kind: "fillet", size: 3, filter: "top" }), shell: { thickness: 2, open: "top" } }));
    expect(measureVolume(s)).toBeGreaterThan(0);
    expect(measureVolume(s)).toBeLessThan(full / 2);
  });
  it("begrenzt auf den größten baubaren Wert", () => {
    const op: EdgeOp = { kind: "fillet", size: 1, filter: "top" };
    const max = largestEdge(box({ params: { width: 40, depth: 30, height: 4 } } as Partial<Feature>), "fillet", 30, op);
    expect(max).toBeGreaterThan(3);
    expect(max).toBeLessThanOrEqual(4);
  });
  it("Befehle: Schritt anfügen und entfernen, Geometrie-Schlüssel ändert sich", () => {
    const d = { ...createDocument("T"), features: [box()] } as ModelDocument;
    const c = (doc: ModelDocument) => ({ doc, selection: ["b"], source: "user" as const });
    const a = (getCommand("edges.fillet") as DocumentCommand).apply(d, { size: 2, filter: "top" }, c(d))!;
    expect(a.doc.features[0].edgeOps).toEqual([{ kind: "fillet", size: 2, filter: "top" }]);
    expect(geometryKey(a.doc.features[0])).not.toBe(geometryKey(d.features[0]));
    const r = (getCommand("edges.remove") as DocumentCommand).apply(a.doc, { index: 0 }, c(a.doc))!;
    expect(r.doc.features[0].edgeOps).toBeUndefined();
    expect(() => (getCommand("edges.chamfer") as DocumentCommand).apply(d, { size: 1 }, c(d))).toThrow(/Kanten wählen/);
  });
});

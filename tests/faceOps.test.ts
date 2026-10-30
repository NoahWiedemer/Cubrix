import { beforeAll, describe, expect, it } from "vitest";
import opencascade from "replicad-opencascadejs";
import { makeBox, measureVolume, setOC, type Shape3D } from "replicad";
import { buildLocal } from "../src/cad/build";
import { getCommand, type DocumentCommand } from "../src/core/commands";
import "../src/core/commandDefs";
import { createDocument, findFeature, type FaceName, type Feature, type GroupFeature, type ModelDocument } from "../src/core/document";

beforeAll(async () => {
  setOC((await (opencascade as unknown as () => Promise<unknown>)()) as Parameters<typeof setOC>[0]);
}, 60_000);

const T = { position: [0, 0, 0], rotation: [0, 0, 0] } as Feature["transform"];
const box = (extra: Partial<Feature> = {}) => ({ id: "b", name: "Quader", type: "box", visible: true, transform: T, params: { width: 40, depth: 30, height: 20 }, ...extra }) as Feature;
const doc = (...features: Feature[]) => ({ ...createDocument("T"), features }) as ModelDocument;
const run = (id: string, d: ModelDocument, p: Record<string, unknown>, sel: string[] = []) => (getCommand(id) as DocumentCommand).apply(d, p, { doc: d, selection: sel, source: "user" as const })!;
const at = (s: Shape3D, c: [number, number, number]) => measureVolume(s.intersect(makeBox([c[0] - 0.5, c[1] - 0.5, c[2] - 0.5], [c[0] + 0.5, c[1] + 0.5, c[2] + 0.5])));
const full = 40 * 30 * 20;

describe("Bohrungen und Taschen", () => {
  it("bohrt mehrere Löcher in einem Schritt, durchgehend", () => {
    const r = run("object.hole", doc(box()), { diameter: 4, at: [[-10, -5], [10, 5]] }, ["b"]);
    const s = buildLocal(r.doc.features[0]);
    expect(measureVolume(s)).toBeCloseTo(full - 2 * Math.PI * 4 * 20, 0);
    expect(at(s, [-10, -5, 10])).toBeCloseTo(0, 3);
    expect(at(s, [0, 0, 10])).toBeCloseTo(1, 3);
    expect(r.label).toContain("2 Bohrungen");
  });
  it("trifft jede der sechs Flächen an der richtigen Stelle", () => {
    const cases: [FaceName, [number, number], [number, number, number]][] = [
      ["top", [8, 4], [8, 4, 19]],
      ["bottom", [8, 4], [8, 4, 1]],
      ["front", [8, 4], [8, -14, 14]],
      ["back", [8, 4], [8, 14, 14]],
      ["left", [8, 4], [-19, 8, 14]],
      ["right", [8, 4], [19, 8, 14]],
    ];
    for (const [face, pos, probe] of cases) {
      const s = buildLocal(run("object.pocket", doc(box()), { face, u: pos[0], v: pos[1], width: 4, height: 4, depth: 3 }, ["b"]).doc.features[0]);
      expect(measureVolume(s), face).toBeCloseTo(full - 4 * 4 * 3, 0);
      expect(at(s, probe), face).toBeCloseTo(0, 3);
    }
  });
  it("Senkungen und Gewinde-Kernloch", () => {
    const plain = measureVolume(buildLocal(run("object.hole", doc(box()), { diameter: 3 }, ["b"]).doc.features[0]));
    const sunk = measureVolume(buildLocal(run("object.hole", doc(box()), { diameter: 3, head: "countersink", headDiameter: 6 }, ["b"]).doc.features[0]));
    const bore = measureVolume(buildLocal(run("object.hole", doc(box()), { diameter: 3, head: "counterbore", headDiameter: 6, headDepth: 3 }, ["b"]).doc.features[0]));
    expect(sunk).toBeLessThan(plain);
    expect(bore).toBeCloseTo(plain - Math.PI * (9 - 2.25) * 3, 0);
    const core = run("object.hole", doc(box()), { thread: 3 }, ["b"]).doc.features[0].faceOps![0];
    expect(core.shape).toEqual({ kind: "circle", d: 2.5 });
  });
  it("setzt Erhöhungen auf und entfernt Schritte wieder", () => {
    const r = run("object.pocket", doc(box()), { mode: "add", shape: "circle", width: 6, depth: 5 }, ["b"]);
    const s = buildLocal(r.doc.features[0]);
    expect(s.boundingBox.bounds[1][2]).toBeCloseTo(25, 3);
    expect(measureVolume(s)).toBeCloseTo(full + Math.PI * 9 * 5, 0);
    expect(run("object.removeFaceOp", r.doc, { index: 0 }, ["b"]).doc.features[0].faceOps).toBeUndefined();
    expect(() => run("object.pocket", doc(box()), { mode: "add", width: 6 }, ["b"])).toThrow(/Höhe/);
  });
  it("funktioniert zusammen mit Abrunden und Aushöhlen", () => {
    const f = box({ fillet: 3, faceOps: [{ op: "cut", face: "bottom", u: 0, v: 0, shape: { kind: "circle", d: 6 }, depth: 2 }], shell: { thickness: 2, open: "top" } });
    expect(measureVolume(buildLocal(f))).toBeGreaterThan(0);
  });
});

describe("Teile im Batch", () => {
  it("platziert relativ, wiederholt, färbt und gruppiert in einem Aufruf", () => {
    const r = run("shapes.createMany", doc(), {
      groupName: "ESP32 DevKit",
      shapes: [
        { type: "box", name: "Platine", params: { width: 52, depth: 28, height: 1.6 }, position: [0, 0, 0], color: "#1f6b45", edges: [{ kind: "fillet", size: 1, filter: "vertical" }], holes: [{ at: [[-24, -12], [24, 12]], diameter: 3 }] },
        { type: "box", name: "Modul", params: { width: 18, depth: 16, height: 3 }, on: "Platine", position: [10, 0, 0], color: "#8d959b", material: "metal" },
        { type: "box", name: "Pin", params: { width: 0.64, depth: 0.64, height: 8 }, on: "Platine", position: [-17.78, -11.43, -3], repeat: { count: 15, step: [2.54, 0, 0] }, color: "#f2c531" },
      ],
    });
    const g = r.doc.features[0] as GroupFeature;
    expect(g.name).toBe("ESP32 DevKit");
    expect(g.children).toHaveLength(17);
    const board = g.children[0];
    expect(board.color).toBe("#1f6b45");
    expect(board.edgeOps).toEqual([{ kind: "fillet", size: 1, filter: "vertical" }]);
    expect(board.faceOps).toHaveLength(2);
    const mod = findFeature(r.doc, g.children[1].id)!;
    expect(mod.transform.position).toEqual([10, 0, 1.6]);
    expect(mod.material).toBe("metal");
    expect(g.children[2].name).toBe("Pin 1");
    expect(g.children[16].transform.position).toEqual([17.78, -11.43, -1.4]);
    expect(measureVolume(buildLocal(board))).toBeLessThan(52 * 28 * 1.6);
  });
  it("meldet unbekannte Bezüge und Materialien", () => {
    expect(() => run("shapes.createMany", doc(), { shapes: [{ type: "box", params: { width: 5, depth: 5, height: 5 }, on: "Fehlt" }] })).toThrow(/Bezug/);
    expect(() => run("shapes.createMany", doc(), { shapes: [{ type: "box", params: { width: 5, depth: 5, height: 5 }, material: "gold" }] })).toThrow(/Material/);
  });
});

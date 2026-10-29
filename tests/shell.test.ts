import { beforeAll, describe, expect, it } from "vitest";
import opencascade from "replicad-opencascadejs";
import { makeBox, measureVolume, setOC, type Shape3D } from "replicad";
import { buildLocal, EdgeTreatmentError } from "../src/cad/build";
import { getCommand } from "../src/core/commands";
import { createDocument, geometryKey, type Feature } from "../src/core/document";
import "../src/core/commandDefs";

beforeAll(async () => {
  setOC((await (opencascade as unknown as () => Promise<unknown>)()) as Parameters<typeof setOC>[0]);
}, 60_000);

const T = { position: [0, 0, 0], rotation: [0, 0, 0] } as Feature["transform"];
const box = (extra: Partial<Feature> = {}) =>
  ({ id: "b", name: "Quader", type: "box", visible: true, transform: T, params: { width: 20, depth: 20, height: 20 }, ...extra }) as Feature;

describe("Aushöhlen (Kernel)", () => {
  it("öffnet oben mit Wand nach innen", () => {
    const s = buildLocal(box({ shell: { thickness: 2, open: "top" } }));
    expect(measureVolume(s)).toBeCloseTo(8000 - 16 * 16 * 18, 0);
    expect(s.boundingBox.bounds).toEqual([[-10, -10, 0], [10, 10, 20]]);
  });
  it("öffnet unten", () => {
    expect(measureVolume(buildLocal(box({ shell: { thickness: 2, open: "bottom" } })))).toBeCloseTo(8000 - 16 * 16 * 18, 0);
  });
  it("lässt einen geschlossenen Hohlraum", () => {
    expect(measureVolume(buildLocal(box({ shell: { thickness: 2, open: "none" } })))).toBeCloseTo(8000 - 16 ** 3, 0);
  });
  // Material in a small cube at height z on the centre axis (0 = empty there).
  const at = (s: Shape3D, z: number) => measureVolume(s.intersect(makeBox([-1, -1, z], [1, 1, z + 1])));
  it("funktioniert mit abgerundeten Kanten (wirklich hohl und offen)", () => {
    const top = buildLocal(box({ fillet: 3, shell: { thickness: 2, open: "top" } }));
    expect([at(top, 18.8), at(top, 10), at(top, 0.5)]).toEqual([0, 0, expect.closeTo(4, 3)]);
    const bottom = buildLocal(box({ fillet: 3, shell: { thickness: 2, open: "bottom" } }));
    expect([at(bottom, 18.8), at(bottom, 10), at(bottom, 0.5)]).toEqual([expect.closeTo(4, 3), 0, 0]);
    const closed = buildLocal(box({ fillet: 3, shell: { thickness: 2, open: "none" } }));
    expect([at(closed, 18.8), at(closed, 10), at(closed, 0.5)]).toEqual([expect.closeTo(4, 3), 0, expect.closeTo(4, 3)]);
  });
  it("erklärt die Grenze bei gefasten Kanten", () => {
    expect(() => buildLocal(box({ chamfer: 2, shell: { thickness: 1.6, open: "top" } }))).toThrow(/gefasten/);
  });
  it("lehnt zu dicke Wände verständlich ab", () => {
    expect(() => buildLocal(box({ shell: { thickness: 10, open: "top" } }))).toThrow(EdgeTreatmentError);
    expect(() => buildLocal(box({ shell: { thickness: 10, open: "top" } }))).toThrow(/halbe Objekt/);
  });
  it("erklärt, wenn oben keine flache Fläche ist", () => {
    const sphere = { id: "s", name: "Kugel", type: "sphere", visible: true, transform: T, params: { diameter: 20 }, shell: { thickness: 2, open: "top" } } as Feature;
    expect(() => buildLocal(sphere)).toThrow(/flache Fläche/);
    expect(measureVolume(buildLocal({ ...sphere, shell: { thickness: 2, open: "none" } }))).toBeGreaterThan(0);
  });
});

describe("object.shell (Befehl)", () => {
  const apply = (doc: ReturnType<typeof createDocument>, p: Record<string, unknown>) =>
    (getCommand("object.shell") as unknown as { apply: Function }).apply(doc, p, { selection: [] });
  it("setzt, ändert und entfernt die Schale", () => {
    const doc = { ...createDocument(), features: [box()] };
    const a = apply(doc, { id: "b", thickness: 2 });
    expect(a.doc.features[0].shell).toEqual({ thickness: 2, open: "top" });
    expect(geometryKey(a.doc.features[0])).not.toBe(geometryKey(doc.features[0]));
    const b = apply(a.doc, { id: "b", thickness: 2, open: "none" });
    expect(b.doc.features[0].shell.open).toBe("none");
    expect(apply(b.doc, { id: "b", thickness: 0 }).doc.features[0].shell).toBeUndefined();
    expect(apply(a.doc, { id: "b", thickness: 2 })).toBeNull();
  });
});

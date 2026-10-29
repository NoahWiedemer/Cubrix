import { beforeAll, describe, expect, it } from "vitest";
import opencascade from "replicad-opencascadejs";
import { measureVolume, setOC } from "replicad";
import { buildLocal } from "../src/cad/build";
import type { Feature, SketchShape } from "../src/core/document";

beforeAll(async () => {
  setOC((await (opencascade as unknown as () => Promise<unknown>)()) as Parameters<typeof setOC>[0]);
}, 60_000);

const extrude = (profile: SketchShape[], height = 3): Feature =>
  ({ id: "e", name: "E", type: "extrude", visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0] }, profile, height }) as Feature;

describe("Echte Kurven (keine Polygone)", () => {
  it("Ellipse: exaktes Volumen und gekrümmte Fläche statt Facetten", () => {
    const s = buildLocal(extrude([{ kind: "ellipse", cx: 0, cy: 0, rx: 20, ry: 12 }]));
    expect(measureVolume(s)).toBeCloseTo(Math.PI * 20 * 12 * 3, 1);
    // top, bottom, one curved side (a polygon would have dozens of flat sides)
    expect(s.faces.length).toBeLessThanOrEqual(4);
  });

  it("Ovaler Anhänger mit Loch: Ellipse minus Kreis", () => {
    const s = buildLocal(extrude([{ kind: "ellipse", cx: 0, cy: 0, rx: 25, ry: 15 }, { kind: "circle", cx: -18, cy: 0, r: 2.5 }]));
    expect(measureVolume(s)).toBeCloseTo((Math.PI * 25 * 15 - Math.PI * 2.5 ** 2) * 3, 0);
  });

  it("Langloch und abgerundetes Rechteck", () => {
    const slot = buildLocal(extrude([{ kind: "slot", cx: 0, cy: 0, length: 40, width: 10 }]));
    expect(measureVolume(slot)).toBeCloseTo((30 * 10 + Math.PI * 25) * 3, 0);
    const rr = buildLocal(extrude([{ kind: "rrect", x: -15, y: -10, w: 30, h: 20, r: 4 }]));
    expect(measureVolume(rr)).toBeCloseTo((30 * 20 - (4 - Math.PI) * 16) * 3, 0);
  });

  it("Pfad mit Bogen und Spline, geschlossen", () => {
    const s = buildLocal(
      extrude([{ kind: "path", start: [-20, 0], closed: true, segments: [
        { type: "line", to: [20, 0] },
        { type: "arc", to: [20, 20], via: [30, 10] },
        { type: "spline", to: [0, 26] },
        { type: "spline", to: [-20, 20] },
        { type: "line", to: [-20, 0] },
      ] }]),
    );
    expect(measureVolume(s)).toBeGreaterThan(40 * 20 * 3);
  });

  it("Pfad, der mit einem Bogen am Start endet", () => {
    const s = buildLocal(
      extrude([{ kind: "path", start: [0, -10], closed: true, segments: [
        { type: "arc", to: [0, 10], via: [10, 0] },
        { type: "arc", to: [0, -10], via: [-10, 0] },
      ] }]),
    );
    expect(measureVolume(s)).toBeCloseTo(Math.PI * 100 * 3, 0);
  });
});

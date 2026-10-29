import { describe, expect, it } from "vitest";
import { getCommand } from "../src/core/commands";
import { createDocument, type Feature, type SketchShape } from "../src/core/document";
import { profileBounds } from "../src/core/scale";
import { setShapeField, shapeFields } from "../src/core/shapeFields";
import "../src/core/commandDefs";

const values = (s: SketchShape) => Object.fromEntries(shapeFields(s).map((f) => [f.key, f.value]));

describe("Form-Maße (2D)", () => {
  it("zeigt Mittelpunkt und echte Maße", () => {
    expect(values({ kind: "rect", x: -10, y: -5, w: 20, h: 10 })).toEqual({ width: 20, depth: 10, x: 0, y: 0 });
    expect(values({ kind: "circle", cx: 3, cy: 4, r: 2.5 })).toEqual({ diameter: 5, x: 3, y: 4 });
    expect(values({ kind: "slot", cx: 0, cy: 0, length: 18, width: 6 })).toEqual({ width: 18, depth: 6, angle: 0, x: 0, y: 0 });
  });
  it("ändert Größen um die Mitte und verschiebt über X/Y", () => {
    const r = setShapeField({ kind: "rect", x: -10, y: -5, w: 20, h: 10 }, "width", 30);
    expect(r).toEqual({ kind: "rect", x: -15, y: -5, w: 30, h: 10 });
    expect(setShapeField(r, "x", 5)).toEqual({ kind: "rect", x: -10, y: -5, w: 30, h: 10 });
    expect(setShapeField({ kind: "circle", cx: 0, cy: 0, r: 2 }, "diameter", 8)).toEqual({ kind: "circle", cx: 0, cy: 0, r: 4 });
    expect(setShapeField({ kind: "polygon", cx: 0, cy: 0, r: 5, sides: 6 }, "sides", 8.4)).toMatchObject({ sides: 8 });
  });
  it("skaliert Pfade über ihre Ausdehnung", () => {
    const path: SketchShape = { kind: "path", start: [0, 0], closed: true, segments: [{ type: "line", to: [10, 0] }, { type: "arc", to: [10, 10], via: [14, 5] }, { type: "line", to: [0, 10] }, { type: "line", to: [0, 0] }] };
    const b = profileBounds([setShapeField(path, "width", 28)])!;
    expect(b.maxX - b.minX).toBeCloseTo(28, 1);
  });
  it("lehnt unmögliche Werte verständlich ab", () => {
    expect(() => setShapeField({ kind: "rrect", x: 0, y: 0, w: 10, h: 6, r: 1 }, "radius", 4)).toThrow(/höchstens 3 mm/);
    expect(() => setShapeField({ kind: "slot", cx: 0, cy: 0, length: 10, width: 4 }, "depth", 12)).toThrow(/Langloch/);
    expect(() => setShapeField({ kind: "polygon", cx: 0, cy: 0, r: 5, sides: 6 }, "sides", 2)).toThrow(/3 Ecken/);
  });
  it("sketch.setShape ändert nur die gewählte Form", () => {
    const T = { position: [0, 0, 0], rotation: [0, 0, 0] } as Feature["transform"];
    const sketch = { id: "s", name: "Anhänger", type: "sketch", visible: true, transform: T, shapes: [{ kind: "rrect", x: -30, y: -17, w: 60, h: 34, r: 8 }, { kind: "circle", cx: 20, cy: 0, r: 3 }] } as Feature;
    const doc = { ...createDocument(), features: [sketch] };
    const r = (getCommand("sketch.setShape") as unknown as { apply: Function }).apply(doc, { id: "s", index: 1, diameter: 10, x: 18 }, { selection: [], doc });
    const shapes = r.doc.features[0].shapes;
    expect(shapes[0]).toEqual(sketch.type === "sketch" && sketch.shapes[0]);
    expect(shapes[1]).toEqual({ kind: "circle", cx: 18, cy: 0, r: 5 });
    expect(r.label).toBe("Anhänger: Kreis 2 ändern");
  });
});

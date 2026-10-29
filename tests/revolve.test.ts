import { beforeAll, describe, expect, it } from "vitest";
import opencascade from "replicad-opencascadejs";
import { makeBox, measureVolume, setOC } from "replicad";
import { buildLocal } from "../src/cad/build";
import { getCommand } from "../src/core/commands";
import { createDocument, geometryKey, type Feature } from "../src/core/document";
import "../src/core/commandDefs";

beforeAll(async () => {
  setOC((await (opencascade as unknown as () => Promise<unknown>)()) as Parameters<typeof setOC>[0]);
}, 60_000);

const T = { position: [0, 0, 0], rotation: [0, 0, 0] } as Feature["transform"];
// A 10 × 30 rectangle with its left edge at x = 5.
const sketch = { id: "s", name: "Skizze", type: "sketch", visible: true, transform: T, shapes: [{ kind: "rect", x: 5, y: -15, w: 10, h: 30 }] } as Feature;
const run = (id: string, doc: ReturnType<typeof createDocument>, p: Record<string, unknown>) =>
  (getCommand(id) as unknown as { apply: Function }).apply(doc, p, { selection: [], doc });

describe("Drehen (Rotationskörper)", () => {
  it("dreht ein Rechteck zum Zylinder, Achse an der linken Kante", () => {
    const doc = { ...createDocument(), features: [sketch] };
    const f = run("sketch.revolve", doc, { id: "s" }).doc.features[0];
    expect(f.type).toBe("extrude");
    expect(f.revolve).toEqual({ offset: 0 });
    const s = buildLocal(f);
    expect(measureVolume(s)).toBeCloseTo(Math.PI * 10 * 10 * 30, -1);
    const [[x0, y0, z0], [x1, y1, z1]] = s.boundingBox.bounds;
    expect([x0, x1, y0, y1, z0, z1].map((v) => Math.round(v))).toEqual([-5, 15, -10, 10, 0, 30]);
  });
  it("macht mit Achsabstand ein Rohr", () => {
    const doc = { ...createDocument(), features: [sketch] };
    const f = run("sketch.revolve", doc, { id: "s", offset: 4 }).doc.features[0];
    expect(measureVolume(buildLocal(f))).toBeCloseTo(Math.PI * (14 * 14 - 4 * 4) * 30, -1);
  });
  it("wird mit einer Höhe wieder zur Extrusion und mit 0 zur Skizze", () => {
    const doc = { ...createDocument(), features: [sketch] };
    const turned = run("sketch.revolve", doc, { id: "s" }).doc;
    const resized = run("shape.setSize", turned, { id: "s", width: 12 }).doc.features[0];
    expect(resized.revolve).toEqual({ offset: 0 });
    const extruded = run("shape.setSize", turned, { id: "s", height: 8 }).doc.features[0];
    expect(extruded.revolve).toBeUndefined();
    expect(extruded.height).toBe(8);
    expect(run("shape.setSize", turned, { id: "s", height: 0 }).doc.features[0].type).toBe("sketch");
    expect(geometryKey(turned.features[0])).not.toBe(geometryKey(extruded));
  });
  it("lässt sich aushöhlen (Becher)", () => {
    const cup = { ...run("sketch.revolve", { ...createDocument(), features: [sketch] }, { id: "s" }).doc.features[0], shell: { thickness: 1.6, open: "top" } };
    const v = measureVolume(buildLocal(cup));
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(Math.PI * 100 * 30 * 0.4);
  });
  it("höhlt eine Vase mit Spline-Profil aus und öffnet sie oben", () => {
    const profile = [{ kind: "path", start: [0, 0], closed: true, segments: [{ type: "line", to: [18, 0] }, { type: "spline", to: [14, 16] }, { type: "spline", to: [22, 36] }, { type: "spline", to: [17, 48] }, { type: "line", to: [0, 48] }, { type: "line", to: [0, 0] }] }];
    const vase = { id: "v", name: "Vase", type: "extrude", visible: true, transform: T, profile, height: 10, revolve: { offset: 0 } } as unknown as Feature;
    const open = measureVolume(buildLocal({ ...vase, shell: { thickness: 1.6, open: "top" } } as Feature));
    const closed = measureVolume(buildLocal({ ...vase, shell: { thickness: 1.6, open: "none" } } as Feature));
    expect(closed).toBeLessThan(measureVolume(buildLocal(vase)) / 3);
    // The removed lid is roughly a disc of the opening (r ≈ 15) and the wall thickness.
    expect(closed - open).toBeGreaterThan(Math.PI * 13 * 13 * 1.6);
    expect(closed - open).toBeLessThan(Math.PI * 17 * 17 * 1.6);
    // No core left standing on the axis inside the cavity.
    const s = buildLocal({ ...vase, shell: { thickness: 1.6, open: "top" } } as Feature);
    // The axis sits at the profile's vertical centre (y = 24); probe up through the opening.
    expect(measureVolume(s.intersect(makeBox([-0.5, 23.5, 2], [0.5, 24.5, 48.5])))).toBeCloseTo(0, 3);
  });
});

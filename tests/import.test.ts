import { beforeAll, describe, expect, it } from "vitest";
import opencascade from "replicad-opencascadejs";
import { measureVolume, setOC } from "replicad";
import { stlToSolid } from "../src/cad/stl";
import { zipSync, strToU8 } from "fflate";
import { buildLocal, importedShapes } from "../src/cad/build";
import { pathToShapes, threeMfObjects, toBinaryStl } from "../src/core/importFormats";
import type { Feature } from "../src/core/document";

beforeAll(async () => {
  setOC((await (opencascade as unknown as () => Promise<unknown>)()) as Parameters<typeof setOC>[0]);
}, 60_000);

/** A 20 mm cube (12 triangles) offset away from the origin. */
function cubeMesh(o = 50) {
  const v: number[] = [];
  for (const [x, y, z] of [[0, 0, 0], [20, 0, 0], [20, 20, 0], [0, 20, 0], [0, 0, 20], [20, 0, 20], [20, 20, 20], [0, 20, 20]]) v.push(x + o, y + o, z + o);
  const t = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  return { v, t };
}

describe("Import", () => {
  it("STL wird zum Körper, mittig aufs Bett gestellt und skalierbar", async () => {
    const { v, t } = cubeMesh();
    const raw = stlToSolid(toBinaryStl(v, t).buffer as ArrayBuffer);
    const [min, max] = raw.boundingBox.bounds;
    importedShapes.set("a1", raw.translate(-(min[0] + max[0]) / 2, -(min[1] + max[1]) / 2, -min[2]));
    const f = { id: "i", name: "W", type: "import", visible: true, assetId: "a1", scale: 1, transform: { position: [0, 0, 0], rotation: [0, 0, 0] } } as Feature;
    const s = buildLocal(f);
    expect(measureVolume(s)).toBeCloseTo(8000, 0);
    expect(s.boundingBox.bounds[0]).toEqual([-10, -10, 0].map((n) => expect.closeTo(n, 3)) as never);
    expect(measureVolume(buildLocal({ ...f, scale: 0.5 } as Feature))).toBeCloseTo(1000, 0);
  });

  it("3MF: jedes Netz-Objekt wird zu STL (Einheit beachtet)", () => {
    const { v, t } = cubeMesh(0);
    const verts = Array.from({ length: v.length / 3 }, (_, i) => `<vertex x="${v[i * 3] / 10}" y="${v[i * 3 + 1] / 10}" z="${v[i * 3 + 2] / 10}"/>`).join("");
    const tris = Array.from({ length: t.length / 3 }, (_, i) => `<triangle v1="${t[i * 3]}" v2="${t[i * 3 + 1]}" v3="${t[i * 3 + 2]}"/>`).join("");
    const model = `<?xml version="1.0"?><model unit="centimeter"><resources><object id="1" name="Würfel" type="model"><mesh><vertices>${verts}</vertices><triangles>${tris}</triangles></mesh></object></resources><build><item objectid="1"/></build></model>`;
    const zip = zipSync({ "3D/3dmodel.model": strToU8(model) });
    const objs = threeMfObjects(zip);
    expect(objs).toHaveLength(1);
    expect(objs[0].name).toBe("Würfel");
    const view = new DataView(objs[0].stl.buffer);
    expect(view.getUint32(80, true)).toBe(12);
    // first vertex of the first triangle, back in mm
    expect(view.getFloat32(84 + 12 + 12, true)).toBeCloseTo(20, 3); // second vertex (20, 20, 0) back in mm
  });

  it("SVG-Pfad mit Bézierkurven wird zu einer echten Kurve", () => {
    const shapes = pathToShapes("M 0 0 L 40 0 C 50 0 50 20 40 20 L 0 20 Z", ([x, y]) => [x, -y]);
    expect(shapes).toHaveLength(1);
    const p = shapes[0];
    if (p.kind !== "path") throw new Error();
    expect(p.closed).toBe(true);
    expect(p.segments.some((g) => g.type === "spline")).toBe(true);
    const s = buildLocal({ id: "e", name: "E", type: "extrude", visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0] }, profile: shapes, height: 2 } as Feature);
    expect(measureVolume(s)).toBeGreaterThan(40 * 20 * 2);
  });
});

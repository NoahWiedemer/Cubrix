import { beforeAll, describe, expect, it } from "vitest";
import opencascade from "replicad-opencascadejs";
import { measureVolume, setOC } from "replicad";
import { buildPlaced } from "../src/cad/build";
import { getCommand, type DocumentCommand } from "../src/core/commands";
import "../src/core/commandDefs";
import { createDocument, type ModelDocument } from "../src/core/document";

beforeAll(async () => {
  setOC((await (opencascade as unknown as () => Promise<unknown>)()) as Parameters<typeof setOC>[0]);
}, 60_000);

const run = (doc: ModelDocument, id: string, params: Record<string, unknown>) => {
  const cmd = getCommand(id) as DocumentCommand;
  const full: Record<string, unknown> = { ...params };
  for (const [k, sp] of Object.entries(cmd.params)) if (full[k] === undefined && "default" in sp && sp.default !== undefined) full[k] = sp.default;
  return cmd.apply(doc, full, { doc, selection: [], source: "ai" })!;
};

/** Pip centres of a 20 mm die standing on the bed (centre at z = 10). */
function pips(): number[][] {
  const s = 5, h = 10, out: number[][] = [];
  const face = (n: number, place: (u: number, v: number) => number[]) => {
    const layouts: Record<number, [number, number][]> = {
      1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
      5: [[-1, -1], [-1, 1], [0, 0], [1, -1], [1, 1]], 6: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]],
    };
    for (const [u, v] of layouts[n]) out.push(place(u * s, v * s));
  };
  face(1, (u, v) => [u, v, 20]);
  face(6, (u, v) => [u, v, 0]);
  face(2, (u, v) => [10, u, h + v]);
  face(5, (u, v) => [-10, u, h + v]);
  face(3, (u, v) => [u, 10, h + v]);
  face(4, (u, v) => [u, -10, h + v]);
  return out;
}

describe("Sammelbefehle für die KI", () => {
  it("Würfel in 3 Schritten: Quader, 21 Augen auf einmal, ein Schnitt mit allen Werkzeugen", () => {
    let doc = createDocument("W", { starter: false });
    const r1 = run(doc, "primitive.box", { width: 20, depth: 20, height: 20, position: [0, 0, 0] });
    doc = r1.doc;
    const boxId = r1.selection![0];
    // Sphere position = bottom centre of the sphere: centre minus radius.
    const shapes = pips().map(([x, y, z]) => ({ type: "sphere", params: { diameter: 3.6 }, position: [x, y, z - 1.8] }));
    const r2 = run(doc, "shapes.createMany", { shapes });
    expect(r2.selection).toHaveLength(21);
    doc = r2.doc;
    const r3 = run(doc, "boolean.subtract", { targetId: boxId, toolIds: r2.selection });
    doc = r3.doc;
    expect(doc.features).toHaveLength(1);
    const die = doc.features[0];
    expect(die.type === "boolean" && die.children.length).toBe(22);
    const v = measureVolume(buildPlaced(die));
    expect(v).toBeLessThan(8000);
    expect(v).toBeGreaterThan(8000 - 21 * ((4 / 3) * Math.PI * 1.8 ** 3) * 0.6);
  });

  it("Muster: kreisförmig und als Raster", () => {
    let doc = createDocument("M", { starter: false });
    const r = run(doc, "primitive.cylinder", { diameter: 4, height: 5, position: [20, 0, 0] });
    doc = r.doc;
    const id = r.selection![0];
    const c = run(doc, "object.pattern", { id, kind: "circular", count: 6 });
    expect(c.doc.features).toHaveLength(6);
    const last = c.doc.features[5].transform.position;
    expect(Math.hypot(last[0], last[1])).toBeCloseTo(20, 2);
    const g = run(doc, "object.pattern", { id, kind: "grid", count: 3, countY: 2, step: [10, 8, 0] });
    expect(g.doc.features).toHaveLength(6);
  });
});

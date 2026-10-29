import { beforeAll, describe, expect, it } from "vitest";
import opencascade from "replicad-opencascadejs";
import { measureVolume, setOC } from "replicad";
import { buildPlaced } from "../src/cad/build";
import { getCommand, type DocumentCommand } from "../src/core/commands";
import "../src/core/commandDefs";
import { createDocument, findFeature, type BooleanFeature, type ModelDocument } from "../src/core/document";

beforeAll(async () => {
  setOC((await (opencascade as unknown as () => Promise<unknown>)()) as Parameters<typeof setOC>[0]);
}, 60_000);

const run = (doc: ModelDocument, id: string, params: Record<string, unknown>, selection: string[] = []) => {
  const cmd = getCommand(id) as DocumentCommand;
  const full: Record<string, unknown> = { ...params };
  for (const [k, sp] of Object.entries(cmd.params)) if (full[k] === undefined && "default" in sp && sp.default !== undefined) full[k] = sp.default;
  return cmd.apply(doc, full, { doc, selection, source: "user" })!;
};

function die() {
  let doc = createDocument("W", { starter: false });
  const box = run(doc, "primitive.box", { width: 20, depth: 20, height: 20, position: [0, 0, 0] });
  doc = box.doc;
  const pips = run(doc, "shapes.createMany", { shapes: [[0, 0, 18.2], [5, 5, 18.2], [-5, -5, 18.2]].map((p) => ({ type: "sphere", params: { diameter: 3.6 }, position: p })) });
  doc = run(pips.doc, "boolean.subtract", { targetId: box.selection![0], toolIds: pips.selection }).doc;
  return { doc, pipIds: pips.selection! };
}
const vol = (doc: ModelDocument) => measureVolume(buildPlaced(doc.features[0]));

describe("Verbund mit bearbeitbaren Teilen", () => {
  it("ein Auge im Würfel bearbeiten: Größe und Lage über seine ID", () => {
    const { doc, pipIds } = die();
    const v0 = vol(doc);
    const bigger = run(doc, "object.setParams", { id: pipIds[0], params: { diameter: 6 } }).doc;
    expect((findFeature(bigger, pipIds[0]) as any).params.diameter).toBe(6);
    expect(vol(bigger)).toBeLessThan(v0);
    const moved = run(doc, "object.transform", { id: pipIds[1], position: [8, -8, 18.2] }).doc;
    expect(findFeature(moved, pipIds[1])!.transform.position).toEqual([8, -8, 18.2]);
  });

  it("Werkzeug ausblenden schaltet den Schnitt ab; lösen, entfernen, Typ ändern", () => {
    const { doc, pipIds } = die();
    const hidden = run(doc, "object.setVisibility", { ids: [pipIds[0]], visible: false }).doc;
    expect(vol(hidden)).toBeGreaterThan(vol(doc));
    const ex = run(doc, "operand.extract", { id: pipIds[2] });
    expect(ex.doc.features).toHaveLength(2);
    expect((ex.doc.features[0] as BooleanFeature).children).toHaveLength(3);
    const rm = run(doc, "operand.remove", { id: pipIds[2] });
    expect(rm.doc.features).toHaveLength(1);
    expect((rm.doc.features[0] as BooleanFeature).children).toHaveLength(3);
    const un = run(doc, "boolean.setOp", { id: pipIds[0], op: "union" }).doc;
    expect((un.features[0] as BooleanFeature).op).toBe("union");
  });

  it("Skalieren des Verbunds skaliert alles gleichmäßig", () => {
    const { doc } = die();
    const s = run(doc, "object.scale", { id: doc.features[0].id, factor: [2, 2, 2] }).doc;
    expect(vol(s) / vol(doc)).toBeCloseTo(8, 2);
  });
});

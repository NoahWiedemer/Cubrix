import { beforeEach, describe, expect, it } from "vitest";
import { execute, getCommand, type DocumentCommand } from "../src/core/commands";
import "../src/core/commandDefs";
import { createDocument, type ModelDocument } from "../src/core/document";
import { useApp } from "../src/core/store";

const ctx = (doc: ModelDocument, selection: string[]) => ({ doc, selection, source: "user" as const });
const doc = () => useApp.getState().nodes[useApp.getState().currentId].doc;

describe("Isolieren / Alle einblenden / Sperren", () => {
  beforeEach(() => useApp.getState().reset(createDocument("T"), "Test", null));

  it("isoliert nur in der Ansicht und hebt es wieder auf", async () => {
    await execute("primitive.box", { position: [40, 0, 0] });
    const [a, b] = doc().features.map((f) => f.id);
    const before = useApp.getState().currentId;
    await execute("selection.set", { ids: [b] });
    await execute("view.isolate");
    expect(useApp.getState().isolated).toEqual([b]);
    expect(doc().features.every((f) => f.visible)).toBe(true); // the file is unchanged
    expect(useApp.getState().nodes[useApp.getState().currentId].commandId).not.toBe("view.isolate");
    await execute("view.isolate");
    expect(useApp.getState().isolated).toBeNull();
    expect(a).toBeTruthy();
    expect(before).toBeTruthy();
  });

  it("Alle einblenden beendet die Isolierung und blendet Ausgeblendetes ein", async () => {
    const id = doc().features[0].id;
    await execute("object.setVisibility", { ids: [id], visible: false });
    useApp.setState({ isolated: ["x"] });
    await execute("view.showAll");
    expect(useApp.getState().isolated).toBeNull();
    expect(doc().features[0].visible).toBe(true);
  });

  it("sperrt und entsperrt", () => {
    const d = createDocument("T");
    const id = d.features[0].id;
    const lock = getCommand("object.lock") as DocumentCommand;
    const locked = lock.apply(d, {}, ctx(d, [id]))!;
    expect(locked.doc.features[0].locked).toBe(true);
    expect(locked.label).toMatch(/sperren/);
    const open = lock.apply(locked.doc, {}, ctx(locked.doc, [id]))!;
    expect(open.doc.features[0].locked).toBeUndefined();
  });
});

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import opencascade from "replicad-opencascadejs";
import { setOC } from "replicad";
import { largestEdge } from "../src/cad/build";
import { execute, getCommand, type DocumentCommand } from "../src/core/commands";
import "../src/core/commandDefs";
import { createDocument, type Feature, type ModelDocument } from "../src/core/document";
import { useApp } from "../src/core/store";
import { useChat } from "../src/ai/chatStore";
import { nextDrill } from "../src/ui/drill";

beforeAll(async () => {
  setOC((await (opencascade as unknown as () => Promise<unknown>)()) as Parameters<typeof setOC>[0]);
}, 60_000);

const ctx = (doc: ModelDocument, selection: string[] = []) => ({ doc, selection, source: "user" as const });
const run = (id: string, doc: ModelDocument, p: Record<string, unknown>, sel: string[] = []) => (getCommand(id) as DocumentCommand).apply(doc, p, ctx(doc, sel));
const T = { position: [0, 0, 0], rotation: [0, 0, 0] } as Feature["transform"];

function wheels() {
  let d = createDocument("T", { starter: false });
  for (const x of [-20, 20]) d = run("primitive.cylinder", d, { diameter: 10, height: 4, position: [x, 5, 0] })!.doc;
  return { d, ids: d.features.map((f) => f.id) };
}

describe("Mehrfachauswahl", () => {
  it("bewegt und dreht alles als eine Bewegung", () => {
    const { d, ids } = wheels();
    const moved = run("objects.transformBy", d, { position: [0, 0, 7] }, ids)!.doc;
    expect(moved.features.map((f) => f.transform.position)).toEqual([[-20, 5, 7], [20, 5, 7]]);
    const turned = run("objects.transformBy", d, { position: [0, 0, 0], rotation: [0, 0, 90] }, ids)!.doc;
    expect(turned.features.map((f) => f.transform.position)).toEqual([[-5, -20, 0], [-5, 20, 0]]);
    expect(turned.features[0].transform.rotation).toEqual([0, 0, 90]);
  });
  it("setzt eine Achse absolut oder relativ, in einem Schritt", () => {
    const { d, ids } = wheels();
    expect(run("objects.setAxis", d, { kind: "position", axis: 0, value: 3 }, ids)!.doc.features.map((f) => f.transform.position[0])).toEqual([3, 3]);
    expect(run("objects.setAxis", d, { kind: "position", axis: 0, delta: 2 }, ids)!.doc.features.map((f) => f.transform.position[0])).toEqual([-18, 22]);
    expect(run("objects.setAxis", d, { kind: "rotation", axis: 2, value: 45 }, ids)!.doc.features.map((f) => f.transform.rotation[2])).toEqual([45, 45]);
    expect(run("objects.setAxis", d, { kind: "position", axis: 1, value: 5 }, ids)).toBeNull();
  });
  it("ändert gleiche Maße bei allen und skaliert um den gemeinsamen Punkt", () => {
    const { d, ids } = wheels();
    const sized = run("objects.setParams", d, { params: { diameter: 14 } }, ids)!.doc;
    expect(sized.features.map((f) => (f as { params: { diameter: number } }).params.diameter)).toEqual([14, 14]);
    const scaled = run("objects.scaleBy", d, { factor: [2, 2, 2], anchor: [0, 5, 0] }, ids)!.doc;
    expect(scaled.features.map((f) => f.transform.position[0])).toEqual([-40, 40]);
    const each = run("objects.scaleBy", d, { factor: [2, 2, 2] }, ids)!.doc;
    expect(each.features.map((f) => f.transform.position[0])).toEqual([-20, 20]);
  });
});

describe("⌘-Klick in Gruppen", () => {
  const chain = ["top", "sub", "obj"];
  it("geht Ebene für Ebene tiefer und dann wieder nach oben", () => {
    expect(nextDrill(chain, [])).toBe("top");
    expect(nextDrill(chain, ["top"])).toBe("sub");
    expect(nextDrill(chain, ["sub"])).toBe("obj");
    expect(nextDrill(chain, ["obj"])).toBe("top");
    expect(nextDrill(["obj"], ["obj"])).toBe("obj");
  });
});

describe("Chat pro Projekt", () => {
  beforeEach(() => useApp.getState().reset(createDocument("A"), "A", null));
  it("Neues Projekt leert den Chat und stoppt einen laufenden Lauf", async () => {
    let stopped = false;
    useChat.setState({ entries: [{ role: "user", text: "Hallo", steps: [] }], api: [{ role: "user", content: "Hallo" } as never], running: true, savedEntries: 1, abortRun: () => (stopped = true) });
    const gen = useChat.getState().generation;
    await execute("file.new");
    expect(useChat.getState()).toMatchObject({ entries: [], api: [], running: false });
    expect(useChat.getState().generation).toBeGreaterThan(gen);
    expect(stopped).toBe(true);
  });
  it("Öffnen stellt genau den Chat des Projekts wieder her", async () => {
    const { currentProjectText, loadProjectText } = await import("../src/core/commandDefs");
    useChat.setState({ entries: [{ role: "user", text: "Projekt A", steps: [] }], api: [] });
    const a = currentProjectText();
    useApp.getState().reset(createDocument("B"), "B", null);
    expect(useChat.getState().entries).toEqual([]);
    loadProjectText(a, "/tmp/a.cubrix", "A");
    expect(useChat.getState().entries.map((e) => e.text)).toEqual(["Projekt A"]);
    expect(useChat.getState().savedEntries).toBe(1);
  });
});

describe("Abrunden begrenzen", () => {
  const plate = (extra: Partial<Feature> = {}) => ({ id: "p", name: "Platte", type: "box", visible: true, transform: T, params: { width: 40, depth: 30, height: 2 }, ...extra }) as Feature;
  it("findet bei einer dünnen Platte den größten Wert", () => {
    expect(largestEdge(plate(), "fillet", 0.5)).toBe(0.5);
    const max = largestEdge(plate(), "fillet", 10);
    expect(max).toBeGreaterThan(0.8);
    expect(max).toBeLessThan(1);
  });
  it("berücksichtigt die Wand eines ausgehöhlten Körpers", () => {
    const box = plate({ params: { width: 30, depth: 30, height: 20 }, shell: { thickness: 2, open: "top" } } as Partial<Feature>);
    const max = largestEdge(box, "fillet", 12);
    expect(max).toBeGreaterThan(0);
    expect(max).toBeLessThan(12);
  });
  it("meldet 0, wenn gar nichts geht", () => {
    const sphere = { ...plate(), type: "sphere", params: { diameter: 20 } } as Feature;
    expect(largestEdge(sphere, "fillet", 2)).toBe(0);
  });
});

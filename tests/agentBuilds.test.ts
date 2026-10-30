import { beforeAll, describe, expect, it } from "vitest";
import opencascade from "replicad-opencascadejs";
import { measureVolume, setOC } from "replicad";
import { buildLocal } from "../src/cad/build";
import { execute } from "../src/core/commands";
import "../src/core/commandDefs";
import { createDocument, findFeature, type Feature, type GroupFeature } from "../src/core/document";
import { useApp } from "../src/core/store";
// @ts-expect-error plain script shared with the dev build
import { run } from "../scripts/e2e/agent-builds.mjs";

beforeAll(async () => {
  setOC((await (opencascade as unknown as () => Promise<unknown>)()) as Parameters<typeof setOC>[0]);
}, 60_000);

const doc = () => useApp.getState().nodes[useApp.getState().currentId].doc;
const api = { execute, useApp };
const leaves = (f: Feature): Feature[] => (f.type === "group" ? f.children.flatMap(leaves) : [f]);

describe("Beispielmodelle als feste Werkzeugfolge", () => {
  it("ESP32 DevKit: maßhaltig, mit Pinraster, alles baubar", async () => {
    useApp.getState().reset(createDocument("T"), "T", null);
    await run(api, "esp32");
    const g = doc().features[0] as GroupFeature;
    expect(doc().features).toHaveLength(1);
    expect(g.name).toBe("ESP32 DevKit");
    const parts = leaves(g);
    const pins = parts.filter((p) => p.name.startsWith("Pin "));
    expect(pins).toHaveLength(30);
    const a = pins.filter((p) => p.name.startsWith("Pin A")).map((p) => p.transform.position[0]);
    expect(a[1] - a[0]).toBeCloseTo(2.54, 3);
    expect(a[14] - a[0]).toBeCloseTo(35.56, 3);
    expect(Math.min(...pins.map((p) => p.transform.position[2]))).toBeCloseTo(0, 3);
    const board = parts.find((p) => p.name === "Platine")!;
    expect(board.faceOps).toHaveLength(4);
    const shield = parts.find((p) => p.name === "Blechschirm")!;
    expect(shield.transform.position[2]).toBeCloseTo(5.9 + 1.6 + 0.8, 3);
    expect(shield.material).toBe("metal");
    for (const p of parts) expect(measureVolume(buildLocal(p)), p.name).toBeGreaterThan(0);
  }, 60_000);

  it("Gehäuse: ausgehöhlt, Kabelausschnitt, Deckel mit Falz und Senkungen", async () => {
    useApp.getState().reset(createDocument("T"), "T", null);
    await run(api, "enclosure");
    const g = doc().features[0] as GroupFeature;
    const [body, lid] = g.children;
    expect(body.shell).toEqual({ thickness: 2, open: "top" });
    const v = measureVolume(buildLocal(findFeature(doc(), body.id)!));
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(80 * 50 * 25 * 0.4);
    const top = buildLocal(findFeature(doc(), lid.id)!);
    expect(top.boundingBox.bounds[1][2] - top.boundingBox.bounds[0][2]).toBeCloseTo(5, 2);
    expect(lid.faceOps).toHaveLength(5);
  }, 60_000);
});

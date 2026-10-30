import { describe, expect, it } from "vitest";
import { capHistory, parseProject, serializeProject, MAX_HISTORY } from "../src/core/projectFile";
import { createDocument } from "../src/core/document";
import type { HistoryNode } from "../src/core/store";

const doc = createDocument("Test");
const node = (id: string, parentId: string | null, time: number, extra: Partial<HistoryNode> = {}): HistoryNode => ({
  id, parentId, childIds: [], activeChildId: null, commandId: "x", label: id, icon: "box", time, source: "user", doc, selection: [], ...extra,
});
function linear(n: number) {
  const nodes: Record<string, HistoryNode> = {};
  for (let i = 0; i < n; i++) {
    nodes[`n${i}`] = node(`n${i}`, i ? `n${i - 1}` : null, i);
    if (i) nodes[`n${i - 1}`].childIds.push(`n${i}`);
  }
  return nodes;
}

describe("Projektdatei", () => {
  it("Round-Trip: Dokument, Verlauf mit Zweig und KI-Gruppe, Chat, Kamera, Auswahl", () => {
    const nodes = linear(5);
    nodes.b1 = node("b1", "n2", 10, { group: { id: "g", prompt: "Würfel" }, source: "ai" });
    nodes.n2.childIds.push("b1");
    const text = serializeProject({
      document: doc,
      history: { rootId: "n0", currentId: "n4", nodes },
      chat: { entries: [{ role: "user", text: "Hallo", steps: [] }], api: [{ role: "user", content: [{ type: "text", text: "Hallo" }] }] },
      camera: { position: [1, 2, 3], target: [0, 0, 0], projection: "perspective" },
      selection: ["a"],
    });
    const { file, migratedFrom } = parseProject(text);
    expect(migratedFrom).toBe(2);
    expect(file.document.name).toBe("Test");
    expect(Object.keys(file.history!.nodes)).toHaveLength(6);
    expect(file.history!.nodes.b1.group).toEqual({ id: "g", prompt: "Würfel" });
    expect(file.history!.currentId).toBe("n4");
    expect(file.chat.entries[0].text).toBe("Hallo");
    expect(file.camera!.position).toEqual([1, 2, 3]);
    expect(file.selection).toEqual(["a"]);
  });

  it("Verlauf höchstens 200 Schritte, Pfad zum aktuellen Stand bleibt", () => {
    const nodes = linear(260);
    const { nodes: kept, rootId } = capHistory(nodes, "n0", "n259");
    expect(Object.keys(kept)).toHaveLength(MAX_HISTORY);
    expect(kept.n259).toBeDefined();
    expect(kept[rootId].parentId).toBeNull();
  });

  it("Chat höchstens 100 Einträge, keine Screenshots", () => {
    const entries = Array.from({ length: 130 }, (_, i) => ({ role: "user" as const, text: `m${i}`, steps: [] }));
    const text = serializeProject({
      document: doc,
      history: { rootId: "n0", currentId: "n0", nodes: linear(1) },
      chat: { entries, api: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "{}", image: "AAAA" }] }] },
      selection: [],
    });
    const { file } = parseProject(text);
    expect(file.chat.entries).toHaveLength(100);
    expect(file.chat.entries[0].text).toBe("m30");
    expect(text).not.toContain("AAAA");
  });

  it("v1 (nur Dokument, auch .albedo) wird migriert", () => {
    const { file, migratedFrom } = parseProject(JSON.stringify({ ...doc, format: "albedo" }));
    expect(migratedFrom).toBe(1);
    expect(file.document.format).toBe("cubrix");
    expect(file.history).toBeUndefined();
  });
});

describe("Wiederherstellungs-Hinweis", () => {
  it("zeigt heute nur die Uhrzeit, sonst auch das Datum", async () => {
    const { recoveryTime } = await import("../src/core/autosave");
    const now = new Date(2026, 9, 30, 15, 0).getTime();
    expect(recoveryTime(new Date(2026, 9, 30, 13, 39).getTime(), now)).toBe("13:39");
    expect(recoveryTime(new Date(2026, 9, 28, 13, 39).getTime(), now)).toContain("28.10.");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import "../src/core/commandDefs";
import { callExternal, checkPath, clientLabel, connectorSnippets, externalTools, toContent } from "../src/ai/connector";
import { useAiRun, endRun, startRun, touchExternal } from "../src/ai/run";
import { getDoc, useApp } from "../src/core/store";

vi.stubGlobal("window", { setTimeout, clearTimeout });

const names = () => externalTools().map((t) => t.name);

describe("Connector: Werkzeuge", () => {
  it("bietet die Werkzeuge des Assistenten als MCP-Tools", () => {
    const tools = externalTools();
    for (const n of ["shapes__createMany", "boolean__subtract", "edges__fillet", "object__hole", "object__pocket", "object__pattern", "group__create", "object__setMaterial", "measure", "check_model", "get_screenshot", "history__undo", "history__redo", "get_scene", "save_project", "export_model"]) expect(names()).toContain(n);
    for (const t of tools) expect(t.inputSchema.type).toBe("object");
    expect(new Set(names()).size).toBe(tools.length);
  });

  it("lässt alles mit Dialog weg", () => {
    expect(names().filter((n) => /^(export__|file__|view__screenshot$)/.test(n))).toEqual([]);
  });

  it("legt über die History an und gruppiert als externen Lauf", async () => {
    const before = getDoc().features.length;
    const a = await callExternal("primitive__box", { width: 10, depth: 10, height: 10, name: "Eins" }, "claude-code");
    const b = await callExternal("primitive__box", { width: 10, depth: 10, height: 10, name: "Zwei" }, "claude-code");
    expect(a.isError).toBeUndefined();
    expect(JSON.stringify(b)).toContain("created");
    expect(getDoc().features).toHaveLength(before + 2);
    const s = useApp.getState();
    const node = s.nodes[s.currentId];
    const parent = s.nodes[node.parentId!];
    expect(node.group?.prompt).toBe("Extern: Claude Code");
    expect(node.group?.id).toBe(parent.group?.id);
    expect(node.source).toBe("ai");
    await callExternal("history__undo", {}, "claude-code");
    expect(getDoc().features).toHaveLength(before + 1);
    endRun();
  });

  it("meldet Fehler als isError statt zu werfen", async () => {
    const r = await callExternal("gibt__esnicht", {}, "x");
    expect(r.isError).toBe(true);
    expect((await callExternal("export__stl", {}, "x")).isError).toBe(true);
    endRun();
  });

  it("get_scene liefert die Übersicht", async () => {
    const r = await callExternal("get_scene", {}, "x");
    expect(r.content[0].text).toContain("pos=");
  });

  it("verlangt absolute Pfade mit passender Endung", () => {
    expect(checkPath("/tmp/a.stl", "stl")).toBe("/tmp/a.stl");
    expect(checkPath("C:\\x\\a.STL", "stl")).toBe("C:\\x\\a.STL");
    expect(() => checkPath("a.stl", "stl")).toThrow(/absolut/);
    expect(() => checkPath("/tmp/a.sh", "stl")).toThrow(/\.stl/);
    expect(() => checkPath(undefined, "stl")).toThrow();
  });

  it("speichert neue Projekte nur mit Pfad", async () => {
    useApp.setState({ filePath: null });
    expect((await callExternal("save_project", {}, "x")).isError).toBe(true);
    expect((await callExternal("export_model", { format: "exe", path: "/tmp/a.exe" }, "x")).isError).toBe(true);
  });

  it("gibt Bilder als MCP-Image zurück", () => {
    expect(toContent({ type: "tool_result", tool_use_id: "x", content: "Bild", image: "QUJD" }).content).toEqual([{ type: "image", data: "QUJD", mimeType: "image/png" }, { type: "text", text: "Bild" }]);
    expect(toContent({ type: "tool_result", tool_use_id: "x", content: "f", isError: true }).isError).toBe(true);
  });
});

describe("Connector: Lauf-Anzeige", () => {
  beforeEach(endRun);

  it("startet einen Lauf für den grünen Rahmen", () => {
    touchExternal("Extern: Codex");
    expect(useAiRun.getState()).toMatchObject({ running: true, phase: "Extern: Codex" });
  });

  it("mischt sich nicht in einen Chat-Lauf ein", () => {
    startRun();
    touchExternal("Extern: Codex");
    expect(useAiRun.getState().phase).toBe("Denkt nach …");
  });
});

describe("Connector: Einrichtung", () => {
  it("baut die Befehle für Port und Token", () => {
    const [claude, codex, cursor, desktop] = connectorSnippets(7333, "abc");
    expect(claude.text).toBe('claude mcp add --transport http cubrix http://127.0.0.1:7333/mcp --header "Authorization: Bearer abc"');
    expect(codex.text).toContain('url = "http://127.0.0.1:7333/mcp"');
    expect(codex.text).toContain('bearer_token_env_var = "CUBRIX_TOKEN"');
    expect(JSON.parse(cursor.text).mcpServers.cubrix.headers.Authorization).toBe("Bearer abc");
    expect(JSON.parse(desktop.text).mcpServers.cubrix.args).toContain("mcp-remote");
  });

  it("zeigt verständliche Client-Namen", () => {
    expect(clientLabel("claude-code")).toBe("Claude Code");
    expect(clientLabel("codex-mcp-client")).toBe("Codex");
    expect(clientLabel("mein-agent")).toBe("mein-agent");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSection, SETTINGS_SECTIONS, stepSection, useSettingsDialog } from "../src/ui/settingsNav";

vi.hoisted(() => {
  const data = new Map<string, string>();
  const localStorage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v), removeItem: (k: string) => data.delete(k) };
  Object.assign(globalThis, { localStorage, window: { localStorage } });
});

describe("Einstellungen: Navigation", () => {
  beforeEach(() => useSettingsDialog.setState({ open: false, section: "general" }));

  it("hat alle Abschnitte in der gewünschten Reihenfolge", () => {
    expect(SETTINGS_SECTIONS.map((s) => s.title)).toEqual(["Allgemein", "KI & Modelle", "MCP", "Ansicht", "Drucker", "Updates", "Entwickler"]);
  });

  it("Pfeiltasten laufen im Kreis", () => {
    expect(stepSection("general", 1)).toBe("ai");
    expect(stepSection("general", -1)).toBe("developer");
    expect(stepSection("developer", 1)).toBe("general");
  });

  it("merkt den Abschnitt, aber nicht das Offensein", () => {
    const { merge } = useSettingsDialog.persist.getOptions();
    useSettingsDialog.setState({ open: true, section: "mcp" });
    expect(JSON.parse(localStorage.getItem("cubrix.settingsDialog")!).state).toEqual({ section: "mcp" });
    expect(merge!({ section: "mcp" }, useSettingsDialog.getState()).section).toBe("mcp");
    expect(merge!({ section: "alt" }, useSettingsDialog.getState()).section).toBe("general");
  });

  it("fällt bei unbekannten Abschnitten auf Allgemein zurück", () => {
    expect(resolveSection("gibtsnicht")).toBe("general");
    expect(resolveSection("updates")).toBe("updates");
  });
});

import { describe, expect, it } from "vitest";
import { activeModel, CATALOG, DEFAULT_MODEL, providerOf } from "../src/ai/models";
import { migrateAi } from "../src/ui/settings";

describe("Modellwahl", () => {
  it("das Modell bestimmt den Anbieter", () => {
    expect(activeModel("gpt-6-luna", ["anthropic", "openai"])).toEqual({ provider: "openai", id: "gpt-6-luna" });
    expect(activeModel("claude-opus-5-5", ["anthropic", "openai"])).toEqual({ provider: "anthropic", id: "claude-opus-5-5" });
    for (const p of ["anthropic", "openai"] as const) for (const m of CATALOG[p]) expect(providerOf(m.id)).toBe(p);
  });

  it("Wechsel zu einem Anbieter ohne Schlüssel springt nicht zurück: die Wahl bleibt, der Lauf nutzt den verbundenen", () => {
    const selected = "gpt-6-luna";
    expect(activeModel(selected, ["anthropic"])).toEqual({ provider: "anthropic", id: DEFAULT_MODEL.anthropic });
    expect(activeModel(selected, ["anthropic", "openai"]).id).toBe(selected);
  });

  it("ohne geladene Schlüssel bleibt die Wahl unverändert", () => {
    expect(activeModel("gpt-6-luna", [])).toEqual({ provider: "openai", id: "gpt-6-luna" });
  });

  it("übernimmt alte Einstellungen", () => {
    expect(migrateAi({ provider: "openai", model: { anthropic: "claude-opus-5-5", openai: "gpt-6-astra" }, effort: "high" }, 6)).toEqual({ model: "gpt-6-astra", effort: "high" });
    expect(migrateAi({ provider: "anthropic", model: { anthropic: "claude-opus-5-5", openai: "gpt-6-astra" } }, 6)).toEqual({ model: "claude-opus-5-5", effort: "medium" });
    expect(migrateAi({ provider: "openai", model: { openai: "gpt-6.1-sol" } }, 2).model).toBe("gpt-6.1-terra");
    expect(migrateAi({ provider: "openai", model: { openai: "gpt-4" } }, 6).model).toBe("claude-sonnet-5-5");
    expect(migrateAi(undefined, 0).model).toBe("claude-sonnet-5-5");
  });
});

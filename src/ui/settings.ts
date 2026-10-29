// User preferences (persisted per machine).
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Quality = "high" | "balanced" | "fast";

export const QUALITY_LABELS: Record<Quality, string> = { high: "Hoch", balanced: "Ausgewogen", fast: "Schnell" };

/** Max device pixel ratio and shadow resolution per quality level. */
export const QUALITY: Record<Quality, { dpr: number; shadows: number }> = {
  high: { dpr: 2, shadows: 1024 },
  balanced: { dpr: 1.5, shadows: 512 },
  fast: { dpr: 1, shadows: 0 },
};

export type Projection = "perspective" | "orthographic";

export type Inertia = "off" | "light";

export const useSettings = create<{ quality: Quality; projection: Projection; inertia: Inertia }>()(
  persist(() => ({ quality: "high" as Quality, projection: "perspective" as Projection, inertia: "off" as Inertia }), { name: "albedo.settings" }),
);

export interface AiSettings {
  provider: "anthropic" | "openai";
  model: { anthropic: string; openai: string };
  effort: "low" | "medium" | "high";
}

export const useAiSettings = create<AiSettings>()(
  persist((): AiSettings => ({ provider: "anthropic", model: { anthropic: "claude-sonnet-5-5", openai: "gpt-6.1-terra" }, effort: "medium" }), {
    name: "albedo.ai",
    version: 3,
    // Older settings could hold an empty OpenAI model id.
    migrate: (s) => {
      const old = s as Partial<AiSettings>;
      return {
        provider: old.provider ?? "anthropic",
        // v3: GPT-6.1 Terra became the OpenAI default (replacing the previous default Sol).
        model: {
          anthropic: old.model?.anthropic || "claude-sonnet-5-5",
          openai: !old.model?.openai || old.model.openai === "gpt-6.1-sol" ? "gpt-6.1-terra" : old.model.openai,
        },
        effort: old.effort ?? "medium",
      };
    },
  }),
);

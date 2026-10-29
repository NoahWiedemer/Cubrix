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

export const useSettings = create<{ quality: Quality; projection: Projection }>()(
  persist(() => ({ quality: "high" as Quality, projection: "perspective" as Projection }), { name: "albedo.settings" }),
);

export interface AiSettings {
  provider: "anthropic" | "openai";
  model: { anthropic: string; openai: string };
}

export const useAiSettings = create<AiSettings>()(
  persist((): AiSettings => ({ provider: "anthropic", model: { anthropic: "claude-sonnet-5-5", openai: "" } }), { name: "albedo.ai" }),
);

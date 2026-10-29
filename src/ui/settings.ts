// User preferences (persisted per machine).
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Projection = "perspective" | "orthographic";

interface ViewSettings {
  projection: Projection;
  /** Build-volume frame (off by default: only the floor grid). */
  showVolume: boolean;
  volumeStrong: boolean;
  showGrid: boolean;
  /** Distance (mm) over which the infinite grid fades out. */
  gridFade: number;
}

export const useSettings = create<ViewSettings>()(
  persist(
    (): ViewSettings => ({ projection: "perspective", showVolume: false, volumeStrong: false, showGrid: true, gridFade: 600 }),
    {
      name: "albedo.settings",
      version: 2,
      // v1: camera inertia removed (damping always off). v2: quality and grid size removed
      // (always high quality; grid spacing follows the snap increment).
      migrate: (stored) => {
        const { inertia: _i, quality: _q, gridSize: _g, ...rest } = (stored ?? {}) as ViewSettings & Record<string, unknown>;
        return { ...rest, showGrid: rest.showGrid ?? true } as ViewSettings;
      },
    },
  ),
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

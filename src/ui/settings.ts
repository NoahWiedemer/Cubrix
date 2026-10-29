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
  /** Objects created by the AI materialize, moves tween (respects reduced motion). */
  aiAnimations: boolean;
  /** Grid line strength in % (100 = the original intensity). */
  gridStrength: number;
  /** Distance (mm) over which the infinite grid fades out. */
  gridFade: number;
}

export const useSettings = create<ViewSettings>()(
  persist(
    (): ViewSettings => ({ projection: "perspective", showVolume: false, volumeStrong: false, showGrid: true, gridStrength: 45, gridFade: 600, aiAnimations: true }),
    {
      name: "albedo.settings",
      version: 3,
      // v1: camera inertia removed (damping always off). v2: quality and grid size removed
      // (always high quality; grid spacing follows the snap increment).
      // v3: grid strength added; everyone starts at the new, weaker default.
      migrate: (stored, version) => {
        const { inertia: _i, quality: _q, gridSize: _g, ...rest } = (stored ?? {}) as ViewSettings & Record<string, unknown>;
        return { ...rest, aiAnimations: (rest as { aiAnimations?: boolean }).aiAnimations ?? true, showGrid: rest.showGrid ?? true, gridStrength: version < 3 ? 45 : (rest.gridStrength ?? 45) } as ViewSettings;
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
    version: 4,
    // v3: GPT-6.1 Terra became the OpenAI default. v4: only the current lineup is offered,
    // so ids outside it (older or list-extended models) fall back to the defaults.
    migrate: (s, version) => {
      const old = s as Partial<AiSettings>;
      const ANTHROPIC = ["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
      const OPENAI = ["gpt-6-astra", "gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-luna"];
      const openai = version < 3 && old.model?.openai === "gpt-6.1-sol" ? "gpt-6.1-terra" : old.model?.openai;
      return {
        provider: old.provider ?? "anthropic",
        model: {
          anthropic: ANTHROPIC.includes(old.model?.anthropic ?? "") ? old.model!.anthropic : "claude-sonnet-5-5",
          openai: OPENAI.includes(openai ?? "") ? openai! : "gpt-6.1-terra",
        },
        effort: old.effort ?? "medium",
      };
    },
  }),
);

// User preferences (persisted per machine).
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { MaterialId } from "../core/materials";

export type Projection = "perspective" | "orthographic";
export type Quality = "high" | "balanced" | "eco";

/** Sharpest render scale per quality level; the display's own ratio is used below that. */
export const MAX_DPR: Record<Quality, number> = { high: 2, balanced: 1.5, eco: 1 };

interface ViewSettings {
  projection: Projection;
  /** Build-volume frame (off by default: only the floor grid). */
  showVolume: boolean;
  volumeStrong: boolean;
  showGrid: boolean;
  /** Objects created by the AI materialize, moves tween (respects reduced motion). */
  aiAnimations: boolean;
  /** Fine matte micro-grain on objects (display only). */
  surfaceTexture: boolean;
  /** Colour picked last; new objects get it (null = neutral). */
  lastColor: string | null;
  /** Material picked last; new objects get it (null = matt). */
  lastMaterial: MaterialId | null;
  /** Custom colours used recently (newest first). */
  recentColors: string[];
  /** Render sharpness in the viewport; lower is cooler and quieter. */
  quality: Quality;
  /** Grid line strength in % (100 = the original intensity). */
  gridStrength: number;
  /** Distance (mm) over which the infinite grid fades out. */
  gridFade: number;
}

export const useSettings = create<ViewSettings>()(
  persist(
    (): ViewSettings => ({ projection: "perspective", showVolume: false, volumeStrong: false, showGrid: true, gridStrength: 45, gridFade: 600, aiAnimations: true, surfaceTexture: true, quality: "balanced", lastColor: null, lastMaterial: null, recentColors: [] }),
    {
      name: "cubrix.settings",
      version: 4,
      // v1: camera inertia removed (damping always off). v2: quality and grid size removed
      // (always high quality; grid spacing follows the snap increment).
      // v3: grid strength added; everyone starts at the new, weaker default.
      // v4: quality is back as a power setting; the old values mean something else.
      migrate: (stored, version) => {
        const { inertia: _i, quality: _q, gridSize: _g, ...rest } = (stored ?? {}) as ViewSettings & Record<string, unknown>;
        return { ...rest, lastColor: (rest as { lastColor?: string | null }).lastColor ?? null, recentColors: (rest as { recentColors?: string[] }).recentColors ?? [], aiAnimations: (rest as { aiAnimations?: boolean }).aiAnimations ?? true, showGrid: rest.showGrid ?? true, gridStrength: version < 3 ? 45 : (rest.gridStrength ?? 45) } as ViewSettings;
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
    name: "cubrix.ai",
    version: 6,
    // v3: GPT-6.1 Terra became the OpenAI default. v4: only the current lineup is offered,
    // so ids outside it (older or list-extended models) fall back to the defaults.
    // v6: web search/fetch is always available (the model uses it only when needed), the toggle is gone.
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

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
  /** Default model; its id decides the provider, there is no separate "active provider". */
  model: string;
  effort: "low" | "medium" | "high";
}

const KNOWN_MODELS = ["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "gpt-6-astra", "gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-luna"];
const DEFAULT_AI_MODEL = "claude-sonnet-5-5";

/**
 * Stored settings of any version. v3: GPT-6.1 Terra became the OpenAI default. v4: only the
 * current lineup is offered. v6: the web search toggle went away. v7: one model instead of
 * a provider plus a model per provider.
 */
export function migrateAi(stored: unknown, version: number): AiSettings {
  const old = (stored ?? {}) as { provider?: "anthropic" | "openai"; model?: Record<string, string> | string; effort?: AiSettings["effort"] };
  let model = typeof old.model === "string" ? old.model : old.model?.[old.provider ?? "anthropic"];
  if (version < 3 && model === "gpt-6.1-sol") model = "gpt-6.1-terra";
  return { model: KNOWN_MODELS.includes(model ?? "") ? model! : DEFAULT_AI_MODEL, effort: old.effort ?? "medium" };
}

export const useAiSettings = create<AiSettings>()(
  persist((): AiSettings => ({ model: DEFAULT_AI_MODEL, effort: "medium" }), { name: "cubrix.ai", version: 7, migrate: migrateAi }),
);

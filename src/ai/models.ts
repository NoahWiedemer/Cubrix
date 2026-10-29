// Curated model catalog with friendly names (IDs stay internal).
// Sources (checked 2026-10-29):
// - Anthropic: Claude API reference (models overview), current models Fable 5.1, Opus 5.5, Sonnet 5.5, Haiku 5.5;
//   depth via `output_config.effort` (low | medium | high | xhigh | max), thinking is adaptive by default.
//   https://docs.anthropic.com/claude/docs/models-overview
// - OpenAI: https://developers.openai.com/api/docs/models (GPT-6 Astra, GPT-6.1 Sol, GPT-6.1 Terra, GPT-6 Luna)
//   and https://developers.openai.com/api/docs/guides/reasoning (`reasoning_effort` in Chat Completions).
import type { Provider } from "./providers";

export type Effort = "low" | "medium" | "high";

export interface ModelInfo {
  id: string;
  name: string;
  hint?: string;
  /** Supports a reasoning-depth setting. */
  effort: boolean;
  recommended: boolean;
}

export const CATALOG: Record<Provider, ModelInfo[]> = {
  anthropic: [
    { id: "claude-fable-5-1", name: "Claude Fable 5.1", hint: "Am stärksten", effort: true, recommended: true },
    { id: "claude-opus-5-5", name: "Claude Opus 5.5", hint: "Sehr stark für komplexe Teile", effort: true, recommended: true },
    { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", hint: "Ausgewogen", effort: true, recommended: true },
    { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", hint: "Am schnellsten", effort: true, recommended: true },
    { id: "claude-opus-5", name: "Claude Opus 5", effort: true, recommended: false },
    { id: "claude-sonnet-5", name: "Claude Sonnet 5", effort: true, recommended: false },
    { id: "claude-opus-4-8", name: "Claude Opus 4.8", effort: true, recommended: false },
    { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", effort: false, recommended: false },
  ],
  openai: [
    { id: "gpt-6-astra", name: "GPT-6 Astra", hint: "Am stärksten", effort: true, recommended: true },
    { id: "gpt-6.1-sol", name: "GPT-6.1 Sol", hint: "Ausgewogen", effort: true, recommended: true },
    { id: "gpt-6.1-terra", name: "GPT-6.1 Terra", hint: "Vielseitig", effort: true, recommended: true },
    { id: "gpt-6-luna", name: "GPT-6 Luna", hint: "Am schnellsten", effort: true, recommended: true },
  ],
};

export const DEFAULT_MODEL: Record<Provider, string> = { anthropic: "claude-sonnet-5-5", openai: "gpt-6.1-sol" };

export const EFFORT_LABELS: Record<Effort, string> = { low: "Niedrig", medium: "Mittel", high: "Hoch" };

/** Friendly name for any id; unknown ids get a tidy version (never shown raw). */
export function modelName(provider: Provider, id: string, apiNames: Record<string, string> = {}): string {
  const known = CATALOG[provider].find((m) => m.id === id);
  if (known) return known.name;
  if (apiNames[id]) return apiNames[id];
  return id
    .replace(/^gpt-/i, "GPT-")
    .replace(/^claude-/i, "Claude ")
    .replace(/-(\d)-(\d)$/, " $1.$2")
    .replace(/-/g, " ")
    .replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

export function modelInfo(provider: Provider, id: string): ModelInfo {
  return CATALOG[provider].find((m) => m.id === id) ?? { id, name: modelName(provider, id), effort: provider === "openai", recommended: false };
}

/** Chat models from the provider's /v1/models list that are not in the catalog. */
export function extraModels(provider: Provider, list: { id: string; display_name?: string }[]): ModelInfo[] {
  const known = new Set(CATALOG[provider].map((m) => m.id));
  return list
    .filter((m) => !known.has(m.id))
    .filter((m) => (provider === "anthropic" ? m.id.startsWith("claude-") : /^(gpt-|o\d)/.test(m.id) && !/(audio|realtime|tts|transcribe|image|embedding|search|instruct)/.test(m.id)))
    .map((m) => ({ id: m.id, name: m.display_name ?? modelName(provider, m.id), effort: provider === "openai", recommended: false }));
}

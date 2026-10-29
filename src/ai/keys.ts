// API keys as the webview sees them: names and masked values only (the secrets stay in Rust).
import { create } from "zustand";
import { isTauri } from "../core/platform";
import type { Provider } from "./providers";

export interface KeyInfo {
  id: string;
  provider: Provider;
  name: string;
  /** e.g. "sk-…a1b2" */
  masked: string;
  createdAt: number;
  active: boolean;
}

export const useKeys = create<{ keys: KeyInfo[]; loaded: boolean }>(() => ({ keys: [], loaded: false }));

async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function refreshKeys() {
  if (!isTauri) return useKeys.setState({ keys: [], loaded: true });
  const keys = await call<KeyInfo[]>("ai_keys_list").catch(() => []);
  useKeys.setState({ keys, loaded: true });
}

export async function addKey(provider: Provider, key: string, name?: string) {
  await call("ai_key_add", { provider, key, name: name ?? null });
  await refreshKeys();
}
export async function renameKey(id: string, name: string) {
  await call("ai_key_rename", { id, name });
  await refreshKeys();
}
export async function deleteKey(id: string) {
  await call("ai_key_delete", { id });
  await refreshKeys();
}
export async function activateKey(id: string) {
  await call("ai_key_activate", { id });
  await refreshKeys();
}

/** Providers that currently have an active key. */
export const connectedProviders = (keys: KeyInfo[]): Provider[] =>
  (["anthropic", "openai"] as Provider[]).filter((p) => keys.some((k) => k.provider === p && k.active));

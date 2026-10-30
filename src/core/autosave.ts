// Autosave + crash recovery and the list of recently opened projects.
// Every 30 s unsaved changes are written to the app folder (Rust; localStorage in the
// browser). On start, unsaved work found there is offered for restore. Saving clears it.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useApp } from "./store";
import { chatUnsaved, useChat } from "../ai/chatStore";
import { isTauri } from "./platform";

const KEY = "cubrix.autosave";
let lastWritten: string | null = null;

// Dev builds share the app data folder: they must never touch the real app's recovery file.
const useFile = isTauri && !import.meta.env.DEV;

async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

async function writeAutosave(text: string) {
  if (useFile) await call("autosave_write", { text });
  else
    try {
      localStorage.setItem(KEY, text);
    } catch {
      /* quota: skip */
    }
}

export async function readAutosave(): Promise<string | null> {
  if (useFile) return call<string | null>("autosave_read").catch(() => null);
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export async function clearAutosave() {
  lastWritten = null;
  if (useFile) await call("autosave_clear").catch(() => {});
  else
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
}

/** Starts the 30 s autosave loop; `serialize` returns the current project text. */
export function startAutosave(serialize: () => string) {
  setInterval(() => {
    const s = useApp.getState();
    if (s.savedNodeId === s.currentId && !chatUnsaved()) return; // nothing unsaved
    // The chat counts too: a conversation without model changes is still worth keeping.
    const state = `${s.currentId}:${useChat.getState().entries.length}`;
    if (state === lastWritten) return; // unchanged since the last autosave
    lastWritten = state;
    void writeAutosave(serialize()).catch(() => {});
  }, 30_000);
}

/** Recovered work waiting for the user's decision (shown as a banner). */
export const useRecovery = create<{ text: string | null; name: string; time: string }>(() => ({ text: null, name: "", time: "" }));

export async function checkRecovery() {
  const text = await readAutosave();
  if (!text) return;
  try {
    const raw = JSON.parse(text);
    const name = raw.document?.name ?? "Projekt";
    const nodes = Object.values(raw.history?.nodes ?? {}) as { time: number }[];
    const t = nodes.length ? Math.max(...nodes.map((n) => n.time)) : Date.now();
    useRecovery.setState({ text, name, time: new Date(t).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) });
  } catch {
    void clearAutosave();
  }
}

// ── Recent files ─────────────────────────────────────────────────────────────

export const useRecent = create<{ paths: string[] }>()(persist(() => ({ paths: [] as string[] }), { name: "cubrix.recent" }));
export const addRecent = (path: string) => useRecent.setState((s) => ({ paths: [path, ...s.paths.filter((p) => p !== path)].slice(0, 8) }));
export const removeRecent = (path: string) => useRecent.setState((s) => ({ paths: s.paths.filter((p) => p !== path) }));

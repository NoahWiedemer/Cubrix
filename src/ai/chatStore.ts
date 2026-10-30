// Conversation state (survives closing the panel; saved with the project).
import { create } from "zustand";
import type { FriendlyError } from "./errors";
import type { Message } from "./providers";

export interface ChatStep {
  label: string;
  nodeId?: string;
  ok: boolean;
  error?: string;
}

export interface ChatEntry {
  role: "user" | "assistant";
  text: string;
  steps: ChatStep[];
  error?: FriendlyError;
  prompt?: string;
  /** History group of the run (to undo it as a whole). */
  groupId?: string;
  durationMs?: number;
  sources?: { url: string; title: string }[];
}

interface ChatState {
  entries: ChatEntry[];
  api: Message[];
  running: boolean;
  /** Entries already stored in the project file (more = unsaved chat). */
  savedEntries: number;
  /** Bumped per project; a run from an earlier project must not write into this one. */
  generation: number;
  /** Stops the running request (set by the chat panel). */
  abortRun: (() => void) | null;
}

// The chat belongs to the project: it lives here only while that project is open and is
// saved with it (file or autosave), never in app-wide storage.
export const useChat = create<ChatState>(() => ({ entries: [], api: [], running: false, savedEntries: 0, generation: 0, abortRun: null }));

/** Switches to another project's chat (empty for a new project) and stops a running request. */
export function setProjectChat(entries: ChatEntry[] = [], api: Message[] = []) {
  useChat.getState().abortRun?.();
  useChat.setState((s) => ({ entries, api, running: false, savedEntries: entries.length, generation: s.generation + 1 }));
}

export const chatUnsaved = () => useChat.getState().entries.length !== useChat.getState().savedEntries;

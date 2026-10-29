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

export const useChat = create<{ entries: ChatEntry[]; api: Message[]; running: boolean }>(() => ({ entries: [], api: [], running: false }));

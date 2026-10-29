import { create } from "zustand";

/** One-shot camera requests from commands (handled by the viewport's camera rig). */
export const useViewRequest = create<{ request: { kind: "iso" | "fit"; at: number } | null }>(() => ({ request: null }));

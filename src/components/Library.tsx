import { create } from "zustand";

/** Shape library state (panel open/closed, current drag). */
export const useLibrary = create<{ open: boolean }>(() => ({ open: false }));

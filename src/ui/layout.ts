// Panel layout store, persisted in localStorage (survives restarts in the Tauri webview too).
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { IconName } from "./icons";
import { DEFAULT_PANELS, DEFAULT_WIDTH, MAX_WIDTH, MIN_WIDTH, movePanel, normalize, type PanelId, type PanelState, type Panels, type Side } from "./layoutModel";

export type { PanelId, PanelState, Side };

interface LayoutState {
  panels: Panels;
  width: Record<Side, number>;
  dragging: PanelId | null;
  setPanel(id: PanelId, patch: Partial<PanelState>): void;
  move(id: PanelId, side: Side, index: number): void;
  setWidth(side: Side, w: number): void;
  reset(): void;
}

export const PANEL_ICONS: Record<PanelId, IconName> = { tree: "boxes", history: "history", props: "sliders", chat: "ai" };

export const PANEL_TITLES: Record<PanelId, string> = { tree: "Objekte", history: "Verlauf", props: "Eigenschaften", chat: "KI-Assistent" };

export const useLayout = create<LayoutState>()(
  persist(
    (set) => ({
      panels: structuredClone(DEFAULT_PANELS),
      width: { ...DEFAULT_WIDTH },
      dragging: null,
      setPanel: (id, patch) => set((s) => ({ panels: { ...s.panels, [id]: { ...s.panels[id], ...patch } } })),
      move: (id, side, index) => set((s) => ({ panels: movePanel(s.panels, id, side, index) })),
      setWidth: (side, w) => set((s) => ({ width: { ...s.width, [side]: Math.round(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w))) } })),
      reset: () => set({ panels: structuredClone(DEFAULT_PANELS), width: { ...DEFAULT_WIDTH } }),
    }),
    {
      name: "albedo.layout",
      version: 2,
      partialize: (s) => ({ panels: s.panels, width: s.width }),
      // Any stored shape (older versions, hand-edited, partially written) is repaired on load.
      migrate: (stored) => normalize(stored),
      merge: (stored, current) => ({ ...current, ...normalize(stored) }),
    },
  ),
);

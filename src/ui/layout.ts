// Panel layout: which side each panel docks to, order, size, collapsed/closed.
// Persisted in localStorage (survives restarts in the Tauri webview too).
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type PanelId = "tree" | "history" | "props";
export type Side = "left" | "right";

export interface PanelState {
  side: Side;
  order: number;
  collapsed: boolean;
  open: boolean;
  /** Share of the column height relative to the other expanded panels. */
  weight: number;
}

interface LayoutState {
  panels: Record<PanelId, PanelState>;
  width: Record<Side, number>;
  dragging: PanelId | null;
  setPanel(id: PanelId, patch: Partial<PanelState>): void;
  move(id: PanelId, side: Side, index: number): void;
  setWidth(side: Side, w: number): void;
  reset(): void;
}

const DEFAULT_PANELS: Record<PanelId, PanelState> = {
  tree: { side: "left", order: 0, collapsed: false, open: true, weight: 1.2 },
  history: { side: "left", order: 1, collapsed: false, open: true, weight: 1 },
  props: { side: "right", order: 0, collapsed: false, open: true, weight: 1 },
};
const DEFAULT_WIDTH: Record<Side, number> = { left: 260, right: 300 };

export const PANEL_TITLES: Record<PanelId, string> = { tree: "Objekte", history: "Verlauf", props: "Eigenschaften" };

export const useLayout = create<LayoutState>()(
  persist(
    (set) => ({
      panels: structuredClone(DEFAULT_PANELS),
      width: { ...DEFAULT_WIDTH },
      dragging: null,
      setPanel: (id, patch) => set((s) => ({ panels: { ...s.panels, [id]: { ...s.panels[id], ...patch } } })),
      move: (id, side, index) =>
        set((s) => {
          const ids = (Object.keys(s.panels) as PanelId[])
            .filter((p) => p !== id && s.panels[p].side === side)
            .sort((a, b) => s.panels[a].order - s.panels[b].order);
          ids.splice(Math.max(0, Math.min(index, ids.length)), 0, id);
          const panels = { ...s.panels };
          ids.forEach((p, i) => (panels[p] = { ...panels[p], side, order: i, open: true }));
          return { panels };
        }),
      setWidth: (side, w) => set((s) => ({ width: { ...s.width, [side]: Math.round(Math.max(200, Math.min(520, w))) } })),
      reset: () => set({ panels: structuredClone(DEFAULT_PANELS), width: { ...DEFAULT_WIDTH } }),
    }),
    { name: "modelonio.layout", version: 1, partialize: (s) => ({ panels: s.panels, width: s.width }) },
  ),
);

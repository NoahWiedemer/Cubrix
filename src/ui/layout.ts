// Panel layout store, persisted in localStorage (survives restarts in the Tauri webview too).
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { IconName } from "./icons";
import {
  clampColumnWidth,
  defaultLayout,
  dropAtSlot,
  dropPanel,
  normalize,
  setActive,
  setMode,
  setOpen,
  type LayoutData,
  type PanelId,
  type PanelState,
  type Side,
  type SideMode,
} from "./layoutModel";

export type { PanelId, PanelState, Side, SideMode };

interface LayoutState extends LayoutData {
  dragging: PanelId | null;
  /** Where the dragged panel would land (shown as a mint insertion line). */
  slot: { side: Side; index: number } | null;
  dropAt(id: PanelId, side: Side, slot: number): void;
  setPanel(id: PanelId, patch: Partial<PanelState>): void;
  open(id: PanelId, open: boolean): void;
  drop(id: PanelId, side: Side, index: number): void;
  move(id: PanelId, side: Side, index: number): void;
  activate(side: Side, id: PanelId): void;
  setMode(side: Side, mode: SideMode): void;
  setHidden(side: Side, hidden: boolean): void;
  setWidth(side: Side, w: number): void;
  reset(): void;
}

export const PANEL_ICONS: Record<PanelId, IconName> = { tree: "boxes", history: "history", chat: "ai", inspector: "sliders" };
export const PANEL_TITLES: Record<PanelId, string> = { tree: "Objekte", history: "Verlauf", chat: "KI-Assistent", inspector: "Inspektor" };

const data = (s: LayoutState): LayoutData => ({ rev: s.rev, panels: s.panels, width: s.width, mode: s.mode, active: s.active, hidden: s.hidden });

export const useLayout = create<LayoutState>()(
  persist(
    (set) => ({
      ...defaultLayout(),
      dragging: null,
      slot: null,
      dropAt: (id, side, slot) => set((s) => dropAtSlot(data(s), id, side, slot)),
      setPanel: (id, patch) => set((s) => ({ panels: { ...s.panels, [id]: { ...s.panels[id], ...patch } } })),
      open: (id, open) => set((s) => setOpen(data(s), id, open)),
      drop: (id, side, index) => set((s) => dropPanel(data(s), id, side, index)),
      move: (id, side, index) => set((s) => dropPanel(data(s), id, side, index)),
      activate: (side, id) => set((s) => setActive(data(s), side, id)),
      setMode: (side, mode) => set((s) => setMode(data(s), side, mode)),
      setHidden: (side, hidden) => set((s) => ({ hidden: { ...s.hidden, [side]: hidden } })),
      setWidth: (side, w) => set((s) => ({ width: { ...s.width, [side]: clampColumnWidth(w, window.innerWidth) } })),
      reset: () => set(defaultLayout()),
    }),
    {
      name: "albedo.layout",
      version: 4,
      partialize: (s) => data(s),
      // Older layouts (floating properties, no inspector) are replaced by the new default once.
      migrate: (stored) => normalize(stored),
      merge: (stored, current) => ({ ...current, ...normalize(stored) }),
    },
  ),
);

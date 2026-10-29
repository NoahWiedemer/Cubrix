// Pure dock model (no React/zustand) so it can be unit-tested.
export type PanelId = "tree" | "history" | "props" | "chat";
export type Side = "left" | "right";

export interface PanelState {
  side: Side;
  order: number;
  collapsed: boolean;
  open: boolean;
  /** Share of the column height relative to the other expanded panels. */
  weight: number;
}

export type Panels = Record<PanelId, PanelState>;

export const PANEL_IDS: PanelId[] = ["tree", "history", "props", "chat"];

export const DEFAULT_PANELS: Panels = {
  tree: { side: "left", order: 0, collapsed: false, open: true, weight: 1.2 },
  history: { side: "left", order: 1, collapsed: false, open: true, weight: 1 },
  props: { side: "right", order: 0, collapsed: false, open: true, weight: 1 },
  chat: { side: "right", order: 1, collapsed: false, open: true, weight: 1 },
};
export const DEFAULT_WIDTH: Record<Side, number> = { left: 260, right: 340 };
export const MIN_WIDTH = 200;
export const MAX_WIDTH = 520;

/** Panels of one side in display order. */
export function column(panels: Panels, side: Side): PanelId[] {
  return PANEL_IDS.filter((id) => panels[id].side === side).sort((a, b) => panels[a].order - panels[b].order);
}

/** Renumbers orders 0..n-1 per side so they stay dense and unique. */
function renumber(panels: Panels): Panels {
  const next = { ...panels };
  for (const side of ["left", "right"] as Side[])
    column(next, side).forEach((id, i) => (next[id] = { ...next[id], order: i }));
  return next;
}

/** Moves a panel to `side` at `index` (clamped); the panel is opened. */
export function movePanel(panels: Panels, id: PanelId, side: Side, index: number): Panels {
  const ids = column(panels, side).filter((p) => p !== id);
  ids.splice(Math.max(0, Math.min(index, ids.length)), 0, id);
  const next = { ...panels };
  next[id] = { ...next[id], side, open: true };
  ids.forEach((p, i) => (next[p] = { ...next[p], order: i }));
  return renumber(next);
}

const clampWidth = (w: unknown, fallback: number) =>
  typeof w === "number" && Number.isFinite(w) ? Math.round(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w))) : fallback;

/** Repairs anything loaded from storage: unknown/missing panels, bad numbers, duplicate orders. */
export function normalize(raw: unknown): { panels: Panels; width: Record<Side, number> } {
  const r = (raw ?? {}) as { panels?: Partial<Record<string, Partial<PanelState>>>; width?: Partial<Record<Side, unknown>> };
  const panels = {} as Panels;
  for (const id of PANEL_IDS) {
    const p = r.panels?.[id] ?? {};
    const d = DEFAULT_PANELS[id];
    panels[id] = {
      side: p.side === "left" || p.side === "right" ? p.side : d.side,
      order: typeof p.order === "number" && Number.isFinite(p.order) ? p.order : d.order,
      collapsed: typeof p.collapsed === "boolean" ? p.collapsed : d.collapsed,
      open: typeof p.open === "boolean" ? p.open : d.open,
      weight: typeof p.weight === "number" && p.weight > 0.05 && p.weight < 50 ? p.weight : d.weight,
    };
  }
  return {
    panels: renumber(panels),
    width: { left: clampWidth(r.width?.left, DEFAULT_WIDTH.left), right: clampWidth(r.width?.right, DEFAULT_WIDTH.right) },
  };
}

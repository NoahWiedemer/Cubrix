// Pure dock model (no React/zustand) so it can be unit-tested.
// Each side shows its panels either as tabs (default) or as stacked sections.
export type PanelId = "tree" | "history" | "chat" | "inspector";
export type Side = "left" | "right";
export type SideMode = "tabs" | "stack";

export interface PanelState {
  side: Side;
  order: number;
  collapsed: boolean;
  open: boolean;
  /** Share of the column height relative to the other expanded panels (stack mode). */
  weight: number;
}

export type Panels = Record<PanelId, PanelState>;

export interface LayoutData {
  rev: number;
  panels: Panels;
  width: Record<Side, number>;
  mode: Record<Side, SideMode>;
  active: Record<Side, PanelId | null>;
  /** Whole sidebar collapsed to a slim icon strip. */
  hidden: Record<Side, boolean>;
}

export const PANEL_IDS: PanelId[] = ["tree", "history", "chat", "inspector"];

export const DEFAULT_PANELS: Panels = {
  chat: { side: "left", order: 0, collapsed: false, open: true, weight: 2 },
  tree: { side: "left", order: 1, collapsed: false, open: true, weight: 1 },
  history: { side: "left", order: 2, collapsed: true, open: true, weight: 1 },
  inspector: { side: "right", order: 0, collapsed: false, open: true, weight: 1 },
};

/** Bumped whenever the default arrangement changes; older stored layouts are replaced once. */
export const LAYOUT_REV = 4;
export const DEFAULT_WIDTH: Record<Side, number> = { left: 300, right: 300 };

export function defaultLayout(): LayoutData {
  return {
    rev: LAYOUT_REV,
    panels: structuredClone(DEFAULT_PANELS),
    width: { ...DEFAULT_WIDTH },
    mode: { left: "stack", right: "stack" },
    active: { left: "chat", right: "inspector" },
    hidden: { left: false, right: false },
  };
}

export const MIN_WIDTH = 240;
/** Max column width as a share of the window. */
export const MAX_SHARE = 0.45;

export function clampColumnWidth(w: number, windowWidth: number): number {
  return Math.round(Math.max(MIN_WIDTH, Math.min(Math.max(MIN_WIDTH, windowWidth * MAX_SHARE), w)));
}

/**
 * Width after dragging a column's inner edge by `dx` pixels (positive = right).
 * Left column: dragging right widens it. Right column: dragging left widens it.
 */
export function resizeColumn(side: Side, startWidth: number, dx: number, windowWidth: number): number {
  return clampColumnWidth(startWidth + (side === "left" ? dx : -dx), windowWidth);
}

/** Open panels of one side in display order. */
export function column(panels: Panels, side: Side, includeClosed = false): PanelId[] {
  return PANEL_IDS.filter((id) => panels[id].side === side && (includeClosed || panels[id].open)).sort(
    (a, b) => panels[a].order - panels[b].order,
  );
}

/** Renumbers orders 0..n-1 per side so they stay dense and unique. */
function renumber(panels: Panels): Panels {
  const next = { ...panels };
  for (const side of ["left", "right"] as Side[])
    column(next, side, true).forEach((id, i) => (next[id] = { ...next[id], order: i }));
  return next;
}

/** Moves a panel to `side` at `index` among that side's panels (clamped); the panel is opened. */
export function movePanel(panels: Panels, id: PanelId, side: Side, index: number): Panels {
  const ids = column(panels, side, true).filter((p) => p !== id);
  ids.splice(Math.max(0, Math.min(index, ids.length)), 0, id);
  const next = { ...panels };
  next[id] = { ...next[id], side, open: true };
  ids.forEach((p, i) => (next[p] = { ...next[p], order: i }));
  return renumber(next);
}

/** Keeps each side's active tab valid (an open panel of that side, else the first one). */
function fixActive(l: LayoutData): LayoutData {
  const active = { ...l.active };
  for (const side of ["left", "right"] as Side[]) {
    const ids = column(l.panels, side);
    if (!active[side] || !ids.includes(active[side]!)) active[side] = ids[0] ?? null;
  }
  return { ...l, active };
}

/** Drop of a dragged panel: onto a side at an index (tabs or stack); it becomes the active tab there. */
export function dropPanel(l: LayoutData, id: PanelId, side: Side, index: number): LayoutData {
  const panels = movePanel(l.panels, id, side, index);
  return fixActive({ ...l, panels, active: { ...l.active, [side]: id }, hidden: { ...l.hidden, [side]: false } });
}

export function setMode(l: LayoutData, side: Side, mode: SideMode): LayoutData {
  return fixActive({ ...l, mode: { ...l.mode, [side]: mode } });
}

export function setActive(l: LayoutData, side: Side, id: PanelId): LayoutData {
  return { ...l, active: { ...l.active, [side]: id }, hidden: { ...l.hidden, [side]: false } };
}

export function setOpen(l: LayoutData, id: PanelId, open: boolean): LayoutData {
  const side = l.panels[id].side;
  const next = { ...l, panels: { ...l.panels, [id]: { ...l.panels[id], open, collapsed: false } } };
  return fixActive(open ? { ...next, active: { ...next.active, [side]: id }, hidden: { ...next.hidden, [side]: false } } : next);
}

const clampWidth = (w: unknown, fallback: number) =>
  typeof w === "number" && Number.isFinite(w) ? Math.round(Math.max(MIN_WIDTH, Math.min(900, w))) : fallback;

/**
 * Repairs anything loaded from storage. Layouts from before the inspector/tab redesign
 * (they had a "props" panel and no "inspector") are replaced by the new default.
 */
export function normalize(raw: unknown): LayoutData {
  const r = (raw ?? {}) as Partial<LayoutData> & { panels?: Record<string, Partial<PanelState>> };
  if (!r.panels || r.rev !== LAYOUT_REV) return defaultLayout();
  const d = defaultLayout();
  const panels = {} as Panels;
  for (const id of PANEL_IDS) {
    const p = r.panels[id] ?? {};
    const def = DEFAULT_PANELS[id];
    panels[id] = {
      side: p.side === "left" || p.side === "right" ? p.side : def.side,
      order: typeof p.order === "number" && Number.isFinite(p.order) ? p.order : def.order,
      collapsed: typeof p.collapsed === "boolean" ? p.collapsed : def.collapsed,
      open: typeof p.open === "boolean" ? p.open : def.open,
      weight: typeof p.weight === "number" && p.weight > 0.05 && p.weight < 50 ? p.weight : def.weight,
    };
  }
  const side = (v: unknown): v is SideMode => v === "tabs" || v === "stack";
  return fixActive({
    rev: LAYOUT_REV,
    panels: renumber(panels),
    width: { left: clampWidth(r.width?.left, d.width.left), right: clampWidth(r.width?.right, d.width.right) },
    mode: { left: side(r.mode?.left) ? r.mode!.left : "stack", right: side(r.mode?.right) ? r.mode!.right : "stack" },
    active: { left: r.active?.left ?? null, right: r.active?.right ?? null },
    hidden: { left: !!r.hidden?.left, right: !!r.hidden?.right },
  });
}

// Object list: which rows are visible, Finder-style arrow navigation, and where a dragged
// row lands. Pure functions (tested); the open/renaming state lives in useTree.
import { create } from "zustand";
import { childrenOf, type Feature } from "../core/document";

export interface TreeRow {
  id: string;
  depth: number;
  parentId: string | null;
  /** Group or boolean: can be opened. */
  branch: boolean;
  group: boolean;
}

export type DropWhere = "before" | "after" | "into";

interface TreeState {
  open: string[];
  renaming: string | null;
  /** Start of a Shift+arrow range. */
  anchor: string | null;
  drop: { id: string | null; where: DropWhere } | null;
}

export const useTree = create<TreeState>(() => ({ open: [], renaming: null, anchor: null, drop: null }));

/** Rows on screen, top to bottom. `isOpen` decides which branches show their children. */
export function visibleRows(features: Feature[], isOpen: (id: string) => boolean): TreeRow[] {
  const out: TreeRow[] = [];
  const walk = (list: Feature[], depth: number, parentId: string | null) => {
    for (const f of list) {
      const kids = childrenOf(f);
      out.push({ id: f.id, depth, parentId, branch: !!kids, group: f.type === "group" });
      if (kids && isOpen(f.id)) walk(kids, depth + 1, f.id);
    }
  };
  walk(features, 0, null);
  return out;
}

/** Row above/below; stays put at the ends. Without a cursor: the first or last row. */
export function stepRow(rows: TreeRow[], cursor: string | undefined, dir: 1 | -1): string | null {
  if (!rows.length) return null;
  const i = rows.findIndex((r) => r.id === cursor);
  if (i < 0) return (dir > 0 ? rows[0] : rows[rows.length - 1]).id;
  return rows[Math.max(0, Math.min(rows.length - 1, i + dir))].id;
}

/** All rows between anchor and cursor, for Shift+arrow. */
export function rangeRows(rows: TreeRow[], anchor: string, cursor: string): string[] {
  const a = rows.findIndex((r) => r.id === anchor);
  const b = rows.findIndex((r) => r.id === cursor);
  if (a < 0 || b < 0) return [cursor];
  const [from, to] = a < b ? [a, b] : [b, a];
  return rows.slice(from, to + 1).map((r) => r.id);
}

/** Drop position inside a row: groups accept drops in their middle, others split in half. */
export function dropWhere(fraction: number, group: boolean): DropWhere {
  if (group) return fraction < 0.28 ? "before" : fraction > 0.72 ? "after" : "into";
  return fraction < 0.5 ? "before" : "after";
}

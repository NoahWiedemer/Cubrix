// Kanten wählen: pick single edges of the selected body for Abrunden/Fasen. Edges come from
// the kernel in the body's own frame; the viewport does the hit test in screen space.
import { create } from "zustand";
import type { EdgeInfo } from "../cad/protocol";
import { listBodyEdges } from "../cad/kernel";
import { findFeature, geometryKey, type EdgeRef } from "../core/document";
import { useApp } from "../core/store";

interface EdgePickState {
  /** The body being edited (null = mode off). */
  id: string | null;
  key: string;
  edges: EdgeInfo[];
  picked: number[];
  hover: number | null;
}

export const useEdgePick = create<EdgePickState>(() => ({ id: null, key: "", edges: [], picked: [], hover: null }));

/** Loads the body's current edges; the picks are kept only if the body is unchanged. */
async function load(id: string) {
  const s = useApp.getState();
  const f = findFeature(s.nodes[s.currentId].doc, id);
  if (!f) return;
  const key = geometryKey(f);
  const edges = await listBodyEdges(f);
  useEdgePick.setState((st) => (st.id === id ? { edges, key, picked: st.key === key ? st.picked : [], hover: null } : st));
}

export function startEdgePick(id: string) {
  useEdgePick.setState({ id, key: "", edges: [], picked: [], hover: null });
  void load(id);
}

export const stopEdgePick = () => useEdgePick.setState({ id: null, key: "", edges: [], picked: [], hover: null });

/** Plain click picks one edge, Shift adds or removes it. */
export function togglePick(index: number, add: boolean) {
  useEdgePick.setState((s) => {
    if (!add) return { picked: s.picked.length === 1 && s.picked[0] === index ? [] : [index] };
    return { picked: s.picked.includes(index) ? s.picked.filter((i) => i !== index) : [...s.picked, index] };
  });
}

export const pickedRefs = (): EdgeRef[] => {
  const { edges, picked } = useEdgePick.getState();
  return picked.map((i) => edges[i].ref);
};

/** Nearest edge to a screen point; `project` maps a local point to pixels (null = off screen). */
export function nearestEdge(
  edges: EdgeInfo[],
  x: number,
  y: number,
  project: (p: [number, number, number]) => [number, number] | null,
  maxPx = 9,
): number | null {
  let best: number | null = null;
  let bestD = maxPx;
  edges.forEach((e, i) => {
    for (let k = 0; k + 1 < e.points.length; k++) {
      const a = project(e.points[k]);
      const b = project(e.points[k + 1]);
      if (!a || !b) continue;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / len2)) : 0;
      const d = Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
  });
  return best;
}

// The mode ends with Esc, or when the selection moves on; after an edit the edges are reloaded.
if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && useEdgePick.getState().id) {
      e.stopPropagation();
      stopEdgePick();
    }
  }, true);
  useApp.subscribe((s, prev) => {
    const { id, key } = useEdgePick.getState();
    if (!id) return;
    if (s.selection.length !== 1 || s.selection[0] !== id || s.workspace !== "model") return stopEdgePick();
    if (s.currentId === prev.currentId) return;
    const f = findFeature(s.nodes[s.currentId].doc, id);
    if (!f) return stopEdgePick();
    if (geometryKey(f) !== key) void load(id);
  });
}

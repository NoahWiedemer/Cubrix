// Messen (M): click two points (on bodies or the bed) to read the distance and the
// per-axis offsets. Points snap to nearby mesh corners. A third click starts anew; Esc ends.
import { create } from "zustand";
import type { Vec3 } from "../core/document";

export const useMeasure = create<{ active: boolean; points: Vec3[] }>(() => ({ active: false, points: [] }));

export function addMeasurePoint(p: Vec3) {
  const { points } = useMeasure.getState();
  useMeasure.setState({ points: points.length >= 2 ? [p] : [...points, p] });
}

if (typeof window !== "undefined")
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && useMeasure.getState().active) useMeasure.setState({ active: false, points: [] });
  });

// Messen (M): click two points (on bodies or the bed) to read the distance and the
// per-axis offsets, or – in Winkel mode – three points (arm, vertex, arm) for the angle
// at the middle one. Points snap to nearby mesh corners. One more click starts anew; Esc ends.
import { create } from "zustand";
import type { Vec3 } from "../core/document";

export type MeasureMode = "distance" | "angle";

export const useMeasure = create<{ active: boolean; mode: MeasureMode; points: Vec3[] }>(() => ({ active: false, mode: "distance", points: [] }));

export const pointsNeeded = (mode: MeasureMode) => (mode === "angle" ? 3 : 2);

export function addMeasurePoint(p: Vec3) {
  const { points, mode } = useMeasure.getState();
  useMeasure.setState({ points: points.length >= pointsNeeded(mode) ? [p] : [...points, p] });
}

export const setMeasureMode = (mode: MeasureMode) => useMeasure.setState({ mode, points: [] });

/** Angle in degrees at vertex `b` between the arms to `a` and `c` (0–180). */
export function angleAt(a: Vec3, b: Vec3, c: Vec3): number {
  const u = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const v = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
  const lu = Math.hypot(...u);
  const lv = Math.hypot(...v);
  if (lu < 1e-9 || lv < 1e-9) return 0;
  const cos = Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (lu * lv)));
  return (Math.acos(cos) * 180) / Math.PI;
}

if (typeof window !== "undefined")
  window.addEventListener("keydown", (e) => {
    if (!useMeasure.getState().active) return;
    if (e.key === "Escape") useMeasure.setState({ active: false, points: [] });
    // Tab switches between Abstand and Winkel while measuring.
    else if (e.key === "Tab" && !(e.target as HTMLElement)?.closest?.("input, textarea")) {
      e.preventDefault();
      setMeasureMode(useMeasure.getState().mode === "angle" ? "distance" : "angle");
    }
  });

// One axis palette for gizmo and axis indicator: rich greens separated by hue
// (teal → emerald → olive-lime) and lightness so the axes never get confused.
export const AXIS_COLORS = ["#1f8f80", "#2fa866", "#86b232"] as const; // X teal, Y emerald, Z lime
export const AXIS_HOVER = ["#4fc7b6", "#5fd894", "#b2df5c"] as const;

/** Mix of two hex colours, used for plane handles. */
export function mix(a: string, b: string): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return "#" + x.map((v, i) => Math.round((v + y[i]) / 2).toString(16).padStart(2, "0")).join("");
}

// One axis palette for gizmo, axis indicator and property fields (green/mint family,
// separated by both hue and lightness so the axes never get confused).
export const AXIS_COLORS = ["#26a69a", "#a3e36b", "#cdf6ea"] as const; // X teal, Y lime, Z pale aqua
export const AXIS_HOVER = ["#4fd6c7", "#c4f590", "#ffffff"] as const;

/** Mix of two hex colours, used for plane handles. */
export function mix(a: string, b: string): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return "#" + x.map((v, i) => Math.round((v + y[i]) / 2).toString(16).padStart(2, "0")).join("");
}

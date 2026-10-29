// Editable dimensions of a single 2D shape in a sketch (Inspector "Formen" list and the
// sketch.setShape command). Positions are shape centres; sizes are what a person measures
// (diameter, width × depth), not the internal radii.
import type { SketchShape } from "./document";
import { profileBounds, resizeProfile } from "./scale";

export type ShapeField = "width" | "depth" | "diameter" | "radius" | "sides" | "angle" | "x" | "y";

export interface FieldSpec {
  key: ShapeField;
  /** One-letter field label. */
  label: string;
  caption: string;
  value: number;
  unit: string;
  min?: number;
  step?: number;
}

export const SHAPE_LABELS: Record<SketchShape["kind"], string> = {
  rect: "Rechteck", circle: "Kreis", polygon: "Vieleck", poly: "Linienzug", ellipse: "Ellipse", slot: "Langloch", rrect: "Abgerundetes Rechteck", path: "Pfad",
};

const r2 = (n: number) => Math.round(n * 100) / 100;

function center(s: SketchShape): [number, number] {
  switch (s.kind) {
    case "rect":
    case "rrect":
      return [s.x + s.w / 2, s.y + s.h / 2];
    case "circle":
    case "polygon":
    case "ellipse":
    case "slot":
      return [s.cx, s.cy];
    default: {
      const b = profileBounds([s])!;
      return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
    }
  }
}

const size = (key: "width" | "depth", label: string, caption: string, value: number): FieldSpec => ({ key, label, caption, value: r2(value), unit: "mm", min: 0.1 });

/** The fields shown for a shape, in display order (size fields first, then X/Y). */
export function shapeFields(s: SketchShape): FieldSpec[] {
  const [cx, cy] = center(s);
  const pos: FieldSpec[] = [
    { key: "x", label: "X", caption: "X", value: r2(cx), unit: "mm" },
    { key: "y", label: "Y", caption: "Y", value: r2(cy), unit: "mm" },
  ];
  const angle = (a = 0): FieldSpec => ({ key: "angle", label: "W", caption: "Winkel", value: r2(a), unit: "°", step: 5 });
  switch (s.kind) {
    case "rect":
      return [size("width", "B", "Breite", s.w), size("depth", "T", "Tiefe", s.h), ...pos];
    case "rrect":
      return [size("width", "B", "Breite", s.w), size("depth", "T", "Tiefe", s.h), { key: "radius", label: "R", caption: "Eckradius", value: r2(s.r), unit: "mm", min: 0, step: 0.5 }, ...pos];
    case "circle":
      return [{ key: "diameter", label: "Ø", caption: "Durchmesser", value: r2(s.r * 2), unit: "mm", min: 0.1 }, ...pos];
    case "polygon":
      return [{ key: "diameter", label: "Ø", caption: "Durchmesser", value: r2(s.r * 2), unit: "mm", min: 0.1 }, { key: "sides", label: "N", caption: "Ecken", value: s.sides, unit: "", min: 3 }, ...pos];
    case "ellipse":
      return [size("width", "B", "Breite", s.rx * 2), size("depth", "T", "Tiefe", s.ry * 2), angle(s.angle), ...pos];
    case "slot":
      return [size("width", "L", "Länge", s.length), size("depth", "B", "Breite", s.width), angle(s.angle), ...pos];
    case "poly":
    case "path": {
      const b = profileBounds([s])!;
      return [size("width", "B", "Breite", b.maxX - b.minX), size("depth", "T", "Tiefe", b.maxY - b.minY), ...pos];
    }
  }
}

/** Moves a shape by (dx, dy). */
function shift(s: SketchShape, dx: number, dy: number): SketchShape {
  const p = ([x, y]: [number, number]) => [r2(x + dx), r2(y + dy)] as [number, number];
  switch (s.kind) {
    case "rect":
    case "rrect":
      return { ...s, x: r2(s.x + dx), y: r2(s.y + dy) };
    case "circle":
    case "polygon":
    case "ellipse":
    case "slot":
      return { ...s, cx: r2(s.cx + dx), cy: r2(s.cy + dy) };
    case "poly":
      return { ...s, points: s.points.map(p) };
    case "path":
      return { ...s, start: p(s.start), segments: s.segments.map((g) => (g.type === "arc" ? { ...g, to: p(g.to), via: p(g.via) } : { ...g, to: p(g.to) })) };
  }
}

/**
 * Sets one field; sizes change around the shape's centre. Throws a readable error for
 * values that make no shape (e.g. a corner radius larger than half the side).
 */
export function setShapeField(s: SketchShape, key: ShapeField, value: number): SketchShape {
  const [cx, cy] = center(s);
  if (key === "x") return shift(s, value - cx, 0);
  if (key === "y") return shift(s, 0, value - cy);
  if (!Number.isFinite(value)) throw new Error("Bitte eine Zahl eingeben.");
  if (key !== "angle" && value < (key === "radius" ? 0 : key === "sides" ? 3 : 0.1))
    throw new Error(key === "sides" ? "Ein Vieleck braucht mindestens 3 Ecken." : "Der Wert ist zu klein.");
  const v = r2(value);
  switch (s.kind) {
    case "rect":
    case "rrect": {
      const w = key === "width" ? v : s.w;
      const h = key === "depth" ? v : s.h;
      const next = { ...s, x: r2(cx - w / 2), y: r2(cy - h / 2), w, h };
      if (s.kind === "rrect") {
        const r = key === "radius" ? v : s.r;
        if (r > Math.min(w, h) / 2) throw new Error(`Der Eckradius darf höchstens ${r2(Math.min(w, h) / 2).toLocaleString("de-DE")} mm sein.`);
        return { ...next, kind: "rrect", r };
      }
      return next;
    }
    case "circle":
      return key === "diameter" ? { ...s, r: v / 2 } : s;
    case "polygon":
      if (key === "sides") return { ...s, sides: Math.round(v) };
      return key === "diameter" ? { ...s, r: v / 2 } : s;
    case "ellipse":
      if (key === "angle") return { ...s, angle: v };
      return key === "width" ? { ...s, rx: v / 2 } : key === "depth" ? { ...s, ry: v / 2 } : s;
    case "slot": {
      if (key === "angle") return { ...s, angle: v };
      const length = key === "width" ? v : s.length;
      const width = key === "depth" ? v : s.width;
      if (width > length) throw new Error("Ein Langloch ist höchstens so breit wie lang.");
      return { ...s, length, width };
    }
    case "poly":
    case "path":
      return key === "width" ? resizeProfile([s], v)[0] : key === "depth" ? resizeProfile([s], undefined, v)[0] : s;
  }
}

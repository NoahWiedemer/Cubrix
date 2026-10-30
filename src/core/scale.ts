// Scaling bakes into the parametric dimensions (no scale matrix in the document).
// Radial dimensions follow the mean of X and Y; bodies that can only scale
// uniformly (sphere) use the factor that changed most.
import { SHAPE_DEFAULTS, type ExtraType } from "./shapeDefs";
import { isClosed, shapePoints, type Feature, type SketchShape, type Vec3 } from "./document";

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Bodies that scale around their bottom centre instead of a bounding-box corner. */
export const ROUND_TYPES = new Set(["cylinder", "sphere", "torus", "cone", "tube", "hemisphere", ...Object.entries(SHAPE_DEFAULTS).filter(([, d]) => d.round).map(([t]) => t)]);

function scaleShape(s: SketchShape, [sx, sy]: Vec3): SketchShape {
  const m = (sx + sy) / 2;
  switch (s.kind) {
    case "rect":
      return { ...s, x: r2(s.x * sx), y: r2(s.y * sy), w: r2(s.w * sx), h: r2(s.h * sy) };
    case "circle":
      return { ...s, cx: r2(s.cx * sx), cy: r2(s.cy * sy), r: r2(s.r * m) };
    case "polygon":
      return { ...s, cx: r2(s.cx * sx), cy: r2(s.cy * sy), r: r2(s.r * m) };
    case "poly":
      return { ...s, points: s.points.map(([x, y]) => [r2(x * sx), r2(y * sy)] as [number, number]) };
    case "ellipse":
      return { ...s, cx: r2(s.cx * sx), cy: r2(s.cy * sy), rx: r2(s.rx * sx), ry: r2(s.ry * sy) };
    case "slot":
      return { ...s, cx: r2(s.cx * sx), cy: r2(s.cy * sy), length: r2(s.length * sx), width: r2(s.width * sy) };
    case "rrect":
      return { ...s, x: r2(s.x * sx), y: r2(s.y * sy), w: r2(s.w * sx), h: r2(s.h * sy), r: r2(s.r * Math.min(sx, sy)) };
    case "path": {
      const p = ([x, y]: [number, number]) => [r2(x * sx), r2(y * sy)] as [number, number];
      return { ...s, start: p(s.start), segments: s.segments.map((g) => (g.type === "arc" ? { ...g, to: p(g.to), via: p(g.via) } : { ...g, to: p(g.to) })) };
    }
  }
}

/** The feature's own dimensions scaled by `s` (X, Y, Z in the CAD frame); transform untouched. */
export function scaleDimensions(f: Feature, s: Vec3): Feature {
  const [sx, sy, sz] = s;
  const xy = (sx + sy) / 2;
  const most = dominant(s);
  switch (f.type) {
    case "box":
    case "wedge":
      return { ...f, params: { ...f.params, width: r2(f.params.width * sx), depth: r2(f.params.depth * sy), height: r2(f.params.height * sz) } };
    case "plate":
      return {
        ...f,
        params: { width: r2(f.params.width * sx), depth: r2(f.params.depth * sy), height: r2(f.params.height * sz), radius: r2(f.params.radius * Math.min(sx, sy)) },
      };
    case "cylinder":
      return { ...f, params: { diameter: r2(f.params.diameter * xy), height: r2(f.params.height * sz) } };
    case "cone":
      return { ...f, params: { bottomDiameter: r2(f.params.bottomDiameter * xy), topDiameter: r2(f.params.topDiameter * xy), height: r2(f.params.height * sz) } };
    case "tube":
      return { ...f, params: { diameter: r2(f.params.diameter * xy), inner: r2(f.params.inner * xy), height: r2(f.params.height * sz) } };
    case "prism":
      return { ...f, params: { ...f.params, diameter: r2(f.params.diameter * xy), height: r2(f.params.height * sz) } };
    case "sphere":
      return { ...f, params: { diameter: r2(f.params.diameter * most) } };
    case "hemisphere":
      return { ...f, params: { diameter: r2(f.params.diameter * xy) } };
    case "torus":
      return { ...f, params: { diameter: r2(f.params.diameter * xy), thickness: r2(f.params.thickness * sz) } };
    case "pyramid":
      return { ...f, params: { width: r2(f.params.width * xy), height: r2(f.params.height * sz) } };
    case "counterbore":
      return {
        ...f,
        params: {
          diameter: r2(f.params.diameter * xy),
          headDiameter: r2(f.params.headDiameter * xy),
          length: r2(f.params.length * sz),
          headDepth: r2(f.params.headDepth * sz),
        },
      };
    case "nut":
      return { ...f, params: { acrossFlats: r2(f.params.acrossFlats * xy), height: r2(f.params.height * sz) } };
    case "text":
      return { ...f, params: { ...f.params, size: r2(f.params.size * xy), depth: f.params.onFace ? f.params.depth : r2(f.params.depth * sz) } };
    case "extrude":
      return { ...f, profile: f.profile.map((p) => scaleShape(p, s)), height: r2(f.height * sz) };
    case "sketch":
      return { ...f, shapes: f.shapes.map((p) => scaleShape(p, s)) };
    case "import":
      return { ...f, scale: r2(f.scale * dominant(s)) } as Feature;
    default: {
      // Library shapes: lengths named height/length scale with Z, counts stay, the rest with X/Y.
      const def = SHAPE_DEFAULTS[(f as { type: ExtraType }).type];
      const params = Object.fromEntries(
        Object.entries((f as { params: Record<string, number> }).params).map(([k, v]) => [
          k,
          def?.counts?.includes(k) ? v : r2(v * (/^(height|length|headHeight)$/.test(k) ? sz : xy)),
        ]),
      );
      return { ...f, params } as Feature;
    }
    case "boolean":
    case "group":
      return {
        ...f,
        children: f.children.map((c) => ({
          ...scaleDimensions(c, s),
          transform: { ...c.transform, position: c.transform.position.map((v, i) => r2(v * s[i])) as Vec3 },
        })) as [Feature, ...Feature[]],
      };
  }
}

/** The factor that changed most (keeps its sign of change), for uniform-only scaling. */
const dominant = (s: Vec3) => s.reduce((a, b) => (Math.abs(b - 1) > Math.abs(a - 1) ? b : a), 1);

/**
 * Compounds (booleans) only scale uniformly: their operands may be round or rotated,
 * and those cannot be stretched along one world axis without changing the shape.
 */
export const scalesUniformly = (f: Feature) => f.type === "boolean" || f.type === "group" || f.type === "import";

/** The factors actually applied to `f` for a requested scale. */
export function effectiveScale(f: Feature, s: Vec3): Vec3 {
  if (!scalesUniformly(f) || (s[0] === s[1] && s[1] === s[2])) return s;
  const k = dominant(s);
  return [k, k, k];
}

/** Scales a feature so that `anchor` (CAD world point) stays where it is. */
export function scaleFeature(f: Feature, requested: Vec3, anchor: Vec3): Feature {
  const s = effectiveScale(f, requested);
  const scaled = scaleDimensions(f, s);
  const position = f.transform.position.map((v, i) => r2(anchor[i] + (v - anchor[i]) * s[i])) as Vec3;
  return { ...scaled, transform: { ...f.transform, position } };
}

/** Bounding box of 2D shapes (closed and open). */
export function profileBounds(shapes: SketchShape[]) {
  const pts = shapes.flatMap((s) => shapePoints(s, 48));
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/** Resizes a 2D profile to the given width/depth (mm), keeping its centre. */
export function resizeProfile(shapes: SketchShape[], width?: number, depth?: number): SketchShape[] {
  const b = profileBounds(shapes);
  if (!b) return shapes;
  const w = b.maxX - b.minX;
  const d = b.maxY - b.minY;
  const sx = width !== undefined && w > 1e-6 ? width / w : 1;
  const sy = depth !== undefined && d > 1e-6 ? depth / d : 1;
  if (sx === 1 && sy === 1) return shapes;
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const shift = (s: SketchShape, dx: number, dy: number): SketchShape => {
    switch (s.kind) {
      case "rect":
        return { ...s, x: s.x + dx, y: s.y + dy };
      case "circle":
      case "polygon":
      case "ellipse":
      case "slot":
        return { ...s, cx: s.cx + dx, cy: s.cy + dy };
      case "rrect":
        return { ...s, x: s.x + dx, y: s.y + dy };
      case "poly":
        return { ...s, points: s.points.map(([x, y]) => [x + dx, y + dy] as [number, number]) };
      case "path": {
        const p = ([x, y]: [number, number]) => [x + dx, y + dy] as [number, number];
        return { ...s, start: p(s.start), segments: s.segments.map((g) => (g.type === "arc" ? { ...g, to: p(g.to), via: p(g.via) } : { ...g, to: p(g.to) })) };
      }
    }
  };
  return shapes.map((s) => shift(scaleShape(shift(s, -cx, -cy), [sx, sy, 1]), cx, cy)).map((s) => shift(s, 0, 0));
}

export const hasClosedProfile = (shapes: SketchShape[]) => shapes.some(isClosed);

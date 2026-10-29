// Scaling bakes into the parametric dimensions (no scale matrix in the document).
// Radial dimensions follow the mean of X and Y; bodies that can only scale
// uniformly (sphere) use the factor that changed most.
import type { Feature, SketchShape, Vec3 } from "./document";

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Bodies that scale around their bottom centre instead of a bounding-box corner. */
export const ROUND_TYPES = new Set(["cylinder", "sphere", "torus", "cone", "tube", "hemisphere"]);

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
    case "boolean":
      return {
        ...f,
        children: f.children.map((c) => ({
          ...scaleDimensions(c, s),
          transform: { ...c.transform, position: c.transform.position.map((v, i) => r2(v * s[i])) as Vec3 },
        })) as [Feature, Feature],
      };
  }
}

/** The factor that changed most (keeps its sign of change), for uniform-only scaling. */
const dominant = (s: Vec3) => s.reduce((a, b) => (Math.abs(b - 1) > Math.abs(a - 1) ? b : a), 1);

/**
 * Compounds (booleans) only scale uniformly: their operands may be round or rotated,
 * and those cannot be stretched along one world axis without changing the shape.
 */
export const scalesUniformly = (f: Feature) => f.type === "boolean";

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

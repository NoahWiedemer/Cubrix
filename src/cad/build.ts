// Builds OpenCascade solids (via replicad) from document features.
// Shared by the CAD worker and the Node tests; requires setOC() to have run.
import { drawCircle, drawPolysides, drawRectangle, drawRoundedRectangle, draw, makeBaseBox, makeCylinder, makeSphere, measureVolume, type Drawing, type Shape3D } from "replicad";
import { isClosed, shapePoints, type Feature, type SketchShape } from "../core/document";

/** Raised when rounding/chamfering edges fails, with a message meant for the user. */
export class EdgeTreatmentError extends Error {}

const mm = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString("de-DE")} mm`;

function applyEdgeTreatment(shape: Shape3D, f: Feature): Shape3D {
  const fillet = f.fillet ?? 0;
  const chamfer = f.chamfer ?? 0;
  if (fillet <= 0 && chamfer <= 0) return shape;
  const what = fillet > 0 ? "Abrunden" : "Fasen";
  const size = fillet > 0 ? fillet : chamfer;
  // Spheres and tori only have seam edges, nothing that could be rounded.
  if (f.type === "sphere" || f.type === "torus" || shape.edges.length === 0)
    throw new EdgeTreatmentError(`${f.name} hat keine Kanten zum ${what}.`);
  let result: Shape3D;
  try {
    result = fillet > 0 ? shape.fillet(fillet) : shape.chamfer(chamfer);
  } catch {
    throw new EdgeTreatmentError(`${what} mit ${mm(size)} ist für ${f.name} zu groß. Versuche einen kleineren Wert.`);
  }
  // OpenCascade sometimes "succeeds" with a broken result: rounding must keep the
  // outer size and only remove a little material.
  const before = shape.boundingBox.bounds;
  const after = result?.boundingBox.bounds;
  const grew = !after || after.some((p, i) => p.some((v, k) => (i === 0 ? v < before[i][k] - 0.01 : v > before[i][k] + 0.01)));
  const v0 = measureVolume(shape);
  const v1 = result ? measureVolume(result) : 0;
  if (!result || result.isNull || grew || !(v1 > 0 && v1 < v0) || result.faces.length <= shape.faces.length)
    throw new EdgeTreatmentError(`${what} mit ${mm(size)} ist für ${f.name} zu groß. Versuche einen kleineren Wert.`);
  return result;
}

export function buildPrimitive(f: Feature): Shape3D {
  switch (f.type) {
    case "box": {
      const { width, depth, height } = f.params;
      return makeBaseBox(width, depth, height);
    }
    case "cylinder": {
      const { diameter, height } = f.params;
      return makeCylinder(diameter / 2, height);
    }
    case "sphere": {
      const r = f.params.diameter / 2;
      return makeSphere(r).translateZ(r);
    }
    case "cone": {
      const { bottomDiameter, topDiameter, height } = f.params;
      const r1 = Math.max(bottomDiameter / 2, 0);
      const r2 = Math.max(topDiameter / 2, 0);
      // Revolve the profile (in the XZ plane) around the Z axis.
      const pen = draw([0, 0]).lineTo([r1, 0]);
      const profile = (r2 > 0.001 ? pen.lineTo([r2, height]) : pen).lineTo([0, height]).close();
      return profile.sketchOnPlane("XZ").revolve([0, 0, 1]) as Shape3D;
    }
    case "torus": {
      const { diameter, thickness } = f.params;
      const minor = thickness / 2;
      const major = Math.max(diameter / 2 - minor, minor + 0.01);
      return drawCircle(minor)
        .translate(major, minor)
        .sketchOnPlane("XZ")
        .revolve([0, 0, 1]) as Shape3D;
    }
    case "pyramid": {
      const { width, height } = f.params;
      return drawRectangle(width, width).sketchOnPlane("XY").extrude(height, { extrusionProfile: { profile: "linear", endFactor: 0.01 } }) as Shape3D;
    }
    case "prism": {
      const { diameter, height, sides } = f.params;
      return drawPolysides(diameter / 2, Math.max(3, Math.round(sides))).sketchOnPlane("XY").extrude(height) as Shape3D;
    }
    case "tube": {
      const { diameter, inner, height } = f.params;
      return drawCircle(diameter / 2).cut(drawCircle(Math.min(inner, diameter - 0.4) / 2)).sketchOnPlane("XY").extrude(height) as Shape3D;
    }
    case "hemisphere": {
      const r = f.params.diameter / 2;
      return makeSphere(r).cut(makeBaseBox(4 * r, 4 * r, 2 * r).translateZ(-2 * r));
    }
    case "wedge": {
      const { width, depth, height } = f.params;
      // Right-angled ramp: full height at -X, sloping down to +X.
      const profile = draw([-width / 2, 0]).lineTo([width / 2, 0]).lineTo([-width / 2, height]).close();
      return (profile.sketchOnPlane("XZ").extrude(depth) as Shape3D).translateY(depth / 2);
    }
    case "plate": {
      const { width, depth, height, radius } = f.params;
      const r = Math.max(0, Math.min(radius, width / 2 - 0.01, depth / 2 - 0.01));
      return drawRoundedRectangle(width, depth, r).sketchOnPlane("XY").extrude(height) as Shape3D;
    }
    case "counterbore": {
      const { diameter, length, headDiameter, headDepth } = f.params;
      const head = makeCylinder(headDiameter / 2, headDepth).translateZ(length - headDepth);
      return makeCylinder(diameter / 2, length).fuse(head);
    }
    case "nut": {
      const { acrossFlats, height } = f.params;
      return drawPolysides(acrossFlats / Math.sqrt(3), 6).sketchOnPlane("XY").extrude(height) as Shape3D;
    }
    default:
      throw new Error("Unbekannter Typ");
  }
}

function drawingOf(s: SketchShape): Drawing {
  switch (s.kind) {
    case "rect":
      return drawRectangle(Math.abs(s.w), Math.abs(s.h)).translate(s.x + s.w / 2, s.y + s.h / 2);
    case "circle":
      return drawCircle(s.r).translate(s.cx, s.cy);
    case "polygon":
      return drawPolysides(s.r, s.sides).rotate(90).translate(s.cx, s.cy);
    case "poly": {
      const [first, ...rest] = s.points;
      let pen = draw(first);
      for (const p of rest) pen = pen.lineTo(p);
      return pen.close();
    }
  }
}

function bbox(s: SketchShape) {
  const pts = shapePoints(s, 32);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/** Closed profiles fused; a profile lying fully inside another one becomes a hole. */
function buildExtrusion(profile: SketchShape[], height: number): Shape3D {
  const closed = profile.filter(isClosed);
  if (!closed.length) throw new Error("Die Skizze enthält keine geschlossene Form.");
  const boxes = closed.map(bbox);
  const inside = (i: number) =>
    boxes.some((o, j) => j !== i && o.minX <= boxes[i].minX && o.maxX >= boxes[i].maxX && o.minY <= boxes[i].minY && o.maxY >= boxes[i].maxY &&
      (o.maxX - o.minX) * (o.maxY - o.minY) > (boxes[i].maxX - boxes[i].minX) * (boxes[i].maxY - boxes[i].minY));
  let outer: Drawing | null = null;
  const holes: Drawing[] = [];
  closed.forEach((s, i) => {
    const d = drawingOf(s);
    if (inside(i)) holes.push(d);
    else outer = outer ? outer.fuse(d) : d;
  });
  if (!outer) throw new Error("Die Skizze enthält keine äußere Form.");
  let region: Drawing = outer;
  for (const h of holes) region = region.cut(h);
  return region.sketchOnPlane("XY").extrude(height) as Shape3D;
}

export function buildLocal(f: Feature): Shape3D {
  if (f.type === "sketch") throw new Error("Skizzen sind keine Körper.");
  let shape: Shape3D;
  if (f.type === "boolean") {
    const [a, b] = f.children.map((c) => buildPlaced(c));
    shape = f.op === "union" ? a.fuse(b) : f.op === "subtract" ? a.cut(b) : a.intersect(b);
  } else if (f.type === "extrude") {
    shape = buildExtrusion(f.profile, f.height);
  } else {
    shape = buildPrimitive(f);
  }
  return applyEdgeTreatment(shape, f);
}

function place(shape: Shape3D, f: Feature): Shape3D {
  const [rx, ry, rz] = f.transform.rotation;
  let s = shape;
  if (rz) s = s.rotate(rz, [0, 0, 0], [0, 0, 1]);
  if (ry) s = s.rotate(ry, [0, 0, 0], [0, 1, 0]);
  if (rx) s = s.rotate(rx, [0, 0, 0], [1, 0, 0]);
  const [x, y, z] = f.transform.position;
  if (x || y || z) s = s.translate(x, y, z);
  return s;
}

export function buildPlaced(f: Feature): Shape3D {
  return place(buildLocal(f), f);
}


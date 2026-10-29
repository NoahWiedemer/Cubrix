// Builds OpenCascade solids (via replicad) from document features.
// Shared by the CAD worker and the Node tests; requires setOC() to have run.
import { drawCircle, draw, makeBaseBox, makeCylinder, makeSphere, measureVolume, type Shape3D } from "replicad";
import type { Feature } from "../core/document";

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
    default:
      throw new Error("Unbekannter Typ");
  }
}

export function buildLocal(f: Feature): Shape3D {
  let shape: Shape3D;
  if (f.type === "boolean") {
    const [a, b] = f.children.map((c) => buildPlaced(c));
    shape = f.op === "union" ? a.fuse(b) : f.op === "subtract" ? a.cut(b) : a.intersect(b);
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


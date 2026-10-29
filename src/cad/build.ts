// Builds OpenCascade solids (via replicad) from document features.
// Shared by the CAD worker and the Node tests; requires setOC() to have run.
import { drawCircle, drawEllipse, drawPolysides, drawRectangle, drawRoundedRectangle, draw, Compound, FaceFinder, Vector, basicFaceExtrusion, makeBaseBox, makeCompound, makeCylinder, makeOffset, makeSolid, makeSphere, measureVolume, type Drawing, type Shape3D } from "replicad";
import { buildText } from "./text";
import { EXTRA_BUILDERS } from "./shapes";
import { hasNoEdges, isClosed, shapePoints, type Feature, type SketchShape } from "../core/document";

/** Raised when rounding/chamfering edges fails, with a message meant for the user. */
export class EdgeTreatmentError extends Error {}

const mm = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString("de-DE")} mm`;

/** One rounding or chamfer pass over all edges, validated (OCC can "succeed" with junk). */
function edgePass(shape: Shape3D, f: Feature, kind: "fillet" | "chamfer", size: number): Shape3D {
  const what = kind === "fillet" ? "Abrunden" : "Fasen";
  const tooBig = () => new EdgeTreatmentError(`${what} mit ${mm(size)} ist für ${f.name} zu groß. Versuche einen kleineren Wert.`);
  let result: Shape3D;
  try {
    result = kind === "fillet" ? shape.fillet(size) : shape.chamfer(size);
  } catch {
    throw tooBig();
  }
  // It must keep the outer size and only remove a little material.
  const before = shape.boundingBox.bounds;
  const after = result?.boundingBox.bounds;
  const grew = !after || after.some((p, i) => p.some((v, k) => (i === 0 ? v < before[i][k] - 0.01 : v > before[i][k] + 0.01)));
  const v0 = measureVolume(shape);
  const v1 = result ? measureVolume(result) : 0;
  if (!result || result.isNull || grew || !(v1 > 0 && v1 < v0) || result.faces.length <= shape.faces.length) throw tooBig();
  return result;
}

/**
 * Fase and Abrundung are independent and can be combined: the chamfer is cut first,
 * then the fillet rounds every resulting edge (which also softens the chamfer borders).
 */
function applyEdgeTreatment(shape: Shape3D, f: Feature): Shape3D {
  const fillet = f.fillet ?? 0;
  const chamfer = f.chamfer ?? 0;
  if (fillet <= 0 && chamfer <= 0) return shape;
  // Spheres and tori only have seam edges, nothing that could be rounded.
  if (hasNoEdges(f) || shape.edges.length === 0)
    throw new EdgeTreatmentError(`${f.name} hat keine Kanten zum ${fillet > 0 ? "Abrunden" : "Fasen"}.`);
  let result = shape;
  if (chamfer > 0) result = edgePass(result, f, "chamfer", chamfer);
  if (fillet > 0) result = edgePass(result, f, "fillet", fillet);
  return result;
}

/**
 * Hollows a solid: open at the top/bottom (the flat face there is removed and the walls
 * grow inward), or closed (an inward offset is cut out, leaving a sealed cavity).
 */
function applyShell(shape: Shape3D, f: Feature): Shape3D {
  const shell = f.shell;
  if (!shell || shell.thickness <= 0) return shape;
  const t = shell.thickness;
  const fail = (why: string) => new EdgeTreatmentError(`${f.name} lässt sich ${why}`);
  const [lo, hi] = shape.boundingBox.bounds;
  const smallest = Math.min(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  if (t * 2 >= smallest - 0.05) throw fail(`mit ${mm(t)} Wand nicht aushöhlen – die Wand ist dicker als das halbe Objekt.`);
  const side = shell.open === "top" ? "oben" : "unten";
  const z = shell.open === "top" ? hi[2] : lo[2];
  if (shell.open !== "none" && new FaceFinder().inPlane("XY", z).find(shape).length === 0)
    throw fail(`nicht ${side} öffnen – dort fehlt eine flache Fläche. Versuche „Zu“ (geschlossener Hohlraum).`);
  const tooThick = () => fail(`mit ${mm(t)} Wand nicht aushöhlen. Versuche eine dünnere Wand.`);
  let inner: Shape3D;
  let closed: Shape3D;
  try {
    // On rounded bodies OCC returns the offset as a shell; it must be a solid to cut.
    const offset = makeOffset(shape as never, -t) as Shape3D;
    inner = offset.constructor.name === "Shell" ? (makeSolid([offset as never]) as Shape3D) : offset;
    // A turned body whose profile touches the axis: OCC's offset leaves a thin core of
    // radius t along the axis. Fill it so the cavity is clean.
    if (f.type === "extrude" && f.revolve && f.revolve.offset === 0) {
      const [ilo, ihi] = inner.boundingBox.bounds;
      const cx = (lo[0] + hi[0]) / 2;
      const cy = (lo[1] + hi[1]) / 2;
      inner = inner.fuse(makeCylinder(t + 0.05, ihi[2] - ilo[2], [cx, cy, ilo[2]])).simplify();
    }
    closed = shape.cut(inner);
  } catch {
    throw (f.chamfer ?? 0) > 0 ? fail("mit gefasten Kanten noch nicht aushöhlen. Nimm stattdessen Abrunden.") : tooThick();
  }
  const vClosed = measureVolume(closed);
  if (!(vClosed > 0 && vClosed < measureVolume(shape) - 1e-6)) throw tooThick();
  if (shell.open === "none") return closed;
  // An open shell is the closed one minus the wall on that side: the cavity's flat face
  // there is pushed out through the wall. OCC's thick solid is the fallback; it sometimes
  // returns junk on curved bodies, so every result must be smaller than the closed shell
  // and lie completely inside it.
  const valid = (r: Shape3D | null) => {
    if (!r || r.isNull) return false;
    const v = measureVolume(r);
    return v > 0 && v < vClosed - 1e-6 && Math.abs(measureVolume(r.intersect(closed)) - v) < v * 1e-4 + 1e-3;
  };
  const attempt = (make: () => Shape3D) => {
    try {
      const r = make();
      return valid(r) ? r : null;
    } catch {
      return null;
    }
  };
  const up = shell.open === "top" ? 1 : -1;
  const pushThrough = () => {
    const [ilo, ihi] = inner.boundingBox.bounds;
    // The cavity face may come in several pieces (e.g. around a turned body's axis).
    const faces = new FaceFinder().inPlane("XY", up > 0 ? ihi[2] : ilo[2]).find(inner);
    if (!faces.length) throw new Error("no flat cavity face");
    return faces.reduce((acc, face) => acc.cut(basicFaceExtrusion(face, new Vector([0, 0, up * (t + 1)])).translate(0, 0, -up * 0.01)), closed);
  };
  const result = attempt(pushThrough) ?? attempt(() => shape.shell(t, (finder) => finder.inPlane("XY", z)));
  if (!result) throw tooThick();
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
    default: {
      const extra = EXTRA_BUILDERS[(f as { type: string }).type];
      if (extra) return extra((f as unknown as { params: Record<string, number> }).params);
      throw new Error("Unbekannter Typ");
    }
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
    // True curves (B-rep), never sampled polylines:
    case "ellipse": {
      const d = s.rx >= s.ry ? drawEllipse(s.rx, s.ry) : drawEllipse(s.ry, s.rx).rotate(90);
      return d.rotate(s.angle ?? 0).translate(s.cx, s.cy);
    }
    case "slot": {
      const w = Math.min(s.width, s.length);
      return drawRoundedRectangle(s.length, w, w / 2 - 0.001).rotate(s.angle ?? 0).translate(s.cx, s.cy);
    }
    case "rrect": {
      const w = Math.abs(s.w), h = Math.abs(s.h);
      const r = Math.max(0, Math.min(s.r, w / 2 - 0.001, h / 2 - 0.001));
      return drawRoundedRectangle(w, h, r).translate(Math.min(s.x, s.x + s.w) + w / 2, Math.min(s.y, s.y + s.h) + h / 2);
    }
    case "path": {
      let pen = draw(s.start);
      const n = s.segments.length;
      s.segments.forEach((seg, i) => {
        // The closing segment back to the start is drawn by close() for lines.
        const closing = s.closed && i === n - 1 && seg.to[0] === s.start[0] && seg.to[1] === s.start[1];
        if (seg.type === "line") { if (!closing) pen = pen.lineTo(seg.to); }
        else if (seg.type === "arc") pen = pen.threePointsArcTo(seg.to, seg.via);
        else pen = pen.smoothSplineTo(seg.to);
      });
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
/** The closed region of a profile (inner shapes become holes), with optional 2D corner rounding. */
function profileRegion(profile: SketchShape[], corner = 0): Drawing {
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
  if (corner > 0) {
    try {
      region = region.fillet(corner);
    } catch {
      throw new EdgeTreatmentError(`Ecken mit ${mm(corner)} abrunden geht hier nicht – kleinerer Radius?`);
    }
  }
  return region;
}

function buildExtrusion(profile: SketchShape[], height: number, corner = 0): Shape3D {
  return profileRegion(profile, corner).sketchOnPlane("XY").extrude(height) as Shape3D;
}

/**
 * Turned body: the profile's Y becomes the height and it spins around a vertical axis
 * `offset` mm left of its left edge. The axis sits where that edge was, so the body
 * appears where the profile was drawn.
 */
function buildRevolve(profile: SketchShape[], offset: number, corner = 0): Shape3D {
  const region = profileRegion(profile, corner);
  const [[minX, minY], [maxX, maxY]] = region.boundingBox.bounds;
  if (!(maxX > minX && maxY > minY)) throw new Error("Das Profil ist zu klein zum Drehen.");
  const placed = region.translate([offset - minX, -minY]);
  const solid = placed.sketchOnPlane("XZ").revolve([0, 0, 1]) as Shape3D;
  return solid.translate(minX - offset, (minY + maxY) / 2, 0);
}

/** Several solids kept side by side (threads: core + swept ridge, see shapes.ts). */
const isMultiSolid = (s: Shape3D) => s instanceof Compound && s.solids.length > 1;
const solidsOf = (s: Shape3D): Shape3D[] => (s instanceof Compound ? s.solids : [s]);

/**
 * Booleans with multi-solid shapes, one solid at a time: OCC fails or silently ignores a
 * compound operand (and fusing a swept thread into its core takes seconds). Cuts and
 * intersections are exact this way; a union keeps the solids next to each other, which
 * slicers merge when printing.
 */
function compoundBoolean(op: "union" | "subtract" | "intersect", a: Shape3D, tools: Shape3D[]): Shape3D {
  const toolSolids = tools.flatMap(solidsOf);
  if (op === "union") return makeCompound([...solidsOf(a), ...toolSolids]) as Shape3D;
  const parts = solidsOf(a).flatMap((part) => {
    if (op === "subtract") return [toolSolids.reduce((acc, t) => acc.cut(t.clone()), part)];
    return toolSolids.map((t) => part.clone().intersect(t.clone()));
  });
  const kept = parts.filter((x) => !x.isNull && measureVolume(x) > 1e-6);
  if (!kept.length) throw new Error("Die Schnittmenge ist leer.");
  return kept.length === 1 ? kept[0] : (makeCompound(kept) as Shape3D);
}

/** Parsed imports (STL/STEP), normalised to stand centred on z = 0; filled by the worker. */
export const importedShapes = new Map<string, Shape3D>();

export function buildLocal(f: Feature): Shape3D {
  if (f.type === "sketch") throw new Error("Skizzen sind keine Körper.");
  let shape: Shape3D;
  if (f.type === "group") {
    // A folder of objects: its visible members side by side (no boolean, export keeps them apart).
    const parts = f.children.filter((c) => c.visible && c.type !== "sketch").flatMap((c) => solidsOf(buildPlaced(c)));
    if (!parts.length) throw new Error(`${f.name} ist leer.`);
    return parts.length === 1 ? parts[0] : (makeCompound(parts) as Shape3D);
  }
  if (f.type === "boolean") {
    // Many tools: fuse them first, then one boolean against the target (much faster
    // than one cut per tool).
    // Hidden tools are switched off (e.g. to try the part without a cut).
    const [base, ...rest] = f.children;
    const a = buildPlaced(base);
    const tools = rest.filter((c) => c.visible).map((c) => buildPlaced(c));
    if (!tools.length) shape = a;
    else if ([a, ...tools].some(isMultiSolid)) shape = compoundBoolean(f.op, a, tools);
    else {
      const b = tools.reduce((acc, t) => acc.fuse(t));
      shape = f.op === "union" ? a.fuse(b) : f.op === "subtract" ? a.cut(b) : a.intersect(b);
    }
  } else if (f.type === "import") {
    const base = importedShapes.get(f.assetId);
    if (!base) throw new Error("Importierte Datei fehlt im Projekt.");
    shape = f.scale !== 1 ? base.clone().scale(f.scale, [0, 0, 0]) : base.clone();
  } else if (f.type === "extrude") {
    shape = f.revolve ? buildRevolve(f.profile, f.revolve.offset, f.corner ?? 0) : buildExtrusion(f.profile, f.height, f.corner ?? 0);
  } else if (f.type === "text") {
    // On a face the text overlaps the surface by 0.01 mm so the boolean is clean:
    // embossed text starts just below the face, engraved text pokes just above it.
    const p = f.params;
    shape = p.onFace ? buildText({ ...p, depth: p.depth + 0.01 }) : buildText(p);
    if (p.onFace === "emboss") shape = shape.translate(0, 0, -0.01);
  } else {
    shape = buildPrimitive(f);
  }
  shape = applyShell(applyEdgeTreatment(shape, f), f);
  // Mirrored copies: flip the geometry in the feature's own frame.
  if (f.mirror) shape = shape.mirror(f.mirror === "x" ? "YZ" : "XZ", [0, 0, 0]);
  return shape;
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


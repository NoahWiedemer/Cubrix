// The Albedo document: a plain, serializable JSON list of features.
// Everything the user builds lives here, so it can be saved, diffed, replayed
// and (later) read and written by the AI assistant.

export type Vec3 = [number, number, number];

export interface Transform {
  /** Position of the object's origin (centre of its base) in mm. */
  position: Vec3;
  /** Euler rotation in degrees, applied in X→Y→Z order (three.js "XYZ"). */
  rotation: Vec3;
}

export type PrimitiveType =
  | "box" | "cylinder" | "sphere" | "cone" | "torus"
  | "pyramid" | "prism" | "tube" | "hemisphere" | "wedge" | "plate" | "counterbore" | "nut";
export type BooleanOp = "union" | "subtract" | "intersect";

export interface PrimitiveParams {
  box: { width: number; depth: number; height: number };
  cylinder: { diameter: number; height: number };
  sphere: { diameter: number };
  cone: { bottomDiameter: number; topDiameter: number; height: number };
  torus: { diameter: number; thickness: number };
  pyramid: { width: number; height: number };
  prism: { diameter: number; height: number; sides: number };
  tube: { diameter: number; inner: number; height: number };
  hemisphere: { diameter: number };
  wedge: { width: number; depth: number; height: number };
  plate: { width: number; depth: number; height: number; radius: number };
  /** Screw hole with counterbore (a tool body to subtract). */
  counterbore: { diameter: number; length: number; headDiameter: number; headDepth: number };
  /** Hexagonal nut trap (a tool body to subtract). */
  nut: { acrossFlats: number; height: number };
}

interface FeatureBase {
  id: string;
  name: string;
  visible: boolean;
  transform: Transform;
  /** Optional edge rounding radius in mm (0 = sharp). */
  fillet?: number;
  /** Optional edge chamfer distance in mm (0 = sharp). Exclusive with fillet. */
  chamfer?: number;
}

export type PrimitiveFeature = {
  [K in PrimitiveType]: FeatureBase & { type: K; params: PrimitiveParams[K] };
}[PrimitiveType];

export interface BooleanFeature extends FeatureBase {
  type: "boolean";
  op: BooleanOp;
  /** [target, tool]. Child transforms are relative to this feature. */
  children: [Feature, Feature];
}

/** 2D shapes on the bed plane (mm, CAD X/Y). */
export type SketchShape =
  | { kind: "rect"; x: number; y: number; w: number; h: number }
  | { kind: "circle"; cx: number; cy: number; r: number }
  | { kind: "polygon"; cx: number; cy: number; r: number; sides: number }
  | { kind: "poly"; points: [number, number][]; closed: boolean };

export interface SketchFeature extends FeatureBase {
  type: "sketch";
  shapes: SketchShape[];
}

export interface ExtrudeFeature extends FeatureBase {
  type: "extrude";
  /** Closed profiles; shapes lying inside another become holes. */
  profile: SketchShape[];
  height: number;
}

export interface TextFeatureParams {
  text: string;
  /** Height of capital letters in mm. */
  size: number;
  /** Extrusion depth in mm (emboss height / engrave depth on a face). */
  depth: number;
  /** Bundled font ("inter", "roboto-slab", "roboto-mono") or an installed family name. */
  font: string;
  bold: boolean;
  align: "left" | "center" | "right";
  /** Set when the text sits on a face as the tool of a union (emboss) or cut (engrave). */
  onFace?: "emboss" | "engrave";
}

export interface TextFeature extends FeatureBase {
  type: "text";
  params: TextFeatureParams;
}

export type SolidFeature = PrimitiveFeature | BooleanFeature | ExtrudeFeature | TextFeature;
export type Feature = SolidFeature | SketchFeature;

export interface PrinterProfile {
  name: string;
  /** Build volume in mm: X, Y, Z. */
  volume: Vec3;
}

export interface ModelDocument {
  format: "albedo";
  version: 1;
  name: string;
  units: "mm";
  printer: PrinterProfile;
  features: Feature[];
}

export const DEFAULT_PRINTER: PrinterProfile = {
  name: "Manuell",
  volume: [220, 220, 250],
};

/** New projects start with the printer used last (remembered per machine). */
function lastPrinter(): PrinterProfile {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem("albedo.lastPrinter") : null;
    const p = raw ? (JSON.parse(raw) as PrinterProfile) : null;
    if (p && typeof p.name === "string" && Array.isArray(p.volume) && p.volume.length === 3) return p;
  } catch {
    /* ignore */
  }
  return DEFAULT_PRINTER;
}

export function rememberPrinter(p: PrinterProfile) {
  try {
    localStorage.setItem("albedo.lastPrinter", JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export function createDocument(name = "Unbenanntes Projekt", { starter = true } = {}): ModelDocument {
  return {
    format: "albedo",
    version: 1,
    name,
    units: "mm",
    printer: (({ name, volume }) => ({ name, volume: [...volume] as Vec3 }))(lastPrinter()),
    features: starter ? [starterCube()] : [],
  };
}

/** Every new project starts with a 20 mm cube standing centred on the bed (base at z = 0). */
function starterCube(): Feature {
  return {
    id: newId(),
    type: "box",
    name: "Quader 1",
    visible: true,
    params: { width: 20, depth: 20, height: 20 },
    transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
  };
}

export const PRIMITIVE_LABELS: Record<PrimitiveType, string> = {
  box: "Quader",
  cylinder: "Zylinder",
  sphere: "Kugel",
  cone: "Kegel",
  torus: "Torus",
  pyramid: "Pyramide",
  prism: "Prisma",
  tube: "Rohr",
  hemisphere: "Halbkugel",
  wedge: "Keil",
  plate: "Platte",
  counterbore: "Schraubloch",
  nut: "Mutterfalle",
};

export const BOOLEAN_LABELS: Record<BooleanOp, string> = {
  union: "Vereinigung",
  subtract: "Differenz",
  intersect: "Schnittmenge",
};

export function featureTypeLabel(f: Feature): string {
  if (f.type === "boolean") return BOOLEAN_LABELS[f.op];
  if (f.type === "sketch") return "Skizze";
  if (f.type === "extrude") return "Extrusion";
  if (f.type === "text") return "Text";
  return PRIMITIVE_LABELS[f.type];
}

export const isSolid = (f: Feature): f is SolidFeature => f.type !== "sketch";

export function isClosed(s: SketchShape): boolean {
  return s.kind !== "poly" || (s.closed && s.points.length >= 3);
}

/** Outline points of a sketch shape (closed shapes repeat no point). */
export function shapePoints(s: SketchShape, segments = 96): [number, number][] {
  switch (s.kind) {
    case "rect":
      return [[s.x, s.y], [s.x + s.w, s.y], [s.x + s.w, s.y + s.h], [s.x, s.y + s.h]];
    case "circle":
      return Array.from({ length: segments }, (_, i) => {
        const a = (i / segments) * Math.PI * 2;
        return [s.cx + Math.cos(a) * s.r, s.cy + Math.sin(a) * s.r] as [number, number];
      });
    case "polygon":
      return Array.from({ length: s.sides }, (_, i) => {
        const a = (i / s.sides) * Math.PI * 2 + Math.PI / 2;
        return [s.cx + Math.cos(a) * s.r, s.cy + Math.sin(a) * s.r] as [number, number];
      });
    case "poly":
      return s.points;
  }
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function findFeature(doc: ModelDocument, id: string): Feature | undefined {
  return doc.features.find((f) => f.id === id);
}

export function updateFeature(
  doc: ModelDocument,
  id: string,
  fn: (f: Feature) => Feature,
): ModelDocument {
  return { ...doc, features: doc.features.map((f) => (f.id === id ? fn(f) : f)) };
}

/** Picks "Quader 3" style names that don't collide with existing ones. */
export function uniqueName(doc: ModelDocument, base: string): string {
  const taken = new Set(doc.features.map((f) => f.name));
  for (let i = 1; ; i++) {
    const name = `${base} ${i}`;
    if (!taken.has(name)) return name;
  }
}

/** Re-assigns ids recursively (used by duplicate). */
export function cloneFeature(f: Feature): Feature {
  const copy = structuredClone(f);
  const walk = (x: Feature) => {
    x.id = newId();
    if (x.type === "boolean") x.children.forEach(walk);
  };
  walk(copy);
  return copy;
}

/** Geometry-relevant part of a feature, ignoring its own placement. Used as mesh cache key. */
export function geometryKey(f: Feature): string {
  const strip = (x: Feature, top: boolean): unknown => {
    const base = { type: x.type, fillet: x.fillet ?? 0, chamfer: x.chamfer ?? 0, t: top ? undefined : x.transform };
    if (x.type === "boolean")
      return { ...base, op: x.op, c: x.children.map((c) => strip(c, false)) };
    if (x.type === "sketch") return { ...base, s: x.shapes };
    if (x.type === "extrude") return { ...base, pr: x.profile, h: x.height };
    return { ...base, p: x.params };
  };
  return JSON.stringify(strip(f, true));
}

export function isModelDocument(x: unknown): x is ModelDocument {
  const d = x as ModelDocument;
  // Files from before the rename (format "modelonio") are still accepted.
  return !!d && (d.format === "albedo" || (d.format as string) === "modelonio") && Array.isArray(d.features);
}

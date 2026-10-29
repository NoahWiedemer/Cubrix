// The Modelonio document: a plain, serializable JSON list of features.
// Everything the user builds lives here, so it can be saved, diffed, replayed
// and (later) read and written by the AI assistant.

export type Vec3 = [number, number, number];

export interface Transform {
  /** Position of the object's origin (centre of its base) in mm. */
  position: Vec3;
  /** Euler rotation in degrees, applied in X→Y→Z order (three.js "XYZ"). */
  rotation: Vec3;
}

export type PrimitiveType = "box" | "cylinder" | "sphere" | "cone" | "torus";
export type BooleanOp = "union" | "subtract" | "intersect";

export interface PrimitiveParams {
  box: { width: number; depth: number; height: number };
  cylinder: { diameter: number; height: number };
  sphere: { diameter: number };
  cone: { bottomDiameter: number; topDiameter: number; height: number };
  torus: { diameter: number; thickness: number };
}

interface FeatureBase {
  id: string;
  name: string;
  visible: boolean;
  transform: Transform;
  /** Optional edge rounding radius in mm (0 = sharp). */
  fillet?: number;
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

export type Feature = PrimitiveFeature | BooleanFeature;

export interface PrinterProfile {
  name: string;
  /** Build volume in mm: X, Y, Z. */
  volume: Vec3;
}

export interface ModelDocument {
  format: "modelonio";
  version: 1;
  name: string;
  units: "mm";
  printer: PrinterProfile;
  features: Feature[];
}

export const DEFAULT_PRINTER: PrinterProfile = {
  name: "Snapmaker Original",
  volume: [125, 125, 125],
};

export function createDocument(name = "Unbenanntes Projekt", { starter = true } = {}): ModelDocument {
  return {
    format: "modelonio",
    version: 1,
    name,
    units: "mm",
    printer: { ...DEFAULT_PRINTER, volume: [...DEFAULT_PRINTER.volume] },
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
};

export const BOOLEAN_LABELS: Record<BooleanOp, string> = {
  union: "Vereinigung",
  subtract: "Differenz",
  intersect: "Schnittmenge",
};

export function featureTypeLabel(f: Feature): string {
  return f.type === "boolean" ? BOOLEAN_LABELS[f.op] : PRIMITIVE_LABELS[f.type];
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
    const base = { type: x.type, fillet: x.fillet ?? 0, t: top ? undefined : x.transform };
    if (x.type === "boolean")
      return { ...base, op: x.op, c: x.children.map((c) => strip(c, false)) };
    return { ...base, p: x.params };
  };
  return JSON.stringify(strip(f, true));
}

export function isModelDocument(x: unknown): x is ModelDocument {
  const d = x as ModelDocument;
  return !!d && d.format === "modelonio" && Array.isArray(d.features);
}

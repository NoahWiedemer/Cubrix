import type { MaterialId } from "./materials";
import { SHAPE_DEFAULTS, type ExtraType } from "./shapeDefs";

// The Cubrix document: a plain, serializable JSON list of features.
// Everything the user builds lives here, so it can be saved, diffed, replayed
// and (later) read and written by the AI assistant.

export type Vec3 = [number, number, number];

export interface Transform {
  /** Position of the object's origin (centre of its base) in mm. */
  position: Vec3;
  /** Euler rotation in degrees, applied in X→Y→Z order (three.js "XYZ"). */
  rotation: Vec3;
}

export type BasicType =
  | "box" | "cylinder" | "sphere" | "cone" | "torus"
  | "pyramid" | "prism" | "tube" | "hemisphere" | "wedge" | "plate" | "counterbore" | "nut";
/** Every primitive: the basic ones plus the library shapes (see core/shapeDefs.ts). */
export type PrimitiveType = BasicType | ExtraType;
export type BooleanOp = "union" | "subtract" | "intersect";

interface BasicParams {
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

export type PrimitiveParams = BasicParams & { [K in ExtraType]: Record<string, number> };

interface FeatureBase {
  id: string;
  name: string;
  visible: boolean;
  transform: Transform;
  /** Optional edge rounding radius in mm (0 = sharp). */
  fillet?: number;
  /** Optional edge chamfer distance in mm (0 = sharp). */
  chamfer?: number;
  /** Display/print colour as "#rrggbb" (unset = neutral grey). */
  color?: string;
  /** Display material (unset = matt); see core/materials.ts. */
  material?: MaterialId;
  /** Geometry mirrored in its own frame (across its local YZ plane for "x", XZ for "y"). */
  mirror?: "x" | "y";
  /** Hollowed out with this wall thickness (mm), optionally open at the top or bottom face. */
  shell?: Shell;
  /** Locked: cannot be picked or moved in the viewport (still selectable in the object list). */
  locked?: boolean;
}

export interface Shell {
  thickness: number;
  open: "none" | "top" | "bottom";
}

export type PrimitiveFeature = {
  [K in PrimitiveType]: FeatureBase & { type: K; params: PrimitiveParams[K] };
}[PrimitiveType];

export interface BooleanFeature extends FeatureBase {
  type: "boolean";
  op: BooleanOp;
  /** [target, ...tools] (one or more tools). Child transforms are relative to this feature. */
  children: [Feature, ...Feature[]];
}

/** One segment of a path: straight, a true circular arc through `via`, or a smooth spline. */
export type PathSegment =
  | { type: "line"; to: [number, number] }
  | { type: "arc"; to: [number, number]; via: [number, number] }
  | { type: "spline"; to: [number, number] };

/** 2D shapes on the bed plane (mm, CAD X/Y). Curves are real curves in the kernel. */
export type SketchShape =
  | { kind: "rect"; x: number; y: number; w: number; h: number }
  | { kind: "circle"; cx: number; cy: number; r: number }
  | { kind: "polygon"; cx: number; cy: number; r: number; sides: number }
  | { kind: "poly"; points: [number, number][]; closed: boolean }
  /** Ellipse (rx along X before rotating by `angle` degrees). */
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number; angle?: number }
  /** Stadium / slot: a rectangle with fully round ends. */
  | { kind: "slot"; cx: number; cy: number; length: number; width: number; angle?: number }
  /** Rectangle with rounded corners. */
  | { kind: "rrect"; x: number; y: number; w: number; h: number; r: number }
  | { kind: "path"; start: [number, number]; segments: PathSegment[]; closed: boolean };

export interface SketchFeature extends FeatureBase {
  type: "sketch";
  shapes: SketchShape[];
  /** 2D corner rounding of the profile in mm (applied when it gets a height). */
  corner?: number;
}

export interface ExtrudeFeature extends FeatureBase {
  type: "extrude";
  /** Closed profiles; shapes lying inside another become holes. */
  profile: SketchShape[];
  height: number;
  /** 2D corner rounding of the profile in mm (rounded outline, not 3D edge fillets). */
  corner?: number;
  /**
   * Turned instead of extruded: the profile spins once around a vertical axis left of it
   * (`offset` mm from its left edge; 0 = solid, > 0 = ring/tube). `height` is unused then.
   */
  revolve?: { offset: number };
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

/** An imported mesh/solid (STL, 3MF or STEP). Its data lives in `ModelDocument.assets`. */
export interface ImportFeature extends FeatureBase {
  type: "import";
  assetId: string;
  /** Uniform scale (imports can't be stretched parametrically). */
  scale: number;
}

export type SolidFeature = PrimitiveFeature | BooleanFeature | ExtrudeFeature | TextFeature | ImportFeature;

/** Embedded import data (base64): STL for meshes (3MF is converted), STEP for exact solids. */
export interface Asset {
  format: "stl" | "step";
  name: string;
  data: string;
}
export type Feature = SolidFeature | SketchFeature;

export interface PrinterProfile {
  name: string;
  /** Build volume in mm: X, Y, Z. */
  volume: Vec3;
}

export interface ModelDocument {
  format: "cubrix";
  version: 1;
  name: string;
  units: "mm";
  printer: PrinterProfile;
  features: Feature[];
  /** Imported file data, referenced by import features. */
  assets?: Record<string, Asset>;
}

export const DEFAULT_PRINTER: PrinterProfile = {
  name: "Manuell",
  volume: [220, 220, 250],
};

/** New projects start with the printer used last (remembered per machine). */
function lastPrinter(): PrinterProfile {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem("cubrix.lastPrinter") : null;
    const p = raw ? (JSON.parse(raw) as PrinterProfile) : null;
    if (p && typeof p.name === "string" && Array.isArray(p.volume) && p.volume.length === 3) return p;
  } catch {
    /* ignore */
  }
  return DEFAULT_PRINTER;
}

export function rememberPrinter(p: PrinterProfile) {
  try {
    localStorage.setItem("cubrix.lastPrinter", JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export function createDocument(name = "Unbenanntes Projekt", { starter = true } = {}): ModelDocument {
  return {
    format: "cubrix",
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
  ...(Object.fromEntries(Object.entries(SHAPE_DEFAULTS).map(([k, d]) => [k, d.label])) as Record<ExtraType, string>),
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
  if (f.type === "import") return "Import";
  return PRIMITIVE_LABELS[f.type];
}

export const isSolid = (f: Feature): f is SolidFeature => f.type !== "sketch";

export function isClosed(s: SketchShape): boolean {
  if (s.kind === "poly") return s.closed && s.points.length >= 3;
  if (s.kind === "path") return s.closed && s.segments.length >= 2;
  return true;
}

/** Catmull-Rom style sample of a smooth curve through points (display only). */
function smoothThrough(pts: [number, number][], closed: boolean, per = 12): [number, number][] {
  const out: [number, number][] = [];
  const n = pts.length;
  const at = (i: number) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)) as [number, number]);
    }
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}

/** Points of a circular arc from a through m to b (display only). */
function arcPoints(a: [number, number], m: [number, number], b: [number, number], steps = 24): [number, number][] {
  const [ax, ay] = a, [bx, by] = m, [cx, cy] = b;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return [b];
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  const r = Math.hypot(ax - ux, ay - uy);
  const a0 = Math.atan2(ay - uy, ax - ux), am = Math.atan2(by - uy, bx - ux), a1 = Math.atan2(cy - uy, cx - ux);
  const norm = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  // Direction: go the way that passes the middle point.
  const ccw = norm(am - a0) < norm(a1 - a0);
  const sweep = ccw ? norm(a1 - a0) : -norm(a0 - a1);
  return Array.from({ length: steps }, (_, i) => {
    const t = a0 + (sweep * (i + 1)) / steps;
    return [ux + Math.cos(t) * r, uy + Math.sin(t) * r] as [number, number];
  });
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
    case "ellipse": {
      const a = ((s.angle ?? 0) * Math.PI) / 180;
      return Array.from({ length: segments }, (_, i) => {
        const t = (i / segments) * Math.PI * 2;
        const x = Math.cos(t) * s.rx, y = Math.sin(t) * s.ry;
        return [s.cx + x * Math.cos(a) - y * Math.sin(a), s.cy + x * Math.sin(a) + y * Math.cos(a)] as [number, number];
      });
    }
    case "slot": {
      const a = ((s.angle ?? 0) * Math.PI) / 180, r = s.width / 2, h = Math.max(0, s.length / 2 - r);
      const local: [number, number][] = [];
      const n = Math.max(8, segments / 4);
      for (let i = 0; i <= n; i++) { const t = -Math.PI / 2 + (i / n) * Math.PI; local.push([h + Math.cos(t) * r, Math.sin(t) * r]); }
      for (let i = 0; i <= n; i++) { const t = Math.PI / 2 + (i / n) * Math.PI; local.push([-h + Math.cos(t) * r, Math.sin(t) * r]); }
      return local.map(([x, y]) => [s.cx + x * Math.cos(a) - y * Math.sin(a), s.cy + x * Math.sin(a) + y * Math.cos(a)] as [number, number]);
    }
    case "rrect": {
      const r = Math.max(0, Math.min(s.r, Math.abs(s.w) / 2, Math.abs(s.h) / 2));
      const x0 = Math.min(s.x, s.x + s.w), y0 = Math.min(s.y, s.y + s.h), x1 = Math.max(s.x, s.x + s.w), y1 = Math.max(s.y, s.y + s.h);
      const out: [number, number][] = [];
      const corner = (cx: number, cy: number, from: number) => {
        for (let i = 0; i <= 8; i++) { const t = from + (i / 8) * (Math.PI / 2); out.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]); }
      };
      corner(x1 - r, y0 + r, -Math.PI / 2);
      corner(x1 - r, y1 - r, 0);
      corner(x0 + r, y1 - r, Math.PI / 2);
      corner(x0 + r, y0 + r, Math.PI);
      return out;
    }
    case "path": {
      const out: [number, number][] = [s.start];
      let cur = s.start;
      let run: [number, number][] = [];
      const flushSpline = () => {
        if (run.length) out.push(...smoothThrough([cur, ...run], false).slice(1));
        if (run.length) cur = run[run.length - 1];
        run = [];
      };
      for (const seg of s.segments) {
        if (seg.type === "spline") { run.push(seg.to); continue; }
        flushSpline();
        if (seg.type === "line") out.push(seg.to);
        else out.push(...arcPoints(cur, seg.via, seg.to));
        cur = seg.to;
      }
      flushSpline();
      return out;
    }
  }
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Finds a feature anywhere in the document, including operands inside booleans. */
export function findFeature(doc: ModelDocument, id: string): Feature | undefined {
  const walk = (list: Feature[]): Feature | undefined => {
    for (const f of list) {
      if (f.id === id) return f;
      if (f.type === "boolean") {
        const hit = walk(f.children);
        if (hit) return hit;
      }
    }
    return undefined;
  };
  return walk(doc.features);
}

/** Chain of boolean parents (outermost first) of a nested operand; [] for top-level features. */
export function parentsOf(doc: ModelDocument, id: string): BooleanFeature[] {
  const walk = (list: Feature[], chain: BooleanFeature[]): BooleanFeature[] | null => {
    for (const f of list) {
      if (f.id === id) return chain;
      if (f.type === "boolean") {
        const hit = walk(f.children, [...chain, f]);
        if (hit) return hit;
      }
    }
    return null;
  };
  return walk(doc.features, []) ?? [];
}

/** Updates a feature anywhere (operands inside booleans too); the parents are rebuilt. */
export function updateFeature(
  doc: ModelDocument,
  id: string,
  fn: (f: Feature) => Feature,
): ModelDocument {
  const walk = (f: Feature): Feature => {
    if (f.id === id) return fn(f);
    if (f.type === "boolean") {
      const children = f.children.map(walk) as BooleanFeature["children"];
      return children.some((c, i) => c !== f.children[i]) ? { ...f, children } : f;
    }
    return f;
  };
  return { ...doc, features: doc.features.map(walk) };
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
/** Bodies without real edges to round or chamfer (curved all round, or threads). */
export const hasNoEdges = (f: Feature) => ["sphere", "torus", "thread", "threadhole"].includes(f.type);

export function geometryKey(f: Feature): string {
  const strip = (x: Feature, top: boolean): unknown => {
    const base = { type: x.type, fillet: x.fillet ?? 0, chamfer: x.chamfer ?? 0, m: x.mirror, sh: x.shell, t: top ? undefined : x.transform };
    if (x.type === "boolean")
      return { ...base, op: x.op, c: x.children.map((c) => ({ ...(strip(c, false) as object), v: c.visible })) };
    if (x.type === "sketch") return { ...base, s: x.shapes };
    if (x.type === "extrude") return { ...base, pr: x.profile, h: x.revolve ? 0 : x.height, rv: x.revolve, co: x.corner };
    if (x.type === "import") return { ...base, a: x.assetId, s: x.scale };
    return { ...base, p: x.params };
  };
  return JSON.stringify(strip(f, true));
}

export function isModelDocument(x: unknown): x is ModelDocument {
  const d = x as ModelDocument;
  // Files from before the rename (format "modelonio") are still accepted.
  // Files from before the renames (format "albedo" / "modelonio") are still accepted.
  return !!d && ["cubrix", "albedo", "modelonio"].includes(d.format as string) && Array.isArray(d.features);
}

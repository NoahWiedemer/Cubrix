// All built-in commands. Importing this module registers them.
import { defineCommand, type CommandContext, type DocumentResult } from "./commands";
import {
  BOOLEAN_LABELS,
  PRIMITIVE_LABELS,
  cloneFeature,
  createDocument,
  findFeature,
  geometryKey,
  isModelDocument,
  newId,
  uniqueName,
  rememberPrinter,
  updateFeature,
  type BooleanFeature,
  type BooleanOp,
  type TextFeature,
  type TextFeatureParams,
  type Feature,
  type ModelDocument,
  type SketchFeature,
  type SketchShape,
  isClosed,
  isSolid,
  type PrimitiveFeature,
  type PrimitiveParams,
  type PrimitiveType,
  type Transform,
  type Vec3,
} from "./document";
import { useApp } from "./store";
import { useGizmo } from "../ui/gizmo";
import { useSettings } from "../ui/settings";
import { useViewRequest } from "../ui/view";
import { usePreview } from "../ui/preview";
import { useSketch } from "../ui/sketch";
import { useLayout } from "../ui/layout";
import { scaleFeature } from "./scale";
import { gizmoAnchor } from "../ui/gizmoAnchor";
import { useTextTool } from "../ui/textTool";
import { useHelp } from "../help/HelpCenter";
import { useMeshes, exportFeatures } from "../cad/kernel";
import type { ExportFormat } from "../cad/protocol";
import { MANUAL, PRINTERS, bestOrientation } from "./printAnalysis";
import { worldBox } from "./bounds";
import { baseName, isTauri, openTextFile, saveFile } from "./platform";
import type { IconName } from "../ui/icons";

const hasSelection = (ctx: CommandContext) => ctx.selection.length > 0;
const hasOne = (ctx: CommandContext) => ctx.selection.length === 1;

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Finds a free spot on the bed near the centre for a new object. */
function freeSpot(doc: ModelDocument, footprint: number): Vec3 {
  // 5 mm grid inside the bed, nearest to the centre first; ties prefer right, then back.
  const limitX = Math.max(0, doc.printer.volume[0] / 2 - footprint / 2);
  const limitY = Math.max(0, doc.printer.volume[1] / 2 - footprint / 2);
  const candidates: [number, number][] = [];
  for (let x = -limitX; x <= limitX; x += 5)
    for (let y = -limitY; y <= limitY; y += 5) candidates.push([Math.round(x / 5) * 5, Math.round(y / 5) * 5]);
  candidates.sort((a, b) => Math.hypot(...a) - Math.hypot(...b) || b[0] - a[0] || b[1] - a[1]);
  const entries = useMeshes.getState().entries;
  const gap = footprint / 2 + 4;
  for (const [x, y] of candidates) {
    const free = doc.features.every((f) => {
      const b = worldBox(f, entries);
      if (!b) return Math.hypot(f.transform.position[0] - x, f.transform.position[1] - y) > gap + 20;
      return x + gap < b.min.x || x - gap > b.max.x || y + gap < b.min.y || y - gap > b.max.y;
    });
    if (free) return [x, y, 0];
  }
  return [0, 0, 0];
}

// ── Primitives ───────────────────────────────────────────────────────────────

function definePrimitive<K extends PrimitiveType>(
  type: K,
  icon: IconName,
  description: string,
  params: Record<keyof PrimitiveParams[K] & string, { description: string; default: number }>,
  footprint: (p: PrimitiveParams[K]) => number,
) {
  const label = PRIMITIVE_LABELS[type];
  const schema: Record<string, any> = {};
  for (const [key, spec] of Object.entries(params) as [string, { description: string; default: number }][])
    schema[key] = { type: "number", unit: "mm", min: 0, ...spec };
  schema.position = { type: "vec3", unit: "mm", optional: true, description: "Position des Fußpunkts. Ohne Angabe: freier Platz auf dem Druckbett." };
  schema.name = { type: "string", optional: true, description: "Name im Objektbaum" };

  defineCommand({
    id: `primitive.${type}`,
    kind: "document",
    label: `${label} hinzufügen`,
    description,
    icon,
    params: schema,
    apply(doc, p) {
      const values = Object.fromEntries(Object.keys(params).map((k) => [k, p[k]])) as PrimitiveParams[K];
      const feature = {
        id: newId(),
        type,
        name: p.name ?? uniqueName(doc, label),
        visible: true,
        params: values,
        transform: { position: p.position ?? freeSpot(doc, footprint(values)), rotation: [0, 0, 0] },
      } as PrimitiveFeature;
      return {
        doc: { ...doc, features: [...doc.features, feature] },
        selection: [feature.id],
        label: `${feature.name} hinzufügen`,
      };
    },
  });
}

definePrimitive("box", "box", "Fügt einen Quader hinzu. Der Fußpunkt liegt mittig auf der Unterseite.", {
  width: { description: "Breite (X)", default: 20 },
  depth: { description: "Tiefe (Y)", default: 20 },
  height: { description: "Höhe (Z)", default: 20 },
}, (p) => Math.max(p.width, p.depth));

definePrimitive("cylinder", "cylinder", "Fügt einen stehenden Zylinder hinzu.", {
  diameter: { description: "Durchmesser", default: 20 },
  height: { description: "Höhe", default: 20 },
}, (p) => p.diameter);

definePrimitive("sphere", "sphere", "Fügt eine Kugel hinzu, die auf dem Druckbett aufliegt.", {
  diameter: { description: "Durchmesser", default: 20 },
}, (p) => p.diameter);

definePrimitive("cone", "cone", "Fügt einen Kegel (oder Kegelstumpf, wenn oben > 0) hinzu.", {
  bottomDiameter: { description: "Durchmesser unten", default: 20 },
  topDiameter: { description: "Durchmesser oben (0 = Spitze)", default: 0 },
  height: { description: "Höhe", default: 20 },
}, (p) => Math.max(p.bottomDiameter, p.topDiameter));

definePrimitive("torus", "torus", "Fügt einen liegenden Ring (Torus) hinzu.", {
  diameter: { description: "Außendurchmesser", default: 30 },
  thickness: { description: "Ringdicke", default: 8 },
}, (p) => p.diameter);

definePrimitive("pyramid", "pyramid", "Fügt eine Pyramide mit quadratischer Grundfläche hinzu.", {
  width: { description: "Kantenlänge der Grundfläche", default: 24 },
  height: { description: "Höhe", default: 20 },
}, (p) => p.width);

definePrimitive("prism", "prism", "Fügt ein Prisma mit regelmäßiger Grundfläche hinzu (3, 6 oder mehr Ecken).", {
  diameter: { description: "Umkreis-Durchmesser", default: 24 },
  height: { description: "Höhe", default: 20 },
  sides: { description: "Anzahl der Ecken", default: 6 },
}, (p) => p.diameter);

definePrimitive("tube", "tube", "Fügt ein Rohr (Hohlzylinder) hinzu.", {
  diameter: { description: "Außendurchmesser", default: 24 },
  inner: { description: "Innendurchmesser", default: 18 },
  height: { description: "Höhe", default: 20 },
}, (p) => p.diameter);

definePrimitive("hemisphere", "hemisphere", "Fügt eine Halbkugel hinzu, flache Seite auf dem Bett.", {
  diameter: { description: "Durchmesser", default: 24 },
}, (p) => p.diameter);

definePrimitive("wedge", "wedge", "Fügt einen Keil (Rampe) hinzu.", {
  width: { description: "Länge (X)", default: 30 },
  depth: { description: "Breite (Y)", default: 20 },
  height: { description: "Höhe", default: 15 },
}, (p) => Math.max(p.width, p.depth));

definePrimitive("plate", "plate", "Fügt eine Platte mit abgerundeten Ecken hinzu.", {
  width: { description: "Breite", default: 50 },
  depth: { description: "Tiefe", default: 30 },
  height: { description: "Dicke", default: 3 },
  radius: { description: "Eckenradius", default: 4 },
}, (p) => Math.max(p.width, p.depth));

definePrimitive("counterbore", "screw", "Fügt ein Schraubloch mit Senkung als Werkzeugkörper hinzu (zum Abziehen). Standard: M3.", {
  diameter: { description: "Lochdurchmesser (M3: 3,4)", default: 3.4 },
  length: { description: "Gesamtlänge", default: 12 },
  headDiameter: { description: "Kopfdurchmesser (M3: 6,5)", default: 6.5 },
  headDepth: { description: "Kopftiefe", default: 3.2 },
}, (p) => p.headDiameter);

definePrimitive("nut", "nut", "Fügt eine Sechskant-Mutterfalle als Werkzeugkörper hinzu (zum Abziehen). Standard: M3.", {
  acrossFlats: { description: "Schlüsselweite (M3: 5,5 + 0,4 Spiel)", default: 5.9 },
  height: { description: "Höhe (M3: 2,4 + 0,2)", default: 2.6 },
}, (p) => p.acrossFlats * 1.2);

// ── Object editing ───────────────────────────────────────────────────────────

function sameVec(a: Vec3, b: Vec3) {
  return a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
}

defineCommand({
  id: "object.transform",
  kind: "document",
  label: "Transformieren",
  description: "Setzt Position (mm) und/oder Drehung (Grad, X→Y→Z) eines Objekts absolut.",
  icon: "move",
  params: {
    id: { type: "id", description: "Objekt-ID" },
    position: { type: "vec3", unit: "mm", optional: true, description: "Neue Position des Fußpunkts" },
    rotation: { type: "vec3", unit: "°", optional: true, description: "Neue Drehung um X, Y, Z" },
  },
  apply(doc, p) {
    const f = findFeature(doc, p.id);
    if (!f) throw new Error("Objekt nicht gefunden");
    const t: Transform = {
      position: (p.position ?? f.transform.position).map(round) as Vec3,
      rotation: (p.rotation ?? f.transform.rotation).map(round) as Vec3,
    };
    const moved = !sameVec(t.position, f.transform.position);
    const rotated = !sameVec(t.rotation, f.transform.rotation);
    if (!moved && !rotated) return null;
    return {
      doc: updateFeature(doc, f.id, (x) => ({ ...x, transform: t })),
      label: `${f.name} ${rotated && !moved ? "drehen" : moved && !rotated ? "verschieben" : "transformieren"}`,
    };
  },
});

defineCommand({
  id: "object.move",
  kind: "document",
  label: "Verschieben",
  description: "Verschiebt die ausgewählten Objekte relativ um dx, dy, dz (mm).",
  icon: "move",
  params: {
    ids: { type: "ids", optional: true, description: "Objekt-IDs (Standard: Auswahl)" },
    delta: { type: "vec3", unit: "mm", description: "Verschiebung" },
  },
  isEnabled: hasSelection,
  apply(doc, p, ctx) {
    const ids: string[] = p.ids ?? ctx.selection;
    const d = p.delta as Vec3;
    const features = doc.features.map((f) =>
      ids.includes(f.id)
        ? { ...f, transform: { ...f.transform, position: f.transform.position.map((v, i) => round(v + d[i])) as Vec3 } }
        : f,
    );
    return { doc: { ...doc, features }, label: `${ids.length > 1 ? `${ids.length} Objekte` : findFeature(doc, ids[0])?.name} verschieben` };
  },
});

defineCommand({
  id: "object.setParams",
  kind: "document",
  label: "Maße ändern",
  description: "Ändert die Maße eines Grundkörpers (z. B. width, depth, height, diameter).",
  icon: "resize",
  params: {
    id: { type: "id", description: "Objekt-ID" },
    params: { type: "string", description: "Objekt mit den neuen Maßen in mm, z. B. {\"width\": 40}" },
  },
  apply(doc, p) {
    const f = findFeature(doc, p.id);
    if (!f || f.type === "boolean" || f.type === "sketch") throw new Error("Nur Grundkörper haben Maße");
    const patch = typeof p.params === "string" ? JSON.parse(p.params) : p.params;
    if (f.type === "extrude") {
      const h = Number(patch.height);
      if (!Number.isFinite(h) || h < 0.1) throw new Error("Die Höhe muss mindestens 0,1 mm sein");
      if (round(h) === f.height) return null;
      return { doc: updateFeature(doc, f.id, (x) => ({ ...x, height: round(h) }) as Feature), label: `${f.name}: Höhe ${round(h)} mm` };
    }
    const next = { ...f.params } as Record<string, number>;
    let changed = false;
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in next)) continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) throw new Error("Maße müssen positive Zahlen sein");
      if (k !== "topDiameter" && n < 0.1) throw new Error("Maße müssen mindestens 0,1 mm sein");
      if (next[k] !== n) changed = true;
      next[k] = round(n);
    }
    if (f.type === "torus" && next.thickness * 2 >= next.diameter)
      throw new Error("Die Ringdicke muss kleiner als der halbe Durchmesser sein");
    if (!changed) return null;
    return {
      doc: updateFeature(doc, f.id, (x) => ({ ...x, params: next }) as Feature),
      label: `${f.name}: Maße ändern`,
    };
  },
});

function defineEdgeCommand(kind: "fillet" | "chamfer") {
  const fillet = kind === "fillet";
  defineCommand({
    id: `object.${kind}`,
    kind: "document",
    label: fillet ? "Abrunden" : "Fasen",
    description: fillet
      ? "Rundet alle Kanten eines Objekts mit dem angegebenen Radius ab (0 entfernt die Abrundung)."
      : "Schrägt alle Kanten eines Objekts mit dem angegebenen Abstand ab (0 entfernt die Fase).",
    icon: fillet ? "fillet" : "chamfer",
    params: {
      id: { type: "id", optional: true, description: "Objekt-ID (Standard: Auswahl)" },
      radius: { type: "number", unit: "mm", min: 0, optional: true, description: "Größe; ohne Angabe ein passender Vorschlag" },
    },
    isEnabled: hasOne,
    apply(doc, p, ctx) {
      const f = findFeature(doc, p.id ?? ctx.selection[0]);
      if (!f) throw new Error("Objekt nicht gefunden");
      if (f.type === "sketch") throw new Error("Skizzen haben keine Kanten – erst in 3D ziehen.");
      if (f.type === "sphere" || f.type === "torus")
        throw new Error(`${PRIMITIVE_LABELS[f.type]} hat keine Kanten zum ${fillet ? "Abrunden" : "Fasen"}.`);
      const current = (fillet ? f.fillet : f.chamfer) ?? 0;
      let size: number = p.radius;
      if (size === undefined) {
        const b = worldBox(f, useMeshes.getState().entries);
        const smallest = b ? Math.min(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) : 20;
        size = current ? 0 : Math.max(0.5, Math.round(smallest * 0.1 * 2) / 2);
      }
      const limit = maxEdgeSize(f);
      if (size > 0 && limit !== null && size >= limit)
        throw new Error(`${size.toLocaleString("de-DE")} mm ist zu groß für ${f.name}. Höchstens etwa ${(Math.floor((limit - 0.05) * 10) / 10).toLocaleString("de-DE")} mm.`);
      if (current === size && !(fillet ? f.chamfer : f.fillet)) return null;
      const verb = fillet ? "abrunden" : "fasen";
      return {
        doc: updateFeature(doc, f.id, (x) => ({ ...x, fillet: fillet ? size : 0, chamfer: fillet ? 0 : size })),
        label: size ? `${f.name} ${verb} (${size.toLocaleString("de-DE")} mm)` : `${f.name}: ${fillet ? "Abrundung" : "Fase"} entfernen`,
      };
    },
  });
}

/** Upper bound for fillet/chamfer size on simple primitives (null = let the kernel decide). */
function maxEdgeSize(f: Feature): number | null {
  switch (f.type) {
    case "box":
      return Math.min(f.params.width, f.params.depth, f.params.height) / 2;
    case "cylinder":
      return Math.min(f.params.diameter / 2, f.params.height / 2);
    default:
      return null;
  }
}

// ── Text ─────────────────────────────────────────────────────────────────────

const TEXT_FONTS = ["inter", "roboto-slab", "roboto-mono"] as const;

const textParamSchema = {
  text: { type: "string", description: "Der Text (eine Zeile, Umlaute erlaubt)" },
  size: { type: "number", unit: "mm", min: 0.5, default: 10, description: "Höhe der Großbuchstaben" },
  font: { type: "enum", options: TEXT_FONTS, default: "inter", description: "Schriftart: inter, roboto-slab, roboto-mono" },
  bold: { type: "boolean", default: true, description: "Fett" },
  align: { type: "enum", options: ["left", "center", "right"], default: "center", description: "Ausrichtung zum Fußpunkt" },
} as const;

defineCommand({
  id: "text.create",
  kind: "document",
  label: "Text",
  description:
    "Erstellt 3D-Text als Körper (mode standalone) oder prägt/graviert ihn in die Oberseite eines Objekts (mode emboss/engrave, targetId).",
  icon: "text",
  params: {
    ...textParamSchema,
    text: { type: "string", default: "Text", description: "Der Text (eine Zeile, Umlaute erlaubt)" },
    depth: { type: "number", unit: "mm", min: 0.1, optional: true, description: "Tiefe: 2 mm frei stehend, 0,8 mm beim Prägen/Gravieren" },
    mode: { type: "enum", options: ["standalone", "emboss", "engrave"], default: "standalone", description: "Frei stehend, prägen (aufsetzen) oder gravieren (einschneiden)" },
    targetId: { type: "id", optional: true, description: "Objekt für prägen/gravieren (Standard: Auswahl)" },
    position: { type: "vec3", unit: "mm", optional: true, description: "Fußpunkt (frei stehend) bzw. Mitte auf der Oberseite; ohne Angabe automatisch" },
    name: { type: "string", optional: true, description: "Name im Objektbaum" },
  },
  apply(doc, p, ctx): DocumentResult {
    const onFace = p.mode === "emboss" || p.mode === "engrave";
    const params: TextFeatureParams = {
      text: String(p.text),
      size: p.size,
      depth: p.depth ?? (onFace ? 0.8 : 2),
      font: p.font,
      bold: p.bold,
      align: p.align,
      ...(onFace ? { onFace: p.mode } : {}),
    };
    if (!params.text.trim()) throw new Error("Der Text ist leer.");
    const name = p.name ?? (params.text.length > 18 ? `„${params.text.slice(0, 16)}…“` : `„${params.text}“`);
    if (!onFace) {
      const footprint = params.size * Math.max(1, params.text.length) * 0.7;
      const feature: TextFeature = {
        id: newId(),
        type: "text",
        name,
        visible: true,
        params,
        transform: { position: p.position ?? freeSpot(doc, footprint), rotation: [0, 0, 0] },
      };
      return { doc: { ...doc, features: [...doc.features, feature] }, selection: [feature.id], label: `Text ${name} hinzufügen` };
    }
    const target = findFeature(doc, p.targetId ?? ctx.selection[0]);
    if (!target || !isSolid(target)) throw new Error("Bitte zuerst einen Körper auswählen, auf dem der Text stehen soll.");
    const box = worldBox(target, useMeshes.getState().entries);
    if (!box) throw new Error("Das Objekt wird noch berechnet – bitte gleich noch einmal.");
    const origin = target.transform.position;
    const top = box.max.z;
    const at: Vec3 = p.position
      ? [p.position[0], p.position[1], top]
      : [(box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, top];
    const z = p.mode === "engrave" ? top - params.depth : top;
    const text: TextFeature = {
      id: newId(),
      type: "text",
      name,
      visible: true,
      params,
      transform: { position: [at[0] - origin[0], at[1] - origin[1], z - origin[2]], rotation: [0, 0, 0] },
    };
    const result: Feature = {
      id: newId(),
      type: "boolean",
      op: p.mode === "emboss" ? "union" : "subtract",
      name: target.name,
      visible: true,
      transform: { position: [...origin], rotation: [0, 0, 0] },
      children: [{ ...target, visible: true, transform: { ...target.transform, position: [0, 0, 0] } }, text],
    };
    const idx = doc.features.findIndex((f) => f.id === target.id);
    const features = doc.features.filter((f) => f.id !== target.id);
    features.splice(idx, 0, result);
    return {
      doc: { ...doc, features },
      selection: [result.id],
      label: `${target.name}: Text ${name} ${p.mode === "emboss" ? "prägen" : "gravieren"}`,
    };
  },
});

defineCommand({
  id: "tool.text",
  kind: "action",
  label: "Text",
  description: "Text-Werkzeug: Klick aufs Druckbett setzt 3D-Text, Klick auf einen Körper prägt Text darauf.",
  icon: "text",
  shortcut: "t",
  params: {},
  perform() {
    useTextTool.setState((s) => ({ active: !s.active }));
  },
});

/** The text feature behind an object: the text itself, or the text tool of an emboss/engrave. */
export function textOf(f: Feature | undefined): TextFeature | undefined {
  if (!f) return undefined;
  if (f.type === "text") return f;
  if (f.type === "boolean" && f.children[1].type === "text" && f.children[1].params.onFace) return f.children[1];
  return undefined;
}

defineCommand({
  id: "text.edit",
  kind: "document",
  label: "Text bearbeiten",
  description: "Ändert Text, Größe, Tiefe, Schrift oder Ausrichtung eines Text-Objekts (auch geprägt/graviert); der Körper wird neu erzeugt.",
  icon: "text",
  params: {
    id: { type: "id", optional: true, description: "Objekt-ID (Standard: Auswahl)" },
    text: { type: "string", optional: true, description: "Neuer Text" },
    size: { type: "number", unit: "mm", min: 0.5, optional: true, description: "Höhe der Großbuchstaben" },
    depth: { type: "number", unit: "mm", min: 0.1, optional: true, description: "Tiefe" },
    font: { type: "enum", options: TEXT_FONTS, optional: true, description: "Schriftart" },
    bold: { type: "boolean", optional: true, description: "Fett" },
    align: { type: "enum", options: ["left", "center", "right"], optional: true, description: "Ausrichtung" },
    mode: { type: "enum", options: ["emboss", "engrave"], optional: true, description: "Nur für Text auf einer Fläche: prägen oder gravieren" },
  },
  isEnabled: (ctx) => ctx.selection.length === 1 && !!textOf(findFeature(ctx.doc, ctx.selection[0])),
  apply(doc, p, ctx) {
    const f = findFeature(doc, p.id ?? ctx.selection[0]);
    const t = textOf(f);
    if (!f || !t) throw new Error("Kein Text-Objekt ausgewählt.");
    const patch = Object.fromEntries(
      (["text", "size", "depth", "font", "bold", "align"] as const).filter((k) => p[k] !== undefined).map((k) => [k, p[k]]),
    ) as Partial<TextFeatureParams>;
    if (patch.text !== undefined && !String(patch.text).trim()) throw new Error("Der Text ist leer.");
    const params = { ...t.params, ...patch };
    if (p.mode && t.params.onFace) params.onFace = p.mode;
    if (JSON.stringify(params) === JSON.stringify(t.params)) return null;
    // The face height stays fixed: emboss sits on it, engraved text ends at it.
    const [x, y, z] = t.transform.position;
    const face = t.params.onFace === "engrave" ? z + t.params.depth : z;
    const nz = params.onFace === "engrave" ? face - params.depth : params.onFace === "emboss" ? face : z;
    const next: TextFeature = { ...t, params, transform: { ...t.transform, position: [x, y, nz] } };
    const updated: Feature =
      f.type === "text"
        ? { ...next, name: patch.text && /^„.*“$/.test(f.name) ? `„${params.text.slice(0, 16)}${params.text.length > 16 ? "…" : ""}“` : f.name }
        : {
            ...(f as BooleanFeature),
            op: params.onFace === "engrave" ? "subtract" : "union",
            children: [(f as BooleanFeature).children[0], next],
          };
    return { doc: updateFeature(doc, f.id, () => updated), label: `${f.name}: Text bearbeiten` };
  },
});

defineEdgeCommand("fillet");
defineEdgeCommand("chamfer");

defineCommand({
  id: "object.rename",
  kind: "document",
  label: "Umbenennen",
  description: "Gibt einem Objekt einen neuen Namen.",
  icon: "rename",
  params: { id: { type: "id", description: "Objekt-ID" }, name: { type: "string", description: "Neuer Name" } },
  apply(doc, p) {
    const f = findFeature(doc, p.id);
    const name = String(p.name).trim();
    if (!f || !name || f.name === name) return null;
    return { doc: updateFeature(doc, f.id, (x) => ({ ...x, name })), label: `„${f.name}“ → „${name}“` };
  },
});

defineCommand({
  id: "object.delete",
  kind: "document",
  label: "Löschen",
  description: "Löscht die angegebenen (Standard: ausgewählten) Objekte.",
  icon: "delete",
  shortcut: "delete",
  params: { ids: { type: "ids", optional: true, description: "Objekt-IDs (Standard: Auswahl)" } },
  isEnabled: hasSelection,
  apply(doc, p, ctx) {
    const ids: string[] = p.ids ?? ctx.selection;
    const gone = doc.features.filter((f) => ids.includes(f.id));
    if (!gone.length) return null;
    return {
      doc: { ...doc, features: doc.features.filter((f) => !ids.includes(f.id)) },
      selection: [],
      label: `${gone.length > 1 ? `${gone.length} Objekte` : gone[0].name} löschen`,
    };
  },
});

defineCommand({
  id: "object.duplicate",
  kind: "document",
  label: "Duplizieren",
  description: "Erstellt Kopien der Objekte, versetzt neben dem Original.",
  icon: "duplicate",
  shortcut: "mod+d",
  params: { ids: { type: "ids", optional: true, description: "Objekt-IDs (Standard: Auswahl)" } },
  isEnabled: hasSelection,
  apply(doc, p, ctx) {
    const ids: string[] = p.ids ?? ctx.selection;
    const entries = useMeshes.getState().entries;
    let working = doc;
    const created: string[] = [];
    for (const id of ids) {
      const f = findFeature(doc, id);
      if (!f) continue;
      const b = worldBox(f, entries);
      const dx = b ? round(b.max.x - b.min.x + 5) : 25;
      const copy = cloneFeature(f);
      copy.name = uniqueName(working, f.name.replace(/\s\d+$/, ""));
      copy.transform = { ...f.transform, position: [f.transform.position[0] + dx, f.transform.position[1], f.transform.position[2]] };
      working = { ...working, features: [...working.features, copy] };
      created.push(copy.id);
    }
    if (!created.length) return null;
    return { doc: working, selection: created, label: `${created.length > 1 ? `${created.length} Objekte` : findFeature(doc, ids[0])!.name} duplizieren` };
  },
});

defineCommand({
  id: "object.setVisibility",
  kind: "document",
  label: "Sichtbarkeit",
  description: "Blendet Objekte ein oder aus. Ausgeblendete Objekte werden nicht exportiert.",
  icon: "visible",
  params: {
    ids: { type: "ids", optional: true, description: "Objekt-IDs (Standard: Auswahl)" },
    visible: { type: "boolean", optional: true, description: "true = sichtbar; ohne Angabe umschalten" },
  },
  shortcut: "h",
  isEnabled: hasSelection,
  apply(doc, p, ctx) {
    const ids: string[] = p.ids ?? ctx.selection;
    const first = findFeature(doc, ids[0]);
    if (!first) return null;
    const visible: boolean = p.visible ?? !first.visible;
    return {
      doc: { ...doc, features: doc.features.map((f) => (ids.includes(f.id) ? { ...f, visible } : f)) },
      label: `${ids.length > 1 ? `${ids.length} Objekte` : first.name} ${visible ? "einblenden" : "ausblenden"}`,
    };
  },
});

defineCommand({
  id: "object.dropToBed",
  kind: "document",
  label: "Auf Druckbett legen",
  description: "Senkt bzw. hebt Objekte so, dass ihre Unterseite genau auf dem Druckbett liegt.",
  icon: "dropToBed",
  shortcut: "b",
  params: { ids: { type: "ids", optional: true, description: "Objekt-IDs (Standard: Auswahl)" } },
  isEnabled: hasSelection,
  apply(doc, p, ctx) {
    const ids: string[] = p.ids ?? ctx.selection;
    const entries = useMeshes.getState().entries;
    let changed = false;
    const features = doc.features.map((f) => {
      if (!ids.includes(f.id)) return f;
      const b = worldBox(f, entries);
      if (!b || Math.abs(b.min.z) < 1e-4) return f;
      changed = true;
      const pos = [...f.transform.position] as Vec3;
      pos[2] = round(pos[2] - b.min.z);
      return { ...f, transform: { ...f.transform, position: pos } };
    });
    if (!changed) return null;
    return { doc: { ...doc, features }, label: "Auf Druckbett legen" };
  },
});

// ── Sketches ─────────────────────────────────────────────────────────────────

const shapeLabels: Record<SketchShape["kind"], string> = { rect: "Rechteck", circle: "Kreis", polygon: "Vieleck", poly: "Linienzug" };

defineCommand({
  id: "sketch.addShape",
  kind: "document",
  label: "Form zeichnen",
  description:
    "Fügt einer Skizze eine 2D-Form hinzu (mm auf dem Druckbett). shape: {kind:'rect',x,y,w,h} | {kind:'circle',cx,cy,r} | {kind:'polygon',cx,cy,r,sides} | {kind:'poly',points:[[x,y],…],closed}. Ohne sketchId wird eine neue Skizze angelegt.",
  icon: "sketch",
  params: {
    sketchId: { type: "id", optional: true, description: "Ziel-Skizze; ohne Angabe eine neue" },
    shape: { type: "string", description: "Form als JSON-Objekt" },
  },
  apply(doc, p) {
    const shape: SketchShape = typeof p.shape === "string" ? JSON.parse(p.shape) : p.shape;
    const existing = p.sketchId ? findFeature(doc, p.sketchId) : undefined;
    if (existing && existing.type !== "sketch") throw new Error("Das ist keine Skizze");
    if (existing) {
      return {
        doc: updateFeature(doc, existing.id, (x) => ({ ...(x as SketchFeature), shapes: [...(x as SketchFeature).shapes, shape] })),
        selection: [existing.id],
        label: `${shapeLabels[shape.kind]} zeichnen`,
      };
    }
    const sketch: SketchFeature = {
      id: newId(),
      type: "sketch",
      name: uniqueName(doc, "Skizze"),
      visible: true,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
      shapes: [shape],
    };
    return { doc: { ...doc, features: [...doc.features, sketch] }, selection: [sketch.id], label: `${shapeLabels[shape.kind]} zeichnen` };
  },
});

defineCommand({
  id: "sketch.extrude",
  kind: "document",
  label: "In 3D ziehen",
  description: "Zieht die geschlossenen Formen einer Skizze um die angegebene Höhe in die Höhe (Extrusion). Innenliegende Formen werden zu Löchern.",
  icon: "extrude",
  shortcut: "e",
  params: {
    id: { type: "id", optional: true, description: "Skizzen-ID (Standard: Auswahl)" },
    height: { type: "number", unit: "mm", min: 0.1, default: 10, description: "Höhe" },
  },
  isEnabled: (ctx) => ctx.selection.length === 1 && findFeature(ctx.doc, ctx.selection[0])?.type === "sketch",
  apply(doc, p, ctx) {
    const sketch = findFeature(doc, p.id ?? ctx.selection[0]);
    if (!sketch || sketch.type !== "sketch") throw new Error("Bitte eine Skizze auswählen");
    const profile = sketch.shapes.filter(isClosed);
    if (!profile.length) throw new Error("Die Skizze enthält keine geschlossene Form. Schließe den Linienzug am Startpunkt.");
    const body: Feature = {
      id: newId(),
      type: "extrude",
      name: uniqueName(doc, "Körper"),
      visible: true,
      transform: structuredClone(sketch.transform),
      profile,
      height: round(p.height),
    };
    const features = doc.features.map((f) => (f.id === sketch.id ? { ...f, visible: false } : f));
    return { doc: { ...doc, features: [...features, body] }, selection: [body.id], label: `${sketch.name} ${round(p.height)} mm hochziehen` };
  },
});

(
  [
    ["select", "Auswählen", "v", "select"],
    ["line", "Linie", "l", "line"],
    ["rect", "Rechteck", "shift+r", "rect"],
    ["circle", "Kreis", "c", "sphere"],
    ["polygon", "Vieleck", "p", "polygon"],
  ] as const
).forEach(([tool, label, key, icon]) =>
  defineCommand({
    id: `sketch.tool.${tool}`,
    kind: "action",
    label,
    description: `2D-Werkzeug ${label}.`,
    icon,
    shortcut: key,
    params: {},
    isEnabled: () => useApp.getState().workspace === "sketch",
    perform() {
      useSketch.setState({ tool });
    },
  }),
);

// ── Print preparation ───────────────────────────────────────────────────────

defineCommand({
  id: "printer.set",
  kind: "document",
  label: "Drucker wählen",
  description: "Setzt das Druckerprofil (Bauraum) des Projekts.",
  icon: "printer",
  params: {
    name: { type: "string", description: "Druckername aus der Liste oder „Manuell“ (eigener Bauraum)" },
    volume: { type: "vec3", unit: "mm", optional: true, description: "Bauraum B × T × H (für Manuell)" },
  },
  apply(doc, p) {
    const preset = PRINTERS.find((x) => x.name === p.name);
    const volume = (preset?.volume ?? p.volume ?? doc.printer.volume) as Vec3;
    if (volume.some((v) => !(v >= 20 && v <= 2000))) throw new Error("Bauraum muss zwischen 20 und 2000 mm liegen");
    const name = preset ? preset.name : MANUAL;
    if (name === doc.printer.name && volume.every((v, i) => v === doc.printer.volume[i])) return null;
    const printer = { name, volume: [...volume] as Vec3 };
    rememberPrinter(printer);
    return { doc: { ...doc, printer }, label: `Drucker: ${name}` };
  },
});

defineCommand({
  id: "print.orient",
  kind: "document",
  label: "Beste Drucklage finden",
  description: "Dreht Objekte in die Lage mit den wenigsten Überhängen und legt sie aufs Bett.",
  icon: "orient",
  params: { ids: { type: "ids", optional: true, description: "Objekt-IDs (Standard: Auswahl oder alle)" } },
  isEnabled: (ctx) => ctx.doc.features.some((f) => f.visible),
  apply(doc, p, ctx) {
    const ids: string[] = p.ids ?? (ctx.selection.length ? ctx.selection : doc.features.filter((f) => f.visible).map((f) => f.id));
    const entries = useMeshes.getState().entries;
    let changed = false;
    const features = doc.features.map((f) => {
      const entry = entries[geometryKey(f)];
      if (!ids.includes(f.id) || !entry) return f;
      const rotation = bestOrientation(entry);
      const t = { ...f.transform, rotation };
      const b = worldBox(f, entries, t);
      const pos = [...f.transform.position] as Vec3;
      if (b) pos[2] = round(pos[2] - b.min.z);
      if (rotation.join() === f.transform.rotation.join() && pos[2] === f.transform.position[2]) return f;
      changed = true;
      return { ...f, transform: { position: pos, rotation } };
    });
    if (!changed) throw new Error("Die Objekte liegen schon in der besten Lage.");
    return { doc: { ...doc, features }, label: "Beste Drucklage" };
  },
});

// ── Booleans ─────────────────────────────────────────────────────────────────

function defineBoolean(op: BooleanOp, icon: IconName, label: string, description: string) {
  defineCommand({
    id: `boolean.${op}`,
    kind: "document",
    label,
    description,
    icon,
    params: {
      targetId: { type: "id", optional: true, description: "Zielkörper (Standard: zuerst ausgewähltes Objekt)" },
      toolId: { type: "id", optional: true, description: "Werkzeugkörper (Standard: als zweites ausgewähltes Objekt)" },
    },
    isEnabled: (ctx) => ctx.selection.length === 2,
    apply(doc, p, ctx): DocumentResult {
      const target = findFeature(doc, p.targetId ?? ctx.selection[0]);
      const tool = findFeature(doc, p.toolId ?? ctx.selection[1]);
      if (!target || !tool || target.id === tool.id) throw new Error("Bitte genau zwei Objekte auswählen");
      if (!isSolid(target) || !isSolid(tool)) throw new Error("Skizzen erst mit „In 3D ziehen“ zu Körpern machen");
      const origin = target.transform.position;
      const rel = (f: Feature): Feature => ({
        ...f,
        visible: true,
        transform: { ...f.transform, position: f.transform.position.map((v, i) => v - origin[i]) as Vec3 },
      });
      const result: Feature = {
        id: newId(),
        type: "boolean",
        op,
        name: target.name,
        visible: true,
        transform: { position: [...origin], rotation: [0, 0, 0] },
        children: [rel(target), rel(tool)],
      };
      const idx = doc.features.findIndex((f) => f.id === target.id);
      const features = doc.features.filter((f) => f.id !== target.id && f.id !== tool.id);
      features.splice(Math.min(idx, features.length), 0, result);
      const sign = op === "union" ? "+" : op === "subtract" ? "−" : "∩";
      return {
        doc: { ...doc, features },
        selection: [result.id],
        label: `${BOOLEAN_LABELS[op]}: ${target.name} ${sign} ${tool.name}`,
      };
    },
  });
}

defineBoolean("union", "union", "Vereinen", "Verschmilzt zwei Objekte zu einem.");
defineBoolean("subtract", "subtract", "Abziehen", "Zieht das zweite ausgewählte Objekt vom ersten ab (z. B. für Löcher).");
defineBoolean("intersect", "intersect", "Schnittmenge", "Behält nur den Bereich, in dem sich beide Objekte überschneiden.");

defineCommand({
  id: "boolean.split",
  kind: "document",
  label: "Auflösen",
  description: "Löst eine Boolesche Operation wieder in ihre zwei Ausgangskörper auf.",
  icon: "boolean",
  params: { id: { type: "id", optional: true, description: "Objekt-ID (Standard: Auswahl)" } },
  isEnabled: (ctx) => hasOne(ctx) && findFeature(ctx.doc, ctx.selection[0])?.type === "boolean",
  apply(doc, p, ctx) {
    const f = findFeature(doc, p.id ?? ctx.selection[0]);
    if (!f || f.type !== "boolean") return null;
    if (f.transform.rotation.some((r) => r !== 0)) throw new Error("Bitte zuerst die Drehung auf 0° setzen");
    const children = f.children.map((c) => ({
      ...c,
      transform: { ...c.transform, position: c.transform.position.map((v, i) => v + f.transform.position[i]) as Vec3 },
    }));
    const idx = doc.features.findIndex((x) => x.id === f.id);
    const features = [...doc.features];
    features.splice(idx, 1, ...children);
    return { doc: { ...doc, features }, selection: children.map((c) => c.id), label: `${f.name} auflösen` };
  },
});

defineCommand({
  id: "document.rename",
  kind: "document",
  label: "Projekt umbenennen",
  description: "Ändert den Projektnamen.",
  icon: "rename",
  params: { name: { type: "string", description: "Neuer Projektname" } },
  apply(doc, p) {
    const name = String(p.name).trim();
    if (!name || name === doc.name) return null;
    return { doc: { ...doc, name }, label: `Projekt „${name}“ nennen` };
  },
});

// ── Selection & history (not recorded) ──────────────────────────────────────

defineCommand({
  id: "selection.set",
  kind: "action",
  label: "Auswählen",
  description: "Setzt die Auswahl. mode: replace (Standard), add oder toggle.",
  icon: "select",
  params: {
    ids: { type: "ids", description: "Objekt-IDs" },
    mode: { type: "enum", options: ["replace", "add", "toggle"], default: "replace", description: "Auswahlmodus" },
  },
  perform(p, ctx) {
    const ids: string[] = p.ids;
    let next = ids;
    if (p.mode === "add") next = [...ctx.selection, ...ids.filter((i) => !ctx.selection.includes(i))];
    if (p.mode === "toggle")
      next = [...ctx.selection.filter((i) => !ids.includes(i)), ...ids.filter((i) => !ctx.selection.includes(i))];
    useApp.setState({ selection: next });
  },
});

defineCommand({
  id: "selection.all",
  kind: "action",
  label: "Alles auswählen",
  description: "Wählt alle sichtbaren Objekte aus.",
  icon: "select",
  shortcut: "mod+a",
  params: {},
  perform(_p, ctx) {
    useApp.setState({ selection: ctx.doc.features.filter((f) => f.visible).map((f) => f.id) });
  },
});

defineCommand({
  id: "selection.clear",
  kind: "action",
  label: "Auswahl aufheben",
  description: "Hebt die Auswahl auf.",
  icon: "select",
  shortcut: "escape",
  params: {},
  perform() {
    // First Esc leaves scale/rotate mode, the next one clears the selection.
    if (useGizmo.getState().mode !== "move") {
      useGizmo.setState({ mode: "move" });
      return;
    }
    useApp.setState({ selection: [], primitivesOpen: false });
  },
});

defineCommand({
  id: "history.undo",
  kind: "action",
  label: "Rückgängig",
  description: "Macht den letzten Schritt rückgängig.",
  icon: "undo",
  shortcut: "mod+z",
  params: {},
  isEnabled: () => {
    const s = useApp.getState();
    return !!s.nodes[s.currentId].parentId;
  },
  perform() {
    const s = useApp.getState();
    const parent = s.nodes[s.currentId].parentId;
    if (parent) s.jumpTo(parent);
  },
});

defineCommand({
  id: "history.redo",
  kind: "action",
  label: "Wiederholen",
  description: "Stellt den zuletzt rückgängig gemachten Schritt wieder her.",
  icon: "redo",
  shortcut: "shift+mod+z",
  params: {},
  isEnabled: () => {
    const s = useApp.getState();
    return !!s.nodes[s.currentId].activeChildId;
  },
  perform() {
    const s = useApp.getState();
    const next = s.nodes[s.currentId].activeChildId;
    if (next) s.jumpTo(next);
  },
});

defineCommand({
  id: "history.redoAlt",
  kind: "action",
  label: "Wiederholen",
  description: "Wie history.redo (Strg+Y unter Windows).",
  icon: "redo",
  shortcut: "mod+y",
  params: {},
  perform() {
    const s = useApp.getState();
    const next = s.nodes[s.currentId].activeChildId;
    if (next) s.jumpTo(next);
  },
});

defineCommand({
  id: "history.goto",
  kind: "action",
  label: "Zu Verlaufsschritt springen",
  description: "Stellt den Zustand eines beliebigen Verlaufsschritts wieder her. Spätere Schritte bleiben erhalten.",
  icon: "undo",
  params: { nodeId: { type: "id", description: "ID des Verlaufseintrags" } },
  perform(p) {
    useApp.getState().jumpTo(p.nodeId);
  },
});

defineCommand({
  id: "object.scale",
  kind: "document",
  label: "Skalieren",
  description:
    "Skaliert ein Objekt (Faktor je Achse X/Y/Z oder einheitlich). Die Maße werden direkt geändert; die untere Ecke (runde Körper: Mitte unten) bleibt stehen.",
  icon: "scale",
  params: {
    id: { type: "id", optional: true, description: "Objekt-ID (Standard: Auswahl)" },
    factor: { type: "vec3", description: "Faktoren [X, Y, Z], z. B. [2, 2, 2] für doppelte Größe" },
  },
  isEnabled: hasOne,
  apply(doc, p, ctx) {
    const f = findFeature(doc, p.id ?? ctx.selection[0]);
    if (!f) throw new Error("Objekt nicht gefunden");
    const s = (Array.isArray(p.factor) ? p.factor : [p.factor, p.factor, p.factor]).map(Number) as Vec3;
    if (s.some((v) => !(v > 0.01 && v < 100))) throw new Error("Faktoren müssen zwischen 0,01 und 100 liegen.");
    if (s.every((v) => v === 1)) return null;
    const box = worldBox(f, useMeshes.getState().entries);
    const anchor: Vec3 = box ? (gizmoAnchor(box, f.type, "scale").toArray() as Vec3) : [...f.transform.position];
    const pct = s.every((v) => v === s[0]) ? `${Math.round(s[0] * 100)} %` : s.map((v) => `${Math.round(v * 100)}`).join(" × ") + " %";
    return { doc: updateFeature(doc, f.id, () => scaleFeature(f, s, anchor)), label: `${f.name} skalieren (${pct})` };
  },
});

defineCommand({
  id: "tool.scale",
  kind: "action",
  label: "Skalieren",
  description: "Schaltet das Gizmo auf Skalieren (Griffe je Achse, Mitte = proportional, Shift = proportional).",
  icon: "scale",
  shortcut: "s",
  params: {},
  perform() {
    useGizmo.setState((s) => ({ mode: s.mode === "scale" ? "move" : "scale" }));
  },
});

defineCommand({
  id: "tool.move",
  kind: "action",
  label: "Verschieben",
  description: "Schaltet das Gizmo zurück auf Verschieben.",
  icon: "move",
  shortcut: "w",
  params: {},
  perform() {
    useGizmo.setState({ mode: "move" });
  },
});

defineCommand({
  id: "tool.rotate",
  kind: "action",
  label: "Drehen",
  description: "Schaltet das Gizmo zwischen Verschieben und Drehen um.",
  icon: "rotate",
  shortcut: "r",
  params: {},
  perform() {
    useGizmo.setState((s) => ({ mode: s.mode === "rotate" ? "move" : "rotate" }));
  },
});

defineCommand({
  id: "workspace.set",
  kind: "action",
  label: "Arbeitsbereich wechseln",
  description: "Wechselt zwischen Modell, 2D und Vorschau.",
  icon: "layers",
  params: { workspace: { type: "enum", options: ["model", "sketch", "preview"], description: "Arbeitsbereich" } },
  perform(p) {
    useApp.setState({ workspace: p.workspace });
  },
});

(["model", "sketch", "preview"] as const).forEach((w, i) =>
  defineCommand({
    id: `workspace.${w}`,
    kind: "action",
    label: ["Modell", "2D", "Vorschau"][i],
    description: `Wechselt in den Arbeitsbereich ${["Modell", "2D", "Vorschau"][i]}.`,
    icon: (["boxes", "sketch", "visible"] as const)[i],
    shortcut: String(i + 1),
    params: {},
    perform() {
      useApp.setState({ workspace: w });
    },
  }),
);

defineCommand({
  id: "view.projection",
  kind: "action",
  label: "Perspektive / Orthografisch",
  description: "Schaltet die Kamera zwischen perspektivischer und orthografischer (paralleler) Projektion um.",
  icon: "projection",
  shortcut: "o",
  params: { mode: { type: "enum", options: ["perspective", "orthographic"], optional: true, description: "Ohne Angabe umschalten" } },
  perform(p) {
    useSettings.setState((s) => ({
      projection: p.mode ?? (s.projection === "perspective" ? "orthographic" : "perspective"),
    }));
  },
});

defineCommand({
  id: "view.iso",
  kind: "action",
  label: "Isometrisch",
  description: "Dreht die Kamera in die klassische isometrische Ansicht (von vorne rechts oben).",
  icon: "iso",
  shortcut: "i",
  params: {},
  perform() {
    useViewRequest.setState({ request: { kind: "iso", at: Date.now() } });
  },
});

defineCommand({
  id: "view.screenshot",
  kind: "action",
  label: "Bild speichern",
  description: "Speichert die aktuelle Ansicht als PNG-Bild.",
  icon: "camera",
  params: {},
  perform() {
    usePreview.setState({ captureAt: Date.now() });
  },
});

defineCommand({
  id: "ai.focus",
  kind: "action",
  label: "KI-Assistent",
  description: "Öffnet den KI-Chat und setzt den Cursor ins Eingabefeld.",
  icon: "ai",
  shortcut: "mod+k",
  params: {},
  perform() {
    const layout = useLayout.getState();
    layout.open("chat", true);
    setTimeout(() => window.dispatchEvent(new Event("albedo:focus-chat")), 60);
  },
});

defineCommand({
  id: "help.open",
  kind: "action",
  label: "Hilfe",
  description: "Öffnet das Hilfe-Center.",
  icon: "help",
  shortcut: "shift+?",
  params: { topic: { type: "string", optional: true, description: "Themen-ID" } },
  perform(p) {
    useHelp.setState({ open: true, ...(p.topic ? { topic: p.topic } : {}) });
  },
});

defineCommand({
  id: "view.snap",
  kind: "action",
  label: "Einrasten",
  description: "Setzt das Einrastraster für Verschieben in mm (0 = aus).",
  icon: "measure",
  params: { mm: { type: "number", min: 0, unit: "mm", description: "Rasterweite" } },
  perform(p) {
    useApp.setState({ snap: p.mm });
  },
});

defineCommand({
  id: "view.grid",
  kind: "action",
  label: "Raster anzeigen",
  description: "Blendet das Bodenraster ein oder aus.",
  icon: "grid",
  shortcut: "g",
  params: { show: { type: "boolean", optional: true, description: "Ein/aus (Standard: umschalten)" } },
  perform(p) {
    useSettings.setState((s) => ({ showGrid: p.show ?? !s.showGrid }));
  },
});

// ── Files ────────────────────────────────────────────────────────────────────

const PROJECT_FILTER = { name: "Albedo-Projekt", extensions: ["albedo"] };
/** Opening also accepts project files saved before the rename. */
const OPEN_FILTER = { name: "Albedo-Projekt", extensions: ["albedo", "modelonio"] };

async function confirmDiscard(): Promise<boolean> {
  const s = useApp.getState();
  if (s.savedNodeId === s.currentId) return true;
  const text = "Ungespeicherte Änderungen gehen verloren. Fortfahren?";
  if (isTauri) {
    const { ask } = await import("@tauri-apps/plugin-dialog");
    return ask(text, { title: "Albedo", kind: "warning", okLabel: "Verwerfen", cancelLabel: "Abbrechen" });
  }
  return window.confirm(text);
}

const fileSafe = (name: string) => name.replace(/[\\/:*?"<>|]/g, "_");

async function saveProject(forceDialog: boolean) {
  const s = useApp.getState();
  const doc = s.nodes[s.currentId].doc;
  const path = await saveFile(
    `${fileSafe(doc.name)}.albedo`,
    PROJECT_FILTER,
    JSON.stringify(doc, null, 2),
    forceDialog ? null : s.filePath,
  );
  if (!path) return;
  useApp.setState({ savedNodeId: s.currentId, filePath: isTauri ? path : null });
  s.toast("success", `Gespeichert: ${baseName(path)}`);
}

defineCommand({
  id: "file.new",
  kind: "action",
  label: "Neues Projekt",
  description: "Beginnt ein leeres Projekt.",
  icon: "file",
  shortcut: "mod+n",
  params: {},
  async perform() {
    if (!(await confirmDiscard())) return;
    useApp.getState().reset(createDocument(), "Neues Projekt", null);
  },
});

defineCommand({
  id: "file.open",
  kind: "action",
  label: "Öffnen …",
  description: "Öffnet eine Albedo-Projektdatei (.albedo, auch ältere .modelonio-Dateien).",
  icon: "open",
  shortcut: "mod+o",
  params: {},
  async perform() {
    if (!(await confirmDiscard())) return;
    const file = await openTextFile(OPEN_FILTER);
    if (!file) return;
    const doc = JSON.parse(file.text);
    if (!isModelDocument(doc)) throw new Error("Keine gültige Albedo-Datei");
    doc.format = "albedo";
    useApp.getState().reset(doc, `${baseName(file.path)} geöffnet`, isTauri ? file.path : null);
  },
});

defineCommand({
  id: "file.save",
  kind: "action",
  label: "Speichern",
  description: "Speichert das Projekt als .albedo-Datei.",
  icon: "save",
  shortcut: "mod+s",
  params: {},
  perform: () => saveProject(false),
});

defineCommand({
  id: "file.saveAs",
  kind: "action",
  label: "Speichern unter …",
  description: "Speichert das Projekt unter einem neuen Namen.",
  icon: "save",
  shortcut: "shift+mod+s",
  params: {},
  perform: () => saveProject(true),
});

function defineExport(format: ExportFormat, description: string, shortcut?: string) {
  defineCommand({
    id: `export.${format}`,
    kind: "action",
    label: `Als ${format.toUpperCase()} exportieren`,
    description,
    icon: "export",
    shortcut,
    params: {},
    isEnabled: (ctx) => ctx.doc.features.some((f) => f.visible && isSolid(f)),
    async perform(_p, ctx) {
      const visible = ctx.doc.features.filter((f) => f.visible && isSolid(f));
      if (!visible.length) throw new Error("Es gibt keine sichtbaren Körper zum Exportieren.");
      const data = await exportFeatures(visible, format, ctx.doc.name);
      const path = await saveFile(
        `${fileSafe(ctx.doc.name)}.${format}`,
        { name: format.toUpperCase(), extensions: [format] },
        data,
      );
      if (path) useApp.getState().toast("success", `${format.toUpperCase()} exportiert: ${baseName(path)}`);
    },
  });
}

defineExport("stl", "Exportiert alle sichtbaren Objekte als binäre STL-Datei für den Slicer.", "mod+e");
defineExport("3mf", "Exportiert alle sichtbaren Objekte als 3MF-Datei (ein Objekt je Körper).");
defineExport("obj", "Exportiert alle sichtbaren Objekte als OBJ-Netz.");
defineExport("step", "Exportiert alle sichtbaren Objekte als STEP (exakte CAD-Geometrie, z. B. für Fusion).");


// ── Example ──────────────────────────────────────────────────────────────────

function exampleDocument(): ModelDocument {
  const doc = createDocument("Schlüsselanhänger", { starter: false });
  const at = (x: number, y: number, z = 0): Transform => ({ position: [x, y, z], rotation: [0, 0, 0] });
  doc.features = [
    {
      id: newId(), type: "boolean", op: "subtract", name: "Anhänger", visible: true, fillet: 1, transform: at(-8, -12),
      children: [
        { id: newId(), type: "box", name: "Platte", visible: true, params: { width: 56, depth: 26, height: 5 }, transform: at(0, 0) },
        { id: newId(), type: "cylinder", name: "Loch", visible: true, params: { diameter: 6, height: 7 }, transform: at(-21, 0, -1) },
      ],
    },
    { id: newId(), type: "cylinder", name: "Stift", visible: true, fillet: 1.5, params: { diameter: 14, height: 30 }, transform: at(34, 24) },
    { id: newId(), type: "sphere", name: "Kugel", visible: true, params: { diameter: 20 }, transform: at(-30, 28) },
    { id: newId(), type: "torus", name: "Ring", visible: true, params: { diameter: 30, thickness: 7 }, transform: at(36, -26) },
    { id: newId(), type: "cone", name: "Spitze", visible: true, params: { bottomDiameter: 18, topDiameter: 4, height: 22 }, transform: at(4, 30) },
  ];
  return doc;
}

defineCommand({
  id: "file.example",
  kind: "action",
  label: "Beispiel öffnen",
  description: "Öffnet ein kleines Beispielprojekt zum Ausprobieren.",
  icon: "shapes",
  params: {},
  async perform() {
    if (!(await confirmDiscard())) return;
    useApp.getState().reset(exampleDocument(), "Beispiel geöffnet", null);
  },
});

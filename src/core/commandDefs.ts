// All built-in commands. Importing this module registers them.
import * as THREE from "three";
import { defineCommand, getCommand, type CommandContext, type DocumentCommand, type DocumentResult } from "./commands";
import {
  BOOLEAN_LABELS,
  PRIMITIVE_LABELS,
  cloneFeature,
  createDocument,
  findFeature,
  geometryKey,
  newId,
  uniqueName,
  parentsOf,
  rememberPrinter,
  updateFeature,
  type BooleanFeature,
  type BooleanOp,
  type TextFeature,
  type ImportFeature,
  type TextFeatureParams,
  type Feature,
  type ModelDocument,
  type SketchFeature,
  type SketchShape,
  type PathSegment,
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
import { parseProject, serializeProject } from "./projectFile";
import { useChat } from "../ai/chatStore";
import { cameraState } from "../ui/cameraState";
import { hasClosedProfile, resizeProfile, scaleFeature } from "./scale";
import { SHAPE_DEFAULTS, type ExtraType, type ShapeDef } from "./shapeDefs";
import { gizmoAnchor } from "../ui/gizmoAnchor";
import { useTextTool } from "../ui/textTool";
import { useMeasure } from "../ui/measureTool";
import { useAlign } from "../components/AlignPanel";
import { useLibrary } from "../components/Library";
import { useSettingsDialog } from "../components/SettingsDialog";
import { useHelp } from "../help/HelpCenter";
import { useMeshes, exportFeatures } from "../cad/kernel";
import type { ExportFormat } from "../cad/protocol";
import { MANUAL, PRINTERS, bestOrientation } from "./printAnalysis";
import { worldBox } from "./bounds";
import { baseName, isTauri, openBinaryFile, openTextFile, saveFile } from "./platform";
import { svgToShapes, threeMfObjects } from "./importFormats";
import { bufferToBase64, registerAsset } from "../cad/assets";
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
        ...newColor(),
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

/** Places one primitive spec (as `primitive.<type>` would) on a document; returns the new doc + id. */
function addPrimitive(doc: ModelDocument, spec: Record<string, any>, ctx: CommandContext) {
  const cmd = getCommand(`primitive.${spec.type}`) as DocumentCommand | undefined;
  if (!cmd) throw new Error(`Unbekannte Form „${spec.type}“`);
  const params: Record<string, unknown> = { ...(spec.params ?? {}) };
  if (spec.position) params.position = spec.position;
  if (spec.name) params.name = spec.name;
  // Fill defaults like execute() would.
  for (const [k, sp] of Object.entries(cmd.params)) if (params[k] === undefined && "default" in sp && sp.default !== undefined) params[k] = sp.default;
  const res = cmd.apply(doc, params, { ...ctx, doc })!;
  let next = res.doc;
  const id = res.selection![0];
  if (spec.rotation) next = updateFeature(next, id, (f) => ({ ...f, transform: { ...f.transform, rotation: (spec.rotation as Vec3).map(round) as Vec3 } }));
  return { doc: next, id };
}

defineCommand({
  id: "shapes.createMany",
  kind: "document",
  label: "Formen erstellen",
  description:
    "Erstellt viele Grundkörper in EINEM Schritt. shapes: [{type: 'box'|'cylinder'|'sphere'|…, params: {…mm}, position: [x,y,z], rotation?: [rx,ry,rz], name?}]. Gibt die neuen IDs zurück.",
  icon: "shapes",
  params: { shapes: { type: "list", description: "Liste der Formen [{type, params, position, rotation?, name?}]" } },
  apply(doc, p, ctx) {
    const specs = (typeof p.shapes === "string" ? JSON.parse(p.shapes) : p.shapes) as Record<string, any>[];
    if (!Array.isArray(specs) || !specs.length) throw new Error("shapes muss eine Liste sein");
    if (specs.length > 500) throw new Error("Höchstens 500 Formen auf einmal");
    let next = doc;
    const ids: string[] = [];
    for (const spec of specs) {
      const r = addPrimitive(next, spec, ctx);
      next = r.doc;
      ids.push(r.id);
    }
    return { doc: next, selection: ids, label: `${specs.length} Formen erstellen` };
  },
});

defineCommand({
  id: "object.pattern",
  kind: "document",
  label: "Muster",
  description:
    "Vervielfältigt ein Objekt in EINEM Schritt: kind 'linear' (count, step [dx,dy,dz]), 'grid' (count [nx,ny], step [dx,dy]), 'circular' (count, center [x,y], angle° gesamt, Standard 360) oder 'mirror' (axis 'x'|'y', plane-Koordinate at). Das Original bleibt; Kopien werden hinzugefügt.",
  icon: "duplicate",
  params: {
    id: { type: "id", optional: true, description: "Objekt-ID (Standard: Auswahl)" },
    kind: { type: "enum", options: ["linear", "grid", "circular", "mirror"], description: "Musterart" },
    count: { type: "number", optional: true, description: "Anzahl inkl. Original (linear/circular; grid: Anzahl je Richtung, oder countY für Y)" },
    countY: { type: "number", optional: true, description: "grid: Anzahl in Y (Standard = count)" },
    step: { type: "vec3", unit: "mm", optional: true, description: "Abstand [dx, dy, dz] (linear/grid)" },
    center: { type: "vec3", unit: "mm", optional: true, description: "Drehzentrum (circular), Standard: Bettmitte" },
    angle: { type: "number", unit: "°", optional: true, description: "Gesamtwinkel (circular), Standard 360" },
    axis: { type: "enum", options: ["x", "y"], optional: true, description: "Spiegelachse (mirror)" },
    at: { type: "number", unit: "mm", optional: true, description: "Lage der Spiegelebene (mirror), Standard 0" },
  },
  apply(doc, p, ctx) {
    const f = findFeature(doc, p.id ?? ctx.selection[0]);
    if (!f) throw new Error("Objekt nicht gefunden");
    const count = p.count;
    const step = (p.step ?? [10, 0, 0]) as number[];
    const [x0, y0, z0] = f.transform.position;
    const places: { pos: Vec3; rotZ?: number }[] = [];
    if (p.kind === "linear") {
      const n = Number(count ?? 2);
      for (let i = 1; i < n; i++) places.push({ pos: [x0 + step[0] * i, y0 + (step[1] ?? 0) * i, z0 + (step[2] ?? 0) * i] });
    } else if (p.kind === "grid") {
      const nx = Number(count ?? 2);
      const ny = Number(p.countY ?? count ?? 2);
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) if (i || j) places.push({ pos: [x0 + step[0] * i, y0 + (step[1] ?? step[0]) * j, z0] });
    } else if (p.kind === "circular") {
      const n = Number(count ?? 6);
      const [cx, cy] = (p.center ?? [0, 0, 0]) as number[];
      const total = p.angle ?? 360;
      const da = (total >= 360 ? total / n : total / Math.max(1, n - 1)) * (Math.PI / 180);
      const rx = x0 - cx, ry = y0 - cy;
      for (let i = 1; i < n; i++) {
        const a = da * i;
        places.push({ pos: [cx + rx * Math.cos(a) - ry * Math.sin(a), cy + rx * Math.sin(a) + ry * Math.cos(a), z0], rotZ: (a * 180) / Math.PI });
      }
    } else {
      const at = p.at ?? 0;
      places.push({ pos: p.axis === "y" ? [x0, 2 * at - y0, z0] : [2 * at - x0, y0, z0] });
    }
    if (!places.length) return null;
    if (places.length > 500) throw new Error("Höchstens 500 Kopien auf einmal");
    const copies = places.map(({ pos, rotZ }) => {
      const c = cloneFeature(f);
      const [rx, ry, rz] = c.transform.rotation;
      return { ...c, name: uniqueName(doc, f.name.replace(/\s\d+$/, "")), transform: { position: pos.map(round) as Vec3, rotation: [rx, ry, round(rz + (rotZ ?? 0))] as Vec3 } };
    });
    // Unique names in order.
    let named = doc;
    for (const c of copies) {
      c.name = uniqueName(named, f.name.replace(/\s\d+$/, ""));
      named = { ...named, features: [...named.features, c] };
    }
    return { doc: named, selection: [f.id, ...copies.map((c) => c.id)], label: `${f.name}: Muster (${copies.length + 1}×)` };
  },
});

defineCommand({
  id: "objects.transformMany",
  kind: "document",
  label: "Mehrere transformieren",
  description: "Setzt Position und/oder Drehung vieler Objekte in EINEM Schritt. items: [{id, position?: [x,y,z], rotation?: [rx,ry,rz]}].",
  icon: "move",
  params: { items: { type: "list", description: "Liste [{id, position?, rotation?}]" } },
  apply(doc, p) {
    const items = (typeof p.items === "string" ? JSON.parse(p.items) : p.items) as { id: string; position?: Vec3; rotation?: Vec3 }[];
    let next = doc;
    for (const it of items) {
      if (!findFeature(next, it.id)) throw new Error(`Objekt ${it.id} nicht gefunden`);
      next = updateFeature(next, it.id, (f) => ({
        ...f,
        transform: { position: (it.position ?? f.transform.position).map(round) as Vec3, rotation: (it.rotation ?? f.transform.rotation).map(round) as Vec3 },
      }));
    }
    return next === doc ? null : { doc: next, label: `${items.length} Objekte transformieren` };
  },
});

defineCommand({
  id: "object.rotateBy",
  kind: "document",
  label: "Drehen",
  description:
    "Dreht ein Objekt RELATIV um X, Y, Z (Grad, Weltachsen) um seine Mitte. Lag es auf dem Bett, liegt es danach wieder darauf.",
  icon: "rotate",
  params: {
    id: { type: "id", optional: true, description: "Objekt-ID (Standard: Auswahl)" },
    by: { type: "vec3", unit: "°", description: "Drehung [x, y, z] in Grad" },
  },
  isEnabled: hasOne,
  apply(doc, p, ctx) {
    const f = findFeature(doc, p.id ?? ctx.selection[0]);
    if (!f) throw new Error("Objekt nicht gefunden");
    const by = (p.by as number[]).map(Number);
    if (by.every((v) => !v)) return null;
    const entries = useMeshes.getState().entries;
    const box = worldBox(f, entries);
    const d = THREE.MathUtils.degToRad;
    const qBy = new THREE.Quaternion().setFromEuler(new THREE.Euler(d(by[0]), d(by[1]), d(by[2]), "XYZ"));
    const q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(f.transform.rotation.map(d) as Vec3), "XYZ"));
    const e = new THREE.Euler().setFromQuaternion(qBy.clone().multiply(q0), "XYZ");
    const rotation = [e.x, e.y, e.z].map((r) => round(THREE.MathUtils.radToDeg(r)) + 0) as Vec3;
    // Pivot = centre of the bounding box.
    const c = box ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3(...f.transform.position);
    const pos = new THREE.Vector3(...f.transform.position).sub(c).applyQuaternion(qBy).add(c);
    let next: Transform = { position: pos.toArray().map(round) as Vec3, rotation };
    // Resting on the bed before → resting on it again.
    if (box && Math.abs(box.min.z) < 0.05) {
      const after = worldBox(f, entries, next);
      if (after) next = { ...next, position: [next.position[0], next.position[1], round(next.position[2] - after.min.z)] };
    }
    const txt = by.map((v, i) => (v ? `${"XYZ"[i]} ${v > 0 ? "+" : ""}${v}°` : "")).filter(Boolean).join(" ");
    return { doc: updateFeature(doc, f.id, (x) => ({ ...x, transform: next })), label: `${f.name} drehen (${txt})` };
  },
});

// ── Ausrichten ───────────────────────────────────────────────────────────────

const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const;
const boxMin = (b: THREE.Box3, k: number) => (k === 0 ? b.min.x : k === 1 ? b.min.y : b.min.z);
const boxMax = (b: THREE.Box3, k: number) => (k === 0 ? b.max.x : k === 1 ? b.max.y : b.max.z);

defineCommand({
  id: "objects.align",
  kind: "document",
  label: "Ausrichten",
  description:
    "Richtet Objekte an einer Achse aus: mode min/center/max (X: links/Mitte/rechts, Y: vorne/Mitte/hinten, Z: unten/Mitte/oben) an der gemeinsamen Bounding-Box. Ein einzelnes Objekt wird am Druckbett ausgerichtet (X/Y: Bettmitte bzw. -rand, Z: auf das Bett).",
  icon: "align",
  params: {
    ids: { type: "ids", optional: true, description: "Objekt-IDs (Standard: Auswahl)" },
    axis: { type: "enum", options: ["x", "y", "z"], description: "Achse" },
    mode: { type: "enum", options: ["min", "center", "max"], description: "Wo ausrichten" },
  },
  isEnabled: hasSelection,
  apply(doc, p, ctx) {
    const ids: string[] = p.ids ?? ctx.selection;
    const entries = useMeshes.getState().entries;
    const items = ids.map((id) => doc.features.find((f) => f.id === id)).filter((f): f is Feature => !!f && isSolid(f));
    const boxes = items.map((f) => worldBox(f, entries));
    if (!items.length || boxes.some((b) => !b)) throw new Error("Objekte werden noch berechnet – bitte gleich noch einmal.");
    const k = AXIS_INDEX[p.axis as "x" | "y" | "z"];
    // Reference: the combined box, or the bed for a single object.
    let ref: number;
    if (items.length === 1) {
      const half = doc.printer.volume[k] / 2;
      ref = k === 2 ? (p.mode === "max" ? doc.printer.volume[2] : p.mode === "center" ? doc.printer.volume[2] / 2 : 0) : p.mode === "min" ? -half : p.mode === "max" ? half : 0;
    } else {
      const lo = Math.min(...boxes.map((b) => boxMin(b!, k)));
      const hi = Math.max(...boxes.map((b) => boxMax(b!, k)));
      ref = p.mode === "min" ? lo : p.mode === "max" ? hi : (lo + hi) / 2;
    }
    let next = doc;
    items.forEach((f, i) => {
      const b = boxes[i]!;
      const cur = p.mode === "min" ? boxMin(b, k) : p.mode === "max" ? boxMax(b, k) : (boxMin(b, k) + boxMax(b, k)) / 2;
      const d = ref - cur;
      if (Math.abs(d) < 1e-6) return;
      next = updateFeature(next, f.id, (x) => ({ ...x, transform: { ...x.transform, position: x.transform.position.map((v, j) => (j === k ? round(v + d) : v)) as Vec3 } }));
    });
    if (next === doc) return null;
    const words = { x: ["links", "mittig", "rechts"], y: ["vorne", "mittig", "hinten"], z: ["unten", "mittig", "oben"] }[p.axis as "x" | "y" | "z"][["min", "center", "max"].indexOf(p.mode)];
    return { doc: next, label: `${items.length === 1 ? items[0].name : `${items.length} Objekte`} ${p.axis.toUpperCase()} ${words} ausrichten` };
  },
});

defineCommand({
  id: "objects.distribute",
  kind: "document",
  label: "Verteilen",
  description: "Verteilt 3 oder mehr Objekte entlang einer Achse mit gleichen Abständen zwischen ihnen (äußere bleiben stehen).",
  icon: "distribute",
  params: {
    ids: { type: "ids", optional: true, description: "Objekt-IDs (Standard: Auswahl)" },
    axis: { type: "enum", options: ["x", "y", "z"], description: "Achse" },
  },
  isEnabled: (ctx) => ctx.selection.length >= 3,
  apply(doc, p, ctx) {
    const ids: string[] = p.ids ?? ctx.selection;
    const entries = useMeshes.getState().entries;
    const k = AXIS_INDEX[p.axis as "x" | "y" | "z"];
    const items = ids
      .map((id) => doc.features.find((f) => f.id === id))
      .filter((f): f is Feature => !!f && isSolid(f))
      .map((f) => ({ f, b: worldBox(f, entries)! }))
      .filter((x) => x.b)
      .sort((a, b) => boxMin(a.b, k) - boxMin(b.b, k));
    if (items.length < 3) throw new Error("Zum Verteilen mindestens drei Objekte auswählen.");
    const total = boxMax(items[items.length - 1].b, k) - boxMin(items[0].b, k);
    const sizes = items.reduce((s, x) => s + boxMax(x.b, k) - boxMin(x.b, k), 0);
    const gap = (total - sizes) / (items.length - 1);
    let cursor = boxMin(items[0].b, k);
    let next = doc;
    for (const { f, b } of items) {
      const d = cursor - boxMin(b, k);
      if (Math.abs(d) > 1e-6) next = updateFeature(next, f.id, (x) => ({ ...x, transform: { ...x.transform, position: x.transform.position.map((v, j) => (j === k ? round(v + d) : v)) as Vec3 } }));
      cursor += boxMax(b, k) - boxMin(b, k) + gap;
    }
    return next === doc ? null : { doc: next, label: `${items.length} Objekte in ${p.axis.toUpperCase()} verteilen` };
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
    if (!f || f.type === "boolean" || f.type === "sketch" || f.type === "import") throw new Error("Nur Grundkörper haben Maße (Importe: object.scale)");
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
      if (f.type === "sketch") throw new Error("Flache Skizzen haben keine Kanten – zuerst im Inspektor eine Höhe geben.");
      if (f.type === "sphere" || f.type === "torus")
        throw new Error(`${PRIMITIVE_LABELS[f.type]} hat keine Kanten zum ${fillet ? "Abrunden" : "Fasen"}.`);
      const current = (fillet ? f.fillet : f.chamfer) ?? 0;
      let size: number = p.radius;
      if (size === undefined) {
        const b = worldBox(f, useMeshes.getState().entries);
        const smallest = b ? Math.min(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) : 20;
        size = current ? 0 : Math.max(0.5, Math.round(smallest * 0.1 * 2) / 2);
      }
      // The other treatment already uses part of the room on each edge.
      const other = (fillet ? f.chamfer : f.fillet) ?? 0;
      const base = maxEdgeSize(f);
      const limit = base === null ? null : base - other;
      if (size > 0 && limit !== null && size >= limit)
        throw new Error(`${size.toLocaleString("de-DE")} mm ist zu groß für ${f.name}. Höchstens etwa ${(Math.floor((limit - 0.05) * 10) / 10).toLocaleString("de-DE")} mm.`);
      if (current === size) return null;
      const verb = fillet ? "abrunden" : "fasen";
      return {
        // Independent of the other treatment: both can be combined.
        doc: updateFeature(doc, f.id, (x) => ({ ...x, [kind]: size })),
        label: size ? `${f.name} ${verb} (${size.toLocaleString("de-DE")} mm)` : `${f.name}: ${fillet ? "Abrundung" : "Fase"} entfernen`,
      };
    },
  });
}

/** Upper bound for fillet/chamfer size on simple primitives (null = let the kernel decide). */
export function maxEdgeSize(f: Feature): number | null {
  switch (f.type) {
    case "box":
      return Math.min(f.params.width, f.params.depth, f.params.height) / 2;
    case "cylinder":
      return Math.min(f.params.diameter / 2, f.params.height / 2);
    default:
      return null;
  }
}

// Library shapes (core/shapeDefs.ts): one primitive command each.
for (const [type, def] of Object.entries(SHAPE_DEFAULTS) as [ExtraType, ShapeDef][]) {
  const specs = Object.fromEntries(Object.entries(def.params).map(([k, v]) => [k, { description: def.labels[k] ?? k, default: v }]));
  definePrimitive(type, def.icon, `Fügt ${def.label === "Schale" ? "eine" : "ein(e)"} ${def.label} hinzu (${def.hint}).`, specs as never, (p) => {
    const vals = Object.values(p as Record<string, number>);
    return Math.max(10, ...vals.filter((v) => v > 5));
  });
}

/** New objects (library, text, sketches, AI) get the colour picked last. */
function newColor(): { color?: string } {
  const c = useSettings.getState().lastColor;
  return c ? { color: c } : {};
}

defineCommand({
  id: "object.setColor",
  kind: "document",
  label: "Farbe",
  description: "Setzt die Farbe eines oder mehrerer Objekte (Hex wie \"#e64a3c\"; leer = neutral grau). Wird in 3MF/OBJ mit exportiert.",
  icon: "background",
  params: {
    ids: { type: "ids", optional: true, description: "Objekt-IDs (Standard: Auswahl)" },
    color: { type: "string", description: "Farbe als #rrggbb oder leer" },
  },
  isEnabled: (ctx) => ctx.selection.length > 0,
  apply(doc, p, ctx) {
    const ids: string[] = p.ids ?? ctx.selection;
    const c = String(p.color ?? "").trim().toLowerCase();
    if (c && !/^#[0-9a-f]{6}$/.test(c)) throw new Error("Farbe bitte als #rrggbb angeben.");
    let changed = 0;
    const features = doc.features.map((f) => {
      if (!ids.includes(f.id) || (f.color ?? "") === c) return f;
      changed++;
      const { color: _old, ...rest } = f;
      return (c ? { ...rest, color: c } : rest) as Feature;
    });
    if (!changed) return null;
    return { doc: { ...doc, features }, label: changed === 1 ? `${doc.features.find((f) => ids.includes(f.id))!.name}: Farbe` : `${changed} Objekte: Farbe` };
  },
});

// ── Text ─────────────────────────────────────────────────────────────────────

const textParamSchema = {
  text: { type: "string", description: "Der Text (eine Zeile, Umlaute erlaubt)" },
  size: { type: "number", unit: "mm", min: 0.5, default: 10, description: "Höhe der Großbuchstaben" },
  font: { type: "string", default: "inter", description: "Schrift: inter, roboto-slab, roboto-mono (mitgeliefert) oder der Name einer installierten Schriftfamilie, z. B. „Futura“" },
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
        ...newColor(),
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
      ...(target.color ? { color: target.color } : {}),
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
  if (f.type === "boolean" && f.children.length === 2 && f.children[1].type === "text" && f.children[1].params.onFace) return f.children[1];
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
    font: { type: "string", optional: true, description: "Schrift (mitgeliefert oder installierte Familie)" },
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
    // Operands inside a boolean too: a hidden tool switches its cut/union off.
    const next = ids.reduce((d, id) => updateFeature(d, id, (f) => ({ ...f, visible })), doc);
    return {
      doc: next,
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

const shapeLabels: Record<SketchShape["kind"], string> = {
  rect: "Rechteck", circle: "Kreis", polygon: "Vieleck", poly: "Linienzug", ellipse: "Ellipse", slot: "Langloch", rrect: "Abgerundetes Rechteck", path: "Pfad",
};

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
      ...newColor(),
      transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
      shapes: [shape],
    };
    return { doc: { ...doc, features: [...doc.features, sketch] }, selection: [sketch.id], label: `${shapeLabels[shape.kind]} zeichnen` };
  },
});

/**
 * Size of a 2D sketch / extruded profile: Breite and Tiefe scale the profile around its
 * centre, Höhe > 0 extrudes it in place (same object), Höhe 0 makes it flat again.
 */
defineCommand({
  id: "shape.setSize",
  kind: "document",
  label: "Größe ändern",
  description:
    "Setzt Breite, Tiefe und Höhe einer Skizze bzw. eines hochgezogenen Profils. Höhe > 0 zieht die Skizze in 3D (parametrisch), Höhe 0 macht sie wieder flach.",
  icon: "extrude",
  params: {
    id: { type: "id", optional: true, description: "Skizzen-/Profil-ID (Standard: Auswahl)" },
    width: { type: "number", unit: "mm", min: 0.1, optional: true, description: "Breite (X)" },
    depth: { type: "number", unit: "mm", min: 0.1, optional: true, description: "Tiefe (Y)" },
    height: { type: "number", unit: "mm", min: 0, optional: true, description: "Höhe (0 = flache Skizze)" },
  },
  isEnabled: (ctx) => ctx.selection.length === 1 && ["sketch", "extrude"].includes(findFeature(ctx.doc, ctx.selection[0])?.type ?? ""),
  apply(doc, p, ctx) {
    const f = findFeature(doc, p.id ?? ctx.selection[0]);
    if (!f || (f.type !== "sketch" && f.type !== "extrude")) throw new Error("Bitte eine Skizze oder ein hochgezogenes Profil auswählen.");
    const shapes = resizeProfile(f.type === "sketch" ? f.shapes : f.profile, p.width, p.depth);
    const height = p.height !== undefined ? round(p.height) : f.type === "extrude" ? f.height : 0;
    if (height > 0 && !hasClosedProfile(shapes))
      throw new Error("Die Skizze enthält keine geschlossene Form. Schließe den Linienzug am Startpunkt.");
    const { id, name, visible, transform } = f;
    const next: Feature =
      height > 0
        ? { id, name, visible, transform, type: "extrude", profile: shapes, height, fillet: f.fillet, chamfer: f.chamfer, ...(f.corner ? { corner: f.corner } : {}), ...(f.color ? { color: f.color } : {}) }
        : { id, name, visible, transform, type: "sketch", shapes, ...(f.corner ? { corner: f.corner } : {}), ...(f.color ? { color: f.color } : {}) };
    if (JSON.stringify(next) === JSON.stringify(f)) return null;
    const label =
      p.height !== undefined && (f.type === "sketch") !== (height === 0)
        ? height > 0 ? `${name} ${height.toLocaleString("de-DE")} mm hochziehen` : `${name} flach machen`
        : `${name}: Größe ändern`;
    return { doc: updateFeature(doc, f.id, () => next), label };
  },
});

/** Adds a curve shape as a new sketch (or straight away as a solid with `height`). */
function addCurveShape(doc: ModelDocument, shape: SketchShape, height: number | undefined, name: string | undefined, corner?: number): DocumentResult {
  const base = { id: newId(), name: name ?? uniqueName(doc, height ? "Körper" : "Skizze"), visible: true, ...newColor(), transform: { position: [0, 0, 0] as Vec3, rotation: [0, 0, 0] as Vec3 } };
  const f: Feature =
    height && height > 0
      ? { ...base, type: "extrude", profile: [shape], height: round(height), ...(corner ? { corner } : {}) }
      : { ...base, type: "sketch", shapes: [shape], ...(corner ? { corner } : {}) };
  return { doc: { ...doc, features: [...doc.features, f] }, selection: [f.id], label: `${shapeLabels[shape.kind]} ${height ? "erstellen" : "zeichnen"}` };
}

const heightParam = { type: "number", unit: "mm", min: 0, optional: true, description: "Höhe: > 0 erstellt direkt einen Körper, sonst eine flache Skizze" } as const;
const nameParam = { type: "string", optional: true, description: "Name im Objektbaum" } as const;

defineCommand({
  id: "sketch.ellipse",
  kind: "document",
  label: "Ellipse",
  description: "Echte Ellipse (kein Vieleck) als Skizze oder mit height direkt als Körper – z. B. ovaler Anhänger.",
  icon: "egg",
  params: {
    center: { type: "vec3", unit: "mm", optional: true, description: "Mitte [x, y, 0], Standard Bettmitte" },
    rx: { type: "number", unit: "mm", min: 0.1, description: "Halbachse in X" },
    ry: { type: "number", unit: "mm", min: 0.1, description: "Halbachse in Y" },
    angle: { type: "number", unit: "°", optional: true, description: "Drehung" },
    height: heightParam,
    name: nameParam,
  },
  apply(doc, p) {
    const [cx, cy] = (p.center ?? [0, 0, 0]) as number[];
    return addCurveShape(doc, { kind: "ellipse", cx, cy, rx: p.rx, ry: p.ry, angle: p.angle ?? 0 }, p.height, p.name);
  },
});

defineCommand({
  id: "sketch.roundedRect",
  kind: "document",
  label: "Abgerundetes Rechteck",
  description: "Rechteck mit echten runden Ecken (Radius r) als Skizze oder mit height direkt als Körper.",
  icon: "plate",
  params: {
    center: { type: "vec3", unit: "mm", optional: true, description: "Mitte [x, y, 0]" },
    width: { type: "number", unit: "mm", min: 0.1, description: "Breite" },
    depth: { type: "number", unit: "mm", min: 0.1, description: "Tiefe" },
    r: { type: "number", unit: "mm", min: 0, description: "Eckradius" },
    height: heightParam,
    name: nameParam,
  },
  apply(doc, p) {
    const [cx, cy] = (p.center ?? [0, 0, 0]) as number[];
    return addCurveShape(doc, { kind: "rrect", x: cx - p.width / 2, y: cy - p.depth / 2, w: p.width, h: p.depth, r: p.r }, p.height, p.name);
  },
});

defineCommand({
  id: "sketch.slot",
  kind: "document",
  label: "Langloch",
  description: "Langloch / Stadion-Form (Rechteck mit halbrunden Enden) als Skizze oder mit height als Körper.",
  icon: "slots",
  params: {
    center: { type: "vec3", unit: "mm", optional: true, description: "Mitte [x, y, 0]" },
    length: { type: "number", unit: "mm", min: 0.1, description: "Gesamtlänge" },
    width: { type: "number", unit: "mm", min: 0.1, description: "Breite" },
    angle: { type: "number", unit: "°", optional: true, description: "Drehung" },
    height: heightParam,
    name: nameParam,
  },
  apply(doc, p) {
    const [cx, cy] = (p.center ?? [0, 0, 0]) as number[];
    return addCurveShape(doc, { kind: "slot", cx, cy, length: p.length, width: p.width, angle: p.angle ?? 0 }, p.height, p.name);
  },
});

defineCommand({
  id: "sketch.path",
  kind: "document",
  label: "Pfad",
  description:
    "Freie Kontur aus echten Segmenten: segments [{type:'line',to:[x,y]} | {type:'arc',to,via} (Kreisbogen durch via) | {type:'spline',to} (glatte Kurve)]. closed: true für Körper. Mit height direkt als Körper; corner rundet die Ecken in 2D.",
  icon: "spline",
  params: {
    start: { type: "vec3", unit: "mm", description: "Startpunkt [x, y, 0]" },
    segments: { type: "list", description: "Segmente" },
    closed: { type: "boolean", default: true, description: "Geschlossen" },
    corner: { type: "number", unit: "mm", min: 0, optional: true, description: "Ecken in 2D abrunden" },
    height: heightParam,
    name: nameParam,
  },
  apply(doc, p) {
    const start = (p.start as number[]).slice(0, 2) as [number, number];
    const segments = (p.segments as PathSegment[]).map((g) => ({ ...g, to: (g.to as number[]).slice(0, 2) as [number, number], ...(g.type === "arc" ? { via: (g.via as number[]).slice(0, 2) as [number, number] } : {}) })) as PathSegment[];
    return addCurveShape(doc, { kind: "path", start, segments, closed: p.closed }, p.height, p.name, p.corner);
  },
});

/** Fits a smooth spline through every closed polyline of a sketch/profile (true curve afterwards). */
defineCommand({
  id: "sketch.smooth",
  kind: "document",
  label: "Glätten",
  description: "Macht aus kantigen Linienzügen einer Skizze/eines Profils eine glatte Kurve (Spline durch die Punkte).",
  icon: "spline",
  params: { id: { type: "id", optional: true, description: "Skizzen-/Profil-ID (Standard: Auswahl)" } },
  isEnabled: (ctx) => {
    const f = findFeature(ctx.doc, ctx.selection[0]);
    return ctx.selection.length === 1 && !!f && (f.type === "sketch" || f.type === "extrude") && (f.type === "sketch" ? f.shapes : f.profile).some((s) => s.kind === "poly" && s.points.length >= 3);
  },
  apply(doc, p, ctx) {
    const f = findFeature(doc, p.id ?? ctx.selection[0]);
    if (!f || (f.type !== "sketch" && f.type !== "extrude")) throw new Error("Bitte eine Skizze auswählen.");
    const smooth = (s: SketchShape): SketchShape => {
      if (s.kind !== "poly" || s.points.length < 3) return s;
      const pts = s.points;
      const segments: PathSegment[] = pts.slice(1).map((to) => ({ type: "spline", to }));
      if (s.closed) segments.push({ type: "spline", to: pts[0] });
      return { kind: "path", start: pts[0], segments, closed: s.closed };
    };
    const next = f.type === "sketch" ? { ...f, shapes: f.shapes.map(smooth) } : { ...f, profile: f.profile.map(smooth) };
    return { doc: updateFeature(doc, f.id, () => next), label: `${f.name} glätten` };
  },
});

defineCommand({
  id: "sketch.roundCorners",
  kind: "document",
  label: "Ecken abrunden (2D)",
  description: "Rundet die Ecken der Kontur einer Skizze/eines Profils in 2D ab (0 = spitz). Für runde Umrisse besser als 3D-Kanten abrunden.",
  icon: "fillet",
  params: {
    id: { type: "id", optional: true, description: "Skizzen-/Profil-ID (Standard: Auswahl)" },
    radius: { type: "number", unit: "mm", min: 0, description: "Eckradius" },
  },
  apply(doc, p, ctx) {
    const f = findFeature(doc, p.id ?? ctx.selection[0]);
    if (!f || (f.type !== "sketch" && f.type !== "extrude")) throw new Error("Bitte eine Skizze oder ein Profil auswählen.");
    if ((f.corner ?? 0) === p.radius) return null;
    return { doc: updateFeature(doc, f.id, (x) => ({ ...x, corner: round(p.radius) }) as Feature), label: `${f.name}: Ecken abrunden (2D)` };
  },
});

/** Kept for the AI and older prompts: extrudes a sketch in place. */
defineCommand({
  id: "sketch.extrude",
  kind: "document",
  label: "Höhe geben",
  description: "Zieht eine Skizze um die angegebene Höhe hoch (wie Höhe im Inspektor). Innenliegende Formen werden zu Löchern.",
  icon: "extrude",
  params: {
    id: { type: "id", optional: true, description: "Skizzen-ID (Standard: Auswahl)" },
    height: { type: "number", unit: "mm", min: 0.1, default: 10, description: "Höhe" },
  },
  isEnabled: (ctx) => ctx.selection.length === 1 && findFeature(ctx.doc, ctx.selection[0])?.type === "sketch",
  apply(doc, p, ctx) {
    return (getCommand("shape.setSize") as DocumentCommand).apply(doc, { id: p.id ?? ctx.selection[0], height: p.height }, ctx);
  },
});

(
  [
    ["select", "Auswählen", "v", "select"],
    ["line", "Linie", "l", "line"],
    ["rect", "Rechteck", "shift+r", "rect"],
    ["circle", "Kreis", "c", "sphere"],
    ["ellipse", "Ellipse", "e", "egg"],
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
      toolId: { type: "id", optional: true, description: "Ein Werkzeugkörper" },
      toolIds: { type: "ids", optional: true, description: "Mehrere Werkzeugkörper auf einmal (ein Schritt, schneller als einzeln)" },
    },
    isEnabled: (ctx) => ctx.selection.length >= 2,
    apply(doc, p, ctx): DocumentResult {
      const target = findFeature(doc, p.targetId ?? ctx.selection[0]);
      const toolIdList: string[] = p.toolIds ?? (p.toolId ? [p.toolId] : ctx.selection.filter((id) => id !== (p.targetId ?? ctx.selection[0])));
      const tools = toolIdList.map((id) => findFeature(doc, id)).filter((t): t is Feature => !!t && t.id !== target?.id);
      if (!target || !tools.length) throw new Error("Bitte einen Zielkörper und mindestens ein Werkzeug angeben");
      if (tools.length !== toolIdList.length) throw new Error("Ein Werkzeugkörper wurde nicht gefunden");
      if (!isSolid(target) || tools.some((t) => !isSolid(t))) throw new Error("Skizzen erst über die Höhe zu Körpern machen");
      const tool = tools[0];
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
        // The result keeps the colour of the first operand.
        ...(target.color ? { color: target.color } : {}),
        transform: { position: [...origin], rotation: [0, 0, 0] },
        children: [rel(target), ...tools.map(rel)],
      };
      const used = new Set([target.id, ...tools.map((t) => t.id)]);
      const idx = doc.features.findIndex((f) => f.id === target.id);
      const features = doc.features.filter((f) => !used.has(f.id));
      features.splice(Math.min(idx, features.length), 0, result);
      const sign = op === "union" ? "+" : op === "subtract" ? "−" : "∩";
      const toolNames = tools.length === 1 ? tool.name : `${tools.length} Körper`;
      return {
        doc: { ...doc, features },
        selection: [result.id],
        label: `${BOOLEAN_LABELS[op]}: ${target.name} ${sign} ${toolNames}`,
      };
    },
  });
}

defineBoolean("union", "union", "Vereinen", "Verschmilzt zwei Objekte zu einem.");
defineBoolean("subtract", "subtract", "Abziehen", "Zieht das zweite ausgewählte Objekt vom ersten ab (z. B. für Löcher).");
defineBoolean("intersect", "intersect", "Schnittmenge", "Behält nur den Bereich, in dem sich beide Objekte überschneiden.");

/** Removes an operand from its boolean; a boolean left with one operand turns back into it. */
function withoutOperand(doc: ModelDocument, id: string): { doc: ModelDocument; operand: Feature; parent: BooleanFeature } {
  const chain = parentsOf(doc, id);
  const parent = chain[chain.length - 1];
  if (!parent) throw new Error("Das ist kein Teil eines Verbunds.");
  const operand = parent.children.find((c) => c.id === id)!;
  const rest = parent.children.filter((c) => c.id !== id);
  const replacement: Feature =
    rest.length >= 2
      ? { ...parent, children: rest as BooleanFeature["children"] }
      : { ...rest[0], transform: { ...rest[0].transform, position: rest[0].transform.position.map((v, i) => v + parent.transform.position[i]) as Vec3 } };
  // Replace the parent where it lives (top level or nested).
  const grand = chain[chain.length - 2];
  let next: ModelDocument;
  if (!grand) next = { ...doc, features: doc.features.map((f) => (f.id === parent.id ? replacement : f)) };
  else next = updateFeature(doc, grand.id, (g) => ({ ...(g as BooleanFeature), children: (g as BooleanFeature).children.map((c) => (c.id === parent.id ? replacement : c)) as BooleanFeature["children"] }));
  return { doc: next, operand, parent };
}

/** World position of a nested operand's origin (parents assumed unrotated). */
function worldOrigin(doc: ModelDocument, f: Feature): Vec3 {
  return parentsOf(doc, f.id).reduce((p, b) => p.map((v, i) => v + b.transform.position[i]) as Vec3, [...f.transform.position] as Vec3);
}

defineCommand({
  id: "operand.extract",
  kind: "document",
  label: "Aus Verbund lösen",
  description: "Nimmt ein Teil (Operand) aus einem Verbund heraus und legt es als eigenes Objekt an derselben Stelle ab.",
  icon: "boolean",
  params: { id: { type: "id", optional: true, description: "Operand-ID (Standard: Auswahl)" } },
  isEnabled: (ctx) => ctx.selection.length === 1 && parentsOf(ctx.doc, ctx.selection[0]).length > 0,
  apply(doc, p, ctx) {
    const id = p.id ?? ctx.selection[0];
    const f = findFeature(doc, id);
    if (!f) throw new Error("Objekt nicht gefunden");
    const pos = worldOrigin(doc, f);
    const r = withoutOperand(doc, id);
    const out = { ...r.operand, visible: true, transform: { ...r.operand.transform, position: pos } };
    return { doc: { ...r.doc, features: [...r.doc.features, out] }, selection: [out.id], label: `${f.name} aus ${r.parent.name} lösen` };
  },
});

defineCommand({
  id: "operand.remove",
  kind: "document",
  label: "Aus Verbund entfernen",
  description: "Entfernt ein Teil (Operand) aus einem Verbund; das Ergebnis wird neu berechnet.",
  icon: "delete",
  params: { id: { type: "id", optional: true, description: "Operand-ID (Standard: Auswahl)" } },
  isEnabled: (ctx) => ctx.selection.length === 1 && parentsOf(ctx.doc, ctx.selection[0]).length > 0,
  apply(doc, p, ctx) {
    const id = p.id ?? ctx.selection[0];
    const r = withoutOperand(doc, id);
    return { doc: r.doc, selection: [r.parent.id].filter((x) => findFeature(r.doc, x)), label: `${r.operand.name} entfernen` };
  },
});

defineCommand({
  id: "boolean.setOp",
  kind: "document",
  label: "Typ ändern",
  description: "Ändert die Art eines Verbunds: union (vereinen), subtract (abziehen), intersect (Schnittmenge).",
  icon: "boolean",
  params: {
    id: { type: "id", optional: true, description: "Verbund-ID oder ID eines seiner Teile (Standard: Auswahl)" },
    op: { type: "enum", options: ["union", "subtract", "intersect"], description: "Neue Art" },
  },
  apply(doc, p, ctx) {
    const id = p.id ?? ctx.selection[0];
    const f = findFeature(doc, id);
    const target = f?.type === "boolean" ? f : parentsOf(doc, id).pop();
    if (!target) throw new Error("Kein Verbund ausgewählt.");
    if (target.op === p.op) return null;
    return { doc: updateFeature(doc, target.id, (x) => ({ ...(x as BooleanFeature), op: p.op })), label: `${target.name}: ${BOOLEAN_LABELS[p.op as BooleanOp]}` };
  },
});

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

/** Back to plain selecting/moving: ends text, scale and library modes (and leaves 2D). */
export function selectTool() {
  useTextTool.setState({ active: false });
  useMeasure.setState({ active: false, points: [] });
  useLibrary.setState({ open: false });
  useGizmo.setState({ mode: "move" });
  if (useApp.getState().workspace !== "model") useApp.setState({ workspace: "model" });
}

defineCommand({
  id: "tool.select",
  kind: "action",
  label: "Auswählen",
  description: "Auswählen und verschieben (beendet Text-, Skalier- und Bibliotheksmodus).",
  icon: "select",
  shortcut: "v",
  params: {},
  isEnabled: () => useApp.getState().workspace !== "sketch",
  perform: selectTool,
});

defineCommand({
  id: "library.toggle",
  kind: "action",
  label: "Formen-Bibliothek",
  description: "Öffnet die Formen-Bibliothek mit allen Grundkörpern.",
  icon: "shapes",
  shortcut: "l",
  params: {},
  isEnabled: () => useApp.getState().workspace !== "sketch",
  perform() {
    useLibrary.setState((s) => ({ open: !s.open }));
  },
});

defineCommand({
  id: "tool.measure",
  kind: "action",
  label: "Messen",
  description: "Messwerkzeug: zwei Punkte anklicken (Körper oder Bett) zeigt Abstand und ΔX/ΔY/ΔZ.",
  icon: "ruler",
  shortcut: "m",
  params: {},
  isEnabled: () => useApp.getState().workspace !== "sketch",
  perform() {
    const on = !useMeasure.getState().active;
    useMeasure.setState({ active: on, points: [] });
    if (on) useTextTool.setState({ active: false });
  },
});

defineCommand({
  id: "tool.align",
  kind: "action",
  label: "Ausrichten",
  description: "Öffnet das Ausrichten-Fenster (Achsen bündig/mittig, Verteilen).",
  icon: "align",
  shortcut: "a",
  params: {},
  isEnabled: () => useApp.getState().workspace !== "sketch",
  perform() {
    useAlign.setState((s) => ({ open: !s.open }));
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
    setTimeout(() => window.dispatchEvent(new Event("cubrix:focus-chat")), 60);
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

defineCommand({
  id: "app.settings",
  kind: "action",
  label: "Einstellungen …",
  description: "Öffnet die Einstellungen (u. a. das Fehlerprotokoll).",
  icon: "settings",
  shortcut: "mod+,",
  params: {},
  perform() {
    useSettingsDialog.setState({ open: true });
  },
});

// ── Import ───────────────────────────────────────────────────────────────────

/** Adds imported parts (STL/STEP data) as import features standing on a free spot of the bed. */
function importParts(parts: { name: string; format: "stl" | "step"; data: Uint8Array }[]) {
  const app = useApp.getState();
  let doc = app.nodes[app.currentId].doc;
  const ids: string[] = [];
  const assets = { ...(doc.assets ?? {}) };
  const features = [...doc.features];
  for (const part of parts) {
    const assetId = newId();
    assets[assetId] = { format: part.format, name: part.name, data: bufferToBase64(part.data) };
    registerAsset(assetId, assets[assetId]);
    const f: ImportFeature = {
      id: newId(),
      type: "import",
      name: uniqueName({ ...doc, features }, part.name.replace(/\.[^.]+$/, "").slice(0, 40) || "Import"),
      visible: true,
      assetId,
      scale: 1,
      ...newColor(),
      transform: { position: freeSpot({ ...doc, features }, 40), rotation: [0, 0, 0] },
    };
    features.push(f);
    ids.push(f.id);
  }
  doc = { ...doc, assets, features };
  app.commit({ commandId: "file.import", label: parts.length === 1 ? `${parts[0].name} importieren` : `${parts.length} Teile importieren`, icon: "open", source: "user", doc, selection: ids });
}

defineCommand({
  id: "file.import",
  kind: "action",
  label: "Importieren …",
  description: "Importiert STL, 3MF oder STEP als Körper bzw. SVG als Skizze (mit echten Kurven).",
  icon: "open",
  shortcut: "shift+mod+i",
  params: {},
  async perform() {
    const file = await openBinaryFile({ name: "3D-Modell oder SVG", extensions: ["stl", "3mf", "step", "stp", "svg"] });
    if (!file) return;
    const name = baseName(file.path);
    const ext = name.split(".").pop()?.toLowerCase();
    if (ext === "svg") {
      const shapes = svgToShapes(new TextDecoder().decode(file.data));
      const app = useApp.getState();
      const doc = app.nodes[app.currentId].doc;
      const sketch: SketchFeature = { id: newId(), type: "sketch", name: uniqueName(doc, name.replace(/\.svg$/i, "").slice(0, 40) || "SVG"), visible: true, ...newColor(), transform: { position: [0, 0, 0], rotation: [0, 0, 0] }, shapes };
      app.commit({ commandId: "file.import", label: `${name} importieren`, icon: "open", source: "user", doc: { ...doc, features: [...doc.features, sketch] }, selection: [sketch.id] });
      app.toast("success", `${shapes.length} Formen aus ${name} – im Inspektor eine Höhe geben, um sie in 3D zu ziehen.`);
      return;
    }
    if (ext === "3mf") return importParts(threeMfObjects(file.data).map((o) => ({ name: o.name, format: "stl" as const, data: o.stl })));
    if (ext === "step" || ext === "stp") return importParts([{ name, format: "step", data: file.data }]);
    if (ext === "stl") return importParts([{ name, format: "stl", data: file.data }]);
    throw new Error("Dieses Dateiformat wird nicht unterstützt (STL, 3MF, STEP, SVG).");
  },
});

// ── Files ────────────────────────────────────────────────────────────────────

const PROJECT_FILTER = { name: "Cubrix-Projekt", extensions: ["cubrix"] };
/** Opening also accepts project files saved before the rename. */
const OPEN_FILTER = { name: "Cubrix-Projekt", extensions: ["cubrix", "albedo", "modelonio"] };

async function confirmDiscard(): Promise<boolean> {
  const s = useApp.getState();
  if (s.savedNodeId === s.currentId) return true;
  const text = "Ungespeicherte Änderungen gehen verloren. Fortfahren?";
  if (isTauri) {
    const { ask } = await import("@tauri-apps/plugin-dialog");
    return ask(text, { title: "Cubrix", kind: "warning", okLabel: "Verwerfen", cancelLabel: "Abbrechen" });
  }
  return window.confirm(text);
}

const fileSafe = (name: string) => name.replace(/[\\/:*?"<>|]/g, "_");

async function saveProject(forceDialog: boolean) {
  const s = useApp.getState();
  const doc = s.nodes[s.currentId].doc;
  const chat = useChat.getState();
  // Document + history (branches, AI groups) + chat + camera + selection; no layout, no keys.
  const text = serializeProject({
    document: doc,
    history: { rootId: s.rootId, currentId: s.currentId, nodes: s.nodes },
    chat: { entries: chat.entries.map(({ error: _e, prompt: _p, ...e }) => e), api: chat.api },
    camera: cameraState.get?.(),
    selection: s.selection,
  });
  const path = await saveFile(`${fileSafe(doc.name)}.cubrix`, PROJECT_FILTER, text, forceDialog ? null : s.filePath);
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
  description: "Öffnet eine Cubrix-Projektdatei (.cubrix, auch ältere .albedo- und .modelonio-Dateien).",
  icon: "open",
  shortcut: "mod+o",
  params: {},
  async perform() {
    if (!(await confirmDiscard())) return;
    const file = await openTextFile(OPEN_FILTER);
    if (!file) return;
    const { file: project, migratedFrom } = parseProject(file.text);
    const app = useApp.getState();
    app.reset(project.document, `${baseName(file.path)} geöffnet`, isTauri ? file.path : null);
    if (project.history) {
      const h = project.history;
      useApp.setState({ nodes: h.nodes, rootId: h.rootId, currentId: h.currentId, savedNodeId: h.currentId });
    }
    useApp.setState({ selection: project.selection.filter((id) => !!findFeature(project.document, id)) });
    useChat.setState({ entries: project.chat.entries, api: project.chat.api, running: false });
    if (project.camera) setTimeout(() => cameraState.set?.(project.camera!), 50);
    if (migratedFrom < 2) app.toast("info", "Ältere Projektdatei geöffnet – beim Speichern wird sie ins neue Format übernommen.");
  },
});

defineCommand({
  id: "file.save",
  kind: "action",
  label: "Speichern",
  description: "Speichert das Projekt als .cubrix-Datei.",
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
      const flat = ctx.doc.features.filter((f) => f.visible && f.type === "sketch").length;
      if (!visible.length) throw new Error("Es gibt keine sichtbaren Körper zum Exportieren.");
      if (flat) useApp.getState().toast("info", flat === 1 ? "1 flache Skizze wurde nicht exportiert." : `${flat} flache Skizzen wurden nicht exportiert.`);
      const { data, mtl } = await exportFeatures(visible, format, fileSafe(ctx.doc.name));
      const path = await saveFile(
        `${fileSafe(ctx.doc.name)}.${format}`,
        { name: format.toUpperCase(), extensions: [format] },
        data,
      );
      // OBJ colours live in a companion .mtl next to the file.
      if (path && mtl) {
        const mtlPath = path.replace(/[^/\\]+$/, `${fileSafe(ctx.doc.name)}.mtl`);
        await saveFile(baseName(mtlPath), { name: "MTL", extensions: ["mtl"] }, mtl, isTauri ? mtlPath : undefined);
      }
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

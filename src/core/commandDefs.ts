// All built-in commands. Importing this module registers them.

import { useTree } from "../ui/treeNav";
import { startEdgePick, stopEdgePick, useEdgePick } from "../ui/edgePick";
import { DEFAULT_MATERIAL, MATERIALS, isMaterialId, materialOf, type MaterialId } from "./materials";
import { useShortcuts } from "../components/ShortcutOverlay";
import { SHAPE_LABELS, setShapeField, type ShapeField } from "./shapeFields";
import { checkForUpdates, useUpdater } from "./updater";
import * as THREE from "three";
import { defineCommand, execute, getCommand, type CommandContext, type DocumentCommand, type DocumentResult } from "./commands";
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
  groupsOf,
  type FaceName,
  type FaceOp,
  type FaceShape,
  type EdgeFilter,
  type EdgeOp,
  type EdgeRef,
  containersOf,
  expandGroups,
  removeFeatures,
  type GroupFeature,
  hasNoEdges,
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
  type Shell,
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
import { chatUnsaved, setProjectChat, useChat } from "../ai/chatStore";
import { addRecent, clearAutosave, removeRecent } from "./autosave";
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
import { composeTransform, relativeTransform, worldBox, worldTransform } from "./bounds";
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

/** Expands `repeat: {count, step:[x,y,z]}` and `grid: {nx, ny, dx, dy}` into single parts. */
function expandRepeats(specs: Record<string, any>[]) {
  const out: { spec: Record<string, any>; base?: string }[] = [];
  for (const spec of specs) {
    const { repeat, grid, ...one } = spec;
    const cells: Vec3[] = [];
    if (grid) for (let j = 0; j < (grid.ny ?? 1); j++) for (let i = 0; i < (grid.nx ?? 1); i++) cells.push([i * (grid.dx ?? 0), j * (grid.dy ?? 0), 0]);
    else if (repeat) for (let i = 0; i < repeat.count; i++) cells.push((repeat.step as Vec3).map((v) => v * i) as Vec3);
    else {
      out.push({ spec: one });
      continue;
    }
    const start = (one.position ?? [0, 0, 0]) as Vec3;
    cells.forEach((c, i) =>
      out.push({ spec: { ...one, position: start.map((v, k) => round(v + c[k])), ...(one.name ? { name: `${one.name} ${i + 1}` } : {}) }, base: one.name }),
    );
  }
  return out;
}

/** `on: "Platine"`: position counts from the middle of that part's top (z = height above it). */
function placeRelative(doc: ModelDocument, spec: Record<string, any>, made: Map<string, { top: number; x: number; y: number }>) {
  if (!spec.on) return spec;
  const ref = String(spec.on);
  let base = made.get(ref);
  if (!base) {
    const f = doc.features.find((x) => x.id === ref || x.name === ref) ?? findFeature(doc, ref);
    if (!f) throw new Error(`Bezug „${ref}“ nicht gefunden.`);
    const b = worldBox(f, useMeshes.getState().entries);
    base = b ? { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2, top: b.max.z } : { x: f.transform.position[0], y: f.transform.position[1], top: f.transform.position[2] };
  }
  const [x, y, z] = (spec.position ?? [0, 0, 0]) as Vec3;
  return { ...spec, position: [round(base.x + x), round(base.y + y), round(base.top + (z ?? 0))] };
}

/** Finish of one part: look, edges and holes, all in the same step. */
function finishPart(doc: ModelDocument, id: string, spec: Record<string, any>): ModelDocument {
  const extra: Partial<Feature> = {};
  if (spec.color) {
    if (!/^#[0-9a-f]{6}$/i.test(spec.color)) throw new Error("Farbe bitte als #rrggbb angeben.");
    extra.color = String(spec.color).toLowerCase();
  }
  if (spec.material) {
    if (!isMaterialId(spec.material)) throw new Error(`Unbekanntes Material. Möglich: ${MATERIALS.map((m) => m.id).join(", ")}.`);
    if (spec.material !== DEFAULT_MATERIAL) extra.material = spec.material;
  }
  if (spec.fillet) extra.fillet = spec.fillet;
  if (spec.chamfer) extra.chamfer = spec.chamfer;
  if (spec.edges) extra.edgeOps = (spec.edges as Record<string, any>[]).map((e) => ({ kind: e.kind ?? "fillet", size: e.size, filter: e.filter }));
  if (spec.holes) extra.faceOps = (spec.holes as Record<string, any>[]).flatMap((h) => holeOps(h, h.at ?? [[h.u ?? 0, h.v ?? 0]]));
  return Object.keys(extra).length ? updateFeature(doc, id, (f) => ({ ...f, ...extra }) as Feature) : doc;
}

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
    "Erstellt viele Teile in EINEM Schritt, inklusive Aussehen und Bearbeitung. shapes: [{type: 'box'|'cylinder'|'sphere'|…, params: {…mm}, position: [x,y,z], rotation?, name?, on?: 'Name' (position zählt dann ab Mitte der Oberseite dieses Teils), repeat?: {count, step:[x,y,z]}, grid?: {nx, ny, dx, dy}, color?: '#rrggbb', material?: 'matte'|'glossy'|'metal'|'silk'|'clear'|'wood', fillet?, chamfer?, edges?: [{kind:'fillet'|'chamfer', size, filter:'top'|'bottom'|'vertical'|'horizontal'|'x'|'y'}], holes?: [{at:[[u,v],…], diameter, depth?, face?, thread?}]}]. Mit groupName landen sie gleich in einer neuen Gruppe. Gibt die neuen IDs zurück.",
  icon: "shapes",
  params: {
    shapes: { type: "list", description: "Liste der Teile [{type, params, position, rotation?, name?, on?, repeat?, grid?, color?, material?, fillet?, chamfer?, edges?, holes?}]" },
    groupName: { type: "string", optional: true, description: "Name einer neuen Gruppe für alle Formen (z. B. \"ESP32 DevKit\")" },
  },
  apply(doc, p, ctx) {
    const specs = (typeof p.shapes === "string" ? JSON.parse(p.shapes) : p.shapes) as Record<string, any>[];
    if (!Array.isArray(specs) || !specs.length) throw new Error("shapes muss eine Liste sein");
    if (specs.length > 500) throw new Error("Höchstens 500 Formen auf einmal");
    let next = doc;
    const ids: string[] = [];
    // Shapes of this call by name, for `on` references to parts made earlier in the list.
    const made = new Map<string, { id: string; top: number; x: number; y: number }>();
    for (const raw of expandRepeats(specs)) {
      const { spec, base } = raw;
      const placed = placeRelative(next, spec, made);
      const r = addPrimitive(next, placed, ctx);
      next = finishPart(r.doc, r.id, spec);
      ids.push(r.id);
      const f = findFeature(next, r.id)!;
      const pa = (f as { params?: Record<string, number> }).params ?? {};
      const entry = { id: r.id, x: f.transform.position[0], y: f.transform.position[1], top: f.transform.position[2] + (pa.height ?? pa.diameter ?? pa.size ?? 0) };
      made.set(f.name, entry);
      if (base) made.set(base, entry);
    }
    if (p.groupName) {
      const g = makeGroup(next, ids, String(p.groupName));
      return { doc: g.doc, selection: [g.id], label: `${specs.length} Formen als „${g.name}“ erstellen` };
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
    const places: { pos: Vec3; rotZ?: number; mirror?: "x" | "y" }[] = [];
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
      // Mirror plane: given, else flush against the object's side (copy right next to it).
      const k = p.axis === "y" ? 1 : 0;
      const b = worldBox(f, useMeshes.getState().entries);
      const at = p.at ?? (b ? (k === 0 ? b.max.x : b.max.y) : f.transform.position[k]);
      places.push({ pos: k === 1 ? [x0, 2 * at - y0, z0] : [2 * at - x0, y0, z0], mirror: p.axis === "y" ? "y" : "x" });
    }
    if (!places.length) return null;
    if (places.length > 500) throw new Error("Höchstens 500 Kopien auf einmal");
    const copies = places.map(({ pos, rotZ, mirror }) => {
      const c = cloneFeature(f);
      const [rx, ry, rz] = c.transform.rotation;
      // A mirror copy flips the geometry (toggles if the original was already mirrored).
      const m = mirror ? (f.mirror === mirror ? undefined : mirror) : f.mirror;
      // Mirroring across X also negates the rotation about Z (and Y), across Y about Z (and X).
      const rot: Vec3 = mirror === "x" ? [rx, -ry, -rz] : mirror === "y" ? [-rx, ry, -rz] : [rx, ry, round(rz + (rotZ ?? 0))];
      const out = { ...c, name: uniqueName(doc, f.name.replace(/\s\d+$/, "")), transform: { position: pos.map(round) as Vec3, rotation: rot } } as Feature;
      if (m) out.mirror = m;
      else delete out.mirror;
      return out;
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

defineCommand({
  id: "object.stackOn",
  kind: "document",
  label: "Stapeln",
  description: "Setzt ein Objekt mittig oben auf ein anderes (Unterseite auf dessen Oberseite). Standard: das zweite ausgewählte auf das erste.",
  icon: "dropToBed",
  params: {
    id: { type: "id", optional: true, description: "Objekt, das oben aufgesetzt wird (Standard: zweite Auswahl)" },
    targetId: { type: "id", optional: true, description: "Objekt darunter (Standard: erste Auswahl)" },
  },
  isEnabled: (ctx) => ctx.selection.length === 2,
  apply(doc, p, ctx) {
    const top = doc.features.find((f) => f.id === (p.id ?? ctx.selection[1]));
    const base = doc.features.find((f) => f.id === (p.targetId ?? ctx.selection[0]));
    if (!top || !base || top.id === base.id) throw new Error("Bitte zwei Objekte auswählen.");
    const entries = useMeshes.getState().entries;
    const a = worldBox(top, entries), b = worldBox(base, entries);
    if (!a || !b) throw new Error("Objekte werden noch berechnet – bitte gleich noch einmal.");
    const [x, y, z] = top.transform.position;
    const dx = (b.min.x + b.max.x) / 2 - (a.min.x + a.max.x) / 2;
    const dy = (b.min.y + b.max.y) / 2 - (a.min.y + a.max.y) / 2;
    const dz = b.max.z - a.min.z;
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const position = [r2(x + dx), r2(y + dy), r2(z + dz)] as Vec3;
    return { doc: updateFeature(doc, top.id, (f) => ({ ...f, transform: { ...f.transform, position } })), label: `${top.name} auf ${base.name} stapeln` };
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
    const next = ids.reduce((x, id) => updateFeature(x, id, (f) => ({ ...f, transform: { ...f.transform, position: f.transform.position.map((v, i) => round(v + d[i])) as Vec3 } })), doc);
    return { doc: next, label: `${ids.length > 1 ? `${ids.length} Objekte` : findFeature(doc, ids[0])?.name} verschieben` };
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
    if (!f || f.type === "boolean" || f.type === "group" || f.type === "sketch" || f.type === "import") throw new Error("Nur Grundkörper haben Maße (Importe und Gruppen: object.scale)");
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
      if (hasNoEdges(f))
        throw new Error(`${f.name} hat keine Kanten zum ${fillet ? "Abrunden" : "Fasen"}.`);
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

defineCommand({
  id: "object.shell",
  kind: "document",
  label: "Aushöhlen",
  description:
    "Höhlt ein Objekt mit der angegebenen Wandstärke aus (0 macht es wieder massiv). open: \"top\" (Standard) entfernt die Oberseite, z. B. für Boxen, Becher, Gehäuse; \"bottom\" die Unterseite; \"none\" lässt einen geschlossenen Hohlraum (spart Material).",
  icon: "shell",
  params: {
    id: { type: "id", optional: true, description: "Objekt-ID (Standard: Auswahl)" },
    thickness: { type: "number", unit: "mm", min: 0, description: "Wandstärke (0 = massiv)" },
    open: { type: "enum", options: ["top", "bottom", "none"], optional: true, description: "Offene Seite (Standard: bisherige Wahl, sonst oben)" },
  },
  isEnabled: hasOne,
  apply(doc, p, ctx) {
    const f = findFeature(doc, p.id ?? ctx.selection[0]);
    if (!f) throw new Error("Objekt nicht gefunden");
    if (f.type === "sketch") throw new Error("Flache Skizzen lassen sich nicht aushöhlen – zuerst im Inspektor eine Höhe geben.");
    const thickness = Math.max(0, p.thickness);
    const open = (p.open ?? f.shell?.open ?? "top") as Shell["open"];
    const next: Shell | undefined = thickness > 0 ? { thickness, open } : undefined;
    if (JSON.stringify(next) === JSON.stringify(f.shell)) return null;
    const where = { top: "oben offen", bottom: "unten offen", none: "geschlossen" }[open];
    return {
      doc: updateFeature(doc, f.id, (x) => ({ ...x, shell: next })),
      label: next ? `${f.name} aushöhlen (${thickness.toLocaleString("de-DE")} mm, ${where})` : `${f.name}: wieder massiv`,
    };
  },
});

const EDGE_FILTERS: EdgeFilter[] = ["top", "bottom", "vertical", "horizontal", "x", "y"];

function defineEdgeOpCommand(kind: "fillet" | "chamfer") {
  const fillet = kind === "fillet";
  defineCommand({
    id: `edges.${kind}`,
    kind: "document",
    label: fillet ? "Kanten abrunden" : "Kanten fasen",
    description: `${fillet ? "Rundet" : "Fast"} nur bestimmte Kanten: filter = "top" (obere Kanten), "bottom" (untere), "vertical" (senkrechte), "horizontal" (waagerechte), "x"/"y" (parallel zur Achse). Mehrere Aufrufe bauen aufeinander auf. Ohne Filter: im Viewport gewählte Kanten (refs).`,
    icon: fillet ? "fillet" : "chamfer",
    params: {
      id: { type: "id", optional: true, description: "Objekt-ID (Standard: Auswahl)" },
      size: { type: "number", unit: "mm", min: 0.01, description: "Radius bzw. Fasenbreite" },
      filter: { type: "enum", options: EDGE_FILTERS, optional: true, description: "Welche Kanten" },
      refs: { type: "list", optional: true, description: "Gewählte Kanten (aus dem Viewport)" },
    },
    isEnabled: hasOne,
    apply(doc, p, ctx) {
      const f = findFeature(doc, p.id ?? ctx.selection[0]);
      if (!f) throw new Error("Objekt nicht gefunden");
      if (f.type === "sketch") throw new Error("Flache Skizzen haben keine Kanten – zuerst im Inspektor eine Höhe geben.");
      if (hasNoEdges(f)) throw new Error(`${f.name} hat keine Kanten zum ${fillet ? "Abrunden" : "Fasen"}.`);
      if (!p.filter && !p.refs?.length) throw new Error("Bitte Kanten wählen oder einen Filter angeben.");
      const op: EdgeOp = { kind, size: round(p.size), ...(p.filter ? { filter: p.filter as EdgeFilter } : { refs: p.refs as EdgeRef[] }) };
      const count = p.filter ? "" : ` (${(p.refs as EdgeRef[]).length} ${(p.refs as EdgeRef[]).length === 1 ? "Kante" : "Kanten"})`;
      return {
        doc: updateFeature(doc, f.id, (x) => ({ ...x, edgeOps: [...(x.edgeOps ?? []), op] })),
        label: `${f.name}: ${fillet ? "abrunden" : "fasen"} ${op.size.toLocaleString("de-DE")} mm${count}`,
      };
    },
  });
}
defineEdgeOpCommand("fillet");
defineEdgeOpCommand("chamfer");

defineCommand({
  id: "tool.edges",
  kind: "action",
  label: "Kanten wählen",
  description: "Einzelne Kanten des ausgewählten Objekts anklicken (Shift für mehrere), dann Abrunden oder Fasen wirkt nur dort.",
  icon: "fillet",
  shortcut: "shift+e",
  params: {},
  isEnabled: (ctx) => {
    const f = ctx.selection.length === 1 ? findFeature(ctx.doc, ctx.selection[0]) : undefined;
    return !!f && f.type !== "sketch" && !hasNoEdges(f) && useApp.getState().workspace === "model" && parentsOf(ctx.doc, f.id).length === 0;
  },
  perform(_p, ctx) {
    if (useEdgePick.getState().id) stopEdgePick();
    else startEdgePick(ctx.selection[0]);
  },
});

const FACES: FaceName[] = ["top", "bottom", "front", "back", "left", "right"];
const faceParam = { type: "enum", options: FACES, optional: true, description: "Fläche: top, bottom, front (−Y), back (+Y), left (−X), right (+X); Standard top" } as const;
/** ISO metric coarse pitch, for thread core holes (printed threads: core ≈ M − pitch). */
const threadCore = (m: number) => Math.round((m - (m <= 3 ? 0.5 : m <= 4 ? 0.7 : m <= 5 ? 0.8 : m <= 6 ? 1 : m <= 8 ? 1.25 : m <= 10 ? 1.5 : 1.75)) * 100) / 100;

function addFaceOps(doc: ModelDocument, id: string, ops: FaceOp[]) {
  const f = findFeature(doc, id);
  if (!f) throw new Error("Objekt nicht gefunden");
  if (f.type === "sketch" || f.type === "group") throw new Error(`${f.name} ist kein Körper; bitte ein einzelnes Objekt wählen.`);
  return { f, doc: updateFeature(doc, id, (x) => ({ ...x, faceOps: [...(x.faceOps ?? []), ...ops] })) };
}

/** A hole from AI/UI values. */
function holeOps(p: Record<string, any>, at: [number, number][]): FaceOp[] {
  const m = p.thread as number | undefined;
  const d = m ? threadCore(m) : Number(p.diameter);
  if (!(d > 0)) throw new Error("Bitte einen Durchmesser (oder thread für ein Gewinde-Kernloch) angeben.");
  const head = p.headDiameter ? { kind: (p.head ?? "counterbore") as "counterbore" | "countersink", d: p.headDiameter, ...(p.headDepth ? { depth: p.headDepth } : {}) } : undefined;
  return at.map(([u, v]) => ({ op: "cut", face: (p.face ?? "top") as FaceName, u, v, shape: { kind: "circle", d }, ...(p.depth ? { depth: p.depth } : {}), ...(head ? { head } : {}) }));
}

defineCommand({
  id: "object.hole",
  kind: "document",
  label: "Bohrung",
  description:
    "Bohrt ein oder viele Löcher in EINEM Schritt in eine Fläche. at = Liste [[u,v],…] ab Flächenmitte (top/bottom: u=X, v=Y; front/back: u=X, v=Z; left/right: u=Y, v=Z). Ohne depth durchgehend. head + headDiameter: Senkung (counterbore = Zylinderkopf, countersink = Senkkopf). thread: 3 macht ein Kernloch für M3.",
  icon: "screw",
  params: {
    id: { type: "id", optional: true, description: "Objekt-ID (Standard: Auswahl)" },
    face: faceParam,
    at: { type: "list", optional: true, description: "Positionen [[u,v],…] (Standard: Flächenmitte)" },
    diameter: { type: "number", unit: "mm", min: 0.1, optional: true, description: "Durchmesser" },
    depth: { type: "number", unit: "mm", min: 0, optional: true, description: "Tiefe; leer = durchgehend" },
    head: { type: "enum", options: ["counterbore", "countersink"], optional: true, description: "Senkung" },
    headDiameter: { type: "number", unit: "mm", min: 0.1, optional: true, description: "Kopf-Ø" },
    headDepth: { type: "number", unit: "mm", min: 0, optional: true, description: "Kopftiefe" },
    thread: { type: "number", optional: true, description: "Gewindegröße M (Kernloch)" },
  },
  isEnabled: hasOne,
  apply(doc, p, ctx) {
    const at = (p.at as [number, number][] | undefined) ?? [[0, 0]];
    const r = addFaceOps(doc, p.id ?? ctx.selection[0], holeOps(p, at));
    return { doc: r.doc, label: `${r.f.name}: ${at.length === 1 ? "Bohrung" : `${at.length} Bohrungen`}` };
  },
});

defineCommand({
  id: "object.pocket",
  kind: "document",
  label: "Tasche",
  description:
    "Fräst eine Tasche (mode cut) oder setzt eine Erhöhung (mode add) auf eine Fläche: shape rect (width, height, radius), circle (width = Ø) oder slot (width = Länge, height = Breite), Mitte u/v ab Flächenmitte. Für Kabeldurchlässe, USB-Ausschnitte, Schraubdome, Stege, Deckel-Falze. Ohne depth bei cut: durchgehend.",
  icon: "extrude",
  params: {
    id: { type: "id", optional: true, description: "Objekt-ID (Standard: Auswahl)" },
    face: faceParam,
    mode: { type: "enum", options: ["cut", "add"], optional: true, description: "cut = vertiefen (Standard), add = aufsetzen" },
    shape: { type: "enum", options: ["rect", "circle", "slot"], optional: true, description: "Form (Standard rect)" },
    u: { type: "number", unit: "mm", optional: true, description: "Mitte u" },
    v: { type: "number", unit: "mm", optional: true, description: "Mitte v" },
    width: { type: "number", unit: "mm", min: 0.1, description: "Breite entlang u" },
    height: { type: "number", unit: "mm", min: 0.1, optional: true, description: "Breite entlang v" },
    radius: { type: "number", unit: "mm", min: 0, optional: true, description: "Eckradius" },
    depth: { type: "number", unit: "mm", min: 0, optional: true, description: "Tiefe bzw. Höhe" },
  },
  isEnabled: hasOne,
  apply(doc, p, ctx) {
    const mode = (p.mode ?? "cut") as "cut" | "add";
    const kind = p.shape ?? "rect";
    if (mode === "add" && !p.depth) throw new Error("Eine Erhöhung braucht depth (Höhe).");
    const shape: FaceShape = kind === "circle" ? { kind, d: p.width } : kind === "slot" ? { kind, l: p.width, w: p.height ?? p.width / 2 } : { kind: "rect", w: p.width, h: p.height ?? p.width, ...(p.radius ? { r: p.radius } : {}) };
    const op: FaceOp = { op: mode, face: (p.face ?? "top") as FaceName, u: p.u ?? 0, v: p.v ?? 0, shape, ...(p.depth ? { depth: p.depth } : {}) };
    const r = addFaceOps(doc, p.id ?? ctx.selection[0], [op]);
    return { doc: r.doc, label: `${r.f.name}: ${mode === "cut" ? "Tasche" : "Erhöhung"}` };
  },
});

defineCommand({
  id: "object.removeFaceOp",
  kind: "document",
  label: "Bohrung/Tasche entfernen",
  description: "Entfernt eine Bohrung, Tasche oder Erhöhung (index in der Liste).",
  icon: "delete",
  params: { id: { type: "id", optional: true, description: "Objekt-ID (Standard: Auswahl)" }, index: { type: "number", min: 0, description: "Index" } },
  isEnabled: hasOne,
  apply(doc, p, ctx) {
    const f = findFeature(doc, p.id ?? ctx.selection[0]);
    if (!f?.faceOps?.[p.index]) return null;
    const rest = f.faceOps.filter((_, i) => i !== p.index);
    return {
      doc: updateFeature(doc, f.id, (x) => {
        const { faceOps: _old, ...others } = x;
        return (rest.length ? { ...others, faceOps: rest } : others) as Feature;
      }),
      label: `${f.name}: Bohrung/Tasche entfernen`,
    };
  },
});

defineCommand({
  id: "edges.remove",
  kind: "document",
  label: "Kanten-Schritt entfernen",
  description: "Entfernt eine Abrundung/Fase einzelner Kanten (index in der Liste).",
  icon: "delete",
  params: { id: { type: "id", optional: true, description: "Objekt-ID (Standard: Auswahl)" }, index: { type: "number", min: 0, description: "Index" } },
  isEnabled: hasOne,
  apply(doc, p, ctx) {
    const f = findFeature(doc, p.id ?? ctx.selection[0]);
    if (!f?.edgeOps?.[p.index]) return null;
    const rest = f.edgeOps.filter((_, i) => i !== p.index);
    return {
      doc: updateFeature(doc, f.id, (x) => {
        const { edgeOps: _old, ...others } = x;
        return (rest.length ? { ...others, edgeOps: rest } : others) as Feature;
      }),
      label: `${f.name}: Kanten-Schritt entfernen`,
    };
  },
});

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

/** New objects (library, text, sketches, AI) get the colour and material picked last. */
function newColor(): { color?: string; material?: MaterialId } {
  const { lastColor: c, lastMaterial: m } = useSettings.getState();
  return { ...(c ? { color: c } : {}), ...(m && m !== DEFAULT_MATERIAL ? { material: m } : {}) };
}

defineCommand({
  id: "object.setMaterial",
  kind: "document",
  label: "Material",
  description: `Setzt das Aussehen (nur Darstellung, kein Einfluss auf die Form): ${MATERIALS.map((m) => `"${m.id}" = ${m.label} (${m.hint})`).join(", ")}. Wird als Materialname in 3MF exportiert.`,
  icon: "material",
  params: {
    ids: { type: "ids", optional: true, description: "Objekt-IDs (Standard: Auswahl)" },
    material: { type: "enum", options: MATERIALS.map((m) => m.id), description: "Material" },
  },
  isEnabled: (ctx) => ctx.selection.length > 0,
  apply(doc, p, ctx) {
    const picked: string[] = p.ids ?? ctx.selection;
    if (!isMaterialId(p.material)) throw new Error(`Unbekanntes Material. Möglich: ${MATERIALS.map((m) => m.id).join(", ")}.`);
    const ids = [...expandGroups(doc, picked)];
    const m: MaterialId = p.material;
    let changed = 0;
    let next = doc;
    for (const id of ids) {
      const f = findFeature(next, id);
      if (!f || (f.material ?? DEFAULT_MATERIAL) === m) continue;
      changed++;
      next = updateFeature(next, id, (x) => {
        const { material: _old, ...rest } = x;
        return (m === DEFAULT_MATERIAL ? rest : { ...rest, material: m }) as Feature;
      });
    }
    if (!changed) return null;
    const label = materialOf(m).label;
    const first = findFeature(doc, picked[0]);
    return { doc: next, label: picked.length === 1 && first ? `${first.name}: ${label}` : `${picked.length} Objekte: ${label}` };
  },
});

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
    const picked: string[] = p.ids ?? ctx.selection;
    const c = String(p.color ?? "").trim().toLowerCase();
    if (c && !/^#[0-9a-f]{6}$/.test(c)) throw new Error("Farbe bitte als #rrggbb angeben.");
    // A group passes the colour on to all of its members (and keeps it for new ones).
    const ids = [...expandGroups(doc, picked)];
    let changed = 0;
    let next = doc;
    for (const id of ids) {
      const f = findFeature(next, id);
      if (!f || (f.color ?? "") === c) continue;
      changed++;
      next = updateFeature(next, id, (x) => {
        const { color: _old, ...rest } = x;
        return (c ? { ...rest, color: c } : rest) as Feature;
      });
    }
    if (!changed) return null;
    const first = findFeature(doc, picked[0]);
    return { doc: next, label: picked.length === 1 && first ? `${first.name}: Farbe` : `${picked.length} Objekte: Farbe` };
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
    // Top-level objects and group members (operands are removed via operand.remove).
    const gone = ids.map((id) => findFeature(doc, id)).filter((f): f is Feature => !!f && parentsOf(doc, f.id).length === 0);
    if (!gone.length) return null;
    return {
      doc: removeFeatures(doc, gone.map((f) => f.id)),
      selection: [],
      label: `${gone.length > 1 ? `${gone.length} Objekte` : gone[0].name} löschen`,
    };
  },
});

// ── Mehrfachauswahl ─────────────────────────────────────────────────────────

const pickedIds = (p: Record<string, any>, ctx: CommandContext): string[] => p.ids ?? ctx.selection;
const several = (ctx: CommandContext) => ctx.selection.length > 0;

defineCommand({
  id: "objects.transformBy",
  kind: "document",
  label: "Auswahl bewegen",
  description: "Bewegt und dreht mehrere Objekte gemeinsam: position/rotation beschreiben EINE Starrkörper-Bewegung, die alle Objekte zusammen ausführen.",
  icon: "move",
  params: {
    ids: { type: "ids", optional: true, description: "Objekt-IDs (Standard: Auswahl)" },
    position: { type: "vec3", unit: "mm", description: "Verschiebung" },
    rotation: { type: "vec3", unit: "°", optional: true, description: "Drehung" },
  },
  isEnabled: several,
  apply(doc, p, ctx) {
    const ids = pickedIds(p, ctx);
    const motion: Transform = { position: p.position, rotation: p.rotation ?? [0, 0, 0] };
    if ([...motion.position, ...motion.rotation].every((v) => v === 0)) return null;
    // The motion is in world space; members of a group stay expressed in their group.
    const next = ids.reduce((d, id) => {
      const frames = groupsOf(d, id).map((g) => g.transform);
      return updateFeature(d, id, (f) => ({ ...f, transform: relativeTransform(frames, composeTransform(motion, worldTransform(frames, f.transform))) }));
    }, doc);
    return { doc: next, label: ids.length === 1 ? `${findFeature(doc, ids[0])?.name} bewegen` : `${ids.length} Objekte bewegen` };
  },
});

defineCommand({
  id: "objects.scaleBy",
  kind: "document",
  label: "Auswahl skalieren",
  description: "Skaliert mehrere Objekte: mit anchor gemeinsam um diesen Punkt (Abstände wachsen mit), ohne anchor jedes um sich selbst.",
  icon: "scale",
  params: {
    ids: { type: "ids", optional: true, description: "Objekt-IDs (Standard: Auswahl)" },
    factor: { type: "vec3", description: "Faktoren [X, Y, Z]" },
    anchor: { type: "vec3", unit: "mm", optional: true, description: "Gemeinsamer Fixpunkt" },
  },
  isEnabled: several,
  apply(doc, p, ctx) {
    const ids = pickedIds(p, ctx);
    const s = (Array.isArray(p.factor) ? p.factor : [p.factor, p.factor, p.factor]).map(Number) as Vec3;
    if (s.some((v) => !(v > 0.01 && v < 100))) throw new Error("Faktoren müssen zwischen 0,01 und 100 liegen.");
    if (s.every((v) => v === 1)) return null;
    const next = ids.reduce((d, id) => {
      const frames = groupsOf(d, id).map((g) => g.transform);
      const anchor = p.anchor ? relativeTransform(frames, { position: p.anchor, rotation: [0, 0, 0] }).position : undefined;
      return updateFeature(d, id, (f) => scaleFeature(f, s, anchor ?? f.transform.position));
    }, doc);
    return { doc: next, label: `${ids.length} Objekte skalieren (${Math.round(s[0] * 100)} %)` };
  },
});

defineCommand({
  id: "objects.setAxis",
  kind: "document",
  label: "Position/Drehung setzen",
  description: "Setzt für mehrere Objekte eine Achse von Position oder Drehung: value = alle auf diesen Wert, delta = jedes relativ um diesen Wert.",
  icon: "move",
  params: {
    ids: { type: "ids", optional: true, description: "Objekt-IDs (Standard: Auswahl)" },
    kind: { type: "enum", options: ["position", "rotation"], description: "Was geändert wird" },
    axis: { type: "number", min: 0, max: 2, description: "0 = X, 1 = Y, 2 = Z" },
    value: { type: "number", optional: true, description: "Absoluter Wert für alle" },
    delta: { type: "number", optional: true, description: "Relative Änderung je Objekt" },
  },
  isEnabled: several,
  apply(doc, p, ctx) {
    const ids = pickedIds(p, ctx);
    const kind = p.kind as "position" | "rotation";
    const axis = Math.round(p.axis);
    if (p.value === undefined && p.delta === undefined) throw new Error("value oder delta angeben.");
    let changed = 0;
    let next = doc;
    for (const id of ids) {
      const f = findFeature(next, id);
      if (!f) continue;
      const v = round(p.value ?? f.transform[kind][axis] + p.delta);
      if (v === f.transform[kind][axis]) continue;
      changed++;
      const list = [...f.transform[kind]] as Vec3;
      list[axis] = v;
      next = updateFeature(next, id, (x) => ({ ...x, transform: { ...x.transform, [kind]: list } }));
    }
    if (!changed) return null;
    return { doc: next, label: `${changed} Objekte: ${kind === "position" ? "Position" : "Drehung"} ${"XYZ"[axis]}` };
  },
});

defineCommand({
  id: "objects.setParams",
  kind: "document",
  label: "Maße aller ändern",
  description: "Setzt dieselben Maße bei mehreren gleichartigen Grundkörpern (jeder bleibt an seinem Platz).",
  icon: "resize",
  params: {
    ids: { type: "ids", optional: true, description: "Objekt-IDs (Standard: Auswahl)" },
    params: { type: "string", description: "Objekt mit den neuen Maßen in mm, z. B. {\"diameter\": 40}" },
  },
  isEnabled: several,
  apply(doc, p, ctx) {
    const ids = pickedIds(p, ctx);
    const one = getCommand("object.setParams") as DocumentCommand;
    let next = doc;
    let changed = 0;
    for (const id of ids) {
      const r = one.apply(next, { id, params: p.params }, ctx);
      if (r) {
        next = r.doc;
        changed++;
      }
    }
    return changed ? { doc: next, label: `${changed} Objekte: Maße` } : null;
  },
});

// ── Gruppen ─────────────────────────────────────────────────────────────────

/** The list (top level or a group's members) that directly contains `id`. */
function siblingsOf(doc: ModelDocument, id: string): Feature[] | null {
  const chain = containersOf(doc, id);
  const parent = chain[chain.length - 1];
  if (!parent) return doc.features;
  return parent.type === "group" ? parent.children : null; // operands can't be grouped
}

/** Wraps `ids` (siblings in one list) into a new group at the first member's place. */
function makeGroup(doc: ModelDocument, ids: string[], name?: string): { doc: ModelDocument; id: string; name: string } {
  if (!ids.length) throw new Error("Bitte Objekte zum Gruppieren auswählen.");
  const list = siblingsOf(doc, ids[0]);
  if (!list) throw new Error("Teile eines Verbunds lassen sich nicht gruppieren.");
  const members = list.filter((f) => ids.includes(f.id));
  if (members.length !== new Set(ids).size) throw new Error("Nur Objekte auf derselben Ebene lassen sich gruppieren.");
  const groupName = name?.trim() || uniqueName(doc, "Gruppe");
  const group: GroupFeature = { id: newId(), name: groupName, type: "group", visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0] }, children: members };
  const insert = (fs: Feature[]): Feature[] => {
    if (!fs.some((f) => ids.includes(f.id))) return fs.map((f) => (f.type === "group" ? { ...f, children: insert(f.children) } : f));
    const at = fs.findIndex((f) => ids.includes(f.id));
    const rest = fs.filter((f) => !ids.includes(f.id));
    rest.splice(at, 0, group);
    return rest;
  };
  return { doc: { ...doc, features: insert(doc.features) }, id: group.id, name: groupName };
}

defineCommand({
  id: "group.create",
  kind: "document",
  label: "Gruppieren",
  description: "Fasst Objekte (auf derselben Ebene) zu einer benannten Gruppe zusammen, z. B. alle Teile eines Bauteils. Die Gruppe bewegt, dreht und skaliert ihre Mitglieder gemeinsam; keine Boolesche Operation.",
  icon: "folder",
  shortcut: "mod+g",
  params: {
    memberIds: { type: "ids", optional: true, description: "Mitglieder (Standard: Auswahl)" },
    name: { type: "string", optional: true, description: "Name der Gruppe (Standard: Gruppe N)" },
  },
  isEnabled: (ctx) => ctx.selection.length > 1,
  apply(doc, p, ctx) {
    const g = makeGroup(doc, p.memberIds ?? ctx.selection, p.name);
    return { doc: g.doc, selection: [g.id], label: `„${g.name}“ gruppieren` };
  },
});

defineCommand({
  id: "group.ungroup",
  kind: "document",
  label: "Gruppierung aufheben",
  description: "Löst eine Gruppe auf; ihre Mitglieder bleiben genau dort, wo sie sind.",
  icon: "folder",
  shortcut: "shift+mod+g",
  params: { id: { type: "id", optional: true, description: "Gruppen-ID (Standard: Auswahl)" } },
  isEnabled: (ctx) => ctx.selection.length === 1 && findFeature(ctx.doc, ctx.selection[0])?.type === "group",
  apply(doc, p, ctx) {
    const g = findFeature(doc, p.id ?? ctx.selection[0]);
    if (!g || g.type !== "group") throw new Error("Bitte eine Gruppe auswählen.");
    const members = g.children.map((c) => ({ ...c, transform: composeTransform(g.transform, c.transform) }));
    const replace = (fs: Feature[]): Feature[] =>
      fs.flatMap((f) => (f.id === g.id ? members : f.type === "group" ? [{ ...f, children: replace(f.children) }] : [f]));
    return { doc: { ...doc, features: replace(doc.features) }, selection: members.map((m) => m.id), label: `„${g.name}“ auflösen` };
  },
});

defineCommand({
  id: "group.move",
  kind: "document",
  label: "In Gruppe verschieben",
  description: "Verschiebt Objekte in eine Gruppe, aus ihr heraus (groupId leer = oberste Ebene) oder an eine andere Stelle der Liste. Sie bleiben im Raum, wo sie sind.",
  icon: "folder",
  params: {
    ids: { type: "ids", optional: true, description: "Objekt-IDs (Standard: Auswahl)" },
    groupId: { type: "string", optional: true, description: "Ziel-Gruppe (leer = oberste Ebene)" },
    index: { type: "number", min: 0, optional: true, description: "Position in der Ziel-Liste (Standard: ans Ende)" },
  },
  isEnabled: hasSelection,
  apply(doc, p, ctx) {
    const ids: string[] = p.ids ?? ctx.selection;
    const groupId: string | null = p.groupId || null;
    const target = groupId ? findFeature(doc, groupId) : null;
    if (groupId && target?.type !== "group") throw new Error("Das Ziel ist keine Gruppe.");
    const moving = ids.map((id) => findFeature(doc, id)).filter((f): f is Feature => !!f && parentsOf(doc, f.id).length === 0);
    if (!moving.length) throw new Error("Teile eines Verbunds lassen sich nicht verschieben.");
    if (groupId && moving.some((f) => f.id === groupId || groupsOf(doc, groupId).some((g) => g.id === f.id)))
      throw new Error("Eine Gruppe kann nicht in sich selbst liegen.");
    const frames = groupId ? [...groupsOf(doc, groupId), target as GroupFeature].map((g) => g.transform) : [];
    const moved = moving.map((f) => ({ ...f, transform: relativeTransform(frames, worldTransform(groupsOf(doc, f.id).map((g) => g.transform), f.transform)) }));
    // Index counted in the target list as it is now, without the moved rows.
    const before = groupId ? (target as GroupFeature).children : doc.features;
    const index = before.slice(0, p.index ?? before.length).filter((f) => !ids.includes(f.id)).length;
    const strip = (list: Feature[]): Feature[] =>
      list.filter((f) => !ids.includes(f.id)).map((f) => (f.type === "group" ? { ...f, children: strip(f.children) } : f));
    const insert = (list: Feature[]) => [...list.slice(0, index), ...moved, ...list.slice(index)];
    const add = (list: Feature[]): Feature[] => list.map((f) => (f.type !== "group" ? f : { ...f, children: f.id === groupId ? insert(f.children) : add(f.children) }));
    const placed = groupId ? add(strip(doc.features)) : insert(strip(doc.features));
    // Groups emptied by the move disappear.
    const prune = (list: Feature[]): Feature[] => list.map((f) => (f.type === "group" ? { ...f, children: prune(f.children) } : f)).filter((f) => f.type !== "group" || f.children.length > 0);
    return { doc: { ...doc, features: prune(placed) }, label: `${moved.length === 1 ? moved[0].name : `${moved.length} Objekte`} verschieben` };
  },
});

defineCommand({
  id: "tree.rename",
  kind: "action",
  label: "Umbenennen",
  description: "Benennt das ausgewählte Objekt in der Objektliste um.",
  icon: "rename",
  shortcut: "f2",
  params: {},
  isEnabled: (ctx) => ctx.selection.length === 1,
  perform(_p, ctx) {
    const id = ctx.selection[0];
    useTree.setState((s) => ({ renaming: id, open: [...new Set([...s.open, ...containersOf(ctx.doc, id).map((c) => c.id)])] }));
  },
});

defineCommand({
  id: "group.rename",
  kind: "document",
  label: "Gruppe umbenennen",
  description: "Gibt einer Gruppe einen neuen Namen.",
  icon: "rename",
  params: { id: { type: "id", description: "Gruppen-ID" }, name: { type: "string", description: "Neuer Name" } },
  apply(doc, p, ctx) {
    return (getCommand("object.rename") as DocumentCommand).apply(doc, p, ctx);
  },
});

// ── Zwischenablage ──────────────────────────────────────────────────────────

/** Copied objects (deep copies incl. the import data they need) and how often they were pasted. */
let clipboard: { features: Feature[]; assets: NonNullable<ModelDocument["assets"]>; pastes: number } | null = null;

const assetIdsOf = (f: Feature): string[] => (f.type === "import" ? [f.assetId] : f.type === "boolean" ? f.children.flatMap(assetIdsOf) : []);

function copySelection(doc: ModelDocument, ids: string[]) {
  const features = ids.map((id) => doc.features.find((f) => f.id === id)).filter((f): f is Feature => !!f);
  if (!features.length) return 0;
  const assets = Object.fromEntries(features.flatMap(assetIdsOf).map((a) => [a, doc.assets![a]]));
  clipboard = { features: structuredClone(features), assets, pastes: 0 };
  return features.length;
}

defineCommand({
  id: "edit.copy",
  kind: "action",
  label: "Kopieren",
  description: "Kopiert die ausgewählten Objekte in die Zwischenablage.",
  icon: "duplicate",
  shortcut: "mod+c",
  params: {},
  isEnabled: hasSelection,
  perform(_p, ctx) {
    const n = copySelection(ctx.doc, ctx.selection);
    if (n) useApp.getState().toast("info", n === 1 ? "1 Objekt kopiert" : `${n} Objekte kopiert`);
  },
});

defineCommand({
  id: "edit.cut",
  kind: "document",
  label: "Ausschneiden",
  description: "Kopiert die ausgewählten Objekte und entfernt sie.",
  icon: "delete",
  shortcut: "mod+x",
  params: {},
  isEnabled: hasSelection,
  apply(doc, _p, ctx) {
    if (!copySelection(doc, ctx.selection)) return null;
    clipboard!.pastes = -1; // pasting a cut puts it back in place first
    const gone = new Set(ctx.selection);
    return { doc: removeFeatures(doc, [...gone]), selection: [], label: `${gone.size === 1 ? "Objekt" : `${gone.size} Objekte`} ausschneiden` };
  },
});

defineCommand({
  id: "edit.paste",
  kind: "document",
  label: "Einfügen",
  description: "Fügt die kopierten Objekte ein, bei jedem Einfügen um 10 mm weiter versetzt.",
  icon: "duplicate",
  shortcut: "mod+v",
  params: {},
  isEnabled: () => !!clipboard,
  apply(doc) {
    if (!clipboard) return null;
    clipboard.pastes++;
    const off = 10 * clipboard.pastes;
    const copies = clipboard.features.map((f) => {
      const c = cloneFeature(f);
      const [x, y, z] = f.transform.position;
      return { ...c, transform: { ...c.transform, position: [round(x + off), round(y + off), z] as Vec3 } };
    });
    let working: ModelDocument = { ...doc, assets: { ...(doc.assets ?? {}), ...clipboard.assets } };
    for (const c of copies) {
      c.name = uniqueName(working, c.name.replace(/\s\d+$/, ""));
      working = { ...working, features: [...working.features, c] };
    }
    return { doc: working, selection: copies.map((c) => c.id), label: copies.length === 1 ? `${copies[0].name} einfügen` : `${copies.length} Objekte einfügen` };
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
      // A copy stays in the same list: next to its original, also inside a group.
      const parent = groupsOf(working, id).at(-1);
      working = parent
        ? updateFeature(working, parent.id, (g) => ({ ...g, children: [...(g as GroupFeature).children, copy] }) as Feature)
        : { ...working, features: [...working.features, copy] };
      created.push(copy.id);
    }
    if (!created.length) return null;
    return { doc: working, selection: created, label: `${created.length > 1 ? `${created.length} Objekte` : findFeature(doc, ids[0])!.name} duplizieren` };
  },
});

defineCommand({
  id: "view.isolate",
  kind: "action",
  label: "Isolieren",
  description: "Zeigt nur die ausgewählten Objekte (nur die Ansicht, Datei und Export bleiben unverändert). Nochmal: wieder alles zeigen.",
  icon: "isolate",
  shortcut: "shift+h",
  params: {},
  isEnabled: (ctx) => ctx.selection.length > 0 || useApp.getState().isolated !== null,
  perform() {
    const { isolated, selection, nodes, currentId } = useApp.getState();
    if (isolated) return void useApp.setState({ isolated: null });
    // Operands isolate the whole object they belong to.
    const doc = nodes[currentId].doc;
    const top = selection.map((id) => doc.features.find((f) => f.id === id || (f.type === "boolean" && parentsOf(doc, id)[0]?.id === f.id))?.id ?? id);
    useApp.setState({ isolated: [...new Set(top)] });
  },
});

defineCommand({
  id: "view.showAll",
  kind: "action",
  label: "Alle einblenden",
  description: "Beendet die Isolierung und blendet alle ausgeblendeten Objekte wieder ein.",
  icon: "visible",
  shortcut: "alt+h",
  params: {},
  async perform() {
    useApp.setState({ isolated: null });
    const { nodes, currentId } = useApp.getState();
    const hidden = nodes[currentId].doc.features.filter((f) => !f.visible).map((f) => f.id);
    if (hidden.length) await execute("object.setVisibility", { ids: hidden, visible: true });
  },
});

defineCommand({
  id: "object.lock",
  kind: "document",
  label: "Sperren",
  description: "Sperrt Objekte gegen versehentliches Anklicken und Verschieben im Arbeitsbereich (in der Objektliste bleiben sie auswählbar). Ohne locked: umschalten.",
  icon: "lock",
  shortcut: "mod+l",
  params: {
    ids: { type: "ids", optional: true, description: "Objekt-IDs (Standard: Auswahl)" },
    locked: { type: "boolean", optional: true, description: "true = sperren; ohne Angabe umschalten" },
  },
  isEnabled: hasSelection,
  apply(doc, p, ctx) {
    const ids: string[] = p.ids ?? ctx.selection;
    const first = findFeature(doc, ids[0]);
    if (!first) return null;
    const locked: boolean = p.locked ?? !first.locked;
    const next = ids.reduce((d, id) => updateFeature(d, id, (f) => ({ ...f, locked: locked || undefined })), doc);
    return { doc: next, label: `${ids.length > 1 ? `${ids.length} Objekte` : first.name} ${locked ? "sperren" : "entsperren"}` };
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
    let next = doc;
    for (const id of ids) {
      const f = findFeature(next, id);
      if (!f) continue;
      const frames = groupsOf(next, id).map((g) => g.transform);
      const world = worldTransform(frames, f.transform);
      const b = worldBox(f, entries, world);
      if (!b || Math.abs(b.min.z) < 1e-4) continue;
      changed = true;
      const moved: Transform = { ...world, position: [world.position[0], world.position[1], round(world.position[2] - b.min.z)] };
      next = updateFeature(next, id, (x) => ({ ...x, transform: relativeTransform(frames, moved) }));
    }
    if (!changed) return null;
    return { doc: next, label: "Auf Druckbett legen" };
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
        ? {
            id, name, visible, transform, type: "extrude", profile: shapes, height, fillet: f.fillet, chamfer: f.chamfer, shell: f.shell,
            ...(f.corner ? { corner: f.corner } : {}), ...(f.color ? { color: f.color } : {}),
            // A turned body stays turned unless a height is set explicitly (then it is extruded).
            ...(f.type === "extrude" && f.revolve && p.height === undefined ? { revolve: f.revolve } : {}),
          }
        : { id, name, visible, transform, type: "sketch", shapes, ...(f.corner ? { corner: f.corner } : {}), ...(f.color ? { color: f.color } : {}) };
    if (JSON.stringify(next) === JSON.stringify(f)) return null;
    const label =
      p.height !== undefined && (f.type === "sketch") !== (height === 0)
        ? height > 0 ? `${name} ${height.toLocaleString("de-DE")} mm hochziehen` : `${name} flach machen`
        : `${name}: Größe ändern`;
    return { doc: updateFeature(doc, f.id, () => next), label };
  },
});

defineCommand({
  id: "sketch.revolve",
  kind: "document",
  label: "Drehen (Rotationskörper)",
  description:
    "Macht aus einer Skizze einen Drehkörper (Vase, Becher, Knopf, Flasche): das Profil dreht sich einmal um eine senkrechte Achse links davon; die Y-Richtung des Profils wird zur Höhe. offset = Abstand der Achse von der linken Profilkante (0 = massiv, > 0 = Ring/Rohr). Zeichne nur die rechte Hälfte des Querschnitts.",
  icon: "revolve",
  params: {
    id: { type: "id", optional: true, description: "Skizzen-ID (Standard: Auswahl)" },
    offset: { type: "number", unit: "mm", min: 0, optional: true, description: "Abstand der Drehachse zur linken Profilkante (Standard 0)" },
  },
  isEnabled: (ctx) => ctx.selection.length === 1 && ["sketch", "extrude"].includes(findFeature(ctx.doc, ctx.selection[0])?.type ?? ""),
  apply(doc, p, ctx) {
    const f = findFeature(doc, p.id ?? ctx.selection[0]);
    if (!f || (f.type !== "sketch" && f.type !== "extrude")) throw new Error("Bitte eine Skizze auswählen.");
    const shapes = f.type === "sketch" ? f.shapes : f.profile;
    if (!hasClosedProfile(shapes)) throw new Error("Die Skizze enthält keine geschlossene Form. Schließe den Linienzug am Startpunkt.");
    const offset = round(Math.max(0, p.offset ?? (f.type === "extrude" ? f.revolve?.offset : undefined) ?? 0));
    const { id, name, visible, transform } = f;
    const next: Feature = {
      id, name, visible, transform, type: "extrude", profile: shapes, height: f.type === "extrude" ? f.height : 10, revolve: { offset },
      fillet: f.fillet, chamfer: f.chamfer, shell: f.shell, ...(f.corner ? { corner: f.corner } : {}), ...(f.color ? { color: f.color } : {}),
    };
    if (JSON.stringify(next) === JSON.stringify(f)) return null;
    return {
      doc: updateFeature(doc, f.id, () => next),
      label: f.type === "extrude" && f.revolve ? `${name}: Achsabstand ${offset.toLocaleString("de-DE")} mm` : `${name} drehen`,
    };
  },
});

defineCommand({
  id: "sketch.setShape",
  kind: "document",
  label: "Form-Maße ändern",
  description:
    "Ändert die Maße EINER Form in einer Skizze bzw. einem Profil (index = Position in der Formenliste, ab 0). Felder je nach Form: width/depth (Rechteck, Ellipse, Linienzug; Langloch: width = Länge, depth = Breite), diameter (Kreis, Vieleck), radius (Eckradius), sides (Ecken), angle (Ellipse, Langloch), x/y (Mittelpunkt). Größen ändern sich um die Mitte.",
  icon: "measure",
  params: {
    id: { type: "id", optional: true, description: "Skizzen-/Profil-ID (Standard: Auswahl)" },
    index: { type: "number", min: 0, description: "Index der Form" },
    width: { type: "number", unit: "mm", optional: true, description: "Breite (Langloch: Länge)" },
    depth: { type: "number", unit: "mm", optional: true, description: "Tiefe (Langloch: Breite)" },
    diameter: { type: "number", unit: "mm", optional: true, description: "Durchmesser" },
    radius: { type: "number", unit: "mm", optional: true, description: "Eckradius" },
    sides: { type: "number", optional: true, description: "Ecken" },
    angle: { type: "number", unit: "°", optional: true, description: "Drehwinkel" },
    x: { type: "number", unit: "mm", optional: true, description: "Mittelpunkt X" },
    y: { type: "number", unit: "mm", optional: true, description: "Mittelpunkt Y" },
  },
  isEnabled: (ctx) => ctx.selection.length === 1 && ["sketch", "extrude"].includes(findFeature(ctx.doc, ctx.selection[0])?.type ?? ""),
  apply(doc, p, ctx) {
    const f = findFeature(doc, p.id ?? ctx.selection[0]);
    if (!f || (f.type !== "sketch" && f.type !== "extrude")) throw new Error("Bitte eine Skizze oder ein Profil auswählen.");
    const shapes = f.type === "sketch" ? f.shapes : f.profile;
    const i = Math.round(p.index);
    if (!shapes[i]) throw new Error(`Die Skizze hat keine Form Nr. ${i + 1}.`);
    let shape = shapes[i];
    const keys = (["width", "depth", "diameter", "radius", "sides", "angle", "x", "y"] as ShapeField[]).filter((k) => p[k] !== undefined);
    for (const k of keys) shape = setShapeField(shape, k, p[k]);
    if (JSON.stringify(shape) === JSON.stringify(shapes[i])) return null;
    const next = shapes.map((s, j) => (j === i ? shape : s));
    return {
      doc: updateFeature(doc, f.id, (x) => (x.type === "sketch" ? { ...x, shapes: next } : { ...x, profile: next }) as Feature),
      label: `${f.name}: ${SHAPE_LABELS[shape.kind]} ${i + 1} ändern`,
    };
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
  description: "Messwerkzeug: zwei Punkte anklicken (Körper oder Bett) zeigt Abstand und ΔX/ΔY/ΔZ; im Modus Winkel (Tab) drei Punkte für den Winkel am mittleren.",
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

// ── Ansichten ───────────────────────────────────────────────────────────────

/** Bounding box (CAD) of the given features, or of everything visible. */
function framingBox(doc: ModelDocument, ids: string[]): { min: Vec3; max: Vec3 } | null {
  const entries = useMeshes.getState().entries;
  const list = (ids.length ? ids.map((id) => findFeature(doc, id)) : doc.features.filter((f) => f.visible)).filter((f): f is Feature => !!f && isSolid(f));
  const box = new THREE.Box3();
  for (const f of list) {
    const b = worldBox(f, entries);
    if (b) box.union(b);
  }
  return box.isEmpty() ? null : { min: box.min.toArray() as Vec3, max: box.max.toArray() as Vec3 };
}

defineCommand({
  id: "view.fit",
  kind: "action",
  label: "Auswahl zeigen",
  description: "Zoomt auf die Auswahl (ohne Auswahl auf alles).",
  icon: "focus",
  shortcut: "f",
  params: {},
  perform(_p, ctx) {
    const b = framingBox(ctx.doc, ctx.selection) ?? framingBox(ctx.doc, []);
    if (b) useViewRequest.setState({ request: { kind: "fit", ...b, at: Date.now() } });
  },
});

defineCommand({
  id: "view.fitAll",
  kind: "action",
  label: "Alles zeigen",
  description: "Zoomt so, dass alle sichtbaren Objekte zu sehen sind.",
  icon: "focus",
  shortcut: "shift+f",
  params: {},
  perform(_p, ctx) {
    const b = framingBox(ctx.doc, []);
    if (b) useViewRequest.setState({ request: { kind: "fit", ...b, at: Date.now() } });
  },
});

(
  [
    ["front", "Vorne", [0, 1, 0], "1"],
    ["back", "Hinten", [0, -1, 0], "2"],
    ["left", "Links", [1, 0, 0], "3"],
    ["right", "Rechts", [-1, 0, 0], "4"],
    ["top", "Oben", [0, 0, -1], "5"],
    ["bottom", "Unten", [0, 0, 1], "6"],
  ] as const
).forEach(([id, label, dir, key]) =>
  defineCommand({
    id: `view.${id}`,
    kind: "action",
    label: `Ansicht ${label}`,
    description: `Blickt von ${label.toLowerCase()} auf das Modell.`,
    icon: "iso",
    shortcut: `shift+${key}`,
    params: {},
    perform() {
      useViewRequest.setState({ request: { kind: "dir", dir: [...dir], at: Date.now() } });
    },
  }),
);

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
  id: "help.shortcuts",
  kind: "action",
  label: "Tastenkürzel",
  description: "Zeigt alle Tastenkürzel auf einen Blick.",
  icon: "keyboard",
  shortcut: "shift+?",
  params: {},
  perform() {
    useShortcuts.setState({ open: !useShortcuts.getState().open });
  },
});

defineCommand({
  id: "help.open",
  kind: "action",
  label: "Hilfe",
  description: "Öffnet das Hilfe-Center.",
  icon: "help",
  shortcut: "f1",
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

defineCommand({
  id: "app.checkUpdates",
  kind: "action",
  label: "Nach Updates suchen …",
  description: "Prüft auf GitHub, ob eine neuere Cubrix-Version verfügbar ist.",
  icon: "update",
  params: {},
  perform() {
    const { status } = useUpdater.getState();
    if (status === "available" || status === "ready") useUpdater.setState({ visible: true });
    else void checkForUpdates();
  },
});

defineCommand({
  id: "file.openRecent",
  kind: "action",
  label: "Zuletzt geöffnet",
  description: "Öffnet eine zuletzt verwendete Projektdatei.",
  icon: "open",
  params: { path: { type: "string", description: "Dateipfad" } },
  async perform(p) {
    if (!(await confirmDiscard())) return;
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    let text: string;
    try {
      text = await readTextFile(p.path);
    } catch {
      removeRecent(p.path);
      throw new Error(`${baseName(p.path)} wurde nicht gefunden.`);
    }
    loadProjectText(text, p.path, `${baseName(p.path)} geöffnet`);
    addRecent(p.path);
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
  if (s.savedNodeId === s.currentId && !chatUnsaved()) return true;
  const text = "Ungespeicherte Änderungen gehen verloren. Fortfahren?";
  if (isTauri) {
    const { ask } = await import("@tauri-apps/plugin-dialog");
    return ask(text, { title: "Cubrix", kind: "warning", okLabel: "Verwerfen", cancelLabel: "Abbrechen" });
  }
  return window.confirm(text);
}

const fileSafe = (name: string) => name.replace(/[\\/:*?"<>|]/g, "_");

/** The whole project as file text: document + history (branches, AI groups) + chat + camera + selection; no layout, no keys. */
export function currentProjectText(): string {
  const s = useApp.getState();
  const chat = useChat.getState();
  return serializeProject({
    document: s.nodes[s.currentId].doc,
    history: { rootId: s.rootId, currentId: s.currentId, nodes: s.nodes },
    chat: { entries: chat.entries.map(({ error: _e, prompt: _p, ...e }) => e), api: chat.api },
    camera: cameraState.get?.(),
    selection: s.selection,
  });
}

/** Loads project file text (any version); `path` = where it lives (null for recovered work). */
export function loadProjectText(text: string, path: string | null, label: string) {
  const { file: project, migratedFrom } = parseProject(text);
  const app = useApp.getState();
  app.reset(project.document, label, path);
  if (project.history) {
    const h = project.history;
    useApp.setState({ nodes: h.nodes, rootId: h.rootId, currentId: h.currentId, savedNodeId: path ? h.currentId : null });
  } else if (!path) useApp.setState({ savedNodeId: null });
  useApp.setState({ selection: project.selection.filter((id) => !!findFeature(project.document, id)) });
  setProjectChat(project.chat.entries, project.chat.api);
  if (project.camera) setTimeout(() => cameraState.set?.(project.camera!), 50);
  if (migratedFrom < 2) app.toast("info", "Ältere Projektdatei geöffnet – beim Speichern wird sie ins neue Format übernommen.");
}

async function saveProject(forceDialog: boolean) {
  const s = useApp.getState();
  const doc = s.nodes[s.currentId].doc;
  const text = currentProjectText();
  const path = await saveFile(`${fileSafe(doc.name)}.cubrix`, PROJECT_FILTER, text, forceDialog ? null : s.filePath);
  if (!path) return;
  useApp.setState({ savedNodeId: s.currentId, filePath: isTauri ? path : null });
  useChat.setState((c) => ({ savedEntries: c.entries.length }));
  if (isTauri) addRecent(path);
  void clearAutosave();
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
    loadProjectText(file.text, isTauri ? file.path : null, `${baseName(file.path)} geöffnet`);
    if (isTauri) addRecent(file.path);
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

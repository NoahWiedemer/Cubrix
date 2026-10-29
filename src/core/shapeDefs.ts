// Extra library shapes: one definition each (label, icon, library category,
// parameters with defaults and German labels). The kernel builders live in cad/shapes.ts.
import type { IconName } from "../ui/icons";

export type ExtraType =
  | "capsule" | "ellipsoid" | "star" | "roundedbox" | "gear" | "countersink" | "hook" | "pin" | "clip"
  | "heart" | "arrow" | "knob" | "handle" | "vase" | "bowl" | "honeycomb" | "slotted" | "thread" | "threadhole";

export interface ShapeDef {
  label: string;
  icon: IconName;
  category: "basic" | "functional" | "deco" | "plates";
  hint: string;
  /** Scales around the bottom centre (round bodies). */
  round?: boolean;
  params: Record<string, number>;
  /** Inspektor labels per parameter (order = field order). */
  labels: Record<string, string>;
  /** Params that are counts (never scaled). */
  counts?: string[];
}

export const SHAPE_DEFAULTS: Record<ExtraType, ShapeDef> = {
  capsule: { label: "Kapsel", icon: "capsule", category: "basic", hint: "Pille, abgerundeter Stab", round: true, params: { diameter: 14, height: 30 }, labels: { diameter: "Ø", height: "Höhe" } },
  ellipsoid: { label: "Ellipsoid", icon: "egg", category: "basic", hint: "Ei, gestreckte Kugel", round: true, params: { diameter: 24, height: 32 }, labels: { diameter: "Ø", height: "Höhe" } },
  star: { label: "Stern", icon: "star", category: "basic", hint: "Sternprisma", params: { diameter: 30, inner: 14, points: 5, height: 5 }, labels: { diameter: "Außen-Ø", inner: "Innen-Ø", points: "Zacken", height: "Höhe" }, counts: ["points"] },
  roundedbox: { label: "Runder Quader", icon: "box", category: "basic", hint: "Quader mit runden Kanten", params: { width: 30, depth: 20, height: 15, radius: 3 }, labels: { width: "Breite", depth: "Tiefe", height: "Höhe", radius: "Radius" } },
  gear: { label: "Zahnrad", icon: "gear", category: "functional", hint: "Stirnrad, Modul und Zähne", round: true, params: { module: 1.5, teeth: 18, height: 6, bore: 5 }, labels: { module: "Modul", teeth: "Zähne", height: "Höhe", bore: "Bohrung" }, counts: ["teeth"] },
  countersink: { label: "Senkloch", icon: "screw", category: "functional", hint: "Schraubloch mit Senkung (zum Abziehen)", round: true, params: { diameter: 3.4, length: 12, headDiameter: 6.5 }, labels: { diameter: "Loch-Ø", length: "Länge", headDiameter: "Kopf-Ø" } },
  hook: { label: "Haken", icon: "hook", category: "functional", hint: "Wandhaken", params: { width: 16, height: 40, thickness: 4, depth: 10 }, labels: { width: "Breite", height: "Höhe", thickness: "Stärke", depth: "Tiefe" } },
  pin: { label: "Stift", icon: "pin", category: "functional", hint: "Scharnierstift mit Kopf", round: true, params: { diameter: 3, length: 20, headDiameter: 6, headHeight: 2 }, labels: { diameter: "Ø", length: "Länge", headDiameter: "Kopf-Ø", headHeight: "Kopfhöhe" } },
  clip: { label: "Klemme", icon: "clip", category: "functional", hint: "Schnappclip (U-Profil)", params: { width: 16, height: 14, thickness: 2, depth: 10 }, labels: { width: "Breite", height: "Höhe", thickness: "Stärke", depth: "Tiefe" } },
  heart: { label: "Herz", icon: "heart", category: "deco", hint: "Herzform", params: { size: 30, height: 5 }, labels: { size: "Größe", height: "Höhe" } },
  arrow: { label: "Pfeil", icon: "arrow", category: "deco", hint: "Richtungspfeil", params: { length: 40, width: 20, height: 4 }, labels: { length: "Länge", width: "Breite", height: "Höhe" } },
  knob: { label: "Drehknopf", icon: "knob", category: "deco", hint: "Knopf mit Griffrillen", round: true, params: { diameter: 24, height: 16 }, labels: { diameter: "Ø", height: "Höhe" } },
  handle: { label: "Griff", icon: "handle", category: "deco", hint: "Bügelgriff", params: { length: 80, height: 28, thickness: 6, depth: 12 }, labels: { length: "Länge", height: "Höhe", thickness: "Stärke", depth: "Tiefe" } },
  vase: { label: "Vase", icon: "vase", category: "deco", hint: "Gedreht, mit Wand", round: true, params: { diameter: 50, height: 90, wall: 1.6 }, labels: { diameter: "Ø", height: "Höhe", wall: "Wand" } },
  bowl: { label: "Schale", icon: "bowl", category: "deco", hint: "Gedreht, mit Wand", round: true, params: { diameter: 80, height: 35, wall: 1.6 }, labels: { diameter: "Ø", height: "Höhe", wall: "Wand" } },
  honeycomb: { label: "Wabenplatte", icon: "hexagon", category: "plates", hint: "Platte mit Sechseck-Löchern", params: { width: 80, depth: 60, height: 3, cell: 8, wall: 1.6 }, labels: { width: "Breite", depth: "Tiefe", height: "Dicke", cell: "Wabe", wall: "Steg" } },
  thread: { label: "Gewinde", icon: "screw", category: "functional", hint: "Gewindestange mit echter Helix (M8 = 8 mm, Steigung 1,25)", round: true, params: { diameter: 8, pitch: 1.25, length: 20 }, labels: { diameter: "Ø", pitch: "Steigung", length: "Länge" }, counts: ["pitch"] },
  threadhole: { label: "Gewindeloch", icon: "nut", category: "functional", hint: "Innengewinde mit 0,3 mm Spiel, zum Abziehen", round: true, params: { diameter: 8, pitch: 1.25, length: 10 }, labels: { diameter: "Ø", pitch: "Steigung", length: "Länge" }, counts: ["pitch"] },
  slotted: { label: "Langlochplatte", icon: "slots", category: "plates", hint: "Platte mit Langlöchern", params: { width: 80, depth: 40, height: 3, slots: 5, slotWidth: 4 }, labels: { width: "Breite", depth: "Tiefe", height: "Dicke", slots: "Löcher", slotWidth: "Lochbreite" }, counts: ["slots"] },
};

export const EXTRA_TYPES = Object.keys(SHAPE_DEFAULTS) as ExtraType[];
export const isExtraType = (t: string): t is ExtraType => t in SHAPE_DEFAULTS;

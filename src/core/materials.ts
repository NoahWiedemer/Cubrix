// Display materials ("Aussehen"): how a body looks in the viewport and in Vorschau.
// Pure data so the document, commands, 3MF export and tests can share it; the viewport
// turns a preset into MeshPhysicalMaterial settings.

export type MaterialId = "matte" | "glossy" | "metal" | "silk" | "clear" | "wood";

export interface MaterialPreset {
  id: MaterialId;
  label: string;
  hint: string;
  roughness: number;
  metalness: number;
  /** Strength of the studio reflections on this material. */
  env: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  /** Soft satin glow along the silhouette (silk PLA). */
  sheen?: number;
  /** < 1: see-through (rendered with plain opacity, no transmission pass). */
  opacity?: number;
  /** Keeps the fine matte grain (only where a real print would show it). */
  grain: boolean;
  /** Wood fill: colour is mixed towards a warm brown and gets soft growth rings. */
  wood?: boolean;
}

export const MATERIALS: MaterialPreset[] = [
  { id: "matte", label: "Matt", hint: "Normales PLA", roughness: 0.6, metalness: 0, env: 0.18, grain: true },
  { id: "glossy", label: "Glänzend", hint: "Glattes PETG", roughness: 0.22, metalness: 0, env: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.18, grain: false },
  { id: "metal", label: "Metall", hint: "Metallic-Filament", roughness: 0.42, metalness: 0.85, env: 1.0, grain: false },
  { id: "silk", label: "Seide", hint: "Silk-PLA mit Satinglanz", roughness: 0.38, metalness: 0.15, env: 0.7, clearcoat: 0.6, clearcoatRoughness: 0.3, sheen: 0.7, grain: true },
  { id: "clear", label: "Transparent", hint: "Klares PETG oder Harz", roughness: 0.12, metalness: 0, env: 0.6, clearcoat: 0.4, clearcoatRoughness: 0.1, opacity: 0.58, grain: false },
  { id: "wood", label: "Holz", hint: "Holz-PLA, matt mit Maserung", roughness: 0.78, metalness: 0, env: 0.12, grain: true, wood: true },
];

export const DEFAULT_MATERIAL: MaterialId = "matte";

export const materialOf = (id?: string): MaterialPreset => MATERIALS.find((m) => m.id === id) ?? MATERIALS[0];

export const isMaterialId = (v: unknown): v is MaterialId => MATERIALS.some((m) => m.id === v);

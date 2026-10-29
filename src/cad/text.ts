// 3D text: font outlines (opentype via replicad) → closed profiles with holes
// (O, A, B, Ä …) → extruded solid. Fonts are bundled (OFL / Apache 2.0).
import { loadFont, textBlueprints, type Shape3D } from "replicad";
import { FONTS, fontKey, type FontId } from "./fontKeys";

export { FONTS, fontKey, isBundledFont, type FontId } from "./fontKeys";

export type TextAlign = "left" | "center" | "right";

const family = fontKey;

/** Cap height as a share of the em size, per loaded family (to size text by capital height). */
const capRatio: Record<string, number> = {};

/** Registers one font's bytes; throws if opentype.js cannot read it (e.g. CFF2). */
export async function registerFont(name: string, data: ArrayBuffer) {
  const f = await loadFont(data, name, true);
  if (!f.glyphs || f.glyphs.length < 2) throw new Error("Schrift enthält keine lesbaren Zeichen.");
  const os2 = (f.tables as { os2?: { sCapHeight?: number } }).os2;
  capRatio[name] = os2?.sCapHeight ? os2.sCapHeight / f.unitsPerEm : 0.7;
}

export const hasFont = (name: string) => name in capRatio;

/** Registers all bundled fonts; `load` returns the file bytes for e.g. "inter-700". */
export async function loadFonts(load: (name: string) => Promise<ArrayBuffer>) {
  await Promise.all(
    (Object.keys(FONTS) as FontId[]).flatMap((font) =>
      [false, true].map(async (bold) => {
        const name = family(font, bold);
        const f = await loadFont(await load(name), name);
        const os2 = (f.tables as { os2?: { sCapHeight?: number } }).os2;
        capRatio[name] = os2?.sCapHeight ? os2.sCapHeight / f.unitsPerEm : 0.7;
      }),
    ),
  );
}

export interface TextParams {
  text: string;
  /** Height of capital letters in mm. */
  size: number;
  /** Extrusion depth in mm. */
  depth: number;
  /** Bundled font id or installed family name. */
  font: string;
  bold: boolean;
  align: TextAlign;
}

/**
 * Text solid standing on z = 0. The text's baseline box is centred on the origin in Y
 * and anchored in X by `align` (left edge / centre / right edge at x = 0).
 */
export function buildText(p: TextParams): Shape3D {
  const text = p.text.trim();
  if (!text) throw new Error("Der Text ist leer.");
  if (!(p.size > 0) || !(p.depth > 0)) throw new Error("Höhe und Tiefe müssen größer als 0 sein.");
  const name = family(p.font, p.bold);
  if (!(name in capRatio)) throw new Error("Schriftart nicht geladen.");
  const bp = textBlueprints(text, { fontSize: p.size / capRatio[name], fontFamily: name });
  const bb = bp.boundingBox;
  const [minX, minY] = bb.bounds[0];
  const [maxX, maxY] = bb.bounds[1];
  const dx = p.align === "left" ? -minX : p.align === "right" ? -maxX : -(minX + maxX) / 2;
  const placed = bp.translate(dx, -(minY + maxY) / 2);
  return placed.sketchOnPlane("XY").extrude(p.depth) as Shape3D;
}

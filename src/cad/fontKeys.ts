// Font naming shared by the main thread and the CAD worker (no replicad import here).
export type FontId = "inter" | "roboto-slab" | "roboto-mono";

export const FONTS: Record<FontId, { label: string }> = {
  inter: { label: "Inter" },
  "roboto-slab": { label: "Roboto Slab" },
  "roboto-mono": { label: "Roboto Mono" },
};

/** Bundled fonts; any other font name is an installed system family. */
export const isBundledFont = (font: string): font is FontId => font in FONTS;

/** Registry name of a font + weight (bundled "inter-700", system "sys:Futura:700"). */
export const fontKey = (font: string, bold: boolean) =>
  isBundledFont(font) ? `${font}-${bold ? 700 : 400}` : `sys:${font}:${bold ? 700 : 400}`;

/** Display name for a stored font value. */
export const fontLabel = (font: string) => (isBundledFont(font) ? FONTS[font].label : font);

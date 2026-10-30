// Model output is cleaned before it is shown or saved: OpenAI's citation markers are private
// use characters (U+E200…) around "cite turn0search1", which no font has; the real sources
// arrive separately as annotations. Unusual hyphens and spaces would fall back to another font.
const MARKER = /\uE200[^\uE201]*(?:\uE201|$)/g;
const LEFTOVER = /[\uE000-\uF8FF]/g;
const RAW_CITE = /\bcite\s*(?:turn\d+[a-z]+\d+\s*)+/gi;
const TURN_REF = /\bturn\d+(?:search|fetch|news|view)\d+\b/g;

export function cleanModelText(text: string): string {
  const marked = /[\uE000-\uF8FF]/.test(text);
  let out = text.replace(MARKER, "").replace(LEFTOVER, "");
  // Without its brackets a marker is left as plain text; only then touch such words.
  if (marked) out = out.replace(RAW_CITE, "").replace(TURN_REF, "");
  // A removed marker leaves its space behind: "Maß .", not "Maß."
  if (marked) out = out.replace(/[ \t]+([.,;:!?])/g, "$1").replace(/[ \t]{2,}/g, " ");
  return out.replace(/[\u2010\u2011]/g, "-").replace(/[\u202F\u2007\u2009\u200A]/g, " ");
}

import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import opencascade from "replicad-opencascadejs";
import { measureVolume, setOC } from "replicad";
import { buildText, loadFonts, type TextParams } from "../src/cad/text";
import { fontFile } from "../src/cad/fontFiles";

beforeAll(async () => {
  setOC((await (opencascade as unknown as () => Promise<unknown>)()) as Parameters<typeof setOC>[0]);
  await loadFonts(async (name) => {
    const b = readFileSync(`node_modules/@fontsource/${fontFile(name)}`);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  });
}, 60_000);

const P = (text: string, extra: Partial<TextParams> = {}): TextParams => ({ text, size: 10, depth: 2, font: "inter", bold: true, align: "center", ...extra });

describe("3D-Text", () => {
  it("baut Buchstaben mit Löchern (O hat ein Loch)", () => {
    const o = buildText(P("O"));
    const box = o.boundingBox;
    // Cap height ≈ 10 mm, depth 2 mm, centred.
    expect(box.depth).toBeCloseTo(2, 3);
    expect(box.height).toBeGreaterThan(9.5);
    expect(box.height).toBeLessThan(11);
    // A ring is clearly less than its filled outline: the counter is a hole.
    const filled = box.width * box.height * 2;
    expect(measureVolume(o)).toBeLessThan(filled * 0.6);
    expect(o.faces.length).toBeGreaterThan(4);
  });

  it("baut Umlaute und ß", () => {
    const s = buildText(P("ÄÖÜß"));
    expect(measureVolume(s)).toBeGreaterThan(50);
    // Ä/Ö/Ü dots reach above the cap height.
    expect(s.boundingBox.height).toBeGreaterThan(11);
  });

  it("richtet links/rechts aus", () => {
    const l = buildText(P("AB", { align: "left" })).boundingBox;
    const r = buildText(P("AB", { align: "right" })).boundingBox;
    expect(l.bounds[0][0]).toBeCloseTo(0, 3);
    expect(r.bounds[1][0]).toBeCloseTo(0, 3);
  });

  it("lehnt leeren Text ab", () => {
    expect(() => buildText(P("  "))).toThrow();
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import opencascade from "replicad-opencascadejs";
import { measureVolume, setOC } from "replicad";
import { buildText, registerFont } from "../src/cad/text";

// A face split out of a .ttc by the Rust side (see src-tauri/src/fonts.rs tests).
const DUMP = process.env.FONT_DUMP_FILE ?? "";

describe.skipIf(!DUMP || !existsSync(DUMP))("System-Schrift aus TTC", () => {
  beforeAll(async () => {
    setOC((await (opencascade as unknown as () => Promise<unknown>)()) as Parameters<typeof setOC>[0]);
    const b = readFileSync(DUMP);
    await registerFont("sys:Test:700", b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  }, 60_000);

  it("baut Text mit einer extrahierten Systemschrift", () => {
    const s = buildText({ text: "AB", size: 10, depth: 2, font: "Test", bold: true, align: "center" });
    expect(measureVolume(s)).toBeGreaterThan(50);
  });
});

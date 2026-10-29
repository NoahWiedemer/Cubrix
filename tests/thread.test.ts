import { beforeAll, describe, expect, it } from "vitest";
import opencascade from "replicad-opencascadejs";
import { measureVolume, setOC } from "replicad";
import { buildLocal } from "../src/cad/build";
import type { Feature } from "../src/core/document";

beforeAll(async () => {
  setOC((await (opencascade as unknown as () => Promise<unknown>)()) as Parameters<typeof setOC>[0]);
}, 60_000);

const at = (position: [number, number, number]) => ({ position, rotation: [0, 0, 0] }) as Feature["transform"];
const thread = (extra: Partial<Feature> = {}) =>
  ({ id: "t", name: "Gewinde", type: "thread", visible: true, transform: at([0, 0, 0]), params: { diameter: 8, pitch: 1.25, length: 20 }, ...extra }) as Feature;
const vol = (s: ReturnType<typeof buildLocal>) => ("solids" in s ? (s as unknown as { solids: Parameters<typeof measureVolume>[0][] }).solids : [s]).reduce((a, x) => a + measureVolume(x), 0);

describe("Gewinde mit echter Helix", () => {
  it("baut Kern und Gewindegang innerhalb von Ø und Länge", () => {
    const s = buildLocal(thread());
    const [[x0, y0, z0], [x1, y1, z1]] = s.boundingBox.bounds;
    expect([x0, y0, z0, x1, y1, z1].map((v) => Math.round(v * 10) / 10 || 0)).toEqual([-4, -4, 0, 4, 4, 20]);
    // Core (r = 4 − 0,6134·1,25) plus a ridge of roughly 16 turns.
    const core = Math.PI * (4 - 0.6134 * 1.25) ** 2 * 20;
    expect(vol(s)).toBeGreaterThan(core + 120);
    expect(vol(s)).toBeLessThan(core + 260);
  });
  it("erklärt unmögliche Maße", () => {
    expect(() => buildLocal(thread({ params: { diameter: 8, pitch: 1.25, length: 1 } } as Partial<Feature>))).toThrow(/mindestens/);
    expect(() => buildLocal(thread({ params: { diameter: 2, pitch: 3, length: 20 } } as Partial<Feature>))).toThrow(/Steigung/);
  });
  it("schneidet ein Innengewinde in eine Mutter", () => {
    const nut = {
      id: "n", name: "Mutter", type: "boolean", op: "subtract", visible: true, transform: at([0, 0, 0]),
      children: [
        { id: "c", name: "Zylinder", type: "cylinder", visible: true, transform: at([0, 0, 0]), params: { diameter: 16, height: 6 } },
        { id: "h", name: "Gewindeloch", type: "threadhole", visible: true, transform: at([0, 0, 0]), params: { diameter: 8, pitch: 1.25, length: 6 } },
      ],
    } as unknown as Feature;
    const v = vol(buildLocal(nut));
    const full = Math.PI * 64 * 6;
    const minorHole = Math.PI * (4.3 - 0.6134 * 1.25) ** 2 * 6;
    expect(v).toBeLessThan(full - minorHole);
    expect(v).toBeGreaterThan(full - Math.PI * 4.3 ** 2 * 6);
  });
});

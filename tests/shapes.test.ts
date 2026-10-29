import { beforeAll, describe, expect, it } from "vitest";
import opencascade from "replicad-opencascadejs";
import { measureVolume, setOC } from "replicad";
import { EXTRA_BUILDERS } from "../src/cad/shapes";
import { SHAPE_DEFAULTS } from "../src/core/shapeDefs";

beforeAll(async () => {
  setOC((await (opencascade as unknown as () => Promise<unknown>)()) as Parameters<typeof setOC>[0]);
}, 60_000);

describe("Bibliotheksformen", () => {
  for (const [type, def] of Object.entries(SHAPE_DEFAULTS))
    it(`${type} baut einen Körper auf dem Bett`, () => {
      const s = EXTRA_BUILDERS[type](def.params);
      expect(measureVolume(s)).toBeGreaterThan(1);
      // The thread hole is a cutting tool: it pokes 0.5 mm out below for a clean cut.
      expect(s.boundingBox.bounds[0][2]).toBeCloseTo(type === "threadhole" ? -0.5 : 0, 1);
    });
});

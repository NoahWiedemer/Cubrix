import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : /\.tsx$/.test(p) ? [p] : [];
});

describe("Dropdowns", () => {
  it("nutzen überall die App-Komponente statt <select>", () => {
    const found = files("src").filter((f) => /<(select|option)[\s>]/.test(readFileSync(f, "utf8")));
    expect(found).toEqual([]);
  });
});

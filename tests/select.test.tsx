import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Select } from "../src/ui/Select";
import { matchTypeahead, moveActive } from "../src/ui/selectKeys";

const options = [{ value: "a", label: "Anthropic" }, { value: "b", label: "Bohrung", disabled: true }, { value: "c", label: "Claude" }, { value: "d", label: "Clip" }];

describe("Select", () => {
  it("überspringt deaktivierte Einträge und bleibt an den Enden stehen", () => {
    expect(moveActive(options, 0, 1)).toBe(2);
    expect(moveActive(options, 2, -1)).toBe(0);
    expect(moveActive(options, 3, 1)).toBe(3);
    expect(moveActive(options, -1, 1)).toBe(0);
    expect(moveActive(options, 4, -1)).toBe(3);
  });

  it("springt beim Tippen", () => {
    expect(matchTypeahead(options, "c", 0)).toBe(2);
    expect(matchTypeahead(options, "cl", 2)).toBe(2);
    expect(matchTypeahead(options, "cli", 2)).toBe(3);
    expect(matchTypeahead(options, "cc", 2)).toBe(3);
    expect(matchTypeahead(options, "c", 3)).toBe(2);
    expect(matchTypeahead(options, "b", 0)).toBe(-1);
    expect(matchTypeahead(options, "x", 0)).toBe(-1);
  });

  it("ist für Screenreader eine Combobox mit Beschriftung und zeigt den Wert", () => {
    const html = renderToString(<Select label="Art" value="c" onChange={() => {}} groups={[{ options }]} />);
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-label="Art"');
    expect(html).toContain("Claude");
  });
});

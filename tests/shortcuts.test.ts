import { describe, expect, it } from "vitest";
import { listCommands } from "../src/core/commands";
import "../src/core/commandDefs";
import { shortcutGroups } from "../src/components/ShortcutOverlay";

describe("Tastenkürzel-Übersicht", () => {
  it("zeigt jedes Kürzel genau einmal", () => {
    const all = listCommands().filter((c) => c.shortcut && c.id !== "history.redoAlt");
    const shown = shortcutGroups(listCommands()).flatMap((g) => g.items.map((c) => c.id));
    expect(shown.sort()).toEqual(all.map((c) => c.id).sort());
    expect(new Set(shown).size).toBe(shown.length);
  });
  it("hat die neuen Kürzel", () => {
    const keys = Object.fromEntries(listCommands().filter((c) => c.shortcut).map((c) => [c.id, c.shortcut]));
    expect(keys["help.shortcuts"]).toBe("shift+?");
    expect(keys["view.isolate"]).toBe("shift+h");
    expect(keys["view.showAll"]).toBe("alt+h");
    expect(keys["object.lock"]).toBe("mod+l");
  });
});

import { describe, expect, it } from "vitest";
import { DEFAULT_PANELS, column, movePanel, normalize } from "../src/ui/layoutModel";

const base = () => structuredClone(DEFAULT_PANELS);

describe("Dock-Layout", () => {
  it("verschiebt ein Panel von links nach rechts", () => {
    const p = movePanel(base(), "history", "right", 99);
    expect(column(p, "left")).toEqual(["tree"]);
    expect(column(p, "right")).toEqual(["props", "chat", "history"]);
    expect(p.history.open).toBe(true);
  });
  it("verschiebt ein Panel von rechts nach links", () => {
    const p = movePanel(base(), "props", "left", 0);
    expect(column(p, "left")).toEqual(["props", "tree", "history"]);
    expect(column(p, "right")).toEqual(["chat"]);
  });
  it("verschiebt beide linken Panels nach rechts", () => {
    let p = movePanel(base(), "tree", "right", 99);
    p = movePanel(p, "history", "right", 99);
    expect(column(p, "left")).toEqual([]);
    expect(column(p, "right")).toEqual(["props", "chat", "tree", "history"]);
  });
  it("bleibt beim Hin- und Herschieben konsistent", () => {
    let p = base();
    for (let i = 0; i < 10; i++) p = movePanel(p, "history", i % 2 ? "left" : "right", 99);
    expect(column(p, "left")).toEqual(["tree", "history"]);
    for (const side of ["left", "right"] as const) expect(column(p, side).map((id) => p[id].order)).toEqual(column(p, side).map((_, i) => i));
  });
  it("behält den eingeklappten Zustand beim Verschieben", () => {
    let p = base();
    p.history.collapsed = true;
    p = movePanel(p, "history", "right", 0);
    expect(p.history).toMatchObject({ side: "right", order: 0, collapsed: true });
  });
  it("repariert gespeicherte Layouts beim Neustart", () => {
    const stored = { panels: { tree: { side: "right", order: 3 }, history: { side: "middle", weight: -1 } }, width: { left: 0, right: "x" } };
    const { panels, width } = normalize(stored);
    expect(column(panels, "right")).toEqual(["props", "chat", "tree"]);
    expect(panels.history).toMatchObject({ side: "left", weight: 1 });
    expect(width).toEqual({ left: 200, right: 340 });
  });
});

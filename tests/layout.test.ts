import { describe, expect, it } from "vitest";
import { column, defaultLayout, dropPanel, movePanel, normalize, resizeColumn, setMode, setOpen } from "../src/ui/layoutModel";

describe("Dock-Layout", () => {
  it("Standard: links Objekte/Verlauf/KI als Tabs, rechts Inspektor", () => {
    const l = defaultLayout();
    expect(column(l.panels, "left")).toEqual(["tree", "history", "chat"]);
    expect(column(l.panels, "right")).toEqual(["inspector"]);
    expect(l.mode).toEqual({ left: "tabs", right: "tabs" });
  });
  it("verschiebt per Ablegen auf die andere Seite und aktiviert den Tab", () => {
    const l = dropPanel(defaultLayout(), "history", "right", 99);
    expect(column(l.panels, "left")).toEqual(["tree", "chat"]);
    expect(column(l.panels, "right")).toEqual(["inspector", "history"]);
    expect(l.active.right).toBe("history");
  });
  it("sortiert Tabs innerhalb einer Seite um", () => {
    const l = dropPanel(defaultLayout(), "chat", "left", 0);
    expect(column(l.panels, "left")).toEqual(["chat", "tree", "history"]);
  });
  it("stapelt über/unter und wechselt zurück zu Tabs", () => {
    let l = setMode(defaultLayout(), "left", "stack");
    l = dropPanel(l, "tree", "left", 1); // unter den Verlauf (Index ohne das gezogene Panel)
    expect(column(l.panels, "left")).toEqual(["history", "tree", "chat"]);
    l = setMode(l, "left", "tabs");
    expect(l.mode.left).toBe("tabs");
    expect(l.active.left).toBe("tree");
  });
  it("bleibt beim Hin- und Herschieben konsistent", () => {
    let p = defaultLayout().panels;
    for (let i = 0; i < 10; i++) p = movePanel(p, "history", i % 2 ? "left" : "right", 99);
    expect(column(p, "left")).toEqual(["tree", "chat", "history"]);
    for (const side of ["left", "right"] as const) expect(column(p, side).map((id) => p[id].order)).toEqual(column(p, side).map((_, i) => i));
  });
  it("Schließen wählt einen gültigen aktiven Tab", () => {
    const l = setOpen(defaultLayout(), "tree", false);
    expect(l.active.left).toBe("history");
  });
  it("ersetzt alte Layouts (mit Eigenschaften-Panel) durch den neuen Standard", () => {
    const old = { panels: { tree: { side: "left" }, history: { side: "left" }, props: { side: "right" } }, width: { left: 0 } };
    expect(normalize(old)).toEqual(defaultLayout());
  });
  it("repariert gespeicherte neue Layouts", () => {
    const stored = { ...defaultLayout(), width: { left: 0, right: "x" }, mode: { left: "weird" } };
    const l = normalize(stored);
    expect(l.width).toEqual({ left: 240, right: 300 });
    expect(l.mode.left).toBe("tabs");
  });
});

describe("Spaltenbreite ziehen", () => {
  it("linke Spalte: nach rechts ziehen macht sie breiter", () => {
    expect(resizeColumn("left", 260, 40, 1440)).toBe(300);
    expect(resizeColumn("left", 260, -40, 1440)).toBe(240);
  });
  it("rechte Spalte: nach links ziehen macht sie breiter", () => {
    expect(resizeColumn("right", 340, -60, 1440)).toBe(400);
    expect(resizeColumn("right", 340, 60, 1440)).toBe(280);
  });
  it("begrenzt auf 240 px bis 45 % des Fensters", () => {
    expect(resizeColumn("right", 340, -2000, 1440)).toBe(648);
    expect(resizeColumn("left", 260, -2000, 1440)).toBe(240);
  });
});

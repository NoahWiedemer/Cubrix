import { describe, expect, it } from "vitest";
import { column, defaultLayout, dropPanel, movePanel, normalize, resizeColumn, setOpen } from "../src/ui/layoutModel";

describe("Dock-Layout", () => {
  it("Standard: links KI (oben, 2/3), Objekte, Verlauf eingeklappt; rechts Inspektor", () => {
    const l = defaultLayout();
    expect(column(l.panels, "left")).toEqual(["chat", "tree", "history"]);
    expect(column(l.panels, "right")).toEqual(["inspector"]);
    expect(l.panels.chat.weight).toBe(2);
    expect(l.panels.history.collapsed).toBe(true);
  });
  it("verschiebt per Ablegen auf die andere Seite und aktiviert den Tab", () => {
    const l = dropPanel(defaultLayout(), "history", "right", 99);
    expect(column(l.panels, "left")).toEqual(["chat", "tree"]);
    expect(column(l.panels, "right")).toEqual(["inspector", "history"]);
  });
  it("sortiert innerhalb einer Seite um (über/unter)", () => {
    let l = dropPanel(defaultLayout(), "history", "left", 0);
    expect(column(l.panels, "left")).toEqual(["history", "chat", "tree"]);
    l = dropPanel(l, "history", "left", 2);
    expect(column(l.panels, "left")).toEqual(["chat", "tree", "history"]);
  });
  it("Verlauf unter den Inspektor auf der rechten Seite", () => {
    const l = dropPanel(defaultLayout(), "history", "right", 1);
    expect(column(l.panels, "right")).toEqual(["inspector", "history"]);
    expect(normalize(JSON.parse(JSON.stringify(l))).panels.history.side).toBe("right");
  });
  it("bleibt beim Hin- und Herschieben konsistent", () => {
    let p = defaultLayout().panels;
    for (let i = 0; i < 10; i++) p = movePanel(p, "history", i % 2 ? "left" : "right", 99);
    expect(column(p, "left")).toEqual(["chat", "tree", "history"]);
    for (const side of ["left", "right"] as const) expect(column(p, side).map((id) => p[id].order)).toEqual(column(p, side).map((_, i) => i));
  });
  it("Schließen blendet das Panel aus der Spalte aus", () => {
    const l = setOpen(defaultLayout(), "tree", false);
    expect(column(l.panels, "left")).toEqual(["chat", "history"]);
  });
  it("ersetzt ältere Layouts einmalig durch den neuen Standard", () => {
    const old = { panels: { tree: { side: "left" }, history: { side: "left" }, props: { side: "right" } }, width: { left: 0 } };
    expect(normalize(old)).toEqual(defaultLayout());
  });
  it("repariert gespeicherte neue Layouts", () => {
    const stored = { ...defaultLayout(), width: { left: 0, right: "x" }, mode: { left: "weird" } };
    const l = normalize(stored);
    expect(l.width).toEqual({ left: 240, right: 320 });
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

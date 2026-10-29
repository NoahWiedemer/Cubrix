import { describe, expect, it } from "vitest";
import { column, defaultLayout, dropAtSlot, dropPanel, movePanel, normalize, resizeColumn, setOpen, slotAt } from "../src/ui/layoutModel";

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

describe("drag slots", () => {
  const spans = [
    { top: 0, bottom: 100 },
    { top: 110, bottom: 300 },
    { top: 310, bottom: 340 },
  ];
  it("maps a pointer y to an insertion slot", () => {
    expect(slotAt(spans, -5)).toBe(0);
    expect(slotAt(spans, 40)).toBe(0);
    expect(slotAt(spans, 60)).toBe(1);
    expect(slotAt(spans, 250)).toBe(2);
    expect(slotAt(spans, 330)).toBe(3);
    expect(slotAt([], 10)).toBe(0);
  });

  it("moves panels left→right, right→left and reorders within a side", () => {
    const l = defaultLayout(); // left: chat, tree, history · right: inspector
    const r1 = dropAtSlot(l, "history", "right", 1); // below the inspector
    expect(column(r1.panels, "right")).toEqual(["inspector", "history"]);
    expect(column(r1.panels, "left")).toEqual(["chat", "tree"]);
    const r2 = dropAtSlot(r1, "inspector", "left", 0); // right → left, on top
    expect(column(r2.panels, "left")).toEqual(["inspector", "chat", "tree"]);
    const r3 = dropAtSlot(l, "chat", "left", 2); // below Objekte (slot counts chat itself)
    expect(column(r3.panels, "left")).toEqual(["tree", "chat", "history"]);
    const r4 = dropAtSlot(l, "history", "left", 0); // reorder upwards
    expect(column(r4.panels, "left")).toEqual(["history", "chat", "tree"]);
    const r5 = dropAtSlot(r1, "history", "right", 0); // reorder within the right
    expect(column(r5.panels, "right")).toEqual(["history", "inspector"]);
  });
});

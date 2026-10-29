import { useState } from "react";
import { execute } from "../core/commands";
import { useApp, useDoc } from "../core/store";
import { isClosed } from "../core/document";
import { useSketch, type SketchTool } from "../ui/sketch";
import { Icon, type IconName } from "../ui/icons";
import { usePopover } from "../ui/usePopover";

const TOOLS: { id: SketchTool; icon: IconName; label: string; key: string }[] = [
  { id: "select", icon: "select", label: "Auswählen", key: "v" },
  { id: "line", icon: "line", label: "Linie", key: "l" },
  { id: "rect", icon: "rect", label: "Rechteck", key: "shift+r" },
  { id: "circle", icon: "sphere", label: "Kreis", key: "c" },
  { id: "polygon", icon: "polygon", label: "Vieleck", key: "p" },
];

/** Toolbar of the 2D workspace. */
export function SketchToolbar() {
  const tool = useSketch((s) => s.tool);
  const sides = useSketch((s) => s.sides);
  const activeId = useSketch((s) => s.activeId);
  const doc = useDoc();
  const active = doc.features.find((f) => f.id === activeId);
  const canExtrude = active?.type === "sketch" && active.shapes.some(isClosed);
  const pop = usePopover();
  const [height, setHeight] = useState("10");

  const extrude = () => {
    if (!active) return;
    pop.setOpen(false);
    void execute("selection.set", { ids: [active.id] })
      .then(() => execute("sketch.extrude", { id: active.id, height: Number(height.replace(",", ".")) || 10 }))
      .then((ok) => {
        if (ok) {
          useSketch.setState({ activeId: null });
          useApp.setState({ workspace: "model" });
        }
      });
  };

  return (
    <div className="toolbar">
      <div className="toolbar-set">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`tool ${tool === t.id ? "active" : ""}`}
            onClick={() => execute(`sketch.tool.${t.id}`)}
            data-tip={t.label}
            data-kbd={t.key}
            data-tip-pos="top"
          >
            <Icon name={t.icon} size={18} />
            {t.label}
          </button>
        ))}
        {tool === "polygon" && (
          <label className="sides">
            <input type="number" min={3} max={32} value={sides} onChange={(e) => useSketch.setState({ sides: Math.max(3, Math.min(32, Number(e.target.value) || 6)) })} />
            Ecken
          </label>
        )}
        <div className="tool-sep" />
        <button className="tool" onClick={() => useSketch.setState({ activeId: null })} data-tip="Nächste Form beginnt eine neue Skizze" data-tip-pos="top">
          <Icon name="sketch" size={18} />Neue Skizze
        </button>
        <div ref={pop.ref} style={{ position: "relative" }}>
          <button className={`tool cta ${pop.open ? "active" : ""}`} disabled={!canExtrude} onClick={() => pop.setOpen(!pop.open)} data-tip="Geschlossene Formen zu einem Körper hochziehen" data-kbd="e" data-tip-pos="top">
            <Icon name="extrude" size={18} />In 3D ziehen
          </button>
          {pop.open && (
            <div className="popover extrude-pop" style={{ left: "50%", transform: "translateX(-50%)" }}>
              <div className="menu-title">Höhe</div>
              <div className="field">
                <input autoFocus value={height} onChange={(e) => setHeight(e.target.value)} onFocus={(e) => e.target.select()} onKeyDown={(e) => e.key === "Enter" && extrude()} />
                <span className="unit">mm</span>
              </div>
              <button className="btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: 8 }} onClick={extrude}>
                Hochziehen
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

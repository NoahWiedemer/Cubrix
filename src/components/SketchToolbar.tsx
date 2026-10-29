import { execute } from "../core/commands";
import { useSketch, type SketchTool } from "../ui/sketch";
import { Icon, type IconName } from "../ui/icons";

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
      </div>
    </div>
  );
}

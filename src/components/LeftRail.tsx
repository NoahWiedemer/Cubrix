import { execute } from "../core/commands";
import { selectTool } from "../core/commandDefs";
import { useApp } from "../core/store";
import { Icon, type IconName } from "../ui/icons";
import { PANEL_ICONS, PANEL_TITLES, useLayout, type PanelId } from "../ui/layout";
import { useHelp } from "../help/HelpCenter";
import { useLibrary } from "./Library";
import { useTextTool } from "../ui/textTool";
import { useGizmo } from "../ui/gizmo";

export const PRIMITIVES: { id: string; icon: IconName; label: string }[] = [
  { id: "primitive.box", icon: "box", label: "Quader" },
  { id: "primitive.cylinder", icon: "cylinder", label: "Zylinder" },
  { id: "primitive.sphere", icon: "sphere", label: "Kugel" },
  { id: "primitive.cone", icon: "cone", label: "Kegel" },
  { id: "primitive.torus", icon: "torus", label: "Torus" },
];

/** Closed panels stay reachable: one icon each at the bottom of the rail. */
function ClosedPanels() {
  const panels = useLayout((s) => s.panels);
  const closed = (Object.keys(panels) as PanelId[]).filter((id) => !panels[id].open);
  if (!closed.length) return null;
  return (
    <>
      {closed.map((id) => (
        <button
          key={id}
          className="rail-btn"
          data-tip={`${PANEL_TITLES[id]} öffnen`}
          data-tip-pos="right"
          onClick={() => useLayout.getState().open(id, true)}
        >
          <Icon name={PANEL_ICONS[id]} size={18} />
        </button>
      ))}
      <div className="rail-sep" />
    </>
  );
}

function RailButton({ icon, tip, kbd, active, onClick }: { icon: IconName; tip: string; kbd?: string; active?: boolean; onClick(): void }) {
  return (
    <button className={`rail-btn ${active ? "active" : ""}`} data-tip={tip} data-kbd={kbd} data-tip-pos="right" onClick={onClick}>
      <Icon name={icon} size={18} />
    </button>
  );
}

/** Left tool rail: tools only (actions on the selection live in the action bar). */
export function LeftRail() {
  const workspace = useApp((s) => s.workspace);
  const library = useLibrary((s) => s.open);
  const textTool = useTextTool((s) => s.active);
  const gizmoMode = useGizmo((s) => s.mode);
  const selecting = workspace === "model" && !library && !textTool && gizmoMode === "move";

  return (
    <aside className="panel rail">
      <RailButton icon="select" tip="Auswählen" kbd="v" active={selecting} onClick={selectTool} />
      <span data-library-toggle>
        <RailButton icon="shapes" tip="Formen-Bibliothek" kbd="l" active={library} onClick={() => useLibrary.setState({ open: !library })} />
      </span>
      <RailButton icon="scale" tip="Skalieren" kbd="s" active={gizmoMode === "scale"} onClick={() => execute("tool.scale")} />
      <RailButton icon="text" tip="Text" kbd="t" active={textTool} onClick={() => execute("tool.text")} />

      <div className="rail-bottom">
        <ClosedPanels />
        <RailButton icon="help" tip="Hilfe" kbd="shift+?" onClick={() => useHelp.setState({ open: true })} />
      </div>
    </aside>
  );
}

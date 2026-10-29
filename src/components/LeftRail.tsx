import { execute } from "../core/commands";
import { useApp } from "../core/store";
import { Icon, type IconName } from "../ui/icons";
import { usePopover } from "../ui/usePopover";
import { PANEL_ICONS, PANEL_TITLES, useLayout, type PanelId } from "../ui/layout";
import { Menu, MenuTitle } from "../ui/Menu";
import { CommandItem } from "../ui/CommandItem";
import { useHelp } from "../help/HelpCenter";
import { useLibrary } from "./Library";

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

/** Left tool rail; only tools that exist are shown. */
export function LeftRail() {
  const workspace = useApp((s) => s.workspace);
  const library = useLibrary((s) => s.open);
  const boolPop = usePopover();
  const edgePop = usePopover();
  useApp((s) => s.selection);

  return (
    <aside className="panel rail">
      <RailButton icon="select" tip="Auswählen" active={workspace === "model" && !library} onClick={() => { useLibrary.setState({ open: false }); void execute("workspace.model"); }} />
      <RailButton icon="shapes" tip="Formen-Bibliothek" active={library} onClick={() => useLibrary.setState({ open: !library })} />
      <div className="rail-sep" />
      <RailButton icon="sketch" tip="Skizze (2D)" kbd="2" active={workspace === "sketch"} onClick={() => execute("workspace.sketch")} />
      <div ref={boolPop.ref} style={{ position: "relative" }}>
        <RailButton icon="boolean" tip="Boolean" active={boolPop.open} onClick={() => boolPop.setOpen(!boolPop.open)} />
        {boolPop.open && (
          <Menu style={{ left: 46, top: 0 }}>
            <MenuTitle>Zwei Körper kombinieren</MenuTitle>
            <CommandItem id="boolean.union" onDone={() => boolPop.setOpen(false)} />
            <CommandItem id="boolean.subtract" onDone={() => boolPop.setOpen(false)} />
            <CommandItem id="boolean.intersect" onDone={() => boolPop.setOpen(false)} />
            <CommandItem id="boolean.split" onDone={() => boolPop.setOpen(false)} />
          </Menu>
        )}
      </div>
      <div ref={edgePop.ref} style={{ position: "relative" }}>
        <RailButton icon="fillet" tip="Abrunden / Fasen" active={edgePop.open} onClick={() => edgePop.setOpen(!edgePop.open)} />
        {edgePop.open && (
          <Menu style={{ left: 46, top: 0 }}>
            <MenuTitle>Kanten des ausgewählten Körpers</MenuTitle>
            <CommandItem id="object.fillet" onDone={() => edgePop.setOpen(false)} />
            <CommandItem id="object.chamfer" onDone={() => edgePop.setOpen(false)} />
          </Menu>
        )}
      </div>
      <div className="rail-sep" />
      <RailButton icon="ai" tip="KI-Assistent" kbd="mod+k" onClick={() => execute("ai.focus")} />

      <div className="rail-bottom">
        <ClosedPanels />
        <RailButton icon="help" tip="Hilfe" kbd="shift+?" onClick={() => useHelp.setState({ open: true })} />
      </div>
    </aside>
  );
}

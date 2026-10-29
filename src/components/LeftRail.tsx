import { execute } from "../core/commands";
import { useApp } from "../core/store";
import { Icon, type IconName } from "../ui/icons";
import { usePopover } from "../ui/usePopover";
import { PANEL_ICONS, PANEL_TITLES, useLayout, type PanelId } from "../ui/layout";

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
    <div className="rail-bottom">
      {closed.map((id) => (
        <button
          key={id}
          className="rail-btn"
          data-tip={`${PANEL_TITLES[id]} öffnen`}
          data-tip-pos="right"
          onClick={() => useLayout.getState().setPanel(id, { open: true, collapsed: false })}
        >
          <Icon name={PANEL_ICONS[id]} size={18} />
        </button>
      ))}
    </div>
  );
}

export function LeftRail() {
  const pop = usePopover();
  const hasSelection = useApp((s) => s.selection.length > 0);

  return (
    <aside className="panel rail" ref={pop.ref}>
      <button
        className={`rail-btn ${!pop.open ? "active" : ""}`}
        data-tip="Auswählen" data-tip-pos="right"
        onClick={() => {
          pop.setOpen(false);
          if (hasSelection) void execute("selection.clear");
        }}
      >
        <Icon name="select" size={18} />
      </button>
      <button
        className={`rail-btn ${pop.open ? "active" : ""}`}
        data-tip={pop.open ? undefined : "Grundkörper"} data-tip-pos="right"
        onClick={() => pop.setOpen(!pop.open)}
      >
        <Icon name="shapes" size={18} />
      </button>

      <ClosedPanels />
      {pop.open && (
        <div className="popover">
          <div className="menu-title">Grundkörper</div>
          <div className="prim-grid">
            {PRIMITIVES.map((p) => (
              <button
                key={p.id}
                className="prim-tile"
                onClick={() => {
                  pop.setOpen(false);
                  void execute(p.id);
                }}
              >
                <Icon name={p.icon} size={22} strokeWidth={1.5} />
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

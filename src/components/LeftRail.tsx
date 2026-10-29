import { execute } from "../core/commands";
import { useApp } from "../core/store";
import { Icon, type IconName } from "../ui/icons";
import { usePopover } from "../ui/usePopover";

export const PRIMITIVES: { id: string; icon: IconName; label: string }[] = [
  { id: "primitive.box", icon: "box", label: "Quader" },
  { id: "primitive.cylinder", icon: "cylinder", label: "Zylinder" },
  { id: "primitive.sphere", icon: "sphere", label: "Kugel" },
  { id: "primitive.cone", icon: "cone", label: "Kegel" },
  { id: "primitive.torus", icon: "torus", label: "Torus" },
];

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

      {pop.open && (
        <div className="popover">
          <div className="menu-title">Grundkörper hinzufügen</div>
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

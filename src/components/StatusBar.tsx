import { Magnet } from "lucide-react";
import { execute } from "../core/commands";
import { useApp, useDoc } from "../core/store";
import { usePopover } from "../ui/usePopover";
import { Menu, MenuItem, MenuTitle } from "../ui/Menu";

const SNAPS = [0, 0.1, 0.5, 1, 5, 10];
const snapLabel = (s: number) => (s === 0 ? "Aus" : `${s.toLocaleString("de-DE")} mm`);

export function StatusBar() {
  const snap = useApp((s) => s.snap);
  const selection = useApp((s) => s.selection);
  const doc = useDoc();
  const pop = usePopover();

  return (
    <footer className="statusbar">
      <div ref={pop.ref} style={{ position: "relative" }}>
        <button className="status-item" onClick={() => pop.setOpen(!pop.open)}>
          <Magnet size={12} /> Einrasten: <b>{snapLabel(snap)}</b>
        </button>
        {pop.open && (
          <Menu style={{ bottom: 28, minWidth: 200 }}>
            <MenuTitle>Einrasten beim Verschieben</MenuTitle>
            {SNAPS.map((s) => (
              <MenuItem key={s} icon={s === 0 ? "snapOff" : "snap"} label={snapLabel(s)} checked={s === snap} onClick={() => { pop.setOpen(false); void execute("view.snap", { mm: s }); }} />
            ))}
          </Menu>
        )}
      </div>
      <span className="status-item">
        {doc.features.length} {doc.features.length === 1 ? "Objekt" : "Objekte"}
        {selection.length > 0 && <> · {selection.length} ausgewählt</>}
      </span>
    </footer>
  );
}

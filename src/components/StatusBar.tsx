import { Magnet } from "lucide-react";
import { execute } from "../core/commands";
import { useApp, useDoc } from "../core/store";
import { usePopover } from "../ui/usePopover";

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
          <div className="popover" style={{ minWidth: 150 }}>
            <div className="menu-title">Einrasten beim Verschieben</div>
            {SNAPS.map((s) => (
              <button key={s} className="menu-item" onClick={() => { pop.setOpen(false); void execute("view.snap", { mm: s }); }}>
                {snapLabel(s)}
                {s === snap && <span className="hint">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      <span className="status-item">
        {doc.features.length} {doc.features.length === 1 ? "Objekt" : "Objekte"}
        {selection.length > 0 && <> · {selection.length} ausgewählt</>}
      </span>
    </footer>
  );
}

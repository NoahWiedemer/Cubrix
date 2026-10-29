// Ausrichten (A): align the selection per axis (min / centre / max) and distribute
// three or more objects with equal gaps. A single object aligns to the bed.
import { useEffect } from "react";
import { create } from "zustand";
import { execute, isEnabled } from "../core/commands";
import { useApp } from "../core/store";
import { Icon } from "../ui/icons";

export const useAlign = create<{ open: boolean }>(() => ({ open: false }));

const ROWS = [
  { axis: "x", label: "X", words: ["Links", "Mitte", "Rechts"] },
  { axis: "y", label: "Y", words: ["Vorne", "Mitte", "Hinten"] },
  { axis: "z", label: "Z", words: ["Unten", "Mitte", "Oben"] },
] as const;

export function AlignPanel() {
  const open = useAlign((s) => s.open);
  const count = useApp((s) => s.selection.length);
  useEffect(() => {
    if (!open) return;
    const close = () => useAlign.setState({ open: false });
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      // Clicks in the viewport (selecting objects) keep it open; elsewhere outside closes it.
      if (!t.closest("[data-align-toggle]") && !t.closest(".viewport")) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="popover menu align-pop" data-floating onPointerDown={(e) => e.stopPropagation()}>
      <div className="menu-title">{count === 1 ? "Am Druckbett ausrichten" : count > 1 ? `${count} Objekte ausrichten` : "Erst Objekte auswählen"}</div>
      {ROWS.map((r) => (
        <div key={r.axis} className="align-row">
          <span className={`align-axis ${r.axis}`}>{r.label}</span>
          {(["min", "center", "max"] as const).map((mode, i) => (
            <button key={mode} disabled={!count} onClick={() => void execute("objects.align", { axis: r.axis, mode })}>
              {r.words[i]}
            </button>
          ))}
        </div>
      ))}
      <div className="menu-sep" />
      <div className="align-row">
        <span className="align-axis"><Icon name="distribute" size={13} /></span>
        {(["x", "y", "z"] as const).map((axis) => (
          <button key={axis} disabled={!isEnabled("objects.distribute")} onClick={() => void execute("objects.distribute", { axis })} data-tip="Gleiche Abstände (ab 3 Objekten)" data-tip-pos="top">
            Verteilen {axis.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
}

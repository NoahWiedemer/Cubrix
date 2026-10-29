// Muster / Spiegeln: compact popover (action bar or right-click) with a live preview.
// Enter or "Anwenden" commits ONE history entry; Esc or a click outside cancels.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { create } from "zustand";
import { clearPreview, execute, previewCommand } from "../core/commands";
import { SegmentedControl } from "../ui/SegmentedControl";

type Kind = "linear" | "grid" | "circular" | "mirror";
interface Request {
  id: string;
  at: { x: number; y: number };
  placement?: "at" | "above";
  kind?: Kind;
}

const usePattern = create<{ req: Request | null }>(() => ({ req: null }));
export const openPatternPopover = (req: Request) => usePattern.setState({ req });

export function PatternPopover() {
  const req = usePattern((s) => s.req);
  return req ? <Popover key={`${req.id}-${req.at.x}-${req.at.y}`} req={req} /> : null;
}

const num = (s: string) => Number(s.replace(",", "."));

function Popover({ req }: { req: Request }) {
  const [kind, setKind] = useState<Kind>(req.kind ?? "linear");
  const [v, setV] = useState({ count: "3", countY: "2", dx: "25", dy: "25", angle: "360", axis: "x" as "x" | "y" });
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: req.at.x, top: req.at.y });

  const params = () =>
    kind === "linear"
      ? { id: req.id, kind, count: num(v.count), step: [num(v.dx), num(v.dy), 0] }
      : kind === "grid"
        ? { id: req.id, kind, count: num(v.count), countY: num(v.countY), step: [num(v.dx), num(v.dy), 0] }
        : kind === "circular"
          ? { id: req.id, kind, count: num(v.count), angle: num(v.angle), center: [0, 0, 0] }
          : { id: req.id, kind, axis: v.axis };

  useEffect(() => {
    const t = setTimeout(() => previewCommand("object.pattern", params()), 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, v]);

  const close = (apply: boolean) => {
    clearPreview();
    if (apply) void execute("object.pattern", params());
    usePattern.setState({ req: null });
  };

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    const above = req.placement === "above";
    const left = Math.max(8, Math.min((above ? req.at.x - w / 2 : req.at.x), window.innerWidth - 8 - w));
    const top = above ? req.at.y - h - 8 : Math.min(req.at.y, window.innerHeight - 8 - h);
    setPos({ left, top });
  }, [req, kind]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && close(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
      if (e.key === "Enter") close(true);
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  });

  const field = (key: keyof typeof v, label: string, unit = "") => (
    <label className="pat-field">
      <span>{label}</span>
      <div className="field">
        <input value={v[key]} inputMode="decimal" onChange={(e) => setV({ ...v, [key]: e.target.value })} onKeyDown={(e) => e.key !== "Enter" && e.key !== "Escape" && e.stopPropagation()} />
        {unit && <span className="unit">{unit}</span>}
      </div>
    </label>
  );

  return (
    <div ref={box} className="pattern-pop" style={pos} data-floating>
      <SegmentedControl<Kind> size="sm" className="block" value={kind} onChange={setKind}
        options={[{ value: "linear", label: "Reihe" }, { value: "grid", label: "Raster" }, { value: "circular", label: "Kreis" }, { value: "mirror", label: "Spiegeln" }]} />
      <div className="pat-fields">
        {kind === "linear" && <>{field("count", "Anzahl")}{field("dx", "Abstand X", "mm")}{field("dy", "Abstand Y", "mm")}</>}
        {kind === "grid" && <>{field("count", "Anzahl X")}{field("countY", "Anzahl Y")}{field("dx", "Abstand X", "mm")}{field("dy", "Abstand Y", "mm")}</>}
        {kind === "circular" && <>{field("count", "Anzahl")}{field("angle", "Winkel", "°")}<p className="pat-note">Um die Bettmitte</p></>}
        {kind === "mirror" && (
          <SegmentedControl<"x" | "y"> size="sm" className="block" value={v.axis} onChange={(axis) => setV({ ...v, axis })}
            options={[{ value: "x", label: "Links ↔ Rechts" }, { value: "y", label: "Vorne ↔ Hinten" }]} />
        )}
      </div>
      <div className="pat-actions">
        <button className="btn-ghost small" onClick={() => close(false)}>Abbrechen</button>
        <button className="btn-primary small" onClick={() => close(true)}>Anwenden</button>
      </div>
    </div>
  );
}

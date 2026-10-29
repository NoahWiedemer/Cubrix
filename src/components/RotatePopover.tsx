// Compact relative rotation (Drehen): three fields X / Y / Z in degrees, starting at 0.
// Same placement and keys as the value popover: live preview, Enter applies as one
// history entry, Esc or a click outside cancels. Arrows ±15° (Shift ±90°, Alt ±1°).
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { clearPreview, execute, previewCommand } from "../core/commands";
import { Icon } from "../ui/icons";
import { useClampX } from "../ui/useClampX";
import type { Vec3 } from "../core/document";

interface Request {
  id: string;
  at: { x: number; y: number };
  placement?: "at" | "above";
}

export const useRotatePopover = create<{ req: Request | null }>(() => ({ req: null }));
export const openRotatePopover = (req: Request) => useRotatePopover.setState({ req });

const AXIS = ["x", "y", "z"] as const;
const parse = (s: string) => Number(s.replace(",", ".").replace("°", "").trim()) || 0;
const fmt = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");

export function RotatePopover() {
  const req = useRotatePopover((s) => s.req);
  return req ? <Popover key={`${req.id}-${req.at.x}-${req.at.y}`} req={req} /> : null;
}

function Popover({ req }: { req: Request }) {
  const [vals, setVals] = useState(["0", "0", "0"]);
  const box = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLInputElement>(null);
  const timer = useRef<number>();
  const by = (v: string[]) => v.map(parse) as Vec3;

  const close = () => {
    window.clearTimeout(timer.current);
    clearPreview();
    useRotatePopover.setState({ req: null });
  };
  const preview = (v: string[]) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (by(v).every((n) => !n)) clearPreview();
      else previewCommand("object.rotateBy", { id: req.id, by: by(v) });
    }, 60);
  };
  const set = (i: number, value: string) => {
    const next = [...vals];
    next[i] = value;
    setVals(next);
    preview(next);
  };
  const apply = () => {
    window.clearTimeout(timer.current);
    clearPreview();
    if (by(vals).some((n) => n)) void execute("object.rotateBy", { id: req.id, by: by(vals) });
    useRotatePopover.setState({ req: null });
  };

  useEffect(() => {
    first.current?.focus();
    first.current?.select();
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) close();
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scrub = (i: number) => (e: React.PointerEvent<HTMLLabelElement>) => {
    e.preventDefault();
    const x0 = e.clientX;
    const start = parse(vals[i]);
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const step = ev.altKey ? 0.25 : ev.shiftKey ? 5 : 1;
      set(i, fmt(Math.round(start + ((ev.clientX - x0) / 2) * step)));
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  const above = req.placement === "above";
  const dx = useClampX(box, req.at.x, above);
  return (
    <div ref={box} className={`value-pop rotate-pop ${above ? "above" : ""}`} style={{ left: above ? req.at.x + dx : Math.min(req.at.x, window.innerWidth - 330), top: above ? req.at.y - 8 : Math.min(req.at.y, window.innerHeight - 90) }}>
      <div className="value-pop-label">
        <Icon name="rotate" size={15} />
        Drehen
      </div>
      {AXIS.map((a, i) => (
        <div key={a} className="field rotate-field">
          <label className={a} onPointerDown={scrub(i)} title="Ziehen zum Ändern">{a.toUpperCase()}</label>
          <input
            ref={i === 0 ? first : undefined}
            inputMode="decimal"
            value={vals[i]}
            onFocus={(e) => e.target.select()}
            onChange={(e) => set(i, e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") apply();
              else if (e.key === "Escape") close();
              else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault();
                const d = (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 90 : e.altKey ? 1 : 15);
                set(i, fmt(parse(vals[i]) + d));
              }
            }}
          />
          <span className="unit">°</span>
        </div>
      ))}
    </div>
  );
}

// Compact inline value input for commands with a single numeric parameter (Abrunden,
// Fasen, …) or a single text (placing 3D text). Opens where the context menu was, previews live while typing (kernel-heavy
// edits only on Enter) and commits one history entry on Enter. Esc or a click outside cancels and removes the preview.
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { clearPreview, execute, getCommand, previewCommand } from "../core/commands";
import { Icon } from "../ui/icons";
import { applyEdge } from "../ui/applyEdge";
import { useApp } from "../core/store";
import { useClampX } from "../ui/useClampX";

interface Request {
  command: string;
  /** Name of the numeric parameter, e.g. "radius". */
  param: string;
  at: { x: number; y: number };
  /** Extra fixed params (e.g. the object id). */
  params?: Record<string, unknown>;
  /** "text": a string field (no unit, no arrow-key steps). Default "number". */
  kind?: "number" | "text";
  /** Initial value (else the last used one). */
  initial?: string;
  /** "above": `at` is the top centre of a button; the popover sits centred above it. */
  placement?: "at" | "above";
}

export const useValuePopover = create<{ req: Request | null }>(() => ({ req: null }));
export const openValuePopover = (req: Request) => useValuePopover.setState({ req });

/** Last value used per command, offered as the next default. */
const useLastValues = create<{ values: Record<string, number> }>()(
  persist(() => ({ values: {} as Record<string, number> }), { name: "cubrix.lastValues" }),
);

const fmt = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");
const parse = (s: string) => Number(s.replace(",", ".").trim());

export function ValuePopover() {
  const req = useValuePopover((s) => s.req);
  return req ? <Popover key={`${req.command}-${req.at.x}-${req.at.y}`} req={req} /> : null;
}

function Popover({ req }: { req: Request }) {
  const cmd = getCommand(req.command)!;
  const spec = cmd.params[req.param];
  const isText = req.kind === "text";
  const heavy = /^object\.(fillet|chamfer|shell)$/.test(req.command);
  const [text, setText] = useState(req.initial ?? fmt(useLastValues.getState().values[req.command] ?? 2));
  const valueOf = (v: string) => (isText ? v : parse(v));
  const invalid = (v: string) => (isText ? !v.trim() : !Number.isFinite(parse(v)) || parse(v) < 0);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef<number>();

  const close = () => {
    window.clearTimeout(timer.current);
    clearPreview();
    useValuePopover.setState({ req: null });
  };

  const preview = (value: string) => {
    window.clearTimeout(timer.current);
    // Kernel-heavy edits apply on Enter only; just check the input here.
    if (heavy) return setError(invalid(value) ? "Bitte eine Zahl ≥ 0 eingeben." : null);
    timer.current = window.setTimeout(() => {
      if (invalid(value)) {
        clearPreview();
        setError(isText ? null : "Bitte eine Zahl ≥ 0 eingeben.");
        return;
      }
      setError(previewCommand(req.command, { ...req.params, [req.param]: valueOf(value) }));
    }, 120);
  };

  const apply = async () => {
    if (invalid(text) || error) return;
    window.clearTimeout(timer.current);
    clearPreview();
    const v = valueOf(text);
    const edge = req.command === "object.fillet" ? "fillet" : req.command === "object.chamfer" ? "chamfer" : null;
    if (edge && typeof v === "number") {
      const id = (req.params?.id as string | undefined) ?? useApp.getState().selection[0];
      const r = await applyEdge(id, edge, v);
      useLastValues.setState((s) => ({ values: { ...s.values, [req.command]: r.value } }));
      // Clamped: stay open and show the applied maximum; Enter or a click outside closes.
      if (r.limit !== null) {
        setText(fmt(r.limit));
        setLimit(r.limit);
        return;
      }
      useValuePopover.setState({ req: null });
      return;
    }
    const ok = await execute(req.command, { ...req.params, [req.param]: v });
    if (ok && typeof v === "number") useLastValues.setState((s) => ({ values: { ...s.values, [req.command]: v } }));
    useValuePopover.setState({ req: null });
  };

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
    preview(text);
    // Clicking outside cancels (safer than applying a value the user may not have meant).
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

  const nudge = (d: number) => {
    const n = Math.max(0, Math.round(((Number.isFinite(parse(text)) ? parse(text) : 0) + d) * 100) / 100);
    const v = fmt(n);
    setText(v);
    preview(v);
    requestAnimationFrame(() => input.current?.select());
  };

  const above = req.placement === "above";
  const dx = useClampX(box, req.at.x, above);
  const x = above ? req.at.x + dx : Math.min(req.at.x, window.innerWidth - 250);
  const y = above ? req.at.y - 8 : Math.min(req.at.y, window.innerHeight - 140);
  const unit = spec && "unit" in spec ? spec.unit : undefined;

  return (
    <div ref={box} className={`value-pop ${above ? "above" : ""}`} style={{ left: x, top: y }}>
      <div className="value-pop-label">
        <Icon name={cmd.icon} size={15} />
        {cmd.label}
      </div>
      <div className={`field value-pop-field ${isText ? "text" : ""} ${error ? "invalid" : ""}`}>
        <input
          ref={input}
          inputMode={isText ? "text" : "decimal"}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            preview(e.target.value);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") void apply();
            else if (e.key === "Escape") close();
            else if (!isText && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
              e.preventDefault();
              nudge((e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 5 : 0.5));
            }
          }}
        />
        {unit && <span className="unit">{unit}</span>}
      </div>
      {error && <div className="value-pop-error">{error}</div>}
      {limit !== null && <div className="value-pop-max">max. {fmt(limit)} mm</div>}
    </div>
  );
}

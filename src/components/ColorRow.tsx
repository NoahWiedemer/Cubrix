// "Farbe": one compact Inspektor row (swatch + name). Clicking opens a small popover
// (also used from the right-click menu) with filament-like swatches, a custom picker /
// hex field and recent colours. Picks preview live; closing writes ONE history entry.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { create } from "zustand";
import { clearPreview, execute, previewCommand } from "../core/commands";
import { useSettings } from "../ui/settings";

export const SWATCHES: { hex: string; name: string }[] = [
  { hex: "#f2f1ec", name: "Weiß" },
  { hex: "#2a2c2f", name: "Schwarz" },
  { hex: "#8d959b", name: "Grau" },
  { hex: "#d8443b", name: "Rot" },
  { hex: "#f08a2c", name: "Orange" },
  { hex: "#f2c531", name: "Gelb" },
  { hex: "#3e9f4f", name: "Grün" },
  { hex: "#6ee7c5", name: "Mint" },
  { hex: "#2f6fd6", name: "Blau" },
  { hex: "#7c55c9", name: "Lila" },
  { hex: "#e46aa6", name: "Pink" },
  { hex: "#d7e2e3", name: "Natur (PETG)" },
];

const NEUTRAL = "#99a1a8";
export const colorName = (hex?: string) => (!hex ? "Neutral" : (SWATCHES.find((s) => s.hex === hex)?.name ?? hex.toUpperCase()));

interface Request {
  ids: string[];
  current?: string;
  at: { x: number; y: number };
}
const useColorPopover = create<{ req: Request | null }>(() => ({ req: null }));
export const openColorPopover = (req: Request) => useColorPopover.setState({ req });

/** Compact row in the Inspektor. */
export function ColorRow({ ids, current }: { ids: string[]; current?: string }) {
  return (
    <div className="color-row">
      <span className="color-row-label">Farbe</span>
      <button
        className="color-chip"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          openColorPopover({ ids, current, at: { x: r.left, y: r.bottom + 6 } });
        }}
      >
        <span className="color-dot" style={{ background: current ?? NEUTRAL }} />
        <span className="color-name">{colorName(current)}</span>
      </button>
    </div>
  );
}

export function ColorPopover() {
  const req = useColorPopover((s) => s.req);
  return req ? <Popover key={`${req.ids.join()}-${req.at.x}-${req.at.y}`} req={req} /> : null;
}

function Popover({ req }: { req: Request }) {
  const recent = useSettings((s) => s.recentColors);
  const [picked, setPicked] = useState<string | null | undefined>(undefined); // undefined = nothing picked yet
  const [hex, setHex] = useState(req.current ?? "");
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: req.at.x, top: req.at.y });
  const shown = picked === undefined ? req.current : (picked ?? undefined);

  // Keep the popover inside the window.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    setPos({ left: Math.max(8, Math.min(req.at.x, window.innerWidth - 8 - w)), top: req.at.y + h > window.innerHeight - 8 ? Math.max(8, req.at.y - h - 40) : req.at.y });
  }, [req.at.x, req.at.y]);

  const pick = (c: string | null) => {
    setPicked(c);
    if (c) setHex(c);
    previewCommand("object.setColor", { ids: req.ids, color: c ?? "" });
  };
  const close = (apply: boolean) => {
    clearPreview();
    if (apply && picked !== undefined && (picked ?? undefined) !== req.current) {
      void execute("object.setColor", { ids: req.ids, color: picked ?? "" });
      useSettings.setState((s) => ({
        lastColor: picked,
        recentColors: picked && !SWATCHES.some((w) => w.hex === picked) ? [picked, ...s.recentColors.filter((c) => c !== picked)].slice(0, 6) : s.recentColors,
      }));
    }
    useColorPopover.setState({ req: null });
  };

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) close(true);
    };
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

  const valid = /^#[0-9a-f]{6}$/i.test(hex);
  return (
    <div ref={box} className="color-pop" style={pos} data-floating>
      <div className="swatches">
        <button className={`swatch none ${!shown ? "on" : ""}`} data-tip="Neutral" data-tip-pos="top" onClick={() => pick(null)} />
        {SWATCHES.map((w) => (
          <button key={w.hex} className={`swatch ${shown === w.hex ? "on" : ""}`} style={{ background: w.hex }} data-tip={w.name} data-tip-pos="top" onClick={() => pick(w.hex)} />
        ))}
      </div>
      {recent.length > 0 && (
        <div className="swatches recent">
          {recent.map((c) => (
            <button key={c} className={`swatch ${shown === c ? "on" : ""}`} style={{ background: c }} data-tip={c.toUpperCase()} data-tip-pos="top" onClick={() => pick(c)} />
          ))}
        </div>
      )}
      <div className="color-custom">
        <label className="color-well" style={{ background: valid ? hex : (shown ?? NEUTRAL) }} data-tip="Eigene Farbe" data-tip-pos="top">
          <input type="color" value={valid ? hex : (shown ?? NEUTRAL)} onChange={(e) => pick(e.target.value.toLowerCase())} />
        </label>
        <div className="field">
          <input
            value={hex}
            placeholder="#rrggbb"
            onChange={(e) => {
              setHex(e.target.value);
              if (/^#[0-9a-f]{6}$/i.test(e.target.value)) pick(e.target.value.toLowerCase());
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") close(true);
              if (e.key === "Escape") close(false);
            }}
          />
        </div>
      </div>
    </div>
  );
}

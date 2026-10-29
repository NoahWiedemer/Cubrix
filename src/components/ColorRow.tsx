// "Aussehen": Farbe and Material at the bottom of the Inspektor. The colour field opens a small popover
// (also used from the right-click menu) with filament-like swatches, a custom picker /
// hex field and recent colours. Picks preview live; closing writes ONE history entry.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { create } from "zustand";
import { clearPreview, execute, previewCommand } from "../core/commands";
import { useSettings } from "../ui/settings";
import { ChevronDown } from "lucide-react";
import { MATERIALS, materialOf } from "../core/materials";
import { Icon } from "../ui/icons";
import { Menu, MenuItem } from "../ui/Menu";
import { usePopover } from "../ui/usePopover";

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

/**
 * "Aussehen" at the bottom of the Inspektor: Farbe (an input-style field that opens the
 * colour popover below it) and Material (a select like the other dropdowns).
 * `color`/`material` undefined with several objects selected = mixed.
 */
export function Appearance({ ids, color, material, mixedColor, mixedMaterial }: { ids: string[]; color?: string; material?: string; mixedColor?: boolean; mixedMaterial?: boolean }) {
  const pop = usePopover();
  const current = materialOf(material);
  return (
    <div className="group appearance">
      <div className="group-label"><span><Icon name="background" size={15} />Aussehen</span></div>
      <div className="appearance-row">
        <span className="appearance-label">Farbe</span>
        <button
          className="select-btn color-field"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            openColorPopover({ ids, current: color, at: { x: r.left, y: r.bottom + 6 } });
          }}
        >
          <span className="color-dot" style={{ background: mixedColor ? "conic-gradient(#d8443b, #f2c531, #3e9f4f, #2f6fd6, #7c55c9, #d8443b)" : (color ?? NEUTRAL) }} />
          <span>{mixedColor ? "Gemischt" : colorName(color)}</span>
          {!mixedColor && color && colorName(color) !== color.toUpperCase() && <em className="color-hex">{color.toUpperCase()}</em>}
          <ChevronDown size={14} />
        </button>
      </div>
      <div className="appearance-row">
        <span className="appearance-label">Material</span>
        <div ref={pop.ref} style={{ position: "relative", minWidth: 0 }}>
          <button className={`select-btn ${pop.open ? "open" : ""}`} onClick={() => pop.setOpen(!pop.open)}>
            <Icon name="material" size={15} />
            <span>{mixedMaterial ? "Gemischt" : current.label}</span>
            <ChevronDown size={14} />
          </button>
          {pop.open && (
            <Menu className="select-menu" matchWidth>
              {MATERIALS.map((m) => (
                <MenuItem
                  key={m.id}
                  label={<span className="printer-opt"><span>{m.label}</span><span className="printer-dim">{m.hint}</span></span>}
                  checked={!mixedMaterial && m.id === current.id}
                  onClick={() => {
                    pop.setOpen(false);
                    void execute("object.setMaterial", { ids, material: m.id }).then((ok) => ok && useSettings.setState({ lastMaterial: m.id }));
                  }}
                />
              ))}
            </Menu>
          )}
        </div>
      </div>
    </div>
  );
}

const useMaterialMenu = create<{ req: { ids: string[]; current?: string; at: { x: number; y: number } } | null }>(() => ({ req: null }));
export const openMaterialMenu = (req: { ids: string[]; current?: string; at: { x: number; y: number } }) => useMaterialMenu.setState({ req });

/** Material list opened from the right-click menu, at the same spot. */
export function MaterialMenu() {
  const req = useMaterialMenu((s) => s.req);
  useEffect(() => {
    if (!req) return;
    const close = () => useMaterialMenu.setState({ req: null });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const t = setTimeout(() => window.addEventListener("pointerdown", close, { once: true }), 0);
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [req]);
  if (!req) return null;
  const current = materialOf(req.current).id;
  return (
    <div style={{ position: "fixed", left: Math.min(req.at.x, window.innerWidth - 280), top: Math.min(req.at.y, window.innerHeight - 260), zIndex: 300 }} onPointerDown={(e) => e.stopPropagation()}>
      <Menu inline style={{ position: "static", minWidth: 250 }}>
        {MATERIALS.map((m) => (
          <MenuItem
            key={m.id}
            label={<span className="printer-opt"><span>{m.label}</span><span className="printer-dim">{m.hint}</span></span>}
            checked={m.id === current}
            onClick={() => {
              useMaterialMenu.setState({ req: null });
              void execute("object.setMaterial", { ids: req.ids, material: m.id }).then((ok) => ok && useSettings.setState({ lastMaterial: m.id }));
            }}
          />
        ))}
      </Menu>
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

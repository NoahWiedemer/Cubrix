// Searchable font dropdown: the bundled fonts first (always available), then every
// installed family (from the Rust side), each name previewed in its own typeface.
import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { ChevronDown } from "lucide-react";
import { FONTS, fontLabel, type FontId } from "../cad/fontKeys";
import { isTauri } from "../core/platform";
import { usePopover } from "../ui/usePopover";
import { MenuItem, MenuTitle } from "../ui/Menu";

const useSystemFonts = create<{ families: string[] | null }>(() => ({ families: null }));

async function loadSystemFonts() {
  if (useSystemFonts.getState().families) return;
  if (!isTauri) return useSystemFonts.setState({ families: [] });
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const list = await invoke<{ family: string }[]>("fonts_list");
    useSystemFonts.setState({ families: list.map((f) => f.family) });
  } catch {
    useSystemFonts.setState({ families: [] });
  }
}

const BUNDLED_CSS: Record<FontId, string> = { inter: "Inter", "roboto-slab": "'Roboto Slab', serif", "roboto-mono": "'Roboto Mono', monospace" };

export function FontPicker({ value, onChange }: { value: string; onChange(font: string): void }) {
  const pop = usePopover();
  const [query, setQuery] = useState("");
  const families = useSystemFonts((s) => s.families);
  useEffect(() => {
    if (pop.open) void loadSystemFonts();
  }, [pop.open]);
  const q = query.trim().toLowerCase();
  const bundled = (Object.keys(FONTS) as FontId[]).filter((id) => FONTS[id].label.toLowerCase().includes(q));
  const system = useMemo(() => (families ?? []).filter((f) => f.toLowerCase().includes(q)).slice(0, 300), [families, q]);
  const pick = (font: string) => {
    onChange(font);
    pop.setOpen(false);
  };
  return (
    <div ref={pop.ref} style={{ position: "relative" }}>
      <button className={`select-btn ${pop.open ? "open" : ""}`} onClick={() => { setQuery(""); pop.setOpen(!pop.open); }}>
        <span style={{ fontFamily: value in FONTS ? BUNDLED_CSS[value as FontId] : `"${value}"` }}>{fontLabel(value)}</span>
        <ChevronDown size={14} />
      </button>
      {pop.open && (
        <div className="popover menu select-menu font-menu" role="menu">
          <input
            className="select-search"
            autoFocus
            placeholder="Schrift suchen…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") pop.setOpen(false);
              if (e.key === "Enter") {
                const first = bundled[0] ?? system[0];
                if (first) pick(first);
              }
            }}
          />
          {bundled.length > 0 && <MenuTitle>Mitgeliefert</MenuTitle>}
          {bundled.map((id) => (
            <MenuItem key={id} label={<span style={{ fontFamily: BUNDLED_CSS[id] }}>{FONTS[id].label}</span>} checked={value === id} onClick={() => pick(id)} />
          ))}
          {system.length > 0 && <MenuTitle>Installiert</MenuTitle>}
          {system.map((f) => (
            <MenuItem key={f} label={<span style={{ fontFamily: `"${f}"` }}>{f}</span>} checked={value === f} onClick={() => pick(f)} />
          ))}
          {families === null && <div className="menu-note">Schriften werden geladen …</div>}
          {families !== null && !bundled.length && !system.length && <div className="menu-note">Keine Schrift gefunden.</div>}
        </div>
      )}
    </div>
  );
}

// Searchable font dropdown: the bundled fonts first (always available), then every
// installed family (from the Rust side), each name previewed in its own typeface.
import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { ChevronDown } from "lucide-react";
import { FONTS, fontLabel, type FontId } from "../cad/fontKeys";
import { isTauri } from "../core/platform";
import { usePopover } from "../ui/usePopover";
import { Menu, MenuItem, MenuTitle } from "../ui/Menu";

const useSystemFonts = create<{ families: string[] | null }>(() => ({ families: null }));

/** Called once the UI is idle after start, so the dropdown opens instantly. */
export function preloadSystemFonts() {
  const go = () => void loadSystemFonts();
  if ("requestIdleCallback" in window) (window as unknown as { requestIdleCallback(f: () => void, o: object): void }).requestIdleCallback(go, { timeout: 4000 });
  else setTimeout(go, 2000);
}

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
        <Menu className="select-menu font-menu" matchWidth>
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
            <MenuItem key={f} label={<LazyFontName family={f} />} checked={value === f} onClick={() => pick(f)} />
          ))}
          {families === null && <div className="menu-note">Schriften werden geladen …</div>}
          {families !== null && !bundled.length && !system.length && <div className="menu-note">Keine Schrift gefunden.</div>}
        </Menu>
      )}
    </div>
  );
}

/** Families whose preview font was already shown (stay styled when the list reopens). */
const warm = new Set<string>();

/** The family name in its own typeface, applied only once the row scrolls into view. */
function LazyFontName({ family }: { family: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [on, setOn] = useState(warm.has(family));
  useEffect(() => {
    if (on || !ref.current) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        warm.add(family);
        setOn(true);
        io.disconnect();
      }
    });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [on, family]);
  // Plain CSS: the webview renders installed fonts natively; unknown names fall back to the UI font.
  return <span ref={ref} style={on ? { fontFamily: `"${family}", Inter, system-ui` } : undefined}>{family}</span>;
}

// "?" overlay: every keyboard shortcut, generated from the command registry (so it is
// always up to date), grouped and searchable. Esc or a click outside closes it.
import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { Search, X } from "lucide-react";
import { execute, listCommands, shortcutKeys, type Command } from "../core/commands";
import { Kbd } from "../ui/Tooltip";

export const useShortcuts = create<{ open: boolean }>(() => ({ open: false }));

const GROUPS: { title: string; match: (id: string) => boolean }[] = [
  { title: "Werkzeuge", match: (id) => id.startsWith("tool.") || id === "library.toggle" || id === "ai.focus" },
  { title: "Bearbeiten", match: (id) => id.startsWith("edit.") || id.startsWith("history.") || id.startsWith("selection.") },
  { title: "Objekte", match: (id) => id.startsWith("object.") || id.startsWith("objects.") || id.startsWith("primitive.") || id.startsWith("boolean.") },
  { title: "Ansicht", match: (id) => id.startsWith("view.") || id.startsWith("workspace.") },
  { title: "2D", match: (id) => id.startsWith("sketch.") },
  { title: "Datei und App", match: () => true },
];

/** Second keys for a command shown on its main row instead of a row of their own. */
const ALIASES: Record<string, string> = { "history.redoAlt": "history.redo" };

/** The shortcut commands, grouped (each command in the first group that matches). */
export function shortcutGroups(commands: Command[]) {
  const withKeys = commands.filter((c) => c.shortcut && !ALIASES[c.id]);
  const seen = new Set<string>();
  return GROUPS.map((g) => {
    const items = withKeys.filter((c) => !seen.has(c.id) && g.match(c.id));
    items.forEach((c) => seen.add(c.id));
    return { title: g.title, items };
  }).filter((g) => g.items.length);
}

export function ShortcutOverlay() {
  const open = useShortcuts((s) => s.open);
  const [query, setQuery] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => (open ? shortcutGroups(listCommands()) : []), [open]);
  const aliases = useMemo(() => {
    const out: Record<string, string> = {};
    for (const c of open ? listCommands() : []) if (ALIASES[c.id] && c.shortcut) out[ALIASES[c.id]] = c.shortcut;
    return out;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && useShortcuts.setState({ open: false });
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!open) return null;

  const q = query.trim().toLowerCase();
  const shown = groups
    .map((g) => ({ ...g, items: g.items.filter((c) => !q || `${c.label} ${c.description}`.toLowerCase().includes(q)) }))
    .filter((g) => g.items.length);

  return (
    <div className="help-backdrop" onMouseDown={(e) => e.target === e.currentTarget && useShortcuts.setState({ open: false })}>
      <div ref={box} className="shortcuts panel" role="dialog" aria-label="Tastenkürzel">
        <header>
          <span>Tastenkürzel</span>
          <label className="lib-search">
            <Search size={14} />
            <input autoFocus placeholder="Suchen …" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key !== "Escape" && e.stopPropagation()} />
          </label>
          <button className="icon-btn small" onClick={() => useShortcuts.setState({ open: false })} data-tip="Schließen" data-kbd="escape" data-tip-pos="bottom-end">
            <X size={15} />
          </button>
        </header>
        <div className="shortcut-cols scroll">
          {shown.map((g) => (
            <section key={g.title}>
              <h4 className="tab-heading">{g.title}</h4>
              {g.items.map((c) => (
                <div key={c.id} className="shortcut-row" title={c.description}>
                  <span>{c.label.replace(/ …$/, "")}</span>
                  <span className="kbd-alts">
                    <Kbd keys={shortcutKeys(c.shortcut!)} />
                    {aliases[c.id] && <Kbd keys={shortcutKeys(aliases[c.id])} />}
                  </span>
                </div>
              ))}
            </section>
          ))}
          {!shown.length && <div className="menu-note">Kein Kürzel gefunden.</div>}
        </div>
        <footer>
          <span>Maus: Linksziehen dreht, Rechtsziehen oder Leertaste verschiebt, Mausrad zoomt.</span>
          <button className="btn-ghost small" onClick={() => { useShortcuts.setState({ open: false }); void execute("help.open"); }}>Hilfe-Center</button>
        </footer>
      </div>
    </div>
  );
}

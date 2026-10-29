import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { Search, X, Lightbulb } from "lucide-react";
import { HELP_TOPICS, type HelpTopic } from "./topics";
import { Icon } from "../ui/icons";
import { Diagram } from "./diagrams";
import logo from "../assets/brand/modelonio-logo-mit-hintergrund-256.png";

const SHOTS = import.meta.glob("../assets/help/*.jpg", { eager: true, import: "default" }) as Record<string, string>;
const shot = (name: string) => SHOTS[`../assets/help/${name}.jpg`];

export const useHelp = create<{ open: boolean; topic: string }>(() => ({ open: false, topic: HELP_TOPICS[0].id }));

function matches(t: HelpTopic, q: string) {
  if (!q) return true;
  const hay = [t.title, t.summary, t.what, t.when, t.tip, ...t.steps, ...(t.keywords ?? [])].join(" ").toLowerCase();
  return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
}

export function HelpCenter() {
  const { open, topic } = useHelp();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const list = useMemo(() => HELP_TOPICS.filter((t) => matches(t, query)), [query]);
  const current = HELP_TOPICS.find((t) => t.id === topic) ?? HELP_TOPICS[0];

  useEffect(() => {
    if (!open) return;
    setTimeout(() => searchRef.current?.focus(), 50);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        useHelp.setState({ open: false });
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  if (!open) return null;
  return (
    <div className="help-backdrop" onMouseDown={(e) => e.target === e.currentTarget && useHelp.setState({ open: false })}>
      <div className="help" role="dialog" aria-label="Hilfe">
        <aside className="help-side">
          <div className="help-head">
            <img src={logo} alt="" />
            <div>
              <div className="help-title">Hilfe</div>
              <div className="help-sub">Albedo Schritt für Schritt</div>
            </div>
          </div>
          <div className="help-search">
            <Search size={15} />
            <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Suchen" />
          </div>
          <nav className="help-list scroll">
            {list.map((t) => (
              <button
                key={t.id}
                className={`help-item ${t.id === current.id ? "on" : ""}`}
                onClick={() => useHelp.setState({ topic: t.id })}
              >
                <Icon name={t.icon} size={16} />
                <span>{t.title}</span>
                {t.status === "soon" && <span className="soon-badge">bald</span>}
              </button>
            ))}
            {list.length === 0 && <div className="help-empty">Nichts gefunden.</div>}
          </nav>
        </aside>
        <article className="help-body scroll" key={current.id}>
          <button className="help-close icon-btn" onClick={() => useHelp.setState({ open: false })} data-tip="Schließen" data-kbd="escape" data-tip-pos="bottom-end">
            <X size={16} />
          </button>
          <div className="help-topic-head">
            <span className="help-topic-icon"><Icon name={current.icon} size={20} /></span>
            <h1>{current.title}</h1>
            {current.status === "soon" && <span className="soon-badge big">Kommt bald</span>}
          </div>
          {current.image &&
            (current.image.kind === "screenshot" && shot(current.image.src) ? (
              <img className="help-image" src={shot(current.image.src)} alt={current.image.alt} />
            ) : current.image.kind === "diagram" ? (
              <div className="help-image diagram" role="img" aria-label={current.image.alt}>
                <Diagram id={current.image.id} />
              </div>
            ) : null)}
          <section>
            <h2>Was ist das?</h2>
            <p>{current.what}</p>
          </section>
          <section>
            <h2>Wann brauche ich das?</h2>
            <p>{current.when}</p>
          </section>
          <section>
            <h2>So geht's</h2>
            <ol>
              {current.steps.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          </section>
          <section className="help-tip">
            <Lightbulb size={16} />
            <div>
              <h2>Drucktipp</h2>
              <p>{current.tip}</p>
            </div>
          </section>
        </article>
      </div>
    </div>
  );
}

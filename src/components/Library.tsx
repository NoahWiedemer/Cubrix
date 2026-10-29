// Formen-Bibliothek (L): every shape with a rendered thumbnail, search and categories.
// Click places the shape on a free spot; dragging shows a ghost and drops it onto the
// bed or onto the top of a body under the pointer.
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { Search, X } from "lucide-react";
import { execute, getCommand } from "../core/commands";
import { useApp } from "../core/store";
import { thumbnail } from "../ui/thumbnails";
import { viewportPick } from "../ui/viewportPick";
import { Icon, type IconName } from "../ui/icons";
import type { Vec3 } from "../core/document";

export const useLibrary = create<{ open: boolean }>(() => ({ open: false }));

interface Shape {
  type: string;
  label: string;
  icon: IconName;
  hint: string;
}

const CATEGORIES: { id: string; label: string; shapes: Shape[] }[] = [
  {
    id: "basic",
    label: "Grundkörper",
    shapes: [
      { type: "box", label: "Quader", icon: "box", hint: "Würfel, Blöcke" },
      { type: "cylinder", label: "Zylinder", icon: "cylinder", hint: "Stifte, Säulen" },
      { type: "sphere", label: "Kugel", icon: "sphere", hint: "rund" },
      { type: "cone", label: "Kegel", icon: "cone", hint: "Spitzen, Trichter" },
      { type: "torus", label: "Torus", icon: "torus", hint: "Ring" },
      { type: "pyramid", label: "Pyramide", icon: "pyramid", hint: "quadratisch" },
      { type: "prism", label: "Prisma", icon: "prism", hint: "Sechskant, Dreieck" },
      { type: "hemisphere", label: "Halbkugel", icon: "hemisphere", hint: "Kuppel" },
      { type: "wedge", label: "Keil", icon: "wedge", hint: "Rampe, Stütze" },
    ],
  },
  {
    id: "plates",
    label: "Platten & Rohre",
    shapes: [
      { type: "plate", label: "Platte", icon: "plate", hint: "abgerundete Ecken" },
      { type: "tube", label: "Rohr", icon: "tube", hint: "Hülse, Distanz" },
    ],
  },
  {
    id: "hardware",
    label: "Verbindungen",
    shapes: [
      { type: "counterbore", label: "Schraubloch", icon: "screw", hint: "M3 mit Senkung, zum Abziehen" },
      { type: "nut", label: "Mutterfalle", icon: "nut", hint: "M3 Sechskant, zum Abziehen" },
    ],
  },
];

function Thumb({ type, icon }: { type: string; icon: IconName }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    thumbnail(type).then((s) => alive && setSrc(s)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [type]);
  return src ? <img src={src} alt="" draggable={false} /> : <span className="lib-thumb-ph"><Icon name={icon} size={26} /></span>;
}

/** Places a shape: at a dropped spot (on the bed or on top of a body) or on a free spot. */
function place(type: string, at?: Vec3) {
  const snap = useApp.getState().snap || 1;
  const position = at ? ([Math.round(at[0] / snap) * snap, Math.round(at[1] / snap) * snap, Math.max(0, at[2])] as Vec3) : undefined;
  void execute(`primitive.${type}`, position ? { position } : {});
}

function startShapeDrag(shape: Shape, e: React.PointerEvent, src: string | undefined) {
  if (e.button !== 0) return;
  const x0 = e.clientX;
  const y0 = e.clientY;
  let ghost: HTMLDivElement | null = null;
  const move = (ev: PointerEvent) => {
    if (!ghost) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
      ghost = document.createElement("div");
      ghost.className = "lib-ghost";
      ghost.innerHTML = `${src ? `<img src="${src}" alt="">` : ""}<span></span>`;
      ghost.querySelector("span")!.textContent = shape.label;
      document.body.appendChild(ghost);
      document.body.classList.add("shape-dragging");
    }
    ghost.style.transform = `translate(${ev.clientX - 36}px, ${ev.clientY - 36}px)`;
    const hit = viewportPick.pick?.(ev.clientX, ev.clientY);
    ghost.classList.toggle("over", !!hit);
    ghost.classList.toggle("on-body", !!hit?.featureId && hit.facesUp);
  };
  const up = (ev: PointerEvent) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("keydown", key, true);
    if (!ghost) {
      place(shape.type); // a plain click
      return;
    }
    ghost.remove();
    document.body.classList.remove("shape-dragging");
    const hit = viewportPick.pick?.(ev.clientX, ev.clientY);
    if (hit) place(shape.type, hit.facesUp ? hit.point : [hit.point[0], hit.point[1], 0]);
  };
  const key = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape" || !ghost) return;
    ev.stopPropagation();
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("keydown", key, true);
    ghost.remove();
    document.body.classList.remove("shape-dragging");
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("keydown", key, true);
}

export function Library() {
  const open = useLibrary((s) => s.open);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const box = useRef<HTMLDivElement>(null);
  const thumbs = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.body.classList.contains("shape-dragging") && useLibrary.setState({ open: false });
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!box.current?.contains(t) && !t.closest("[data-library-toggle]")) useLibrary.setState({ open: false });
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [open]);

  if (!open) return null;
  const q = query.trim().toLowerCase();
  const sections = CATEGORIES.filter((c) => category === "all" || c.id === category)
    .map((c) => ({ ...c, shapes: c.shapes.filter((s) => !q || `${s.label} ${s.hint} ${s.type}`.toLowerCase().includes(q)) }))
    .filter((c) => c.shapes.length);

  return (
    <div ref={box} className="library panel" role="dialog" aria-label="Formen-Bibliothek">
      <div className="lib-head">
        <span className="lib-title">Formen</span>
        <button className="icon-btn small" onClick={() => useLibrary.setState({ open: false })} data-tip="Schließen" data-kbd="escape" data-tip-pos="bottom-end">
          <X size={15} />
        </button>
      </div>
      <label className="lib-search">
        <Search size={14} />
        <input autoFocus placeholder="Form suchen …" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      </label>
      <div className="lib-cats">
        {[{ id: "all", label: "Alle" }, ...CATEGORIES].map((c) => (
          <button key={c.id} className={category === c.id ? "on" : ""} onClick={() => setCategory(c.id)}>{c.label}</button>
        ))}
      </div>
      <div className="lib-body scroll">
        {sections.map((c) => (
          <section key={c.id}>
            {category === "all" && <h4>{c.label}</h4>}
            <div className="lib-grid">
              {c.shapes.map((s) => (
                <button
                  key={s.type}
                  className="lib-item"
                  title={getCommand(`primitive.${s.type}`)?.description}
                  onPointerDown={(e) => {
                    const img = (e.currentTarget.querySelector("img") as HTMLImageElement | null)?.src;
                    if (img) thumbs.current[s.type] = img;
                    startShapeDrag(s, e, thumbs.current[s.type]);
                  }}
                >
                  <span className="lib-thumb"><Thumb type={s.type} icon={s.icon} /></span>
                  <span className="lib-label">{s.label}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
        {!sections.length && <div className="menu-note">Keine Form gefunden.</div>}
        <p className="lib-foot">Klicken setzt die Form frei aufs Bett, Ziehen legt sie genau dort ab – auch oben auf einen Körper.</p>
      </div>
    </div>
  );
}

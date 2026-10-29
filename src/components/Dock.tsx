import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { useApp, useDoc } from "../core/store";
import { PANEL_ICONS, PANEL_TITLES, useLayout, type PanelId, type Side } from "../ui/layout";
import { Icon } from "../ui/icons";
import { clampColumnWidth, column, resizeColumn, slotAt } from "../ui/layoutModel";
import { ObjectTree } from "./ObjectTree";
import { HistoryPanel } from "./HistoryPanel";
import { ChatPanel } from "./ChatPanel";
import { InspectorBody, InspectorTabs } from "./Inspector";

function useWindowWidth() {
  const [w, setW] = useState(window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

function PanelBody({ id }: { id: PanelId }) {
  if (id === "tree") return <ObjectTree />;
  if (id === "history") return <HistoryPanel />;
  if (id === "chat") return <ChatPanel />;
  return <InspectorBody />;
}

function PanelMeta({ id }: { id: PanelId }) {
  const doc = useDoc();
  if (id === "tree" && doc.features.length) return <span className="count">{doc.features.length}</span>;
  return null;
}

/**
 * Panel drag with pointer events (HTML5 drag and drop is unreliable in the Tauri
 * webview). A press on a header becomes a drag after 5 px; a ghost follows the pointer,
 * the target slot is shown as a mint line, Esc cancels, release drops.
 */
function startPanelDrag(id: PanelId, e: React.PointerEvent) {
  if (e.button !== 0) return;
  const x0 = e.clientX;
  const y0 = e.clientY;
  let ghost: HTMLDivElement | null = null;

  const findSlot = (x: number, y: number) => {
    for (const col of document.querySelectorAll<HTMLElement>(".dock-col[data-side]")) {
      const r = col.getBoundingClientRect();
      // Generous horizontal slack so the narrow empty column is easy to hit.
      if (x < r.left - 24 || x > r.right + 24) continue;
      const spans = [...col.querySelectorAll<HTMLElement>(".dock-panel[data-panel]")].map((p) => p.getBoundingClientRect());
      return { side: col.dataset.side as Side, index: slotAt(spans, y) };
    }
    return null;
  };

  const move = (ev: PointerEvent) => {
    if (!ghost) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
      ghost = document.createElement("div");
      ghost.className = "panel-ghost";
      ghost.textContent = PANEL_TITLES[id];
      document.body.appendChild(ghost);
      document.body.classList.add("panel-dragging");
      useLayout.setState({ dragging: id });
    }
    ghost.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 10}px)`;
    const slot = findSlot(ev.clientX, ev.clientY);
    const cur = useLayout.getState().slot;
    if (slot?.side !== cur?.side || slot?.index !== cur?.index) useLayout.setState({ slot });
  };
  const finish = (drop: boolean) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("keydown", key, true);
    if (!ghost) return;
    ghost.remove();
    document.body.classList.remove("panel-dragging");
    const { slot } = useLayout.getState();
    useLayout.setState({ dragging: null, slot: null });
    if (drop && slot) useLayout.getState().dropAt(id, slot.side, slot.index);
    // The release must not also click a header button (collapse, tab switch).
    window.addEventListener("click", (c) => c.stopPropagation(), { capture: true, once: true });
    setTimeout(() => window.dispatchEvent(new Event("panel-drag-end")), 0);
  };
  const up = () => finish(true);
  const key = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
      ev.stopPropagation();
      finish(false);
    }
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("keydown", key, true);
}

/** Mint insertion line at a slot of a column. */
function DropLine({ side, index }: { side: Side; index: number }) {
  const slot = useLayout((s) => s.slot);
  return slot && slot.side === side && slot.index === index ? <div className="drop-line" /> : null;
}

/** A stacked section. Its header is the drag handle. */
function StackPanel({ id }: { id: PanelId }) {
  const state = useLayout((s) => s.panels[id]);
  const setPanel = useLayout((s) => s.setPanel);
  const dragging = useLayout((s) => s.dragging === id);

  return (
    <section
      data-panel={id}
      className={`panel dock-panel ${state.collapsed ? "collapsed" : ""} ${dragging ? "is-dragged" : ""}`}
      style={{ flex: state.collapsed ? "0 0 auto" : `${state.weight} 1 0` }}
    >
      {id === "inspector" ? (
        // The inspector's header is its own tab bar; dragging the header moves the panel.
        <header className="dock-head inspector-head" onPointerDown={(e) => startPanelDrag(id, e)}>
          <InspectorTabs />
        </header>
      ) : (
      <header className="dock-head" onPointerDown={(e) => startPanelDrag(id, e)} onDoubleClick={() => setPanel(id, { collapsed: !state.collapsed })}>
        <button className="dock-toggle" onClick={() => setPanel(id, { collapsed: !state.collapsed })}>
          {state.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
        <span className="dock-icon"><Icon name={PANEL_ICONS[id]} size={15} /></span>
        <span className="dock-title">{PANEL_TITLES[id]}</span>
        <PanelMeta id={id} />
        <span className="dock-actions">
          <button data-tip="Schließen (über Ansicht wieder öffnen)" data-tip-pos="bottom-end" onPointerDown={(e) => e.stopPropagation()} onClick={() => useLayout.getState().open(id, false)}>
            <X size={13} />
          </button>
        </span>
      </header>
      )}
      {!state.collapsed && <div className="dock-body"><PanelBody id={id} /></div>}
    </section>
  );
}

function SplitHandle({ above, below }: { above: PanelId; below: PanelId }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      className="split-h"
      onPointerDown={(e) => {
        const { panels, setPanel } = useLayout.getState();
        const total = panels[above].weight + panels[below].weight;
        const a = ref.current!.previousElementSibling as HTMLElement;
        const b = ref.current!.nextElementSibling as HTMLElement;
        const pxTotal = a.offsetHeight + b.offsetHeight;
        const startY = e.clientY;
        const startA = a.offsetHeight;
        const move = (ev: PointerEvent) => {
          const h = Math.max(80, Math.min(pxTotal - 80, startA + ev.clientY - startY));
          setPanel(above, { weight: (total * h) / pxTotal });
          setPanel(below, { weight: (total * (pxTotal - h)) / pxTotal });
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
    />
  );
}

function WidthHandle({ side }: { side: Side }) {
  return (
    <div
      className={`split-v ${side}`}
      onPointerDown={(e) => {
        const start = e.clientX;
        const w0 = useLayout.getState().width[side];
        document.body.classList.add("col-resizing");
        const move = (ev: PointerEvent) => useLayout.getState().setWidth(side, resizeColumn(side, w0, ev.clientX - start, window.innerWidth));
        const up = () => {
          document.body.classList.remove("col-resizing");
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
    />
  );
}

export function DockColumn({ side, override }: { side: Side; override?: ReactNode }) {
  const panels = useLayout((s) => s.panels);
  const width = useLayout((s) => s.width[side]);
  const dragging = useLayout((s) => s.dragging);
  const slotHere = useLayout((s) => s.slot?.side === side);
  const winWidth = useWindowWidth();
  useApp((s) => s.currentId);
  const ids = column(panels, side);

  if (override)
    return (
      <div className={`dock-col ${side}`} style={{ width: clampColumnWidth(width, winWidth) }}>
        <WidthHandle side={side} />
        <div className="dock-stack">{override}</div>
      </div>
    );

  if (ids.length === 0)
    return (
      <div data-side={side} className={`dock-col ${side} empty ${dragging ? "drop-target" : ""} ${slotHere ? "over" : ""}`} style={{ width: dragging ? 72 : 0 }}>
        {dragging && <DropLine side={side} index={0} />}
      </div>
    );

  const items: ReactNode[] = [<DropLine key="d0" side={side} index={0} />];
  ids.forEach((id, i) => {
    if (i > 0) {
      if (!panels[ids[i - 1]].collapsed && !panels[id].collapsed) items.push(<SplitHandle key={`h-${id}`} above={ids[i - 1]} below={id} />);
      else items.push(<div key={`g-${id}`} className="split-gap" />);
      items.push(<DropLine key={`d${i}`} side={side} index={i} />);
    }
    items.push(<StackPanel key={id} id={id} />);
  });
  items.push(<DropLine key="dn" side={side} index={ids.length} />);

  return (
    <div data-side={side} className={`dock-col ${side}`} style={{ width: clampColumnWidth(width, winWidth) }}>
      <WidthHandle side={side} />
      <div className="dock-stack">{items}</div>
    </div>
  );
}

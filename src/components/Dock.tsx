import { useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, ArrowLeftToLine, ArrowRightToLine, X } from "lucide-react";
import { useApp, useDoc } from "../core/store";
import { PANEL_ICONS, PANEL_TITLES, useLayout, type PanelId, type Side } from "../ui/layout";
import { Icon } from "../ui/icons";
import { ObjectTree } from "./ObjectTree";
import { HistoryPanel } from "./HistoryPanel";
import { ChatPanel } from "./ChatPanel";

function PanelBody({ id }: { id: PanelId }) {
  return id === "tree" ? <ObjectTree /> : id === "chat" ? <ChatPanel /> : <HistoryPanel />;
}

function PanelMeta({ id }: { id: PanelId }) {
  const doc = useDoc();
  const steps = useApp((s) => {
    let n = 0;
    for (let x = s.nodes[s.currentId]; x.parentId; x = s.nodes[x.parentId]) n++;
    return n;
  });
  if (id === "tree") return <span className="count">{doc.features.length || ""}</span>;
  if (id === "history") return <span className="count">{steps || ""}</span>;
  return null;
}

function Panel({ id, side, index, onDrop }: { id: PanelId; side: Side; index: number; onDrop(index: number): void }) {
  const state = useLayout((s) => s.panels[id]);
  const setPanel = useLayout((s) => s.setPanel);
  const dragging = useLayout((s) => s.dragging);
  const [over, setOver] = useState<"top" | "bottom" | null>(null);

  return (
    <section
      className={`panel dock-panel ${state.collapsed ? "collapsed" : ""} ${over ? `drop-${over}` : ""}`}
      style={{ flex: state.collapsed ? "0 0 auto" : `${state.weight} 1 0` }}
      onDragOver={(e) => {
        if (!dragging || dragging === id) return;
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        setOver(e.clientY < r.top + r.height / 2 ? "top" : "bottom");
      }}
      onDragLeave={() => setOver(null)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(null);
        onDrop(over === "bottom" ? index + 1 : index);
      }}
      data-side={side}
    >
      <header
        className="dock-head"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", id);
          e.dataTransfer.effectAllowed = "move";
          useLayout.setState({ dragging: id });
        }}
        onDragEnd={() => useLayout.setState({ dragging: null })}
        onDoubleClick={() => setPanel(id, { collapsed: !state.collapsed })}
      >
        <button className="dock-toggle" onClick={() => setPanel(id, { collapsed: !state.collapsed })} title={state.collapsed ? "Aufklappen" : "Einklappen"}>
          {state.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
        <span className="dock-icon"><Icon name={PANEL_ICONS[id]} size={15} /></span>
        <span className="dock-title">{PANEL_TITLES[id]}</span>
        <PanelMeta id={id} />
        <span className="dock-actions">
          <button
            data-tip={side === "left" ? "Nach rechts verschieben" : "Nach links verschieben"}
            onClick={() => useLayout.getState().move(id, side === "left" ? "right" : "left", 99)}
          >
            {side === "left" ? <ArrowRightToLine size={13} /> : <ArrowLeftToLine size={13} />}
          </button>
          <button data-tip="Schließen (über Ansicht wieder öffnen)" onClick={() => setPanel(id, { open: false })}>
            <X size={13} />
          </button>
        </span>
      </header>
      {!state.collapsed && <div className="dock-body">{<PanelBody id={id} />}</div>}
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
        const col = ref.current!.parentElement!;
        const { panels, setPanel } = useLayout.getState();
        const total = panels[above].weight + panels[below].weight;
        const a = ref.current!.previousElementSibling as HTMLElement;
        const b = ref.current!.nextElementSibling as HTMLElement;
        const pxTotal = a.offsetHeight + b.offsetHeight;
        const startY = e.clientY;
        const startA = a.offsetHeight;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        col.classList.add("resizing");
        const move = (ev: PointerEvent) => {
          const h = Math.max(80, Math.min(pxTotal - 80, startA + ev.clientY - startY));
          setPanel(above, { weight: (total * h) / pxTotal });
          setPanel(below, { weight: (total * (pxTotal - h)) / pxTotal });
        };
        const up = () => {
          col.classList.remove("resizing");
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
        const move = (ev: PointerEvent) => useLayout.getState().setWidth(side, w0 + (side === "left" ? 1 : -1) * (ev.clientX - start));
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

export function DockColumn({ side }: { side: Side }) {
  const panels = useLayout((s) => s.panels);
  const width = useLayout((s) => s.width[side]);
  const dragging = useLayout((s) => s.dragging);
  const ids = (Object.keys(panels) as PanelId[])
    .filter((id) => id !== "props" && panels[id].side === side && panels[id].open)
    .sort((a, b) => panels[a].order - panels[b].order);
  const empty = ids.length === 0;
  const move = (id: PanelId, index: number) => useLayout.getState().move(id, side, index);

  const items: ReactNode[] = [];
  ids.forEach((id, i) => {
    if (i > 0 && !panels[ids[i - 1]].collapsed && !panels[id].collapsed)
      items.push(<SplitHandle key={`h-${id}`} above={ids[i - 1]} below={id} />);
    else if (i > 0) items.push(<div key={`g-${id}`} className="split-gap" />);
    items.push(<Panel key={id} id={id} side={side} index={i} onDrop={(idx) => dragging && move(dragging, idx)} />);
  });

  return (
    <div
      className={`dock-col ${side} ${empty ? "empty" : ""} ${empty && dragging ? "drop-target" : ""}`}
      style={{ width: empty ? (dragging ? 64 : 0) : width }}
      onDragOver={(e) => empty && dragging && e.preventDefault()}
      onDrop={(e) => {
        if (!empty || !dragging) return;
        e.preventDefault();
        move(dragging, 0);
      }}
    >
      {!empty && <WidthHandle side={side} />}
      <div className="dock-stack">{items}</div>
    </div>
  );
}

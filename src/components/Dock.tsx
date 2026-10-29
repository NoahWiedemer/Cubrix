import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, X, GripVertical } from "lucide-react";
import { useApp, useDoc } from "../core/store";
import { PANEL_ICONS, PANEL_TITLES, useLayout, type PanelId, type Side } from "../ui/layout";
import { Icon } from "../ui/icons";
import { clampColumnWidth, column, resizeColumn } from "../ui/layoutModel";
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

/** Drag payload helpers (HTML5 drag and drop between and within sidebars). */
const startDrag = (id: PanelId) => (e: React.DragEvent) => {
  e.dataTransfer.setData("text/x-albedo-panel", id);
  e.dataTransfer.effectAllowed = "move";
  useLayout.setState({ dragging: id });
};
const endDrag = () => useLayout.setState({ dragging: null });
const draggedPanel = (e: React.DragEvent): PanelId | null =>
  (e.dataTransfer.getData("text/x-albedo-panel") as PanelId) || useLayout.getState().dragging;

/** A stacked section (stack mode). */
function StackPanel({ id, side, index }: { id: PanelId; side: Side; index: number }) {
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
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        setOver(e.clientY < r.top + r.height / 2 ? "top" : "bottom");
      }}
      onDragLeave={() => setOver(null)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const dragged = draggedPanel(e);
        const at = over === "bottom" ? index + 1 : index;
        setOver(null);
        endDrag();
        if (!dragged) return;
        const ids = column(useLayout.getState().panels, side);
        const own = ids.indexOf(dragged);
        useLayout.getState().drop(dragged, side, own >= 0 && own < at ? at - 1 : at);
      }}
    >
      {id === "inspector" ? (
        // The inspector's header is its own tab bar; the grip on the left drags the panel.
        <header className="dock-head inspector-head">
          <span className="grip" draggable onDragStart={startDrag(id)} onDragEnd={endDrag} data-tip="Ziehen zum Verschieben" data-tip-pos="bottom">
            <GripVertical size={14} />
          </span>
          <InspectorTabs />
        </header>
      ) : (
      <header className="dock-head" draggable onDragStart={startDrag(id)} onDragEnd={endDrag} onDoubleClick={() => setPanel(id, { collapsed: !state.collapsed })}>
        <button className="dock-toggle" onClick={() => setPanel(id, { collapsed: !state.collapsed })}>
          {state.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
        <span className="dock-icon"><Icon name={PANEL_ICONS[id]} size={15} /></span>
        <span className="dock-title">{PANEL_TITLES[id]}</span>
        <PanelMeta id={id} />
        <span className="dock-actions">
          <button data-tip="Schließen (über Ansicht wieder öffnen)" data-tip-pos="bottom-end" onClick={() => useLayout.getState().open(id, false)}>
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
  const winWidth = useWindowWidth();
  const [bodyOver, setBodyOver] = useState(false);
  useApp((s) => s.currentId);
  const ids = column(panels, side);
  const empty = ids.length === 0;

  // Dropping anywhere on the column body appends the panel to this side.
  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if (!dragging) return;
      e.preventDefault();
      setBodyOver(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setBodyOver(false);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setBodyOver(false);
      const id = draggedPanel(e);
      endDrag();
      if (id) useLayout.getState().drop(id, side, 99);
    },
  };

  if (override)
    return (
      <div className={`dock-col ${side}`} style={{ width: clampColumnWidth(width, winWidth) }}>
        <WidthHandle side={side} />
        <div className="dock-stack">{override}</div>
      </div>
    );

  if (empty)
    return (
      <div className={`dock-col ${side} empty ${dragging ? "drop-target" : ""} ${bodyOver ? "over" : ""}`} style={{ width: dragging ? 72 : 0 }} {...dropProps} />
    );

  const items: ReactNode[] = [];
  ids.forEach((id, i) => {
      if (i > 0 && !panels[ids[i - 1]].collapsed && !panels[id].collapsed) items.push(<SplitHandle key={`h-${id}`} above={ids[i - 1]} below={id} />);
      else if (i > 0) items.push(<div key={`g-${id}`} className="split-gap" />);
      items.push(<StackPanel key={id} id={id} side={side} index={i} />);
    });

  return (
    <div className={`dock-col ${side} ${bodyOver ? "over" : ""}`} style={{ width: clampColumnWidth(width, winWidth) }} {...dropProps}>
      <WidthHandle side={side} />
      <div className="dock-stack">{items}</div>
    </div>
  );
}

import { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { execute } from "../core/commands";
import { useApp, useDoc } from "../core/store";
import type { Feature } from "../core/document";
import { Icon, type IconName } from "../ui/icons";

export function featureIcon(f: Feature): IconName {
  return f.type === "boolean" ? f.op : f.type === "sketch" ? "sketch" : f.type === "extrude" ? "extrude" : f.type;
}

function Row({ f }: { f: Feature }) {
  const selected = useApp((s) => s.selection.includes(f.id));
  const [renaming, setRenaming] = useState(false);
  const [open, setOpen] = useState(false);

  return (
    <>
      <div
        className={`tree-row ${selected ? "selected" : ""} ${f.visible ? "" : "hidden-obj"}`}
        onPointerEnter={() => useApp.setState({ hoveredId: f.id })}
        onPointerLeave={() => useApp.setState({ hoveredId: null })}
        onClick={(e) =>
          execute("selection.set", { ids: [f.id], mode: e.shiftKey || e.metaKey || e.ctrlKey ? "toggle" : "replace" })
        }
        onDoubleClick={() => setRenaming(true)}
      >
        {f.type === "boolean" ? (
          <button className="tree-chevron" onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        ) : null}
        <span className="tree-icon"><Icon name={featureIcon(f)} size={15} /></span>
        <span className="tree-name">
          {renaming ? (
            <input
              autoFocus
              defaultValue={f.name}
              onFocus={(e) => e.target.select()}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                setRenaming(false);
                void execute("object.rename", { id: f.id, name: e.target.value });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setRenaming(false);
              }}
            />
          ) : (
            f.name
          )}
        </span>
        <button
          className={`tree-eye ${f.visible ? "" : "off"}`}
          title={f.visible ? "Ausblenden" : "Einblenden"}
          onClick={(e) => {
            e.stopPropagation();
            void execute("object.setVisibility", { ids: [f.id], visible: !f.visible });
          }}
        >
          <Icon name={f.visible ? "visible" : "hidden"} size={14} />
        </button>
      </div>
      {open && f.type === "boolean" &&
        f.children.map((c, i) => (
          <div key={c.id} className="tree-row child">
            <span className="tree-icon"><Icon name={featureIcon(c)} size={13} /></span>
            <span className="tree-name">{c.name} {i === 1 && f.op === "subtract" ? "(abgezogen)" : ""}</span>
          </div>
        ))}
    </>
  );
}

export function ObjectTree() {
  const doc = useDoc();
  return (
    <div className="scroll tree-list">
      {doc.features.map((f) => (
        <Row key={f.id} f={f} />
      ))}
    </div>
  );
}

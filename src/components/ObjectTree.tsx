import { SHAPE_DEFAULTS, isExtraType } from "../core/shapeDefs";
import { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { execute } from "../core/commands";
import { useApp, useDoc } from "../core/store";
import type { BooleanFeature, Feature } from "../core/document";
import { Icon, type IconName } from "../ui/icons";
import { openContextMenu } from "./ContextMenu";

export function featureIcon(f: Feature): IconName {
  if (isExtraType(f.type)) return SHAPE_DEFAULTS[f.type].icon;
  if (f.type === "import") return "open";
  return f.type === "boolean" ? f.op : f.type === "sketch" ? "sketch" : f.type === "extrude" ? "extrude" : f.type;
}

/** Role of an operand inside its boolean (icon + tooltip). */
function roleOf(parent: BooleanFeature, index: number): { icon: IconName; tip: string } {
  if (index === 0) return { icon: "box", tip: "Basis" };
  return parent.op === "union" ? { icon: "union", tip: "Vereinigt" } : parent.op === "subtract" ? { icon: "subtract", tip: "Abgezogen" } : { icon: "intersect", tip: "Schnittmenge" };
}

function Row({ f, depth = 0, parent, index = 0 }: { f: Feature; depth?: number; parent?: BooleanFeature; index?: number }) {
  const selected = useApp((s) => s.selection.includes(f.id));
  const [renaming, setRenaming] = useState(false);
  // Expanded automatically while one of its operands is selected.
  const childSelected = useApp((s) => f.type === "boolean" && s.selection.some((id) => contains(f, id)));
  const [openState, setOpen] = useState(false);
  const open = openState || childSelected;
  const role = parent ? roleOf(parent, index) : null;

  return (
    <>
      <div
        className={`tree-row ${selected ? "selected" : ""} ${f.visible ? "" : "hidden-obj"} ${depth ? "operand" : ""}`}
        style={depth ? { paddingLeft: 8 + depth * 16 } : undefined}
        onPointerEnter={() => useApp.setState({ hoveredId: f.id })}
        onPointerLeave={() => useApp.setState({ hoveredId: null })}
        onClick={(e) =>
          execute("selection.set", { ids: [f.id], mode: e.shiftKey || e.metaKey || e.ctrlKey ? "toggle" : "replace" })
        }
        onDoubleClick={() => setRenaming(true)}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!useApp.getState().selection.includes(f.id)) void execute("selection.set", { ids: [f.id] });
          openContextMenu(e.clientX, e.clientY);
        }}
      >
        {f.type === "boolean" ? (
          <button className="tree-chevron" onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        ) : depth ? <span className="tree-chevron" /> : null}
        {role && <span className={`tree-role ${role.icon}`} data-tip={role.tip} data-tip-pos="right"><Icon name={role.icon} size={12} /></span>}
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
        {(f.locked || !depth) && (
          <button
            className={`tree-lock ${f.locked ? "on" : ""}`}
            title={f.locked ? "Entsperren" : "Sperren"}
            onClick={(e) => {
              e.stopPropagation();
              void execute("object.lock", { ids: [f.id], locked: !f.locked });
            }}
          >
            <Icon name={f.locked ? "lock" : "unlock"} size={13} />
          </button>
        )}
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
      {open && f.type === "boolean" && f.children.map((c, i) => <Row key={c.id} f={c} depth={depth + 1} parent={f} index={i} />)}
    </>
  );
}

const contains = (b: Feature, id: string): boolean => b.type === "boolean" && b.children.some((c) => c.id === id || contains(c, id));

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

import { SHAPE_DEFAULTS, isExtraType } from "../core/shapeDefs";
import { useEffect, useRef } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { execute } from "../core/commands";
import { useApp, useDoc } from "../core/store";
import type { BooleanFeature, Feature, GroupFeature } from "../core/document";
import { Icon, type IconName } from "../ui/icons";
import { openContextMenu } from "./ContextMenu";
import { containersOf, findFeature, parentsOf } from "../core/document";
import { dropWhere, rangeRows, stepRow, useTree, visibleRows } from "../ui/treeNav";

export function featureIcon(f: Feature): IconName {
  if (isExtraType(f.type)) return SHAPE_DEFAULTS[f.type].icon;
  if (f.type === "import") return "open";
  if (f.type === "group") return "folder";
  return f.type === "boolean" ? f.op : f.type === "sketch" ? "sketch" : f.type === "extrude" ? "extrude" : f.type;
}

/** Role of an operand inside its boolean (icon + tooltip). */
function roleOf(parent: BooleanFeature, index: number): { icon: IconName; tip: string } {
  if (index === 0) return { icon: "box", tip: "Basis" };
  return parent.op === "union" ? { icon: "union", tip: "Vereinigt" } : parent.op === "subtract" ? { icon: "subtract", tip: "Abgezogen" } : { icon: "intersect", tip: "Schnittmenge" };
}

function Row({ f, depth = 0, parent, index = 0 }: { f: Feature; depth?: number; parent?: BooleanFeature | GroupFeature; index?: number }) {
  const selected = useApp((s) => s.selection.includes(f.id));
  // Expanded automatically while one of its operands is selected.
  const childSelected = useApp((s) => (f.type === "boolean" || f.type === "group") && s.selection.some((id) => contains(f, id)));
  const openState = useTree((t) => t.open.includes(f.id));
  const setOpen = (on: boolean) => useTree.setState((t) => ({ open: on ? [...t.open, f.id] : t.open.filter((id) => id !== f.id) }));
  const open = openState || childSelected;
  const dropHere = useTree((t) => (t.drop?.id === f.id ? t.drop.where : null));
  const renaming = useTree((t) => t.renaming === f.id);
  const setRenaming = (on: boolean) => useTree.setState({ renaming: on ? f.id : null });
  const role = parent?.type === "boolean" ? roleOf(parent, index) : null;

  return (
    <>
      <div
        data-row={f.id}
        onPointerDown={(e) => parent?.type !== "boolean" && startRowDrag(f, e)}
        className={`tree-row ${selected ? "selected" : ""} ${f.visible ? "" : "hidden-obj"} ${depth ? "operand" : ""} ${dropHere ? `drop-${dropHere}` : ""}`}
        style={depth ? { paddingLeft: 8 + depth * 16 } : undefined}
        onPointerEnter={() => useApp.setState({ hoveredId: f.id })}
        onPointerLeave={() => useApp.setState({ hoveredId: null })}
        onClick={(e) => {
          // Shift: range from the last picked row in the same list; ⌘/Ctrl: toggle one.
          const { selection, nodes, currentId } = useApp.getState();
          const siblings = parent ? parent.children : nodes[currentId].doc.features;
          const anchor = siblings.findIndex((s) => s.id === selection[selection.length - 1]);
          const here = siblings.findIndex((s) => s.id === f.id);
          if (e.shiftKey && anchor >= 0 && here >= 0) {
            const [from, to] = anchor < here ? [anchor, here] : [here, anchor];
            void execute("selection.set", { ids: siblings.slice(from, to + 1).map((s) => s.id), mode: "add" });
          } else void execute("selection.set", { ids: [f.id], mode: e.metaKey || e.ctrlKey ? "toggle" : "replace" });
        }}
        onDoubleClick={() => setRenaming(true)}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!useApp.getState().selection.includes(f.id)) void execute("selection.set", { ids: [f.id] });
          openContextMenu(e.clientX, e.clientY);
        }}
      >
        {f.type === "boolean" || f.type === "group" ? (
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
      {open && (f.type === "boolean" || f.type === "group") && f.children.map((c, i) => <Row key={c.id} f={c} depth={depth + 1} parent={f} index={i} />)}
    </>
  );
}

const contains = (b: Feature, id: string): boolean => (b.type === "boolean" || b.type === "group") && b.children.some((c) => c.id === id || contains(c, id));

/** Drag rows to reorder them or to move them into and out of groups (mint line shows where). */
function startRowDrag(f: Feature, e: React.PointerEvent) {
  if (e.button !== 0 || (e.target as HTMLElement).closest("button, input")) return;
  const y0 = e.clientY;
  let ghost: HTMLDivElement | null = null;
  const { selection } = useApp.getState();
  const ids = selection.includes(f.id) ? selection : [f.id];
  const docNow = () => useApp.getState().nodes[useApp.getState().currentId].doc;

  const move = (ev: PointerEvent) => {
    if (!ghost) {
      if (Math.abs(ev.clientY - y0) < 5) return;
      ghost = document.createElement("div");
      ghost.className = "panel-ghost";
      ghost.textContent = ids.length > 1 ? `${ids.length} Objekte` : f.name;
      document.body.appendChild(ghost);
    }
    ghost.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 10}px)`;
    const el = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-row]");
    const list = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest(".tree-list");
    if (!el) return useTree.setState({ drop: list ? { id: null, where: "after" } : null });
    const id = el.dataset.row!;
    const target = findFeature(docNow(), id);
    // Not onto itself, nor into a boolean's operands.
    if (!target || ids.includes(id) || parentsOf(docNow(), id).length) return useTree.setState({ drop: null });
    const r = el.getBoundingClientRect();
    useTree.setState({ drop: { id, where: dropWhere((ev.clientY - r.top) / r.height, target.type === "group") } });
  };
  const finish = (apply: boolean) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("keydown", key, true);
    const { drop } = useTree.getState();
    useTree.setState({ drop: null });
    if (!ghost) return;
    ghost.remove();
    window.addEventListener("click", (c) => c.stopPropagation(), { capture: true, once: true });
    if (!apply || !drop) return;
    const doc = docNow();
    if (drop.id === null) return void execute("group.move", { ids });
    if (drop.where === "into") {
      useTree.setState((t) => ({ open: [...t.open, drop.id!] }));
      return void execute("group.move", { ids, groupId: drop.id });
    }
    const parent = containersOf(doc, drop.id).at(-1);
    const siblings = parent ? parent.children : doc.features;
    const at = siblings.findIndex((s) => s.id === drop.id) + (drop.where === "after" ? 1 : 0);
    void execute("group.move", { ids, groupId: parent?.id ?? "", index: at });
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

export function ObjectTree() {
  const doc = useDoc();
  const box = useRef<HTMLDivElement>(null);
  const selection = useApp((s) => s.selection);
  const open = useTree((t) => t.open);
  const last = selection[selection.length - 1];
  const rows = () => {
    const shown = new Set([...open, ...selection.flatMap((id) => containersOf(doc, id).map((c) => c.id))]);
    return visibleRows(doc.features, (id) => shown.has(id));
  };
  // The current row stays in view.
  useEffect(() => {
    if (last) box.current?.querySelector(`[data-row="${last}"]`)?.scrollIntoView({ block: "nearest" });
  }, [last]);

  // Finder-style keys. They only act while the list has focus (after clicking a row).
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const list = rows();
    const row = list.find((r) => r.id === last);
    if (e.key === "ArrowRight") {
      if (!row?.branch) return;
      if (open.includes(row.id)) {
        const child = list[list.indexOf(row) + 1];
        if (child?.parentId === row.id) void execute("selection.set", { ids: [child.id] });
      } else useTree.setState((t) => ({ open: [...t.open, row.id] }));
      return;
    }
    if (e.key === "ArrowLeft") {
      if (!row) return;
      if (row.branch && open.includes(row.id)) useTree.setState((t) => ({ open: t.open.filter((id) => id !== row.id) }));
      else if (row.parentId) void execute("selection.set", { ids: [row.parentId] });
      return;
    }
    const next = stepRow(list, last, e.key === "ArrowDown" ? 1 : -1);
    if (!next) return;
    if (e.shiftKey) {
      const anchor = useTree.getState().anchor ?? last ?? next;
      useTree.setState({ anchor });
      const range = rangeRows(list, anchor, next);
      // The moving end stays last, so the next step continues from it.
      void execute("selection.set", { ids: [...range.filter((id) => id !== next), next] });
    } else {
      useTree.setState({ anchor: next });
      void execute("selection.set", { ids: [next] });
    }
  };
  return (
    <div ref={box} className="scroll tree-list" tabIndex={0} onKeyDown={onKeyDown}>
      {doc.features.map((f) => (
        <Row key={f.id} f={f} />
      ))}
    </div>
  );
}

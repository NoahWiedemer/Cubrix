import { useEffect, useMemo, useRef, useState } from "react";
import { GitBranch } from "lucide-react";
import { execute } from "../core/commands";
import { useApp, type HistoryNode } from "../core/store";
import { Icon } from "../ui/icons";

const time = (t: number) => new Date(t).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

function branchTip(nodes: Record<string, HistoryNode>, id: string) {
  let n = nodes[id];
  let steps = 1;
  while (n.activeChildId) {
    n = nodes[n.activeChildId];
    steps++;
  }
  return { tip: n, steps };
}

export function HistoryPanel() {
  const nodes = useApp((s) => s.nodes);
  const currentId = useApp((s) => s.currentId);
  const listRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // The visible line: root → current, then the redo-able future along active children.
  const line = useMemo(() => {
    const past: HistoryNode[] = [];
    for (let n: HistoryNode | undefined = nodes[currentId]; n; n = n.parentId ? nodes[n.parentId] : undefined) past.unshift(n);
    const future: HistoryNode[] = [];
    for (let n = nodes[currentId]; n.activeChildId; ) {
      n = nodes[n.activeChildId];
      future.push(n);
    }
    return { past, future };
  }, [nodes, currentId]);

  useEffect(() => {
    listRef.current?.querySelector(".hist-row.current")?.scrollIntoView({ block: "nearest" });
  }, [currentId]);

  const all = [...line.past, ...line.future];
  const onLine = new Set(all.map((n) => n.id));

  const renderNode = (n: HistoryNode, inGroup = false) => {
    const isFuture = !line.past.includes(n);
    const branches = n.childIds.filter((c) => !onLine.has(c));
    return (
      <div key={n.id}>
        <button
          className={`hist-row ${n.id === currentId ? "current" : ""} ${isFuture ? "future" : ""} ${inGroup ? "in-group" : ""}`}
          onClick={() => execute("history.goto", { nodeId: n.id })}
          title={n.source === "ai" ? "Von der KI ausgeführt" : undefined}
        >
          <span className={`hist-icon ${n.source === "ai" ? "ai" : ""}`}>
            <Icon name={n.source === "ai" && !inGroup ? "ai" : n.icon} size={13} />
          </span>
          <span className="hist-label">{n.label}</span>
          <span className="hist-time">{time(n.time)}</span>
        </button>
        {branches.map((b) => {
          const { tip, steps } = branchTip(nodes, b);
          return (
            <button key={b} className="hist-branch" onClick={() => execute("history.goto", { nodeId: tip.id })} title="Diesen früheren Zweig wiederherstellen">
              <GitBranch size={12} style={{ flex: "none" }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                Zweig: {nodes[b].label} · {steps} {steps === 1 ? "Schritt" : "Schritte"}
              </span>
            </button>
          );
        })}
      </div>
    );
  };

  // Consecutive steps of one AI response are shown as one collapsible block.
  const items: (HistoryNode | HistoryNode[])[] = [];
  for (const n of all) {
    const last = items[items.length - 1];
    if (n.group && Array.isArray(last) && last[0].group?.id === n.group.id) last.push(n);
    else items.push(n.group ? [n] : n);
  }

  return (
    <div className="scroll history-list" ref={listRef}>
      {items.map((item) => {
        if (!Array.isArray(item)) return renderNode(item);
        const g = item[0].group!;
        const open = !collapsed.has(g.id);
        const parent = item[0].parentId;
        return (
          <div key={g.id} className="hist-group">
            <div className="hist-group-head">
              <button className="hist-group-toggle" onClick={() => toggle(g.id)}>
                <span className="hist-icon ai"><Icon name="ai" size={13} /></span>
                <span className="hist-label" title={g.prompt}>{g.prompt}</span>
                <span className="hist-time">{item.length}</span>
              </button>
              {parent && (
                <button className="hist-discard" onClick={() => execute("history.goto", { nodeId: parent })} data-tip="KI-Änderung verwerfen (bleibt als Zweig erhalten)" data-tip-pos="bottom-end">
                  Verwerfen
                </button>
              )}
            </div>
            {open && item.map((n) => renderNode(n, true))}
          </div>
        );
      })}
    </div>
  );
}

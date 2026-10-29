// Application state: a branching history tree of document snapshots plus UI state.
// The current document is always `nodes[currentId].doc`.
import { create } from "zustand";
import { createDocument, newId, type ModelDocument, type Transform } from "./document";
import type { IconName } from "../ui/icons";

export type CommandSource = "user" | "ai";

export interface HistoryNode {
  id: string;
  parentId: string | null;
  childIds: string[];
  /** Child to follow on redo (the most recently visited branch). */
  activeChildId: string | null;
  commandId: string;
  label: string;
  icon: IconName;
  time: number;
  source: CommandSource;
  /** AI response this step belongs to (all steps of one response form a block). */
  group?: { id: string; prompt: string };
  doc: ModelDocument;
  selection: string[];
}

export type Workspace = "model" | "sketch" | "preview";

export interface Toast {
  id: string;
  kind: "info" | "success" | "error";
  text: string;
}

interface AppState {
  nodes: Record<string, HistoryNode>;
  rootId: string;
  currentId: string;
  selection: string[];
  /** Live transform while dragging the gizmo, committed on release. */
  preview: { id: string; transform: Transform } | null;
  /** Uncommitted document shown while a value is being typed (live preview); never in history. */
  draft: ModelDocument | null;
  savedNodeId: string | null;
  filePath: string | null;
  workspace: Workspace;
  /** Grid snap in mm, 0 = off. */
  snap: number;
  hoveredId: string | null;
  primitivesOpen: boolean;
  toasts: Toast[];

  commit(entry: Omit<HistoryNode, "id" | "parentId" | "childIds" | "activeChildId" | "time">): void;
  jumpTo(id: string): void;
  reset(doc: ModelDocument, label: string, filePath: string | null): void;
  toast(kind: Toast["kind"], text: string): void;
}

function rootNode(doc: ModelDocument, label: string): HistoryNode {
  return {
    id: newId(),
    parentId: null,
    childIds: [],
    activeChildId: null,
    commandId: "file.new",
    label,
    icon: "file",
    time: Date.now(),
    source: "user",
    doc,
    selection: [],
  };
}

const initialRoot = rootNode(createDocument(), "Neues Projekt");

export const useApp = create<AppState>((set, get) => ({
  nodes: { [initialRoot.id]: initialRoot },
  rootId: initialRoot.id,
  currentId: initialRoot.id,
  selection: [],
  preview: null,
  draft: null,
  savedNodeId: initialRoot.id,
  filePath: null,
  workspace: "model",
  snap: 1,
  hoveredId: null,
  primitivesOpen: false,
  toasts: [],

  commit(entry) {
    const { nodes, currentId } = get();
    const parent = nodes[currentId];
    const node: HistoryNode = {
      ...entry,
      id: newId(),
      parentId: parent.id,
      childIds: [],
      activeChildId: null,
      time: Date.now(),
    };
    set({
      nodes: {
        ...nodes,
        [parent.id]: { ...parent, childIds: [...parent.childIds, node.id], activeChildId: node.id },
        [node.id]: node,
      },
      currentId: node.id,
      selection: entry.selection,
      preview: null,
      draft: null,
    });
  },

  jumpTo(id) {
    const { nodes } = get();
    const target = nodes[id];
    if (!target) return;
    // Mark the path to the target as the active branch so redo follows it.
    const next = { ...nodes };
    let n: HistoryNode = target;
    while (n.parentId) {
      const p = next[n.parentId];
      next[p.id] = { ...p, activeChildId: n.id };
      n = p;
    }
    const existing = new Set(target.doc.features.map((f) => f.id));
    set({
      nodes: next,
      currentId: id,
      selection: target.selection.filter((s) => existing.has(s)),
      preview: null,
      draft: null,
    });
  },

  reset(doc, label, filePath) {
    const root = rootNode(doc, label);
    set({
      nodes: { [root.id]: root },
      rootId: root.id,
      currentId: root.id,
      selection: [],
      preview: null,
      draft: null,
      savedNodeId: root.id,
      filePath,
    });
  },

  toast(kind, text) {
    const id = newId();
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3200);
  },
}));

/** The document on screen: the live draft while previewing, else the current history state. */
export const useDoc = () => useApp((s) => s.draft ?? s.nodes[s.currentId].doc);
export const getDoc = () => {
  const s = useApp.getState();
  return s.nodes[s.currentId].doc;
};

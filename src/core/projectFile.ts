// The .cubrix project file. Versioned:
//   v1 (Albedo/Modelonio era): the bare ModelDocument JSON.
//   v2: { format, version: 2, document, history, chat, camera, selection }.
// The window layout is a per-machine preference and never part of a project.
import { capEntryImages, limitImages } from "../ai/images";
import { isModelDocument, type ModelDocument, type Vec3 } from "./document";
import type { HistoryNode } from "./store";
import type { Message } from "../ai/providers";

export const PROJECT_VERSION = 2;
export const MAX_HISTORY = 200;
export const MAX_CHAT = 100;

export interface ChatEntryData {
  role: "user" | "assistant";
  text: string;
  steps: { label: string; nodeId?: string; ok: boolean; error?: string }[];
  groupId?: string;
  durationMs?: number;
  sources?: { url: string; title: string }[];
}

export interface CameraData {
  position: Vec3;
  target: Vec3;
  projection: "perspective" | "orthographic";
  /** Orthographic zoom (px per mm). */
  zoom?: number;
}

export interface ProjectFile {
  format: "cubrix";
  version: number;
  document: ModelDocument;
  history: { rootId: string; currentId: string; nodes: Record<string, HistoryNode> };
  chat: { entries: ChatEntryData[]; api: Message[] };
  camera?: CameraData;
  selection: string[];
}

/**
 * Keeps at most `max` history nodes: always the path from the root to the current
 * state, then the newest other steps (each with its ancestors, so branches stay intact).
 */
export function capHistory(nodes: Record<string, HistoryNode>, rootId: string, currentId: string, max = MAX_HISTORY) {
  const keep = new Set<string>();
  const withAncestors = (id: string) => {
    const chain: string[] = [];
    for (let n: HistoryNode | undefined = nodes[id]; n && !keep.has(n.id); n = n.parentId ? nodes[n.parentId] : undefined) chain.push(n.id);
    return chain;
  };
  for (const id of withAncestors(currentId)) keep.add(id);
  keep.add(rootId);
  // The current path alone may exceed the cap: then keep its newest part and re-root there.
  let root = rootId;
  if (keep.size > max) {
    const path = withAncestorsFresh(nodes, currentId).slice(0, max);
    keep.clear();
    path.forEach((id) => keep.add(id));
    root = path[path.length - 1];
  }
  const rest = Object.values(nodes).filter((n) => !keep.has(n.id)).sort((a, b) => b.time - a.time);
  for (const n of rest) {
    if (keep.size >= max) break;
    const chain = withAncestors(n.id);
    if (keep.size + chain.length <= max) chain.forEach((id) => keep.add(id));
  }
  const out: Record<string, HistoryNode> = {};
  for (const id of keep) {
    const n = nodes[id];
    out[id] = {
      ...n,
      parentId: id === root ? null : n.parentId,
      childIds: n.childIds.filter((c) => keep.has(c)),
      activeChildId: n.activeChildId && keep.has(n.activeChildId) ? n.activeChildId : null,
    };
  }
  return { nodes: out, rootId: root };
}

function withAncestorsFresh(nodes: Record<string, HistoryNode>, id: string) {
  const chain: string[] = [];
  for (let n: HistoryNode | undefined = nodes[id]; n; n = n.parentId ? nodes[n.parentId] : undefined) chain.push(n.id);
  return chain;
}

/** Chat for the file: the newest entries, API history without screenshots (keys never live here). */
function chatForFile(entries: ChatEntryData[], api: Message[]) {
  const strip = (m: Message): Message => ({ ...m, content: m.content.map((b) => (b.type === "tool_result" && b.image ? { ...b, image: undefined } : b)) });
  // Pictures: only the newest stay in the API history; the visible chat keeps them up to a size limit.
  return { entries: capEntryImages(entries.slice(-MAX_CHAT) as { images?: string[] }[]) as ChatEntryData[], api: limitImages(api).map(strip) };
}

export function serializeProject(p: Omit<ProjectFile, "format" | "version">): string {
  const history = capHistory(p.history.nodes, p.history.rootId, p.history.currentId);
  const file: ProjectFile = {
    format: "cubrix",
    version: PROJECT_VERSION,
    document: p.document,
    history: { ...history, currentId: p.history.currentId },
    chat: chatForFile(p.chat.entries, p.chat.api),
    camera: p.camera,
    selection: p.selection,
  };
  return JSON.stringify(file);
}

/** Parses any project version into the current shape (v1 = bare document → fresh history). */
export function parseProject(text: string): { file: Omit<ProjectFile, "history"> & { history?: ProjectFile["history"] }; migratedFrom: number } {
  const raw = JSON.parse(text);
  if (raw && typeof raw === "object" && "version" in raw && raw.version >= 2 && raw.document) {
    if (raw.version > PROJECT_VERSION) throw new Error("Diese Datei stammt aus einer neueren Cubrix-Version.");
    if (!isModelDocument(raw.document)) throw new Error("Keine gültige Cubrix-Datei");
    const doc = { ...raw.document, format: "cubrix" } as ModelDocument;
    const history = raw.history && raw.history.nodes?.[raw.history.currentId] ? raw.history : undefined;
    return {
      file: { format: "cubrix", version: PROJECT_VERSION, document: doc, history, chat: raw.chat ?? { entries: [], api: [] }, camera: raw.camera, selection: raw.selection ?? [] },
      migratedFrom: raw.version,
    };
  }
  if (!isModelDocument(raw)) throw new Error("Keine gültige Cubrix-Datei");
  return {
    file: { format: "cubrix", version: PROJECT_VERSION, document: { ...raw, format: "cubrix" } as ModelDocument, chat: { entries: [], api: [] }, selection: [] },
    migratedFrom: 1,
  };
}

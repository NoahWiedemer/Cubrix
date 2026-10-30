// Cubrix as an MCP server: Rust takes the requests of external agents, they are carried out
// here with the built-in assistant's tools, so they land in the history and in the viewport.
import { create } from "zustand";
import { exportToPath, saveProjectTo } from "../core/commandDefs";
import type { ExportFormat } from "../cad/protocol";
import { isTauri } from "../core/platform";
import { buildTools, runTool, sceneSummary, type AgentEvents } from "./agent";
import { touchExternal } from "./run";
import type { Block } from "./providers";

export interface ConnectorStatus {
  enabled: boolean;
  port: number;
  running: boolean;
  runningPort: number | null;
  error: string | null;
  clients: { id: string; name: string; connectedAt: number }[];
  pending: string[];
  approved: string[];
}

const OFF: ConnectorStatus = { enabled: false, port: 7331, running: false, runningPort: null, error: null, clients: [], pending: [], approved: [] };

export const useConnector = create<{ status: ConnectorStatus }>(() => ({ status: OFF }));

async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

const apply = (status: ConnectorStatus) => useConnector.setState({ status });

export const refreshConnector = async () => apply(await call<ConnectorStatus>("connector_status"));
export const setConnector = async (enabled: boolean, port?: number) => apply(await call<ConnectorStatus>("connector_set", { enabled, port }));
export const connectorToken = () => call<string>("connector_token");
export const regenerateToken = async () => apply(await call<ConnectorStatus>("connector_regenerate"));
export const decideClient = async (client: string, allow: boolean) => apply(await call<ConnectorStatus>("connector_decide", { client, allow }));
export const disconnectClient = async (client: string) => apply(await call<ConnectorStatus>("connector_disconnect", { client }));

/** Friendly name of a client from its `clientInfo.name`. */
export function clientLabel(name: string) {
  if (/claude[-_ ]?code/i.test(name)) return "Claude Code";
  if (/codex/i.test(name)) return "Codex";
  if (/claude/i.test(name)) return "Claude";
  if (/cursor/i.test(name)) return "Cursor";
  return name;
}

/** Ready-made setups for the common clients; `token` may be a placeholder for display. */
export function connectorSnippets(port: number, token: string) {
  const url = `http://127.0.0.1:${port}/mcp`;
  return [
    { id: "claude", label: "Claude Code", text: `claude mcp add --transport http cubrix ${url} --header "Authorization: Bearer ${token}"` },
    { id: "codex", label: "Codex (~/.codex/config.toml)", text: `[mcp_servers.cubrix]\nurl = "${url}"\nbearer_token_env_var = "CUBRIX_TOKEN"\n\n# In der Shell, die Codex startet:\n# export CUBRIX_TOKEN=${token}` },
    { id: "cursor", label: "Cursor (mcp.json)", text: JSON.stringify({ mcpServers: { cubrix: { url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2) },
    { id: "desktop", label: "Claude Desktop", text: JSON.stringify({ mcpServers: { cubrix: { command: "npx", args: ["-y", "mcp-remote", url, "--header", `Authorization: Bearer ${token}`] } } }, null, 2) },
  ];
}

// ── Tools ────────────────────────────────────────────────────────────────────

/** These open dialogs; external agents get `save_project` and `export_model` with a path instead. */
const DIALOGS = /^(export__|file__|view__screenshot$)/;
const FORMATS: ExportFormat[] = ["stl", "3mf", "obj", "step"];

export function externalTools() {
  const own = [
    { name: "get_scene", description: "Kurze Übersicht des geöffneten Projekts: Drucker und Bauraum sowie alle Objekte mit ID, Typ, Name, Position und Größe in mm. Zuerst aufrufen.", input_schema: { type: "object", properties: {} } },
    {
      name: "save_project",
      description: "Speichert das Projekt als .cubrix-Datei. Ohne path am bisherigen Ort; ein neues Projekt braucht einen absoluten path.",
      input_schema: { type: "object", properties: { path: { type: "string", description: "Absoluter Pfad, endet auf .cubrix" } } },
    },
    {
      name: "export_model",
      description: "Exportiert alle sichtbaren Körper in eine Datei: STL und 3MF für den Slicer, STEP als exakte CAD-Geometrie, OBJ als Netz.",
      input_schema: { type: "object", properties: { format: { type: "string", enum: FORMATS }, path: { type: "string", description: "Absoluter Pfad mit passender Endung" } }, required: ["format", "path"] },
    },
  ];
  return [...buildTools().filter((t) => !DIALOGS.test(t.name)), ...own].map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema }));
}

const isAbsolute = (p: string) => /^(\/|[A-Za-z]:[\\/])/.test(p);

/** A path from a client, checked before anything is written. */
export function checkPath(path: unknown, extension: string): string {
  if (typeof path !== "string" || !isAbsolute(path)) throw new Error("path muss ein absoluter Pfad sein.");
  if (!path.toLowerCase().endsWith(`.${extension}`)) throw new Error(`path muss auf .${extension} enden.`);
  return path;
}

/** MCP content of a tool result. */
export function toContent(block: Block) {
  if (block.type !== "tool_result") return { content: [] };
  return {
    content: [...(block.image ? [{ type: "image", data: block.image, mimeType: "image/png" }] : []), { type: "text", text: block.content }],
    ...(block.isError ? { isError: true } : {}),
  };
}

/** Changes in quick succession form one entry in the history. */
const GROUP_GAP_MS = 120_000;
const groups = new Map<string, { id: string; prompt: string; last: number }>();

function groupFor(client: string) {
  const now = Date.now();
  let g = groups.get(client);
  if (!g || now - g.last > GROUP_GAP_MS) {
    g = { id: Math.random().toString(36).slice(2), prompt: `Extern: ${clientLabel(client)}`, last: now };
    groups.set(client, g);
  }
  g.last = now;
  return { id: g.id, prompt: g.prompt };
}

const QUIET: AgentEvents = { onText() {}, onStep() {} };

export async function callExternal(name: string, args: Record<string, unknown>, client: string) {
  const text = (t: string) => ({ content: [{ type: "text", text: t }] });
  try {
    if (name === "get_scene") return text(sceneSummary());
    if (name === "save_project") return text(`Gespeichert: ${await saveProjectTo(args.path === undefined ? null : checkPath(args.path, "cubrix"))}`);
    if (name === "export_model") {
      const format = args.format as ExportFormat;
      if (!FORMATS.includes(format)) throw new Error(`format muss eines von ${FORMATS.join(", ")} sein.`);
      return text(`Exportiert: ${await exportToPath(format, checkPath(args.path, format))}`);
    }
    if (DIALOGS.test(name)) throw new Error("Dieses Werkzeug gibt es für externe Clients nicht.");
    touchExternal(`Extern: ${clientLabel(client)}`);
    const block: Block = { type: "tool_use", id: "external", name, input: args };
    return toContent(await runTool(block, groupFor(client), QUIET));
  } catch (e) {
    return { ...text(e instanceof Error ? e.message : String(e)), isError: true };
  }
}

type Request = { id: number; message: { kind: "list" } | { kind: "call"; name: string; arguments: Record<string, unknown>; client: string } };

// One after the other: commands build on the document the previous one left.
let queue: Promise<unknown> = Promise.resolve();

function handle({ id, message }: Request) {
  const answer = async () => {
    try {
      const result = message.kind === "list" ? externalTools() : await callExternal(message.name, message.arguments, message.client);
      await call("connector_reply", { id, result });
    } catch (e) {
      await call("connector_reply", { id, error: e instanceof Error ? e.message : String(e) });
    }
  };
  if (message.kind === "list") void answer();
  else queue = queue.then(answer, answer);
}

export async function initConnector() {
  if (!isTauri) return;
  const { listen } = await import("@tauri-apps/api/event");
  await listen<Request>("connector-request", (e) => handle(e.payload));
  await listen("connector-changed", () => void refreshConnector());
  await refreshConnector();
}

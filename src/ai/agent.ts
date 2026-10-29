// Agentic loop: the model sees every registered command as a tool, plus a few
// meta tools (model JSON, screenshot, scripts). All changes go through the
// command registry with source "ai", grouped per response in the history.
import { logError } from "../core/errorLog";
import { execute, getCommand, listCommands, toToolDefinition } from "../core/commands";
import { getDoc, useApp } from "../core/store";
import { geometryKey, isSolid } from "../core/document";
import { useMeshes } from "../cad/kernel";
import { worldBox } from "../core/bounds";
import { HELP_TOPICS } from "../help/topics";
import type { Effort } from "./models";
import { runTurn, type Block, type Message, type Provider, type ToolSpec, type Transport } from "./providers";

/** Command ids contain dots, tool names may not. */
export const toolName = (id: string) => id.replace(/\./g, "__");
export const commandId = (name: string) => name.replace(/__/g, ".");

const HIDDEN = new Set(["file.new", "file.open", "history.redoAlt", "selection.clear", "app.settings"]);

export function buildTools(): ToolSpec[] {
  const commands = listCommands()
    .filter((c) => !HIDDEN.has(c.id) && !c.id.startsWith("workspace.") && !c.id.startsWith("sketch.tool."))
    .map((c) => {
      const t = toToolDefinition(c);
      return { ...t, name: toolName(c.id) };
    });
  return [
    ...commands,
    { name: "get_model", description: "Gibt das aktuelle Modell als JSON zurück: Objekte mit IDs, Typ, Maßen, Position, Drehung, Bounding-Box (mm) sowie Auswahl und Drucker.", input_schema: { type: "object", properties: {} } },
    { name: "get_screenshot", description: "Liefert ein Bild des aktuellen Viewports, um das Ergebnis zu prüfen.", input_schema: { type: "object", properties: {} } },
    { name: "list_commands", description: "Listet alle Befehle mit Beschreibung.", input_schema: { type: "object", properties: {} } },
    {
      name: "run_script",
      description: "Führt mehrere Befehle nacheinander aus. steps: [{command: 'primitive.box', params: {...}}, …]. Bricht beim ersten Fehler ab.",
      input_schema: {
        type: "object",
        properties: { steps: { type: "array", items: { type: "object", properties: { command: { type: "string" }, params: { type: "object" } }, required: ["command"] } } },
        required: ["steps"],
      },
    },
  ];
}

export function modelSnapshot() {
  const doc = getDoc();
  const entries = useMeshes.getState().entries;
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    name: doc.name,
    printer: doc.printer,
    userSelection: useApp.getState().selection,
    objects: doc.features.map((f) => {
      const b = isSolid(f) && entries[geometryKey(f)] ? worldBox(f, entries) : null;
      const { id, name, type, visible, transform } = f;
      const extra = f.type === "boolean" ? { op: f.op, children: f.children.map((c) => c.name) } : f.type === "sketch" ? { shapes: f.shapes } : f.type === "extrude" ? { height: f.height } : { params: f.params };
      return {
        id, name, type, visible, transform, fillet: f.fillet, chamfer: f.chamfer, ...extra,
        bounds: b ? { min: [r(b.min.x), r(b.min.y), r(b.min.z)], max: [r(b.max.x), r(b.max.y), r(b.max.z)] } : undefined,
      };
    }),
  };
}

export function systemPrompt(): string {
  const doc = getDoc();
  const help = HELP_TOPICS.map((t) => `- ${t.title}${t.status === "soon" ? " (kommt bald)" : ""}: ${t.summary}`).join("\n");
  return `Du bist der KI-Assistent in Albedo, einer CAD-App für den 3D-Druck für Einsteiger. Antworte auf Deutsch, freundlich und knapp.

Koordinaten: Millimeter, Z zeigt nach oben, das Druckbett liegt bei Z = 0 und ist um den Ursprung zentriert (${doc.printer.name}, ${doc.printer.volume.join(" × ")} mm, also X/Y von −${doc.printer.volume[0] / 2} bis +${doc.printer.volume[0] / 2}). Die Position eines Grundkörpers ist die Mitte seiner Unterseite; neue Körper stehen auf dem Bett. Kugeln liegen auf dem Bett auf.

Arbeitsweise:
- Ändere das Modell ausschließlich über die Werkzeuge (Befehle). Jede Änderung landet im Verlauf und kann rückgängig gemacht werden.
- Bei mehrteiligen Aufgaben: plane kurz, baue Schritt für Schritt, prüfe mit get_model (und bei Bedarf get_screenshot) und korrigiere.
- Löcher und Aussparungen: Werkzeugkörper anlegen, dann boolean.subtract mit targetId und toolId. Verbinden: boolean.union.
- Für den 3D-Druck: Wände mindestens 1,2 mm, Überhänge über 45° vermeiden, Teile flach aufs Bett legen.
- Fragen zur App beantwortest du anhand dieser Hilfe-Themen:
${help}

Aktuelles Modell (gekürzt): ${JSON.stringify(modelSnapshot()).slice(0, 4000)}`;
}

export interface AgentEvents {
  onText(delta: string): void;
  onStep(step: { label: string; nodeId?: string; ok: boolean; error?: string }): void;
}

/** Hook for viewport screenshots (set by the viewport). */
export let captureViewport: () => Promise<string | null> = async () => null;
export function setCaptureViewport(fn: () => Promise<string | null>) {
  captureViewport = fn;
}

async function runCommand(id: string, params: Record<string, unknown>, group: { id: string; prompt: string }, events: AgentEvents) {
  const cmd = getCommand(id);
  if (!cmd) throw new Error(`Unbekannter Befehl ${id}`);
  const before = useApp.getState().currentId;
  await execute(id, params, { source: "ai", group, throwErrors: true });
  const after = useApp.getState().currentId;
  const node = after !== before ? useApp.getState().nodes[after] : undefined;
  events.onStep({ label: node?.label ?? cmd.label, nodeId: node?.id, ok: true });
  // New objects are reported by id so the model can refer to them (the UI selection stays the user's).
  const created = node && node.parentId ? node.doc.features.filter((f) => !useApp.getState().nodes[node.parentId!].doc.features.some((g) => g.id === f.id)).map((f) => ({ id: f.id, name: f.name })) : [];
  return { ok: true, command: id, changed: !!node, created };
}

async function runTool(block: Extract<Block, { type: "tool_use" }>, group: { id: string; prompt: string }, events: AgentEvents): Promise<Block> {
  const result = (content: unknown, extra: Partial<Extract<Block, { type: "tool_result" }>> = {}): Block => ({
    type: "tool_result",
    tool_use_id: block.id,
    content: typeof content === "string" ? content : JSON.stringify(content),
    ...extra,
  });
  try {
    switch (block.name) {
      case "get_model":
        return result(modelSnapshot());
      case "list_commands":
        return result(listCommands().map((c) => ({ id: c.id, description: c.description })));
      case "get_screenshot": {
        const image = await captureViewport();
        return image ? result("Screenshot des Viewports.", { image }) : result("Kein Screenshot verfügbar.");
      }
      case "run_script": {
        const steps = (block.input.steps as { command: string; params?: Record<string, unknown> }[]) ?? [];
        const done = [];
        for (const s of steps) done.push(await runCommand(s.command, s.params ?? {}, group, events));
        return result({ ok: true, steps: done.length, created: done.flatMap((d) => d.created) });
      }
      default:
        return result(await runCommand(commandId(block.name), block.input, group, events));
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logError("ai", `Werkzeug ${block.name}: ${error}`, { tool: block.name, input: block.input });
    events.onStep({ label: commandId(block.name), ok: false, error });
    return result({ ok: false, error }, { isError: true });
  }
}

/** User turns kept in the model context (the visible chat keeps everything). */
export const CONTEXT_TURNS = 20;

const isPrompt = (m: Message) => m.role === "user" && m.content.some((b) => b.type === "text");

/**
 * Makes a history safe to send:
 * - keeps only the last `turns` user prompts (cut at a prompt, so tool pairs stay whole);
 * - every tool_use gets a tool_result in the following user message (a stopped run
 *   leaves calls without results, which both APIs reject with HTTP 400);
 * - tool_results without a matching call and empty text blocks are dropped;
 * - empty messages are removed.
 */
export function prepareHistory(messages: Message[], turns = CONTEXT_TURNS): Message[] {
  const prompts = messages.map((m, i) => (isPrompt(m) ? i : -1)).filter((i) => i >= 0);
  const start = prompts.length > turns ? prompts[prompts.length - turns] : 0;
  const src = messages.slice(start);
  const out: Message[] = [];
  for (let i = 0; i < src.length; i++) {
    const m = src[i];
    if (m.role === "assistant") {
      const content = m.content.filter((b) => !(b.type === "text" && !b.text.trim()));
      if (!content.length) continue;
      out.push({ role: "assistant", content });
      const calls = content.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use").map((b) => b.id);
      if (!calls.length) continue;
      // The answers must come right after the calls.
      const next = src[i + 1];
      const given = next?.role === "user" ? next.content.filter((b) => b.type === "tool_result" && calls.includes(b.tool_use_id)) : [];
      const answered = new Set(given.map((b) => (b as Extract<Block, { type: "tool_result" }>).tool_use_id));
      const missing: Block[] = calls
        .filter((id) => !answered.has(id))
        .map((id) => ({ type: "tool_result", tool_use_id: id, content: JSON.stringify({ ok: false, error: "Abgebrochen" }), isError: true }));
      const rest = next?.role === "user" ? next.content.filter((b) => b.type !== "tool_result" && !(b.type === "text" && !b.text.trim())) : [];
      out.push({ role: "user", content: [...given, ...missing, ...rest] });
      if (next?.role === "user") i++;
      continue;
    }
    // A user message not answering calls: orphaned results go.
    const content = m.content.filter((b) => b.type !== "tool_result" && !(b.type === "text" && !b.text.trim()));
    if (content.length) out.push({ role: "user", content });
  }
  // The context must not start with an assistant message.
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

export async function runAgent(opts: {
  provider: Provider;
  model: string;
  /** Reasoning depth, or null when the model has no such setting. */
  effort?: Effort | null;
  transport: Transport;
  history: Message[];
  prompt: string;
  signal: AbortSignal;
  events: AgentEvents;
  maxTurns?: number;
}): Promise<Message[]> {
  const group = { id: Math.random().toString(36).slice(2), prompt: opts.prompt };
  const messages: Message[] = [...prepareHistory(opts.history), { role: "user", content: [{ type: "text", text: opts.prompt }] }];
  const tools = buildTools();
  for (let turn = 0; turn < (opts.maxTurns ?? 16); turn++) {
    if (opts.signal.aborted) break;
    const res = await runTurn(opts.provider, opts.transport, opts.model, opts.effort ?? null, systemPrompt(), tools, prepareHistory(messages), opts.events.onText, opts.signal);
    messages.push({ role: "assistant", content: res.blocks });
    const calls = res.blocks.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use");
    if (!calls.length || res.stop !== "tool_use") break;
    const results: Block[] = [];
    for (const c of calls) {
      if (opts.signal.aborted) break;
      results.push(await runTool(c, group, opts.events));
    }
    messages.push({ role: "user", content: results });
  }
  // Stopped mid-run: close any open tool calls so the saved history stays valid.
  return prepareHistory(messages, Infinity);
}

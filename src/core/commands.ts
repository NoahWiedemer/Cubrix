// Central command registry. Every user-visible action is a named command with
// typed parameters and a description. Buttons, keyboard shortcuts and (later)
// the AI chat / MCP server all go through `execute()`.
import type { ModelDocument } from "./document";
import { getDoc, useApp, type CommandSource } from "./store";
import type { IconName } from "../ui/icons";

export type ParamSpec =
  | { type: "number"; description: string; unit?: "mm" | "°"; min?: number; default?: number; optional?: boolean }
  | { type: "string"; description: string; default?: string; optional?: boolean }
  | { type: "boolean"; description: string; default?: boolean; optional?: boolean }
  | { type: "vec3"; description: string; unit?: "mm" | "°"; default?: [number, number, number]; optional?: boolean }
  | { type: "id"; description: string; optional?: boolean }
  | { type: "ids"; description: string; optional?: boolean }
  | { type: "enum"; description: string; options: readonly string[]; default?: string; optional?: boolean };

export type ParamSchema = Record<string, ParamSpec>;

export interface CommandContext {
  doc: ModelDocument;
  selection: string[];
  source: CommandSource;
}

export interface DocumentResult {
  doc: ModelDocument;
  /** Selection after the command; defaults to the current one. */
  selection?: string[];
  /** History label override, e.g. "Quader 2 verschieben". */
  label?: string;
}

interface CommandBase {
  id: string;
  /** Short German label for buttons and history. */
  label: string;
  /** What the command does — shown in tooltips and given to the AI later. */
  description: string;
  icon: IconName;
  params: ParamSchema;
  /** e.g. "mod+d", "shift+mod+z", "delete" */
  shortcut?: string;
  isEnabled?(ctx: CommandContext): boolean;
}

export interface DocumentCommand extends CommandBase {
  kind: "document";
  /** Pure function: returns the new document, or null for a no-op. */
  apply(doc: ModelDocument, params: Record<string, any>, ctx: CommandContext): DocumentResult | null;
}

export interface ActionCommand extends CommandBase {
  kind: "action";
  perform(params: Record<string, any>, ctx: CommandContext): void | Promise<void>;
}

export type Command = DocumentCommand | ActionCommand;

const registry = new Map<string, Command>();

export function defineCommand<C extends Command>(cmd: C): C {
  registry.set(cmd.id, cmd);
  return cmd;
}

export function getCommand(id: string): Command | undefined {
  return registry.get(id);
}

export function listCommands(): Command[] {
  return [...registry.values()];
}

function context(source: CommandSource): CommandContext {
  return { doc: getDoc(), selection: useApp.getState().selection, source };
}

export function isEnabled(id: string): boolean {
  const cmd = registry.get(id);
  return !!cmd && (cmd.isEnabled?.(context("user")) ?? true);
}

function withDefaults(schema: ParamSchema, params: Record<string, any>) {
  const out: Record<string, any> = { ...params };
  for (const [key, spec] of Object.entries(schema)) {
    if (out[key] === undefined && "default" in spec && spec.default !== undefined) out[key] = spec.default;
    if (out[key] === undefined && !spec.optional) throw new Error(`Parameter „${key}“ fehlt`);
    if (spec.type === "number" && out[key] !== undefined) {
      const n = Number(out[key]);
      if (!Number.isFinite(n)) throw new Error(`„${key}“ muss eine Zahl sein`);
      if (spec.min !== undefined && n < spec.min) throw new Error(`„${key}“ muss mindestens ${spec.min} sein`);
      out[key] = n;
    }
  }
  return out;
}

export async function execute(
  id: string,
  params: Record<string, any> = {},
  opts: { source?: CommandSource } = {},
): Promise<boolean> {
  const cmd = registry.get(id);
  const app = useApp.getState();
  if (!cmd) {
    app.toast("error", `Unbekannter Befehl: ${id}`);
    return false;
  }
  const ctx = context(opts.source ?? "user");
  // isEnabled describes the selection-driven UI state; explicit params (AI, scripts) bypass it.
  if (cmd.isEnabled && Object.keys(params).length === 0 && !cmd.isEnabled(ctx)) return false;
  try {
    const p = withDefaults(cmd.params, params);
    if (cmd.kind === "action") {
      await cmd.perform(p, ctx);
      return true;
    }
    const res = cmd.apply(ctx.doc, p, ctx);
    if (!res) return false;
    app.commit({
      commandId: cmd.id,
      label: res.label ?? cmd.label,
      icon: cmd.icon,
      source: ctx.source,
      doc: res.doc,
      selection: res.selection ?? ctx.selection,
    });
    return true;
  } catch (e) {
    app.toast("error", e instanceof Error ? e.message : String(e));
    return false;
  }
}

/** JSON-Schema view of a command, ready to be handed to an LLM as a tool definition. */
export function toToolDefinition(cmd: Command) {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, spec] of Object.entries(cmd.params)) {
    const base = { description: spec.description + ("unit" in spec && spec.unit ? ` (${spec.unit})` : "") };
    properties[key] =
      spec.type === "vec3"
        ? { ...base, type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 }
        : spec.type === "ids"
          ? { ...base, type: "array", items: { type: "string" } }
          : spec.type === "id"
            ? { ...base, type: "string" }
            : spec.type === "enum"
              ? { ...base, type: "string", enum: spec.options }
              : { ...base, type: spec.type };
    if (!spec.optional && !("default" in spec && spec.default !== undefined)) required.push(key);
  }
  return {
    name: cmd.id,
    description: cmd.description,
    input_schema: { type: "object", properties, required },
  };
}

// ── Keyboard shortcuts ───────────────────────────────────────────────────────

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Keycap labels for a shortcut, e.g. "shift+mod+z" → ["⇧", "⌘", "Z"] (Mac) or ["Umschalt", "Strg", "Z"]. */
export function shortcutKeys(s: string): string[] {
  const names: Record<string, string> = isMac
    ? { mod: "⌘", shift: "⇧", alt: "⌥", delete: "⌫", escape: "esc" }
    : { mod: "Strg", shift: "Umschalt", alt: "Alt", delete: "Entf", escape: "Esc" };
  return s.split("+").map((k) => names[k] ?? k.toUpperCase());
}

export function formatShortcut(s: string): string {
  return s
    .split("+")
    .map((k) =>
      k === "mod" ? (isMac ? "⌘" : "Strg") : k === "shift" ? (isMac ? "⇧" : "Umschalt") : k === "delete" ? "Entf" : k.toUpperCase(),
    )
    .join(isMac ? "" : "+");
}

function eventShortcut(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.shiftKey) parts.push("shift");
  if (isMac ? e.metaKey : e.ctrlKey) parts.push("mod");
  let key = e.key.toLowerCase();
  if (key === "backspace") key = "delete";
  parts.push(key);
  return parts.join("+");
}

export function installShortcuts(): () => void {
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea, [contenteditable=true]")) return;
    const combo = eventShortcut(e);
    for (const cmd of registry.values()) {
      if (cmd.shortcut === combo) {
        e.preventDefault();
        void execute(cmd.id);
        return;
      }
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}

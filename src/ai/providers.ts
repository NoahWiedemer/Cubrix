import type { Effort } from "./models";

// Provider adapters (Anthropic Messages API, OpenAI Chat Completions) over a
// pluggable transport. The real transport goes through the Rust backend, which
// holds the API key; tests use a mock.

export type Provider = "anthropic" | "openai";

export type Block =
  | { type: "text"; text: string }
  // Anthropic thinking blocks must be sent back unchanged on later turns.
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "redacted_thinking"; data: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; image?: string; isError?: boolean };

export interface Message {
  role: "user" | "assistant";
  content: Block[];
}

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface Transport {
  /** Streams a request; resolves when the stream ends. `onChunk` gets raw SSE text. */
  stream(provider: Provider, body: unknown, onChunk: (text: string) => void, signal: AbortSignal): Promise<void>;
}

export interface TurnResult {
  blocks: Block[];
  stop: "tool_use" | "end";
}

/** Splits SSE text into JSON payloads of `data:` lines (handles chunk boundaries). */
export function sseParser(onEvent: (data: Record<string, unknown>) => void) {
  let buffer = "";
  return (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        onEvent(JSON.parse(payload));
      } catch {
        /* ignore keep-alives / partial garbage */
      }
    }
  };
}

// ── Anthropic ────────────────────────────────────────────────────────────────

function anthropicMessages(messages: Message[]) {
  return messages.map((m) => ({
    role: m.role,
    content: m.content.map((b) => {
      if (b.type !== "tool_result") return b;
      const content: unknown[] = [{ type: "text", text: b.content }];
      if (b.image) content.unshift({ type: "image", source: { type: "base64", media_type: "image/png", data: b.image } });
      return { type: "tool_result", tool_use_id: b.tool_use_id, content, is_error: b.isError || undefined };
    }),
  }));
}

async function anthropicTurn(
  t: Transport, model: string, effort: Effort | null, system: string, tools: ToolSpec[], messages: Message[], onText: (d: string) => void, signal: AbortSignal,
): Promise<TurnResult> {
  const blocks: Block[] = [];
  const json: Record<number, string> = {};
  let stop: TurnResult["stop"] = "end";
  const parse = sseParser((e) => {
    const type = e.type as string;
    if (type === "content_block_start") {
      const b = e.content_block as { type: string; id?: string; name?: string; text?: string };
      const i = e.index as number;
      if (b.type === "tool_use") {
        blocks[i] = { type: "tool_use", id: b.id!, name: b.name!, input: {} };
        json[i] = "";
      } else if (b.type === "thinking") {
        const t = b as { thinking?: string; signature?: string };
        blocks[i] = { type: "thinking", thinking: t.thinking ?? "", signature: t.signature ?? "" };
      } else if (b.type === "redacted_thinking") {
        blocks[i] = { type: "redacted_thinking", data: (b as { data?: string }).data ?? "" };
      } else blocks[i] = { type: "text", text: b.text ?? "" };
    } else if (type === "content_block_delta") {
      const i = e.index as number;
      const d = e.delta as { type: string; text?: string; partial_json?: string; thinking?: string; signature?: string };
      const cur = blocks[i];
      if (d.type === "thinking_delta" && cur?.type === "thinking") cur.thinking += d.thinking ?? "";
      else if (d.type === "signature_delta" && cur?.type === "thinking") cur.signature += d.signature ?? "";
      else if (d.type === "text_delta" && blocks[i]?.type === "text") {
        (blocks[i] as { text: string }).text += d.text ?? "";
        onText(d.text ?? "");
      } else if (d.type === "input_json_delta") json[i] += d.partial_json ?? "";
    } else if (type === "content_block_stop") {
      const i = e.index as number;
      const b = blocks[i];
      if (b?.type === "tool_use") b.input = json[i] ? JSON.parse(json[i]) : {};
    } else if (type === "message_delta") {
      const d = e.delta as { stop_reason?: string };
      if (d.stop_reason === "tool_use") stop = "tool_use";
      if (d.stop_reason === "refusal") throw new Error("Das Modell hat diese Anfrage abgelehnt.");
    } else if (type === "error") {
      throw new Error(((e.error as { message?: string }) ?? {}).message ?? "Fehler des KI-Anbieters");
    }
  });
  await t.stream(
    "anthropic",
    {
      model,
      max_tokens: 16000,
      system,
      tools,
      messages: anthropicMessages(messages),
      stream: true,
      // Thinking is adaptive by default on current models; depth is set via effort.
      ...(effort ? { output_config: { effort } } : {}),
    },
    parse,
    signal,
  );
  return { blocks: blocks.filter(Boolean), stop };
}

// ── OpenAI ───────────────────────────────────────────────────────────────────

function openaiMessages(system: string, messages: Message[]) {
  const out: Record<string, unknown>[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "assistant") {
      const text = m.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
      const calls = m.content.filter((b) => b.type === "tool_use") as Extract<Block, { type: "tool_use" }>[];
      out.push({
        role: "assistant",
        content: text || null,
        tool_calls: calls.length
          ? calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.input) } }))
          : undefined,
      });
      continue;
    }
    const images: string[] = [];
    for (const b of m.content) {
      if (b.type === "tool_result") {
        out.push({ role: "tool", tool_call_id: b.tool_use_id, content: b.content });
        if (b.image) images.push(b.image);
      } else if (b.type === "text") out.push({ role: "user", content: b.text });
    }
    if (images.length)
      out.push({
        role: "user",
        content: [
          { type: "text", text: "Screenshot des Viewports:" },
          ...images.map((d) => ({ type: "image_url", image_url: { url: `data:image/png;base64,${d}` } })),
        ],
      });
  }
  return out;
}

async function openaiTurn(
  t: Transport, model: string, effort: Effort | null, system: string, tools: ToolSpec[], messages: Message[], onText: (d: string) => void, signal: AbortSignal,
): Promise<TurnResult> {
  let text = "";
  const calls: { id: string; name: string; args: string }[] = [];
  let stop: TurnResult["stop"] = "end";
  const parse = sseParser((e) => {
    const choice = (e.choices as { delta?: Record<string, unknown>; finish_reason?: string }[] | undefined)?.[0];
    if (!choice) return;
    const d = choice.delta ?? {};
    if (typeof d.content === "string") {
      text += d.content;
      onText(d.content);
    }
    for (const c of (d.tool_calls as { index: number; id?: string; function?: { name?: string; arguments?: string } }[]) ?? []) {
      const slot = (calls[c.index] ??= { id: "", name: "", args: "" });
      if (c.id) slot.id = c.id;
      if (c.function?.name) slot.name += c.function.name;
      if (c.function?.arguments) slot.args += c.function.arguments;
    }
    if (choice.finish_reason === "tool_calls") stop = "tool_use";
  });
  await t.stream(
    "openai",
    {
      model,
      stream: true,
      ...(effort ? { reasoning_effort: effort } : {}),
      messages: openaiMessages(system, messages),
      tools: tools.map((x) => ({ type: "function", function: { name: x.name, description: x.description, parameters: x.input_schema } })),
    },
    parse,
    signal,
  );
  const blocks: Block[] = [];
  if (text) blocks.push({ type: "text", text });
  for (const c of calls.filter(Boolean))
    blocks.push({ type: "tool_use", id: c.id, name: c.name, input: c.args ? JSON.parse(c.args) : {} });
  return { blocks, stop: calls.length ? "tool_use" : stop };
}

export function runTurn(
  provider: Provider, t: Transport, model: string, effort: Effort | null, system: string, tools: ToolSpec[], messages: Message[],
  onText: (d: string) => void, signal: AbortSignal,
): Promise<TurnResult> {
  return (provider === "anthropic" ? anthropicTurn : openaiTurn)(t, model, effort, system, tools, messages, onText, signal);
}

// ── Tauri transport ──────────────────────────────────────────────────────────

export const tauriTransport: Transport = {
  async stream(provider, body, onChunk, signal) {
    const { invoke, Channel } = await import("@tauri-apps/api/core");
    const requestId = Math.random().toString(36).slice(2);
    const channel = new Channel<string>();
    channel.onmessage = onChunk;
    const abort = () => void invoke("ai_cancel", { requestId });
    signal.addEventListener("abort", abort);
    try {
      await invoke("ai_stream", { requestId, provider, body, onChunk: channel });
    } finally {
      signal.removeEventListener("abort", abort);
    }
  },
};

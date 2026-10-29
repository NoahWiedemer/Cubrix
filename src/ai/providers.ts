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
  // Raw OpenAI Responses output item (reasoning, message, function_call), replayed unchanged.
  | { type: "openai_item"; item: Record<string, unknown> }
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
  return messages.filter((m) => m.content.some((b) => b.type !== "openai_item")).map((m) => ({
    role: m.role,
    content: m.content.filter((b) => b.type !== "openai_item").map((b) => {
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
      if (b?.type === "tool_use") {
        try {
          b.input = json[i] ? JSON.parse(json[i]) : {};
        } catch {
          delete blocks[i]; // cut off by the token limit; never send a half call
        }
      }
    } else if (type === "message_delta") {
      const d = e.delta as { stop_reason?: string };
      if (d.stop_reason === "tool_use") stop = "tool_use";
      if (d.stop_reason === "max_tokens") stop = "end";
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
  const kept = blocks.filter(Boolean);
  // Calls cut off by the token limit are not run (and not sent back).
  if ((stop as TurnResult["stop"]) === "tool_use" && !kept.some((b) => b.type === "tool_use")) stop = "end";
  return { blocks: kept, stop };
}

// ── OpenAI (Responses API) ───────────────────────────────────────────────────

/** Input items for /v1/responses. Output items of earlier turns (reasoning, function calls) are passed back as-is. */
function openaiInput(messages: Message[]) {
  const input: unknown[] = [];
  for (const m of messages) {
    if (m.role === "assistant") {
      const native = m.content.some((x) => x.type === "openai_item");
      for (const b of m.content) {
        if (b.type === "openai_item") input.push(b.item);
        else if (native) continue;
        // History from the other provider (after switching): rebuild the items.
        else if (b.type === "text") input.push({ role: "assistant", content: b.text });
        else if (b.type === "tool_use") input.push({ type: "function_call", call_id: b.id, name: b.name, arguments: JSON.stringify(b.input) });
      }
      continue;
    }
    const images: string[] = [];
    for (const b of m.content) {
      if (b.type === "tool_result") {
        input.push({ type: "function_call_output", call_id: b.tool_use_id, output: b.content });
        if (b.image) images.push(b.image);
      } else if (b.type === "text") input.push({ role: "user", content: b.text });
    }
    if (images.length)
      input.push({
        role: "user",
        content: [
          { type: "input_text", text: "Screenshot des Viewports:" },
          ...images.map((d) => ({ type: "input_image", image_url: `data:image/png;base64,${d}` })),
        ],
      });
  }
  return input;
}

async function openaiTurn(
  t: Transport, model: string, effort: Effort | null, system: string, tools: ToolSpec[], messages: Message[], onText: (d: string) => void, signal: AbortSignal,
): Promise<TurnResult> {
  const items: Record<string, unknown>[] = [];
  let finalOutput: Record<string, unknown>[] | null = null;
  const parse = sseParser((e) => {
    const type = e.type as string;
    if (type === "response.output_text.delta") onText((e.delta as string) ?? "");
    else if (type === "response.output_item.done") items.push(e.item as Record<string, unknown>);
    else if (type === "response.completed") finalOutput = ((e.response as { output?: Record<string, unknown>[] }) ?? {}).output ?? null;
    else if (type === "response.failed" || type === "error") {
      const err = (e.response as { error?: { message?: string } } | undefined)?.error ?? (e.error as { message?: string } | undefined) ?? (e as { message?: string });
      throw new Error(err?.message ?? "Fehler des KI-Anbieters");
    }
  });
  await t.stream(
    "openai",
    {
      model,
      stream: true,
      instructions: system,
      input: openaiInput(messages),
      tools: tools.map((x) => ({ type: "function", name: x.name, description: x.description, parameters: x.input_schema })),
      ...(effort ? { reasoning: { effort } } : {}),
    },
    parse,
    signal,
  );
  const output: Record<string, unknown>[] = finalOutput ?? items;
  const blocks: Block[] = [];
  let calls = 0;
  for (const item of output) {
    blocks.push({ type: "openai_item", item });
    if (item.type === "message") {
      const text = ((item.content as { type: string; text?: string }[]) ?? []).filter((c) => c.type === "output_text").map((c) => c.text ?? "").join("");
      if (text) blocks.push({ type: "text", text });
    } else if (item.type === "function_call") {
      calls++;
      let input: Record<string, unknown> = {};
      try {
        input = item.arguments ? JSON.parse(item.arguments as string) : {};
      } catch {
        input = { _invalid: String(item.arguments).slice(0, 200) };
      }
      blocks.push({ type: "tool_use", id: item.call_id as string, name: item.name as string, input });
    }
  }
  return { blocks, stop: calls ? "tool_use" : "end" };
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

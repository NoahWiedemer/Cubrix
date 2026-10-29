import { describe, expect, it } from "vitest";
import "../src/core/commandDefs";
import { prepareHistory, runAgent } from "../src/ai/agent";
import type { Message, Transport } from "../src/ai/providers";
import { getDoc, useApp } from "../src/core/store";

const sse = (events: unknown[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");

/** Fake provider: first answer calls primitive.box, second answers with text. */
function anthropicMock(): Transport & { bodies: any[] } {
  const bodies: any[] = [];
  return {
    bodies,
    async stream(_p, body, onChunk) {
      bodies.push(body);
      if (bodies.length === 1) {
        const json = JSON.stringify({ width: 40, depth: 30, height: 10, name: "Platte" });
        // Deliberately split across chunks to exercise the SSE parser.
        const text = sse([
          { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Ich baue eine Platte." } },
          { type: "content_block_stop", index: 0 },
          { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t1", name: "primitive__box" } },
          { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: json.slice(0, 10) } },
          { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: json.slice(10) } },
          { type: "content_block_stop", index: 1 },
          { type: "message_delta", delta: { stop_reason: "tool_use" } },
        ]);
        onChunk(text.slice(0, 50));
        onChunk(text.slice(50));
      } else {
        onChunk(
          sse([
            { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
            { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Fertig!" } },
            { type: "message_delta", delta: { stop_reason: "end_turn" } },
          ]),
        );
      }
    },
  };
}

describe("KI-Agent (gemockter Anbieter)", () => {
  it("führt Werkzeugaufrufe als KI-Schritte im Verlauf aus", async () => {
    const t = anthropicMock();
    let text = "";
    const steps: string[] = [];
    const messages = await runAgent({
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      transport: t,
      history: [],
      prompt: "Bau mir eine Platte 40 × 30 × 10",
      signal: new AbortController().signal,
      events: { onText: (d) => (text += d), onStep: (s) => steps.push(s.label) },
    });
    const plate = getDoc().features.find((f) => f.name === "Platte");
    expect(plate).toMatchObject({ type: "box", params: { width: 40, depth: 30, height: 10 } });
    const node = useApp.getState().nodes[useApp.getState().currentId];
    expect(node.source).toBe("ai");
    expect(node.group?.prompt).toBe("Bau mir eine Platte 40 × 30 × 10");
    expect(text).toBe("Ich baue eine Platte.Fertig!");
    expect(steps).toEqual(["Platte hinzufügen"]);
    expect(messages.at(-1)?.role).toBe("assistant");
    // Tool names never contain dots (provider requirement).
    expect(t.bodies[0].tools.every((x: { name: string }) => /^[a-zA-Z0-9_-]+$/.test(x.name))).toBe(true);
    // The tool result is sent back on the second request.
    expect(JSON.stringify(t.bodies[1].messages)).toContain("tool_result");
  });

  it("spricht die OpenAI Responses API (function_call / function_call_output)", async () => {
    const bodies: any[] = [];
    const t: Transport = {
      async stream(_p, body, onChunk) {
        bodies.push(body);
        if (bodies.length === 1) {
          const reasoning = { type: "reasoning", id: "rs_1", summary: [] };
          const call = { type: "function_call", id: "fc_1", call_id: "call_1", name: "primitive__cylinder", arguments: '{"diameter":12,"height":5}' };
          onChunk(
            sse([
              { type: "response.output_item.done", item: reasoning },
              { type: "response.output_item.added", item: { ...call, arguments: "" } },
              { type: "response.function_call_arguments.delta", delta: '{"diameter":12,' },
              { type: "response.output_item.done", item: call },
              { type: "response.completed", response: { output: [reasoning, call] } },
            ]),
          );
        } else
          onChunk(
            sse([
              { type: "response.output_text.delta", delta: "Erledigt." },
              { type: "response.completed", response: { output: [{ type: "message", content: [{ type: "output_text", text: "Erledigt." }] }] } },
            ]),
          );
      },
    };
    await runAgent({
      provider: "openai", model: "gpt-6.1-terra", effort: "medium", transport: t, history: [], prompt: "Zylinder",
      signal: new AbortController().signal, events: { onText: () => {}, onStep: () => {} },
    });
    expect(getDoc().features.some((f) => f.type === "cylinder" && f.params.diameter === 12)).toBe(true);
    expect(bodies[0].model).toBe("gpt-6.1-terra");
    expect(bodies[0].reasoning).toEqual({ effort: "medium" });
    expect(bodies[0].tools[0]).toMatchObject({ type: "function", name: expect.any(String), parameters: expect.any(Object) });
    // Second request replays reasoning + call and adds the output.
    const input = bodies[1].input;
    expect(input.map((i: any) => i.type ?? i.role)).toEqual(["user", "reasoning", "function_call", "function_call_output"]);
    expect(input[3].call_id).toBe("call_1");
  });
});

describe("Denktiefe und Thinking-Blöcke", () => {
  it("sendet output_config.effort an Anthropic und gibt Thinking-Blöcke unverändert zurück", async () => {
    const bodies: any[] = [];
    const t: Transport = {
      async stream(_p, body, onChunk) {
        bodies.push(body);
        if (bodies.length === 1)
          onChunk(
            sse([
              { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
              { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig-123" } },
              { type: "content_block_stop", index: 0 },
              { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t9", name: "get_model" } },
              { type: "content_block_stop", index: 1 },
              { type: "message_delta", delta: { stop_reason: "tool_use" } },
            ]),
          );
        else onChunk(sse([{ type: "message_delta", delta: { stop_reason: "end_turn" } }]));
      },
    };
    await runAgent({
      provider: "anthropic", model: "claude-opus-5-5", effort: "high", transport: t, history: [], prompt: "x",
      signal: new AbortController().signal, events: { onText: () => {}, onStep: () => {} },
    });
    expect(bodies[0].output_config).toEqual({ effort: "high" });
    expect(bodies[0].thinking).toBeUndefined();
    const assistant = bodies[1].messages.find((m: any) => m.role === "assistant");
    expect(assistant.content[0]).toEqual({ type: "thinking", thinking: "", signature: "sig-123" });
  });

  it("sendet reasoning.effort an OpenAI und lässt es ohne Unterstützung weg", async () => {
    const bodies: any[] = [];
    const t: Transport = {
      async stream(_p, body, onChunk) {
        bodies.push(body);
        onChunk(sse([{ type: "response.completed", response: { output: [] } }]));
      },
    };
    const base = { provider: "openai" as const, model: "gpt-6.1-sol", transport: t, history: [], prompt: "x", signal: new AbortController().signal, events: { onText: () => {}, onStep: () => {} } };
    await runAgent({ ...base, effort: "low" });
    await runAgent({ ...base, effort: null });
    expect(bodies[0].reasoning).toEqual({ effort: "low" });
    expect("reasoning" in bodies[1]).toBe(false);
  });

  it("jeder Eintrag der Modellauswahl sendet seine eigene ID", async () => {
    const { CATALOG, modelInfo } = await import("../src/ai/models");
    for (const provider of ["anthropic", "openai"] as const)
      for (const m of CATALOG[provider]) {
        let sent = "";
        const t: Transport = {
          async stream(_p, body: any, onChunk) {
            sent = body.model;
            onChunk(provider === "openai" ? sse([{ type: "response.completed", response: { output: [] } }]) : sse([{ type: "message_delta", delta: { stop_reason: "end_turn" } }]));
          },
        };
        const info = modelInfo(provider, m.id);
        await runAgent({ provider, model: info.id, effort: info.effort ? "medium" : null, transport: t, history: [], prompt: "x", signal: new AbortController().signal, events: { onText: () => {}, onStep: () => {} } });
        expect(sent).toBe(m.id);
      }
  });
});

describe("KI und Auswahl", () => {
  it("lässt die Auswahl des Nutzers bei KI-Schritten unverändert", async () => {
    const first = getDoc().features[0].id;
    useApp.setState({ selection: [first] });
    const t: Transport = {
      async stream(_p, _body, onChunk) {
        onChunk(
          sse([
            { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "s1", name: "primitive__sphere" } },
            { type: "content_block_stop", index: 0 },
            { type: "message_delta", delta: { stop_reason: "end_turn" } },
          ]),
        );
      },
    };
    // The single tool call runs; a second turn is not needed because stop_reason is end_turn.
    await runAgent({ provider: "anthropic", model: "claude-sonnet-5-5", transport: t, history: [], prompt: "Kugel", signal: new AbortController().signal, events: { onText: () => {}, onStep: () => {} } });
    const { execute } = await import("../src/core/commands");
    await execute("primitive.cylinder", {}, { source: "ai" });
    expect(useApp.getState().selection).toEqual([first]);
  });
});

describe("Verlauf für die API (keine verwaisten Tool-Aufrufe)", () => {
  const prompt = (text: string): Message => ({ role: "user", content: [{ type: "text", text }] });
  const call = (id: string): Message => ({ role: "assistant", content: [{ type: "tool_use", id, name: "get_model", input: {} }] });
  const answer = (id: string): Message => ({ role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "{}" }] });

  it("schließt Aufrufe ohne Ergebnis (gestoppter Lauf) und entfernt verwaiste Ergebnisse", () => {
    const h = prepareHistory([prompt("a"), call("x"), prompt("b"), answer("zzz"), prompt("c")]);
    // x gets a synthetic error result right after the call; the orphan result for zzz is gone.
    expect(h[2].content[0]).toMatchObject({ type: "tool_result", tool_use_id: "x", isError: true });
    expect(JSON.stringify(h)).not.toContain("zzz");
    for (let i = 0; i < h.length; i++) {
      const ids = h[i].content.filter((b) => b.type === "tool_use").map((b: any) => b.id);
      if (ids.length) expect(h[i + 1].content.filter((b) => b.type === "tool_result").map((b: any) => b.tool_use_id)).toEqual(ids);
    }
  });

  it("behält nur die letzten 20 Nutzer-Runden, an Rundengrenzen geschnitten", () => {
    const long: Message[] = [];
    for (let i = 0; i < 30; i++) long.push(prompt(`p${i}`), call(`c${i}`), answer(`c${i}`), { role: "assistant", content: [{ type: "text", text: "ok" }] });
    const h = prepareHistory(long);
    expect(h.filter((m) => m.role === "user" && m.content.some((b) => b.type === "text")).length).toBe(20);
    expect(h[0]).toEqual(prompt("p10"));
  });

  it("baut Anthropic-Aufrufe beim Wechsel zu OpenAI als function_call nach", async () => {
    const bodies: any[] = [];
    const t: Transport = {
      async stream(_p, body, onChunk) {
        bodies.push(body);
        onChunk(sse([{ type: "response.completed", response: { output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }] } }]));
      },
    };
    await runAgent({ provider: "openai", model: "m", transport: t, history: [prompt("a"), call("x"), answer("x")], prompt: "b", signal: new AbortController().signal, events: { onText() {}, onStep() {} } });
    const input = bodies[0].input as any[];
    const fc = input.findIndex((i) => i.type === "function_call" && i.call_id === "x");
    const out = input.findIndex((i) => i.type === "function_call_output" && i.call_id === "x");
    expect(fc).toBeGreaterThanOrEqual(0);
    expect(out).toBeGreaterThan(fc);
  });
});

describe("Modellwechsel mitten im Chat", () => {
  const prompt = (text: string): Message => ({ role: "user", content: [{ type: "text", text }] });
  const capture = () => {
    const bodies: any[] = [];
    const t: Transport = {
      async stream(p, body, onChunk) {
        bodies.push(body);
        onChunk(
          p === "anthropic"
            ? sse([
                { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
                { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
                { type: "message_delta", delta: { stop_reason: "end_turn" } },
              ])
            : sse([{ type: "response.completed", response: { output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }] } }]),
        );
      },
    };
    return { t, bodies };
  };
  const run = (provider: "anthropic" | "openai", model: string, history: Message[], t: Transport) =>
    runAgent({ provider, model, transport: t, history, prompt: "weiter", signal: new AbortController().signal, events: { onText() {}, onStep() {} } });

  it("OpenAI → Anthropic: function_call wird zu tool_use mit passendem tool_result", async () => {
    const history: Message[] = [
      prompt("a"),
      {
        role: "assistant",
        model: "gpt-6.1-terra",
        content: [
          { type: "openai_item", item: { type: "reasoning", id: "rs_1", summary: [] } },
          { type: "openai_item", item: { type: "function_call", call_id: "c1", name: "get_model", arguments: "{}" } },
          { type: "tool_use", id: "c1", name: "get_model", input: {} },
        ],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "{}" }] },
    ];
    const { t, bodies } = capture();
    await run("anthropic", "claude-sonnet-5-5", history, t);
    const msgs = bodies[0].messages as any[];
    expect(JSON.stringify(msgs)).not.toContain("openai_item");
    const i = msgs.findIndex((m) => m.content.some((b: any) => b.type === "tool_use" && b.id === "c1"));
    expect(msgs[i + 1].content.some((b: any) => b.type === "tool_result" && b.tool_use_id === "c1")).toBe(true);
  });

  it("Anthropic-Thinking geht nur an dasselbe Modell zurück", async () => {
    const history: Message[] = [
      prompt("a"),
      { role: "assistant", model: "claude-opus-5-5", content: [{ type: "thinking", thinking: "…", signature: "sig" }, { type: "text", text: "hi" }] },
    ];
    const same = capture();
    await run("anthropic", "claude-opus-5-5", history, same.t);
    expect(JSON.stringify(same.bodies[0].messages)).toContain("thinking");
    const other = capture();
    await run("anthropic", "claude-sonnet-5-5", history, other.t);
    expect(JSON.stringify(other.bodies[0].messages)).not.toContain('"thinking"');
  });
});

describe("Websuche (Server-Werkzeug)", () => {
  it("Anthropic: Suche, Pause, Fortsetzung; Blöcke werden unverändert zurückgegeben", async () => {
    const bodies: any[] = [];
    const t: Transport = {
      async stream(_p, body, onChunk) {
        bodies.push(body);
        if (bodies.length === 1)
          onChunk(
            sse([
              { type: "content_block_start", index: 0, content_block: { type: "server_tool_use", id: "srv1", name: "web_search" } },
              { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"query":"Raspberry Pi 5 Maße"}' } },
              { type: "content_block_stop", index: 0 },
              { type: "content_block_start", index: 1, content_block: { type: "web_search_tool_result", tool_use_id: "srv1", content: [{ type: "web_search_result", url: "https://example.org/pi5", title: "Pi 5 Datenblatt" }] } },
              { type: "content_block_stop", index: 1 },
              { type: "message_delta", delta: { stop_reason: "pause_turn" } },
            ]),
          );
        else
          onChunk(
            sse([
              { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
              { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "85 × 56 mm" } },
              { type: "message_delta", delta: { stop_reason: "end_turn" } },
            ]),
          );
      },
    };
    const steps: string[] = [];
    let sources: { url: string }[] = [];
    const out = await runAgent({
      provider: "anthropic", model: "claude-sonnet-5-5", transport: t, history: [], prompt: "Case für den Pi", webSearch: true,
      signal: new AbortController().signal, events: { onText() {}, onStep: (s) => steps.push(s.label), onSources: (s) => (sources = s) },
    });
    expect(bodies[0].tools.some((x: any) => x.type === "web_search_20260209" && x.max_uses === 3)).toBe(true);
    expect(steps).toContain("Sucht im Web: Raspberry Pi 5 Maße");
    expect(sources[0].url).toBe("https://example.org/pi5");
    // The paused turn is continued with the server-tool blocks replayed as they came.
    const replay = JSON.stringify(bodies[1].messages);
    expect(replay).toContain('"type":"server_tool_use"');
    expect(replay).toContain('"type":"web_search_tool_result"');
    expect(replay).not.toContain("anthropic_raw");
    // Switching to OpenAI drops the Anthropic server-tool blocks cleanly.
    const o: any[] = [];
    const ot: Transport = { async stream(_p, body, onChunk) { o.push(body); onChunk(sse([{ type: "response.completed", response: { output: [] } }])); } };
    await runAgent({ provider: "openai", model: "gpt-6.1-terra", transport: ot, history: out, prompt: "weiter", webSearch: true, signal: new AbortController().signal, events: { onText() {}, onStep() {} } });
    expect(JSON.stringify(o[0].input)).not.toContain("server_tool_use");
    expect(o[0].tools.some((x: any) => x.type === "web_search")).toBe(true);
  });
});

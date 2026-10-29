import { describe, expect, it } from "vitest";
import "../src/core/commandDefs";
import { runAgent } from "../src/ai/agent";
import type { Transport } from "../src/ai/providers";
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

  it("spricht auch das OpenAI-Format", async () => {
    let n = 0;
    const t: Transport = {
      async stream(_p, _body, onChunk) {
        n++;
        if (n === 1)
          onChunk(
            sse([
              { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "primitive__cylinder", arguments: '{"diameter":' } }] } }] },
              { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '12,"height":5}' } }] } }] },
              { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
            ]) + "data: [DONE]\n\n",
          );
        else onChunk(sse([{ choices: [{ delta: { content: "Erledigt." }, finish_reason: "stop" }] }]));
      },
    };
    await runAgent({
      provider: "openai", model: "test", transport: t, history: [], prompt: "Zylinder",
      signal: new AbortController().signal, events: { onText: () => {}, onStep: () => {} },
    });
    expect(getDoc().features.some((f) => f.type === "cylinder" && f.params.diameter === 12)).toBe(true);
  });
});

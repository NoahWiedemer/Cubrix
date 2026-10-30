import { describe, expect, it } from "vitest";
import { runAgent } from "../src/ai/agent";
import { capEntryImages, fitSize, limitImages, splitDataUrl } from "../src/ai/images";
import { runTurn, type Message, type Transport } from "../src/ai/providers";
import { parseProject, serializeProject } from "../src/core/projectFile";
import { createDocument } from "../src/core/document";

const url = (n: number) => `data:image/jpeg;base64,${"A".repeat(n)}`;
const capture = () => {
  const bodies: Record<string, any>[] = [];
  const t: Transport = { async stream(_p, b) { bodies.push(b as Record<string, any>); } };
  return { t, bodies };
};
const msg: Message[] = [{ role: "user", content: [{ type: "text", text: "Bau das" }, { type: "image", url: url(8) }, { type: "image", url: url(4) }] }];

describe("Bilder im KI-Chat", () => {
  it("skaliert auf höchstens 1568 px, ohne zu vergrößern", () => {
    expect(fitSize(4000, 2000)).toEqual([1568, 784]);
    expect(fitSize(800, 600)).toEqual([800, 600]);
    expect(splitDataUrl("data:image/png;base64,QUJD")).toEqual({ media: "image/png", data: "QUJD" });
    expect(() => splitDataUrl("kein bild")).toThrow(/Ungültiges/);
  });
  it("sendet an Anthropic als image-Blöcke", async () => {
    const { t, bodies } = capture();
    await runTurn("anthropic", t, "claude-sonnet-5-5", null, "", [], msg, () => {}, new AbortController().signal);
    const c = bodies[0].messages[0].content;
    expect(c[0]).toEqual({ type: "text", text: "Bau das" });
    expect(c[1]).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAAAAAAA" } });
    expect(c).toHaveLength(3);
  });
  it("sendet an OpenAI als input_image in einer Nachricht", async () => {
    const { t, bodies } = capture();
    await runTurn("openai", t, "gpt-6.1-terra", null, "", [], msg, () => {}, new AbortController().signal);
    const input = bodies[0].input;
    expect(input).toHaveLength(1);
    expect(input[0].content[0]).toEqual({ type: "input_text", text: "Bau das" });
    expect(input[0].content[1]).toEqual({ type: "input_image", image_url: url(8) });
  });
  it("runAgent hängt die Bilder an den Auftrag", async () => {
    const { t, bodies } = capture();
    await runAgent({ provider: "openai", model: "gpt-6.1-terra", transport: t, history: [], prompt: "Hi", images: [url(4)], signal: new AbortController().signal, events: { onText: () => {}, onStep: () => {} } });
    expect(bodies[0].input.at(-1).content.map((c: { type: string }) => c.type)).toEqual(["input_text", "input_image"]);
  });
  it("ersetzt ältere Bilder im Verlauf durch einen Platzhalter", () => {
    const history: Message[] = [0, 1, 2, 3, 4, 5].map((i) => ({ role: "user", content: [{ type: "text", text: `T${i}` }, { type: "image", url: url(i + 1) }] }));
    const out = limitImages(history, 4);
    const kinds = out.map((m) => m.content[1].type);
    expect(kinds).toEqual(["text", "text", "image", "image", "image", "image"]);
    expect(history[0].content[1].type).toBe("image"); // the original stays untouched
  });
  it("speichert Bilder im Projekt nur bis zum Limit, die neuesten zuerst", () => {
    const entries = [{ images: [url(100)] }, { images: [url(100)] }, { images: [url(10)] }];
    const out = capEntryImages(entries, 200);
    expect(out[0].images).toBeUndefined();
    expect(out[1].images).toHaveLength(1);
    expect(out[2].images).toHaveLength(1);
    const text = serializeProject({
      document: createDocument("T"),
      history: { rootId: "r", currentId: "r", nodes: { r: { id: "r", parentId: null, childIds: [], activeChildId: null, commandId: "file.new", label: "", icon: "file", time: 0, source: "user", doc: createDocument("T"), selection: [] } } } as never,
      chat: { entries: [{ role: "user", text: "Hi", steps: [], images: [url(8)] }] as never, api: [] },
      selection: [],
    } as never);
    expect((parseProject(text).file.chat.entries[0] as { images?: string[] }).images).toEqual([url(8)]);
  });
});

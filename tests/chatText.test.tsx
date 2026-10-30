import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatMarkdown } from "../src/components/ChatMarkdown";
import { cleanModelText } from "../src/ai/cleanText";
import { runAgent } from "../src/ai/agent";
import type { Transport } from "../src/ai/providers";

const OPEN = "\uE200";
const SEP = "\uE202";
const CLOSE = "\uE201";

describe("Modelltext aufräumen", () => {
  it("entfernt Zitat-Marker vollständig", () => {
    expect(cleanModelText(`Das Board misst 54 mm ${OPEN}cite${SEP}turn0search14${SEP}turn0search0${CLOSE}.`)).toBe("Das Board misst 54 mm.");
    expect(cleanModelText(`Maß ${OPEN}citeturn0search14turn0search0${CLOSE} passt`)).toBe("Maß passt");
    expect(cleanModelText(`Nur Reste ${OPEN}cite turn0search1`)).toBe("Nur Reste ");
    expect(cleanModelText(`\uE203citeturn1search2\uE204 danach`)).toBe("danach");
  });
  it("lässt normalen Text in Ruhe", () => {
    const t = "Bitte cite im Text, turn0 bleibt, 4 , 5 und  doppelte Leerzeichen.";
    expect(cleanModelText(t)).toBe(t);
  });
  it("vereinheitlicht Bindestriche und schmale Leerzeichen", () => {
    expect(cleanModelText("ESP32\u2011DevKitC und Micro\u2010USB, 54\u202Fmm")).toBe("ESP32-DevKitC und Micro-USB, 54 mm");
  });
});

describe("Markdown", () => {
  it("rendert alle Grundformen, ohne Marker", () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown text={`## Plan\n\n**Fett** und *kursiv*, \`code\` ${OPEN}cite${SEP}turn0search1${CLOSE}\n\n1. Eins\n2. Zwei\n\n- Punkt\n\nAbsatz\u2011Text\n\n\`\`\`\nblock\n\`\`\``} />,
    );
    for (const tag of ["<h2>", "<strong>Fett</strong>", "<em>kursiv</em>", "<code>code</code>", "<ol>", "<ul>", "<pre>"]) expect(html).toContain(tag);
    expect(html).toContain("Absatz-Text");
    expect(html).not.toContain("turn0");
    expect(html).not.toContain(OPEN);
  });
});

describe("Absätze zwischen Schritten", () => {
  it("trennt Text vor und nach Werkzeugen", async () => {
    let call = 0;
    const replies = [
      [{ type: "response.output_text.delta", delta: "Ich sehe nach." }, { type: "response.output_item.done", item: { type: "function_call", call_id: "1", name: "list_commands", arguments: "{}" } }],
      [{ type: "response.output_text.delta", delta: "Fertig!" }, { type: "response.output_item.done", item: { type: "message", content: [{ type: "output_text", text: "Fertig!" }] } }],
    ];
    const transport: Transport = {
      async stream(_p, _b, onChunk) {
        for (const e of replies[call]) onChunk(`data: ${JSON.stringify(e)}\n\n`);
        call++;
      },
    };
    let text = "";
    await runAgent({ provider: "openai", model: "gpt-6.1-terra", transport, history: [], prompt: "Hi", signal: new AbortController().signal, events: { onText: (d) => (text += d), onStep: () => {} } });
    expect(text).toBe("Ich sehe nach.\n\nFertig!");
  });
});

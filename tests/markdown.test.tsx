import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatMarkdown } from "../src/components/ChatMarkdown";

const SAMPLE = `## Plan
**Fett** und *kursiv*, \`code\`.

1. Erstens
   - verschachtelt
2. Zweitens

| Teil | Maß |
| --- | --- |
| Box | 60 mm |

> Zitat

---
[Quelle](https://example.org) <script>alert(1)</script>

\`\`\`
G1 X10
\`\`\``;

describe("Markdown im Chat", () => {
  it("rendert GFM-Elemente und kein rohes HTML", () => {
    const html = renderToStaticMarkup(<ChatMarkdown text={SAMPLE} />);
    for (const tag of ["<h2>", "<strong>", "<em>", "<code>", "<ol>", "<ul>", "<table>", "<blockquote>", "<hr/>", "<pre>", 'href="https://example.org"'])
      expect(html).toContain(tag);
    expect(html).not.toContain("<script");
  });
  it("verträgt unvollständigen Text beim Streamen", () => {
    expect(() => renderToStaticMarkup(<ChatMarkdown text={"**halb fett und | Tabelle"} />)).not.toThrow();
  });
});

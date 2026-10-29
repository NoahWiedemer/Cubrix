// Assistant messages as Markdown (GFM: tables, task lists, strikethrough). No raw HTML.
// Works while streaming: incomplete syntax simply renders as text until it closes.
import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { isTauri } from "../core/platform";

function openExternal(url: string) {
  if (isTauri) void import("@tauri-apps/plugin-opener").then((o) => o.openUrl(url));
  else window.open(url, "_blank", "noopener");
}

const components: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (href && /^https?:\/\//.test(href)) openExternal(href);
      }}
    >
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="md-table">
      <table>{children}</table>
    </div>
  ),
};

export const ChatMarkdown = memo(function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {text}
      </ReactMarkdown>
    </div>
  );
});

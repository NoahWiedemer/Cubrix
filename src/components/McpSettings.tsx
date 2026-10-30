// "MCP" section of the settings: servers with status, tools and the add flow. Secret
// values go straight to Rust; afterwards the UI only ever sees them masked.
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2, X } from "lucide-react";
import { isMac } from "../core/commands";
import { isTauri } from "../core/platform";
import { Icon } from "../ui/icons";
import { SegmentedControl } from "../ui/SegmentedControl";
import { ConnectorSettings } from "./ConnectorSettings";
import { addMcpServer, commandLine, connectMcpServer, parseMcpConfig, refreshMcp, removeMcpServer, updateMcpServer, useMcp, type McpDraft, type McpServer } from "../ai/mcp";

const STATUS: Record<McpServer["status"], string> = { off: "Aus", idle: "Nicht verbunden", connected: "Verbunden", error: "Fehler" };
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Pairs({ label, keyHint, valueHint, rows, onChange }: { label: string; keyHint: string; valueHint: string; rows: [string, string][]; onChange(rows: [string, string][]): void }) {
  const set = (i: number, j: 0 | 1, v: string) => onChange(rows.map((r, k) => (k === i ? ((j ? [r[0], v] : [v, r[1]]) as [string, string]) : r)));
  return (
    <div className="mcp-pairs">
      {rows.map((r, i) => (
        <div className="mcp-pair" key={i}>
          <input className="mcp-input" placeholder={keyHint} value={r[0]} onChange={(e) => set(i, 0, e.target.value)} />
          <input className="mcp-input" type="password" placeholder={valueHint} value={r[1]} onChange={(e) => set(i, 1, e.target.value)} />
          <button className="icon-btn small" aria-label={`${label} entfernen`} onClick={() => onChange(rows.filter((_, k) => k !== i))}><X size={14} /></button>
        </div>
      ))}
      <button className="key-add-btn" onClick={() => onChange([...rows, ["", ""]])}><Plus size={14} />{label}</button>
    </div>
  );
}

/** Splits an argument line like a shell: quotes keep spaces together. */
function splitArgs(text: string) {
  return (text.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((a) => a.replace(/^(["'])(.*)\1$/, "$2"));
}

function AddForm({ onDone }: { onDone(): void }) {
  const [mode, setMode] = useState<"remote" | "stdio" | "json">("remote");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [headers, setHeaders] = useState<[string, string][]>([]);
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [env, setEnv] = useState<[string, string][]>([]);
  const [json, setJson] = useState("");
  const [error, setError] = useState("");
  const [review, setReview] = useState<McpDraft[] | null>(null);

  const add = async (drafts: McpDraft[]) => {
    setError("");
    try {
      for (const d of drafts) {
        // A local command runs only through this path, after the user read it.
        const server = await addMcpServer(d, d.kind === "stdio");
        void connectMcpServer(server.id);
      }
      onDone();
    } catch (e) {
      setReview(null);
      setError(message(e));
    }
  };

  const submit = () => {
    setError("");
    const clean = (rows: [string, string][]) => rows.filter(([k]) => k.trim()).map(([k, v]) => [k.trim(), v] as [string, string]);
    try {
      const drafts: McpDraft[] =
        mode === "json"
          ? parseMcpConfig(json)
          : [
              mode === "remote"
                ? { name, kind: "remote", url, headers: [...clean(headers), ...(token.trim() ? ([["Authorization", `Bearer ${token.trim()}`]] as [string, string][]) : [])], command: "", args: [], env: [] }
                : { name, kind: "stdio", url: "", headers: [], command, args: splitArgs(args), env: clean(env) },
            ];
      if (drafts.some((d) => d.kind === "stdio")) setReview(drafts);
      else void add(drafts);
    } catch (e) {
      setError(message(e));
    }
  };

  if (review) {
    return (
      <div className="mcp-confirm" role="alertdialog" aria-label="Lokalen Server bestätigen">
        <h3><Icon name="warn" size={16} />Dieser Befehl wird auf deinem {isMac ? "Mac" : "Computer"} ausgeführt</h3>
        <p>Er läuft mit deinen Rechten und kann auf deine Dateien zugreifen. Erlaube ihn nur, wenn du der Quelle vertraust.</p>
        {review.filter((d) => d.kind === "stdio").map((d) => (
          <div key={d.name} className="mcp-command">
            <b>{d.name}</b>
            <code>{commandLine(d)}</code>
            {d.env.length > 0 && <span>Umgebung: {d.env.map(([k]) => k).join(", ")}</span>}
          </div>
        ))}
        <div className="props-actions tight">
          <button className="btn-primary" onClick={() => void add(review)}>Erlauben und hinzufügen</button>
          <button className="btn-ghost" onClick={() => setReview(null)}>Abbrechen</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mcp-form">
      <SegmentedControl size="sm" className="block" value={mode} onChange={(m) => setMode(m as typeof mode)}
        options={[{ value: "remote", label: "Remote" }, { value: "stdio", label: "Lokal" }, { value: "json", label: "JSON einfügen" }]} />
      {mode !== "json" && <input className="mcp-input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />}
      {mode === "remote" && (
        <>
          <input className="mcp-input" placeholder="https://example.com/mcp" value={url} onChange={(e) => setUrl(e.target.value)} />
          <input className="mcp-input" type="password" placeholder="Bearer-Token (optional)" value={token} onChange={(e) => setToken(e.target.value)} />
          <Pairs label="Header" keyHint="Name" valueHint="Wert" rows={headers} onChange={setHeaders} />
        </>
      )}
      {mode === "stdio" && (
        <>
          <input className="mcp-input mono" placeholder="Befehl, z. B. npx" value={command} onChange={(e) => setCommand(e.target.value)} />
          <input className="mcp-input mono" placeholder="Argumente, z. B. -y mein-mcp-server" value={args} onChange={(e) => setArgs(e.target.value)} />
          <Pairs label="Umgebungsvariable" keyHint="NAME" valueHint="Wert" rows={env} onChange={setEnv} />
        </>
      )}
      {mode === "json" && (
        <textarea className="mcp-input mono mcp-json" spellCheck={false} placeholder={'{\n  "mcpServers": {\n    "beispiel": { "command": "npx", "args": ["-y", "mein-mcp-server"] }\n  }\n}'} value={json} onChange={(e) => setJson(e.target.value)} />
      )}
      {error && <div className="chat-error">{error}</div>}
      <div className="props-actions tight">
        <button className="btn-primary" onClick={submit}>{mode === "json" ? "Importieren" : "Hinzufügen"}</button>
        <button className="btn-ghost" onClick={onDone}>Abbrechen</button>
      </div>
    </div>
  );
}

function ServerCard({ s }: { s: McpServer }) {
  const busy = useMcp((m) => !!m.busy[s.id]);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const guard = (p: Promise<unknown>) => void p.catch((e) => setError(message(e)));
  const toggleTool = (tool: string, on: boolean) => guard(updateMcpServer(s.id, { disabledTools: on ? s.disabledTools.filter((t) => t !== tool) : [...s.disabledTools, tool] }));
  const active = s.tools.filter((t) => !s.disabledTools.includes(t.name)).length;
  return (
    <div className="mcp-server">
      <div className="mcp-head">
        <span className={`mcp-dot ${busy ? "busy" : s.status}`} />
        <div className="mcp-title">
          <b>{s.name}</b>
          <span>{s.kind === "remote" ? s.urlDisplay : commandLine(s)}</span>
        </div>
        <span className="mcp-status">{busy ? "Verbindet …" : STATUS[s.status]}</span>
        <button className={`switch-btn`} role="switch" aria-checked={s.enabled} aria-label={`${s.name} aktiv`} onClick={() => guard(updateMcpServer(s.id, { enabled: !s.enabled }))}>
          <span className={`switch ${s.enabled ? "on" : ""}`}><i /></span>
        </button>
      </div>
      {s.status === "error" && s.error && <div className="chat-error mcp-error">{s.error}</div>}
      {error && <div className="chat-error mcp-error">{error}</div>}
      {(s.headers.length > 0 || s.env.length > 0) && (
        <div className="mcp-secrets">
          {[...s.headers, ...s.env].map((x) => <span key={x.name}>{x.name}: <code>{x.masked}</code></span>)}
        </div>
      )}
      <div className="mcp-actions">
        <button className="btn-ghost" disabled={!s.enabled || busy} onClick={() => guard(connectMcpServer(s.id, true))}>Testen</button>
        {s.tools.length > 0 && (
          <button className="btn-ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{active} von {s.tools.length} Werkzeugen
          </button>
        )}
        <span className="mcp-spacer" />
        {s.alwaysAllow && <button className="btn-ghost" onClick={() => guard(updateMcpServer(s.id, { alwaysAllow: false }))} data-tip="Vor dem nächsten Aufruf wieder fragen" data-tip-pos="top">Immer erlaubt</button>}
        {confirm ? (
          <span className="key-confirm">
            <button className="danger" onClick={() => guard(removeMcpServer(s.id))}>Entfernen</button>
            <button onClick={() => setConfirm(false)}>Abbrechen</button>
          </span>
        ) : (
          <button className="icon-btn small" onClick={() => setConfirm(true)} data-tip="Server entfernen" data-tip-pos="top-end"><Trash2 size={14} /></button>
        )}
      </div>
      {open && (
        <div className="mcp-tools">
          {s.tools.map((t) => {
            const on = !s.disabledTools.includes(t.name);
            return (
              <button key={t.name} className="mcp-tool" role="switch" aria-checked={on} onClick={() => toggleTool(t.name, !on)}>
                <span><b>{t.name}</b>{t.description && <small>{t.description}</small>}</span>
                <span className={`switch ${on ? "on" : ""}`}><i /></span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function McpSettings() {
  const [more, setMore] = useState(false);
  if (!isTauri) return <p className="subtle-hint">Nur in der Desktop-App verfügbar.</p>;
  return (
    <>
      <ConnectorSettings />
      <button className="more-row mcp-more" aria-expanded={more} onClick={() => setMore(!more)}>
        {more ? <ChevronDown size={14} /> : <ChevronRight size={14} />}Externe Server nutzen
      </button>
      {more && <ExternalServers />}
    </>
  );
}

function ExternalServers() {
  const { servers, loaded } = useMcp();
  const [adding, setAdding] = useState(false);
  useEffect(() => void refreshMcp(), []);
  return (
    <div className="mcp">
      {servers.map((s) => <ServerCard key={s.id} s={s} />)}
      {loaded && !servers.length && !adding && <p className="subtle-hint">Noch kein Server angeschlossen.</p>}
      {adding ? <AddForm onDone={() => setAdding(false)} /> : <button className="key-add-btn" onClick={() => setAdding(true)}><Plus size={14} />Server hinzufügen</button>}
      <p className="subtle-hint">Tokens und Umgebungswerte bleiben auf diesem Gerät, nie im Projekt. Vor dem ersten Aufruf eines Servers fragt der Chat nach.</p>
    </div>
  );
}

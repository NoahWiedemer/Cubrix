// "Cubrix als Connector" in the MCP settings, and the question that appears when a new
// client wants to reach the open project.
import { useEffect, useState } from "react";
import { Check, Copy, Eye, EyeOff, RefreshCw } from "lucide-react";
import { Icon } from "../ui/icons";
import { clientLabel, connectorSnippets, connectorToken, decideClient, disconnectClient, refreshConnector, regenerateToken, setConnector, useConnector } from "../ai/connector";

const MASK = "••••••••";

function CopyButton({ text, label }: { text: () => Promise<string> | string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="icon-btn small"
      aria-label={label}
      data-tip={done ? "Kopiert" : label}
      data-tip-pos="top-end"
      onClick={async () => {
        await navigator.clipboard.writeText(await text());
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      }}
    >
      {done ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

export function ConnectorSettings() {
  const s = useConnector((c) => c.status);
  const [port, setPort] = useState(String(s.port));
  const [token, setToken] = useState<string | null>(null);
  const [confirmNew, setConfirmNew] = useState(false);
  const [error, setError] = useState("");
  const guard = (p: Promise<unknown>) => void p.catch((e) => setError(e instanceof Error ? e.message : String(e)));
  useEffect(() => void refreshConnector().catch(() => {}), []);
  useEffect(() => setPort(String(s.port)), [s.port]);

  const shownPort = s.runningPort ?? s.port;
  const names = [...new Set([...s.clients.map((c) => c.name), ...s.approved])];
  const live = new Set(s.clients.map((c) => c.name));
  const count = new Set(s.clients.map((c) => c.name)).size;
  const state = s.running ? `Läuft auf Port ${shownPort}${s.runningPort !== s.port ? ` (${s.port} war belegt)` : ""} · ${count} ${count === 1 ? "Client" : "Clients"}` : "Aus";
  const commitPort = () => {
    const n = Number(port);
    if (Number.isInteger(n) && n >= 1024 && n <= 65535 && n !== s.port) guard(setConnector(s.enabled, n));
    else setPort(String(s.port));
  };

  return (
    <section className="set-group">
      <h2>Cubrix als Connector</h2>
      <p className="set-intro">Claude Code, Codex und andere MCP-Clients steuern damit das geöffnete Projekt: nur auf diesem Rechner, mit Token, jede Änderung im Verlauf.</p>
      <div className="set-rows">
        <div className="set-row">
          <div className="set-label"><span>Connector</span><small>{state}</small></div>
          <div className="set-control">
            <button className="switch-btn" role="switch" aria-checked={s.enabled} aria-label="Connector" onClick={() => guard(setConnector(!s.enabled))}>
              <span className={`switch ${s.enabled ? "on" : ""}`}><i /></span>
            </button>
          </div>
        </div>
        {s.error && <div className="set-block"><div className="chat-error mcp-error">{s.error}</div></div>}
        {error && <div className="set-block"><div className="chat-error mcp-error">{error}</div></div>}
        <div className="set-row">
          <div className="set-label"><span>Port</span><small>Ist er belegt, nimmt Cubrix den nächsten freien.</small></div>
          <div className="set-control">
            <input className="mcp-input conn-port" inputMode="numeric" aria-label="Port" value={port} onChange={(e) => setPort(e.target.value)} onBlur={commitPort} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
          </div>
        </div>
        <div className="set-row">
          <div className="set-label"><span>Token</span><small>Wer ihn hat, kann das Projekt ändern. Wie ein Passwort behandeln.</small></div>
          <div className="set-control conn-token">
            <code>{token ?? MASK}</code>
            <button className="icon-btn small" aria-label={token ? "Token verbergen" : "Token anzeigen"} onClick={() => (token ? setToken(null) : guard(connectorToken().then(setToken)))}>
              {token ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            <CopyButton text={connectorToken} label="Token kopieren" />
            {confirmNew ? (
              <span className="key-confirm">
                <button className="danger" onClick={() => { setConfirmNew(false); setToken(null); guard(regenerateToken()); }}>Neu erzeugen</button>
                <button onClick={() => setConfirmNew(false)}>Abbrechen</button>
              </span>
            ) : (
              <button className="icon-btn small" aria-label="Neu erzeugen" data-tip="Neu erzeugen: alte Verbindungen enden" data-tip-pos="top-end" onClick={() => setConfirmNew(true)}><RefreshCw size={14} /></button>
            )}
          </div>
        </div>
        {names.map((n) => (
          <div className="set-row" key={n}>
            <div className="set-label"><span>{clientLabel(n)}</span><small>{live.has(n) ? "Verbunden" : "Erlaubt, gerade nicht verbunden"}</small></div>
            <div className="set-control"><button className="btn-ghost" onClick={() => guard(disconnectClient(n))}>Trennen</button></div>
          </div>
        ))}
      </div>
      <div className="conn-snippets">
        {connectorSnippets(shownPort, MASK).map((sn) => (
          <div className="conn-snippet" key={sn.id}>
            <div><span>{sn.label}</span><CopyButton label={`${sn.label} kopieren`} text={async () => connectorSnippets(shownPort, await connectorToken()).find((x) => x.id === sn.id)!.text} /></div>
            <pre>{sn.text}</pre>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Appears over everything: an agent is waiting for an answer. */
export function ConnectorApproval() {
  const name = useConnector((c) => c.status.pending[0]);
  if (!name) return null;
  return (
    <div className="conn-approval panel" role="alertdialog" aria-label="Neuer Client">
      <div className="conn-approval-head"><Icon name="plug" size={15} /><span><b>{clientLabel(name)}</b> möchte dieses Projekt steuern</span></div>
      <p>Der Client kann das Modell lesen und ändern. Änderungen landen im Verlauf.</p>
      <div className="mcp-consent-actions">
        <button className="btn-primary" onClick={() => void decideClient(name, true)}>Erlauben</button>
        <button className="btn-ghost" onClick={() => void decideClient(name, false)}>Ablehnen</button>
      </div>
    </div>
  );
}

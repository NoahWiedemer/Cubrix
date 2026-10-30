// Both providers, each with its named keys (masked): add, rename, delete, choose the one in
// use. Keys are validated by the Rust side on add.
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { isTauri } from "../core/platform";
import { ProviderLogo } from "../ui/ProviderLogo";
import { friendlyError } from "../ai/errors";
import { logError } from "../core/errorLog";
import { activateKey, addKey, deleteKey, refreshKeys, renameKey, useKeys, type KeyInfo } from "../ai/keys";
import type { Provider } from "../ai/providers";

const PROVIDERS: { id: Provider; label: string; url: string; placeholder: string }[] = [
  { id: "anthropic", label: "Anthropic", url: "https://console.anthropic.com/settings/keys", placeholder: "sk-ant-…" },
  { id: "openai", label: "OpenAI", url: "https://platform.openai.com/api-keys", placeholder: "sk-…" },
];

function KeyRow({ k }: { k: KeyInfo }) {
  const [name, setName] = useState(k.name);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => setName(k.name), [k.name]);
  return (
    <div className={`key-row ${k.active ? "on" : ""}`}>
      <button className="key-radio" role="radio" aria-checked={k.active} onClick={() => void activateKey(k.id)} data-tip={k.active ? "Aktiver Schlüssel" : "Als aktiv verwenden"} data-tip-pos="top">
        <span />
      </button>
      <input
        className="key-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => (name.trim() && name !== k.name ? void renameKey(k.id, name) : setName(k.name))}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setName(k.name);
        }}
      />
      <span className="key-mask">{k.masked}</span>
      {confirm ? (
        <span className="key-confirm">
          <button className="danger" onClick={() => void deleteKey(k.id)}>Löschen</button>
          <button onClick={() => setConfirm(false)}>Abbrechen</button>
        </span>
      ) : (
        <button className="icon-btn small" onClick={() => setConfirm(true)} data-tip="Schlüssel löschen" data-tip-pos="top-end">
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}

function ProviderSection({ p, keys }: { p: (typeof PROVIDERS)[number]; keys: KeyInfo[] }) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const [state, setState] = useState<"idle" | "testing" | "error">("idle");
  const [error, setError] = useState("");
  const connected = keys.some((k) => k.active);
  const close = () => {
    setValue("");
    setAdding(false);
    setState("idle");
  };
  const add = async () => {
    setState("testing");
    try {
      await addKey(p.id, value);
      close();
    } catch (e) {
      logError("ai", e instanceof Error ? e.message : String(e), { provider: p.id, request: "key-validate" });
      setError(friendlyError(e).title);
      setState("error");
    }
  };
  return (
    <section className="provider-card">
      <header>
        <ProviderLogo mark={p.id === "anthropic" ? "claude" : "openai"} size={20} />
        <span>{p.label}</span>
        <span className={`provider-badge ${connected ? "on" : ""}`}>{connected ? "Verbunden" : "Nicht verbunden"}</span>
      </header>
      {keys.length > 0 && <div className="provider-rows">{keys.map((k) => <KeyRow key={k.id} k={k} />)}</div>}
      {adding ? (
        <div className="key-add">
          <input className="mcp-input" type="password" autoFocus aria-label={`${p.label}-Schlüssel`} placeholder={`API-Schlüssel einfügen (${p.placeholder})`} value={value}
            onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && value.trim()) void add(); }} />
          <div className="key-add-actions">
            <button className="btn-primary" disabled={!isTauri || !value.trim() || state === "testing"} onClick={() => void add()}>
              {state === "testing" ? "Prüfe …" : "Hinzufügen"}
            </button>
            <button className="btn-ghost" onClick={close}>Abbrechen</button>
          </div>
          {state === "error" && <div className="chat-error">{error}</div>}
        </div>
      ) : (
        <div className="provider-actions">
          <button className="key-add-btn" onClick={() => setAdding(true)}><Plus size={14} />Schlüssel hinzufügen</button>
          <button className="provider-link" onClick={() => void import("@tauri-apps/plugin-opener").then((o) => o.openUrl(p.url))}>Wo bekomme ich einen?</button>
        </div>
      )}
    </section>
  );
}

/** One card per provider with its keys. */
export function ProviderKeys() {
  const { keys, loaded } = useKeys();
  useEffect(() => {
    if (!loaded) void refreshKeys();
  }, [loaded]);
  return (
    <div className="provider-keys">
      {PROVIDERS.map((p) => <ProviderSection key={p.id} p={p} keys={keys.filter((k) => k.provider === p.id)} />)}
      {!isTauri && <div className="chat-note">Nur in der Desktop-App verfügbar.</div>}
      <p className="subtle-hint">Schlüssel bleiben verschlüsselt auf diesem Gerät; die App zeigt sie nur gekürzt.</p>
    </div>
  );
}

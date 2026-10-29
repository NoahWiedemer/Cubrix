// "KI-Anbieter": both providers, each with its named keys (masked), add / rename /
// delete / choose the active one. Keys are validated by the Rust side on add.
import { useEffect, useState } from "react";
import { create } from "zustand";
import { Plus, Trash2, X } from "lucide-react";
import { isTauri } from "../core/platform";
import { ProviderLogo } from "../ui/ProviderLogo";
import { Icon } from "../ui/icons";
import { friendlyError } from "../ai/errors";
import { logError } from "../core/errorLog";
import { activateKey, addKey, deleteKey, refreshKeys, renameKey, useKeys, type KeyInfo } from "../ai/keys";
import type { Provider } from "../ai/providers";

export const useProviderDialog = create<{ open: boolean }>(() => ({ open: false }));

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
  const [adding, setAdding] = useState(keys.length === 0);
  const [value, setValue] = useState("");
  const [state, setState] = useState<"idle" | "testing" | "error">("idle");
  const [error, setError] = useState("");
  const add = async () => {
    setState("testing");
    try {
      await addKey(p.id, value);
      setValue("");
      setAdding(false);
      setState("idle");
    } catch (e) {
      logError("ai", e instanceof Error ? e.message : String(e), { provider: p.id, request: "key-validate" });
      setError(friendlyError(e).title);
      setState("error");
    }
  };
  return (
    <section className="provider-section">
      <header>
        <ProviderLogo mark={p.id === "anthropic" ? "claude" : "openai"} />
        <span>{p.label}</span>
        {keys.some((k) => k.active) && <span className="provider-ok"><Icon name="check" size={12} />verbunden</span>}
      </header>
      {keys.map((k) => <KeyRow key={k.id} k={k} />)}
      {adding ? (
        <div className="key-add">
          <div className="field chat-key">
            <input type="password" autoFocus={keys.length > 0} placeholder={`API-Schlüssel einfügen (${p.placeholder})`} value={value}
              onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && value.trim()) void add(); }} />
          </div>
          <div className="key-add-actions">
            <button className="btn-primary" disabled={!isTauri || !value.trim() || state === "testing"} onClick={() => void add()}>
              {state === "testing" ? "Prüfe …" : "Hinzufügen"}
            </button>
            {keys.length > 0 && <button className="btn-ghost" onClick={() => setAdding(false)}>Abbrechen</button>}
            <button className="chat-link" onClick={() => void import("@tauri-apps/plugin-opener").then((o) => o.openUrl(p.url))}>Wo bekomme ich einen?</button>
          </div>
          {state === "error" && <div className="chat-error">{error}</div>}
        </div>
      ) : (
        <button className="key-add-btn" onClick={() => setAdding(true)}><Plus size={14} />Schlüssel hinzufügen</button>
      )}
    </section>
  );
}

/** Both providers with their keys (used inline when nothing is connected, and in the dialog). */
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

export function ProviderDialog() {
  const open = useProviderDialog((s) => s.open);
  useEffect(() => {
    if (!open) return;
    void refreshKeys();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && useProviderDialog.setState({ open: false });
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!open) return null;
  return (
    <div className="help-backdrop" onMouseDown={(e) => e.target === e.currentTarget && useProviderDialog.setState({ open: false })}>
      <div className="settings-dialog panel" role="dialog" aria-label="KI-Anbieter">
        <header>
          <span>KI-Anbieter</span>
          <button className="icon-btn small" onClick={() => useProviderDialog.setState({ open: false })} data-tip="Schließen" data-kbd="escape" data-tip-pos="bottom-end">
            <X size={15} />
          </button>
        </header>
        <ProviderKeys />
      </div>
    </div>
  );
}

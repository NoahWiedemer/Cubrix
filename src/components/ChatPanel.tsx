import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { execute } from "../core/commands";
import { isTauri } from "../core/platform";
import { useAiSettings } from "../ui/settings";
import { Icon } from "../ui/icons";
import { runAgent } from "../ai/agent";
import { DEFAULT_MODEL, MODELS, tauriTransport, type Message, type Provider } from "../ai/providers";
import logo from "../assets/brand/modelonio-logo-mit-hintergrund-256.png";

interface Step {
  label: string;
  nodeId?: string;
  ok: boolean;
  error?: string;
}
interface ChatEntry {
  role: "user" | "assistant";
  text: string;
  steps: Step[];
  error?: string;
}

/** Conversation state survives closing/reopening the panel. */
const useChat = create<{ entries: ChatEntry[]; api: Message[]; running: boolean }>(() => ({ entries: [], api: [], running: false }));
let controller: AbortController | null = null;

export const focusChat = () => window.dispatchEvent(new Event("modelonio:focus-chat"));

const STARTERS = [
  "Bau mir eine Box mit Deckel, 60 × 40 × 30 mm",
  "Halterung für einen Arduino Uno",
  "Ein Schlüsselanhänger mit Loch und abgerundeten Ecken",
  "Wie ziehe ich eine Skizze in 3D?",
];

const PROVIDERS: { id: Provider; label: string; url: string }[] = [
  { id: "anthropic", label: "Anthropic Claude", url: "https://console.anthropic.com/settings/keys" },
  { id: "openai", label: "OpenAI", url: "https://platform.openai.com/api-keys" },
];

async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

function SetupCard({ onDone }: { onDone(): void }) {
  const { provider } = useAiSettings();
  const [key, setKey] = useState("");
  const [state, setState] = useState<"idle" | "testing" | "error">("idle");
  const [error, setError] = useState("");
  const info = PROVIDERS.find((p) => p.id === provider)!;

  const test = async () => {
    setState("testing");
    try {
      await invoke("ai_set_key", { provider, key });
      const model = useAiSettings.getState().model[provider] || DEFAULT_MODEL[provider];
      const body =
        provider === "anthropic"
          ? { model, max_tokens: 8, messages: [{ role: "user", content: "Hallo" }] }
          : { model, max_completion_tokens: 8, messages: [{ role: "user", content: "Hallo" }] };
      if (provider === "openai" && !model) throw new Error("Bitte zuerst eine Modell-ID eintragen.");
      await invoke("ai_test", { provider, body });
      onDone();
    } catch (e) {
      setState("error");
      setError(String(e instanceof Error ? e.message : e).slice(0, 220));
    }
  };

  return (
    <div className="chat-setup">
      <div className="chat-setup-title"><Icon name="key" size={16} />KI verbinden</div>
      <p>Wähle einen Anbieter und füge deinen API-Schlüssel ein. Er wird sicher im Schlüsselbund deines Systems gespeichert.</p>
      <div className="seg">
        {PROVIDERS.map((p) => (
          <button key={p.id} className={provider === p.id ? "on" : ""} onClick={() => useAiSettings.setState({ provider: p.id })}>
            {p.label}
          </button>
        ))}
      </div>
      {provider === "openai" && <ModelPicker />}
      <div className="field chat-key">
        <input type="password" placeholder={provider === "anthropic" ? "sk-ant-…" : "sk-…"} value={key} onChange={(e) => setKey(e.target.value)} />
      </div>
      <button className="btn-primary" disabled={!key.trim() || state === "testing"} onClick={test} style={{ width: "100%", justifyContent: "center" }}>
        {state === "testing" ? "Teste Verbindung …" : "Verbindung testen"}
      </button>
      {state === "error" && <div className="chat-error">{error}</div>}
      <button className="chat-link" onClick={() => void import("@tauri-apps/plugin-opener").then((o) => o.openUrl(info.url))}>
        Wo bekomme ich einen Schlüssel?
      </button>
    </div>
  );
}

function ModelPicker() {
  const { provider, model } = useAiSettings();
  const value = model[provider];
  const set = (m: string) => useAiSettings.setState((s) => ({ model: { ...s.model, [provider]: m } }));
  if (MODELS[provider].length)
    return (
      <select className="select chat-model" value={value} onChange={(e) => set(e.target.value)}>
        {MODELS[provider].map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
    );
  return <input className="select chat-model" placeholder="Modell-ID, z. B. aus deinem OpenAI-Konto" value={value} onChange={(e) => set(e.target.value)} />;
}

export function ChatPanel() {
  const { entries, running } = useChat();
  const { provider, model } = useAiSettings();
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isTauri) return setHasKey(false);
    invoke<boolean>("ai_has_key", { provider }).then(setHasKey, () => setHasKey(false));
  }, [provider]);

  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    window.addEventListener("modelonio:focus-chat", focus);
    return () => window.removeEventListener("modelonio:focus-chat", focus);
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [entries]);

  if (!isTauri)
    return (
      <div className="chat-empty">
        <img src={logo} alt="" />
        <p>Der KI-Assistent ist in der Desktop-App verfügbar (API-Schlüssel bleiben im Schlüsselbund des Systems).</p>
      </div>
    );

  if (hasKey === false || showSetup)
    return (
      <div className="scroll chat-scroll">
        <SetupCard onDone={() => { setHasKey(true); setShowSetup(false); }} />
      </div>
    );

  const send = async (prompt: string) => {
    if (!prompt.trim() || running) return;
    setInput("");
    controller = new AbortController();
    const entry: ChatEntry = { role: "assistant", text: "", steps: [] };
    useChat.setState((s) => ({ entries: [...s.entries, { role: "user", text: prompt, steps: [] }, entry], running: true }));
    const update = (fn: (e: ChatEntry) => ChatEntry) =>
      useChat.setState((s) => ({ entries: [...s.entries.slice(0, -1), fn(s.entries[s.entries.length - 1])] }));
    try {
      const api = await runAgent({
        provider,
        model: model[provider] || DEFAULT_MODEL[provider],
        transport: tauriTransport,
        history: useChat.getState().api,
        prompt,
        signal: controller.signal,
        events: {
          onText: (d) => update((e) => ({ ...e, text: e.text + d })),
          onStep: (step) => update((e) => ({ ...e, steps: [...e.steps, step] })),
        },
      });
      useChat.setState({ api });
    } catch (e) {
      update((x) => ({ ...x, error: String(e instanceof Error ? e.message : e).slice(0, 300) }));
    } finally {
      useChat.setState({ running: false });
      controller = null;
    }
  };

  return (
    <div className="chat">
      <div className="chat-bar">
        <ModelPicker />
        <button className="icon-btn" onClick={() => setShowSetup(true)} data-tip="Anbieter und Schlüssel" data-tip-pos="bottom-end">
          <Icon name="key" size={15} />
        </button>
      </div>
      <div className="scroll chat-scroll" ref={listRef}>
        {entries.length === 0 ? (
          <div className="chat-empty">
            <img src={logo} alt="" />
            <p>Beschreibe, was du bauen möchtest – oder frag mich etwas zu Modelonio.</p>
            <div className="chat-starters">
              {STARTERS.map((s) => (
                <button key={s} className="chat-starter" onClick={() => send(s)}>
                  <Icon name="ai" size={14} />{s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          entries.map((e, i) => (
            <div key={i} className={`msg ${e.role}`}>
              {e.text && <div className="msg-text">{e.text}</div>}
              {e.steps.length > 0 && (
                <div className="msg-steps">
                  {e.steps.map((s, j) => (
                    <button
                      key={j}
                      className={`step-chip ${s.ok ? "" : "failed"}`}
                      disabled={!s.nodeId}
                      onClick={() => s.nodeId && execute("history.goto", { nodeId: s.nodeId })}
                      title={s.error}
                    >
                      <Icon name={s.ok ? "ai" : "warn"} size={12} />{s.label}
                    </button>
                  ))}
                </div>
              )}
              {e.error && <div className="chat-error">{e.error}</div>}
              {e.role === "assistant" && running && i === entries.length - 1 && !e.text && !e.steps.length && (
                <div className="typing"><span /><span /><span /></div>
              )}
            </div>
          ))
        )}
      </div>
      <div className="chat-input">
        <textarea
          ref={inputRef}
          rows={2}
          value={input}
          placeholder="Was soll ich bauen?"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
        />
        {running ? (
          <button className="chat-send stop" onClick={() => controller?.abort()} data-tip="Stopp" data-tip-pos="top">
            <Icon name="stop" size={14} />
          </button>
        ) : (
          <button className="chat-send" disabled={!input.trim()} onClick={() => send(input)} data-tip="Senden" data-tip-pos="top">
            <Icon name="send" size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

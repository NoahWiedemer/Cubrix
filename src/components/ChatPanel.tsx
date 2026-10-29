import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { ChevronDown, ChevronRight, MoreHorizontal } from "lucide-react";
import { execute } from "../core/commands";
import { isTauri } from "../core/platform";
import { useAiSettings } from "../ui/settings";
import { Icon } from "../ui/icons";
import { ProviderLogo } from "../ui/ProviderLogo";
import { usePopover } from "../ui/usePopover";
import { Menu, MenuItem, MenuSeparator, MenuTitle } from "../ui/Menu";
import { runAgent } from "../ai/agent";
import { tauriTransport, type Message, type Provider } from "../ai/providers";
import { CATALOG, DEFAULT_MODEL, EFFORT_LABELS, extraModels, modelInfo, type Effort, type ModelInfo } from "../ai/models";
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

const STARTERS = ["Box mit Deckel, 60 × 40 × 30 mm", "Halterung für einen Arduino Uno", "Schlüsselanhänger mit Loch", "Wie ziehe ich eine Skizze in 3D?"];

const PROVIDERS: { id: Provider; label: string; url: string }[] = [
  { id: "anthropic", label: "Anthropic", url: "https://console.anthropic.com/settings/keys" },
  { id: "openai", label: "OpenAI", url: "https://platform.openai.com/api-keys" },
];

async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

const markFor = (p: Provider) => (p === "anthropic" ? "claude" : "openai");

/** Extra chat models from the provider's /v1/models list, loaded once per provider. */
const useModelList = create<Record<Provider, ModelInfo[]>>(() => ({ anthropic: [], openai: [] }));
async function loadExtraModels(provider: Provider) {
  if (!isTauri) return;
  try {
    const res = await invoke<{ data?: { id: string; display_name?: string }[] }>("ai_models", { provider });
    useModelList.setState({ [provider]: extraModels(provider, res.data ?? []) });
  } catch {
    /* offline or no key: catalog only */
  }
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
      const model = DEFAULT_MODEL[provider];
      const body =
        provider === "anthropic"
          ? { model, max_tokens: 16, messages: [{ role: "user", content: "Hallo" }] }
          : { model, messages: [{ role: "user", content: "Hallo" }] };
      await invoke("ai_test", { provider, body });
      void loadExtraModels(provider);
      onDone();
    } catch (e) {
      setState("error");
      setError(String(e instanceof Error ? e.message : e).slice(0, 220));
    }
  };

  return (
    <div className="chat-setup">
      <div className="chat-setup-title"><Icon name="key" size={16} />KI verbinden</div>
      <div className="seg">
        {PROVIDERS.map((p) => (
          <button key={p.id} className={provider === p.id ? "on" : ""} onClick={() => useAiSettings.setState({ provider: p.id })}>
            <ProviderLogo mark={p.id} />
            {p.label}
          </button>
        ))}
      </div>
      <div className="field chat-key">
        <input type="password" placeholder="API-Schlüssel einfügen" value={key} onChange={(e) => setKey(e.target.value)} />
      </div>
      <button className="btn-primary" disabled={!isTauri || !key.trim() || state === "testing"} onClick={test} style={{ width: "100%", justifyContent: "center" }}>
        {state === "testing" ? "Teste Verbindung …" : "Verbindung testen"}
      </button>
      {!isTauri && <div className="chat-note">Nur in der Desktop-App verfügbar.</div>}
      {state === "error" && <div className="chat-error">{error}</div>}
      <div className="chat-note">Der Schlüssel wird im Schlüsselbund deines Systems gespeichert.</div>
      <button className="chat-link" onClick={() => void import("@tauri-apps/plugin-opener").then((o) => o.openUrl(info.url))}>
        Wo bekomme ich einen Schlüssel?
      </button>
    </div>
  );
}

/** Model + reasoning depth in one compact dropdown. */
function ModelMenu() {
  const { provider, model, effort } = useAiSettings();
  const extra = useModelList((s) => s[provider]);
  const pop = usePopover();
  const [more, setMore] = useState(false);
  const current = modelInfo(provider, model[provider] || DEFAULT_MODEL[provider]);
  const recommended = CATALOG[provider].filter((m) => m.recommended);
  const others = [...CATALOG[provider].filter((m) => !m.recommended), ...extra];
  const pick = (id: string) => {
    useAiSettings.setState((s) => ({ model: { ...s.model, [provider]: id } }));
    pop.setOpen(false);
  };
  return (
    <div ref={pop.ref} className="model-picker">
      <button className="model-button" onClick={() => pop.setOpen(!pop.open)}>
        <ProviderLogo mark={markFor(provider)} />
        <span className="model-name">{current.name}</span>
        {current.effort && <EffortDots effort={effort} />}
        <ChevronDown size={14} />
      </button>
      {pop.open && (
        <Menu style={{ top: 36, left: 0 }} className="model-menu">
          <MenuTitle>Modell</MenuTitle>
          {recommended.map((m) => (
            <MenuItem key={m.id} iconNode={<ProviderLogo mark={markFor(provider)} />} label={<ModelLabel m={m} />} checked={m.id === current.id} onClick={() => pick(m.id)} />
          ))}
          {others.length > 0 && (
            <button className="menu-item more" onClick={() => setMore(!more)}>
              <span className="menu-icon">{more ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
              <span className="menu-label">Weitere Modelle</span>
            </button>
          )}
          {more && others.map((m) => (
            <MenuItem key={m.id} iconNode={<span />} label={m.name} checked={m.id === current.id} onClick={() => pick(m.id)} />
          ))}
          {current.effort && (
            <>
              <MenuSeparator />
              <MenuTitle>Denktiefe</MenuTitle>
              <div className="seg effort-seg">
                {(["low", "medium", "high"] as Effort[]).map((e) => (
                  <button key={e} className={effort === e ? "on" : ""} onClick={() => useAiSettings.setState({ effort: e })}>
                    {EFFORT_LABELS[e]}
                  </button>
                ))}
              </div>
            </>
          )}
        </Menu>
      )}
    </div>
  );
}

function ModelLabel({ m }: { m: ModelInfo }) {
  return (
    <span className="model-label">
      {m.name}
      {m.hint && <span className="model-hint">{m.hint}</span>}
    </span>
  );
}

function EffortDots({ effort }: { effort: Effort }) {
  const n = effort === "low" ? 1 : effort === "medium" ? 2 : 3;
  return (
    <span className="effort-dots" title={`Denktiefe: ${EFFORT_LABELS[effort]}`}>
      {[1, 2, 3].map((i) => <i key={i} className={i <= n ? "on" : ""} />)}
    </span>
  );
}

function Steps({ steps }: { steps: Step[] }) {
  const [open, setOpen] = useState(false);
  const failed = steps.filter((s) => !s.ok).length;
  return (
    <div className="msg-steps">
      <button className="steps-toggle" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Icon name="ai" size={13} />
        {steps.length} {steps.length === 1 ? "Schritt" : "Schritte"}
        {failed > 0 && <span className="steps-failed">· {failed} fehlgeschlagen</span>}
      </button>
      {open &&
        steps.map((s, j) => (
          <button key={j} className={`step-row ${s.ok ? "" : "failed"}`} disabled={!s.nodeId} onClick={() => s.nodeId && execute("history.goto", { nodeId: s.nodeId })} title={s.error}>
            <Icon name={s.ok ? "check" : "warn"} size={12} />
            {s.label}
          </button>
        ))}
    </div>
  );
}

export function ChatPanel() {
  const { entries, running } = useChat();
  const { provider, model, effort } = useAiSettings();
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const more = usePopover();

  useEffect(() => {
    // Dev-only preview of the connected panel in a plain browser (?kiDemo, ?kiDemo=chat).
    const demo = import.meta.env.DEV ? new URLSearchParams(location.search).get("kiDemo") : null;
    if (demo !== null) {
      setHasKey(true);
      if (demo === "chat" && !useChat.getState().entries.length)
        useChat.setState({
          entries: [
            { role: "user", text: "Bau mir eine Box mit Deckel, 60 × 40 × 30 mm", steps: [] },
            {
              role: "assistant",
              text: "Fertig: Die Box hat 2 mm Wände und einen passenden Deckel mit 0,3 mm Spiel. Der Deckel liegt rechts daneben auf dem Bett.",
              steps: [
                { label: "Box hinzufügen", ok: true },
                { label: "Innenraum hinzufügen", ok: true },
                { label: "Differenz: Box − Innenraum", ok: true },
                { label: "Deckel hinzufügen", ok: true },
              ],
            },
          ],
        });
      return;
    }
    if (!isTauri) return setHasKey(false);
    invoke<boolean>("ai_has_key", { provider }).then((ok) => {
      setHasKey(ok);
      if (ok) void loadExtraModels(provider);
    }, () => setHasKey(false));
  }, [provider]);

  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    window.addEventListener("albedo:focus-chat", focus);
    return () => window.removeEventListener("albedo:focus-chat", focus);
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [entries]);

  const send = async (prompt: string) => {
    if (!prompt.trim() || running) return;
    setInput("");
    controller = new AbortController();
    const entry: ChatEntry = { role: "assistant", text: "", steps: [] };
    useChat.setState((s) => ({ entries: [...s.entries, { role: "user", text: prompt, steps: [] }, entry], running: true }));
    const update = (fn: (e: ChatEntry) => ChatEntry) =>
      useChat.setState((s) => ({ entries: [...s.entries.slice(0, -1), fn(s.entries[s.entries.length - 1])] }));
    const info = modelInfo(provider, model[provider] || DEFAULT_MODEL[provider]);
    try {
      const api = await runAgent({
        provider,
        model: info.id,
        effort: info.effort ? effort : null,
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

  if (hasKey === false || showSetup)
    return (
      <div className="scroll chat-scroll">
        <SetupCard onDone={() => { setHasKey(true); setShowSetup(false); }} />
      </div>
    );

  return (
    <div className="chat">
      <div className="chat-bar">
        <ModelMenu />
        <div ref={more.ref} style={{ position: "relative" }}>
          <button className="icon-btn small" onClick={() => more.setOpen(!more.open)} data-tip="Mehr" data-tip-pos="bottom-end">
            <MoreHorizontal size={16} />
          </button>
          {more.open && (
            <Menu style={{ top: 34, right: 0 }}>
              <MenuItem icon="file" label="Neuer Chat" onClick={() => { useChat.setState({ entries: [], api: [] }); more.setOpen(false); }} />
              <MenuItem icon="key" label="Anbieter und Schlüssel" onClick={() => { setShowSetup(true); more.setOpen(false); }} />
            </Menu>
          )}
        </div>
      </div>
      <div className="scroll chat-scroll" ref={listRef}>
        {entries.length === 0 ? (
          <div className="chat-empty">
            <img src={logo} alt="" />
            <p>Was möchtest du bauen?</p>
            <div className="chat-starters">
              {STARTERS.map((s) => (
                <button key={s} className="chat-starter" onClick={() => send(s)}>{s}</button>
              ))}
            </div>
          </div>
        ) : (
          entries.map((e, i) => (
            <div key={i} className={`msg ${e.role}`}>
              {e.text && <div className="msg-text">{e.text}</div>}
              {e.steps.length > 0 && <Steps steps={e.steps} />}
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
          placeholder="Nachricht an die KI"
          data-tip="KI-Chat"
          data-kbd="mod+k"
          data-tip-pos="top"
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
            <Icon name="stop" size={13} />
          </button>
        ) : (
          <button className="chat-send" disabled={!input.trim()} onClick={() => send(input)} data-tip="Senden" data-tip-pos="top">
            <Icon name="send" size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

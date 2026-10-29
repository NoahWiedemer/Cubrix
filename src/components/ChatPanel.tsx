import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { ChevronDown, ChevronRight, Settings } from "lucide-react";
import { execute } from "../core/commands";
import { isTauri } from "../core/platform";
import { useAiSettings } from "../ui/settings";
import { Icon } from "../ui/icons";
import { ProviderLogo } from "../ui/ProviderLogo";
import { usePopover } from "../ui/usePopover";
import { SegmentedControl } from "../ui/SegmentedControl";
import { Menu, MenuItem, MenuSeparator, MenuTitle } from "../ui/Menu";
import { runAgent } from "../ai/agent";
import { VoiceButton } from "./VoiceButton";
import { friendlyError, type FriendlyError } from "../ai/errors";
import { logError } from "../core/errorLog";
import { tauriTransport, type Message, type Provider } from "../ai/providers";
import { CATALOG, DEFAULT_MODEL, EFFORT_LABELS, modelInfo, type Effort, type ModelInfo } from "../ai/models";
import { connectedProviders, refreshKeys, useKeys } from "../ai/keys";
import { endRun, setPhase, startRun, useAiRun } from "../ai/run";
import { useApp } from "../core/store";
import { ProviderKeys, useProviderDialog } from "./ProviderKeys";
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
  error?: FriendlyError;
  prompt?: string;
  /** History group of the run (to undo it as a whole). */
  groupId?: string;
  durationMs?: number;
}

/** Conversation state survives closing/reopening the panel. */
const useChat = create<{ entries: ChatEntry[]; api: Message[]; running: boolean }>(() => ({ entries: [], api: [], running: false }));
let controller: AbortController | null = null;

const STARTERS = ["Box mit Deckel, 60 × 40 × 30 mm", "Halterung für einen Arduino Uno", "Schlüsselanhänger mit Loch", "Wie ziehe ich eine Skizze in 3D?"];

const markFor = (p: Provider) => (p === "anthropic" ? "claude" : "openai");
const PROVIDER_LABEL: Record<Provider, string> = { anthropic: "Anthropic", openai: "OpenAI" };

/**
 * Model + reasoning depth in one compact dropdown. Lists the models of every provider
 * with an active key, grouped by provider; picking a model picks its provider too.
 */
function ModelMenu() {
  const { provider, model, effort } = useAiSettings();
  const keys = useKeys((s) => s.keys);
  const pop = usePopover();
  const current = modelInfo(provider, model[provider] || DEFAULT_MODEL[provider]);
  const providers = connectedProviders(keys);
  const pick = (p: Provider, id: string) => {
    useAiSettings.setState((s) => ({ provider: p, model: { ...s.model, [p]: id } }));
    pop.setOpen(false);
  };
  return (
    <div ref={pop.ref} className="model-picker">
      <button className="model-button" onClick={() => pop.setOpen(!pop.open)}>
        <ProviderLogo mark={markFor(provider)} />
        <span className="model-name">{current.name}</span>
        <ChevronDown size={14} />
      </button>
      {pop.open && (
        <Menu style={{ top: 36, left: 0 }} className="model-menu">
          {(providers.length ? providers : [provider]).map((p, i) => (
            <div key={p}>
              {i > 0 && <MenuSeparator />}
              <MenuTitle>{PROVIDER_LABEL[p]}</MenuTitle>
              {CATALOG[p].map((m) => (
                <MenuItem key={m.id} iconNode={<ProviderLogo mark={markFor(p)} />} label={<ModelLabel m={m} />} checked={p === provider && m.id === current.id} onClick={() => pick(p, m.id)} />
              ))}
            </div>
          ))}
          {current.effort && (
            <>
              <MenuSeparator />
              <MenuTitle>Denktiefe</MenuTitle>
              <div className="menu-seg">
                <SegmentedControl
                  size="sm"
                  className="block"
                  value={effort}
                  onChange={(e) => useAiSettings.setState({ effort: e })}
                  options={(["low", "medium", "high"] as Effort[]).map((e) => ({ value: e, label: EFFORT_LABELS[e] }))}
                />
              </div>
            </>
          )}
          <MenuSeparator />
          <MenuItem icon="key" label="Anbieter und Schlüssel …" onClick={() => { pop.setOpen(false); useProviderDialog.setState({ open: true }); }} />
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

/** Live status while the agent works: pulsing dot, shimmering activity, elapsed seconds. */
function RunStatus() {
  const phase = useAiRun((s) => s.phase);
  const startedAt = useAiRun((s) => s.startedAt);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.floor((performance.now() - startedAt) / 1000));
  return (
    <div className="run-status" role="status" aria-live="polite">
      <span className="run-dot" />
      <span className="run-phase">{phase || "Arbeitet …"}</span>
      <span className="run-time">{secs} s</span>
    </div>
  );
}

/** Undo / redo a whole AI run (its history group), as long as nothing was built on top. */
function RunUndo({ groupId }: { groupId: string }) {
  const nodes = useApp((s) => s.nodes);
  const currentId = useApp((s) => s.currentId);
  const mine = Object.values(nodes).filter((n) => n.group?.id === groupId);
  if (!mine.length) return null;
  const first = mine.find((n) => !mine.some((m) => m.id === n.parentId))!;
  const last = mine.find((n) => !mine.some((m) => m.parentId === n.id))!;
  const before = first.parentId;
  const canUndo = currentId === last.id && !!before;
  const canRedo = currentId === before && nodes[before!]?.activeChildId === first.id;
  if (!canUndo && !canRedo) return null;
  return (
    <button className="run-undo" onClick={() => execute("history.goto", { nodeId: canUndo ? before! : last.id })} data-tip={canUndo ? "Alle Schritte dieser Antwort zurücknehmen" : "Schritte wiederherstellen"} data-tip-pos="top">
      <Icon name={canUndo ? "undo" : "redo"} size={13} />{canUndo ? "Rückgängig" : "Wiederherstellen"}
    </button>
  );
}

function ErrorBox({ error, onRetry }: { error: FriendlyError; onRetry?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="chat-error">
      <div className="err-title"><Icon name="warn" size={14} />{error.title}</div>
      <div className="err-actions">
        {onRetry && <button onClick={onRetry}>Erneut versuchen</button>}
        <button onClick={() => setOpen(!open)}>{open ? "Details ausblenden" : "Details"}</button>
      </div>
      {open && <pre className="err-details">{error.details}</pre>}
    </div>
  );
}

function Steps({ steps, live }: { steps: Step[]; live?: boolean }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const shown = open ?? !!live; // live runs show their steps, finished ones collapse
  const failed = steps.filter((s) => !s.ok).length;
  return (
    <div className="msg-steps">
      <button className="steps-toggle" onClick={() => setOpen(!shown)}>
        {shown ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Icon name="ai" size={13} />
        {steps.length} {steps.length === 1 ? "Schritt" : "Schritte"}
        {failed > 0 && <span className="steps-failed">· {failed} fehlgeschlagen</span>}
      </button>
      {shown &&
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
  const keys = useKeys((s) => s.keys);
  const keysLoaded = useKeys((s) => s.loaded);
  const [demo, setDemo] = useState(false);
  const connected = connectedProviders(keys);
  const hasKey = demo || connected.length > 0;
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const more = usePopover();

  useEffect(() => {
    // Dev-only preview of the connected panel in a plain browser (?kiDemo, ?kiDemo=chat).
    const demo = import.meta.env.DEV ? new URLSearchParams(location.search).get("kiDemo") : null;
    if (demo !== null) {
      setDemo(true);
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
    void refreshKeys();
  }, []);

  // The chosen provider must have a key; otherwise use one that has.
  useEffect(() => {
    if (connected.length && !connected.includes(provider)) useAiSettings.setState({ provider: connected[0] });
  }, [connected.join(), provider]);

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
    if (inputRef.current) inputRef.current.style.height = "";
    controller = new AbortController();
    const entry: ChatEntry = { role: "assistant", text: "", steps: [] };
    useChat.setState((s) => ({ entries: [...s.entries, { role: "user", text: prompt, steps: [] }, entry], running: true }));
    const update = (fn: (e: ChatEntry) => ChatEntry) =>
      useChat.setState((s) => ({ entries: [...s.entries.slice(0, -1), fn(s.entries[s.entries.length - 1])] }));
    const info = modelInfo(provider, model[provider] || DEFAULT_MODEL[provider]);
    const groupId = Math.random().toString(36).slice(2);
    const t0 = performance.now();
    update((e) => ({ ...e, groupId }));
    startRun();
    try {
      const api = await runAgent({
        groupId,
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
          onPhase: setPhase,
        },
      });
      useChat.setState({ api });
    } catch (e) {
      if (controller?.signal.aborted) update((x) => ({ ...x, text: x.text || "Gestoppt." }));
      else {
        logError("ai", e instanceof Error ? e.message : String(e), { provider, model: info.id, request: "agent" });
        update((x) => ({ ...x, error: friendlyError(e), prompt }));
      }
    } finally {
      update((e) => ({ ...e, durationMs: performance.now() - t0 }));
      endRun();
      useChat.setState({ running: false });
      controller = null;
    }
  };

  // Retry: drop the failed exchange and send the same prompt again.
  const retry = (prompt: string) => {
    useChat.setState((s) => ({ entries: s.entries.slice(0, -2) }));
    void send(prompt);
  };

  if (!hasKey)
    return (
      <div className="scroll chat-scroll">
        <div className="chat-setup-title"><Icon name="key" size={16} />KI verbinden</div>
        {keysLoaded || !isTauri ? <ProviderKeys /> : null}
      </div>
    );

  return (
    <div className="chat">
      <div className="chat-bar">
        <ModelMenu />
        <div ref={more.ref} style={{ position: "relative" }}>
          <button className="icon-btn small" onClick={() => more.setOpen(!more.open)} data-tip="Einstellungen" data-tip-pos="bottom-end">
            <Settings size={16} strokeWidth={1.75} />
          </button>
          {more.open && (
            <Menu style={{ top: 34, right: 0 }}>
              <MenuItem icon="file" label="Neuer Chat" onClick={() => { useChat.setState({ entries: [], api: [] }); more.setOpen(false); }} />
              <MenuItem icon="key" label="Anbieter und Schlüssel …" onClick={() => { useProviderDialog.setState({ open: true }); more.setOpen(false); }} />
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
              {e.steps.length > 0 && <Steps steps={e.steps} live={running && i === entries.length - 1} />}
              {e.error && <ErrorBox error={e.error} onRetry={e.prompt ? () => retry(e.prompt!) : undefined} />}
              {e.role === "assistant" && running && i === entries.length - 1 && <RunStatus />}
              {e.role === "assistant" && !(running && i === entries.length - 1) && e.durationMs !== undefined && !e.error && (
                <div className="run-done">
                  <Icon name="check" size={12} />
                  <span>Fertig · {Math.max(1, Math.round(e.durationMs / 1000))} s{e.steps.filter((x) => x.nodeId).length ? ` · ${e.steps.filter((x) => x.nodeId).length} ${e.steps.filter((x) => x.nodeId).length === 1 ? "Änderung" : "Änderungen"}` : ""}</span>
                  {e.groupId && <RunUndo groupId={e.groupId} />}
                </div>
              )}
            </div>
          ))
        )}
      </div>
      <div className="chat-input">
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          placeholder={running ? "Arbeitet …" : "Nachricht an die KI"}
          data-tip="KI-Chat"
          data-kbd="mod+k"
          data-tip-pos="top"
          onChange={(e) => {
            setInput(e.target.value);
            // Grow with the content up to ~6 lines.
            const el = e.target;
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
        />
        <div className="chat-actions">
        {running ? (
          <button className="chat-send stop" onClick={() => controller?.abort()} data-tip="Stopp" data-tip-pos="top">
            <Icon name="stop" size={13} />
          </button>
        ) : (
          <button className={`chat-send ${input.trim() ? "ready" : ""}`} disabled={!input.trim()} onClick={() => send(input)} data-tip="Senden" data-tip-pos="top">
            <Icon name="send" size={14} />
          </button>
        )}
        <VoiceButton
          disabled={running}
          onText={(t) => void send(t)}
          onError={(err) => useChat.setState((st) => ({ entries: [...st.entries, { role: "assistant", text: "", steps: [], error: err }] }))}
        />
        </div>
      </div>
    </div>
  );
}

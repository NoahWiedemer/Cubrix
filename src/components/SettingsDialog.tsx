// Einstellungen, built like the help window: sections on the left, content on the right.
import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { clearErrors, formatErrors, openErrorFolder, readErrors } from "../core/errorLog";
import { isTauri } from "../core/platform";
import { Icon, type IconName } from "../ui/icons";
import { SegmentedControl } from "../ui/SegmentedControl";
import { useAiSettings, useSettings } from "../ui/settings";
import { SETTINGS_SECTIONS, stepSection, useSettingsDialog, type SettingsSection } from "../ui/settingsNav";
import { checkForUpdates, updateSource, useUpdatePrefs, useUpdater } from "../core/updater";
import { activeModel, CATALOG, EFFORT_LABELS, type Effort } from "../ai/models";
import { connectedProviders, useKeys } from "../ai/keys";
import type { Provider } from "../ai/providers";
import { ProviderLogo } from "../ui/ProviderLogo";
import { Select } from "../ui/Select";
import { useHelp } from "../help/HelpCenter";
import { useShortcuts } from "./ShortcutOverlay";
import { ProviderKeys } from "./ProviderKeys";
import { McpSettings } from "./McpSettings";
import { Printer } from "./Inspector";
import logo from "../assets/brand/cubrix-logo-mit-hintergrund-256.png";

export { useSettingsDialog };

function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="set-group">
      {title && <h2>{title}</h2>}
      <div className="set-rows">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-label">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div className="set-control">{children}</div>
    </div>
  );
}

function Switch({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange(v: boolean): void }) {
  return (
    <Row label={label} hint={hint}>
      <button className="switch-btn" role="switch" aria-checked={value} aria-label={label} onClick={() => onChange(!value)}>
        <span className={`switch ${value ? "on" : ""}`}><i /></span>
      </button>
    </Row>
  );
}

function Version() {
  const [version, setVersion] = useState("");
  useEffect(() => void updateSource.currentVersion().then(setVersion).catch(() => {}), []);
  return <b className="set-value">{version ? `v${version}` : "…"}</b>;
}

function General() {
  const close = () => useSettingsDialog.setState({ open: false });
  return (
    <Group>
      <Row label="Installierte Version"><Version /></Row>
      <Row label="Hilfe" hint="Alle Funktionen Schritt für Schritt erklärt.">
        <button className="btn-ghost" onClick={() => { close(); useHelp.setState({ open: true }); }}>Öffnen</button>
      </Row>
      <Row label="Tastenkürzel" hint="Übersicht aller Kürzel.">
        <button className="btn-ghost" onClick={() => { close(); useShortcuts.setState({ open: true }); }}>Anzeigen</button>
      </Row>
    </Group>
  );
}

const PROVIDER_LOOK: Record<Provider, { label: string; mark: "claude" | "openai" }> = { anthropic: { label: "Anthropic", mark: "claude" }, openai: { label: "OpenAI", mark: "openai" } };

function Ai() {
  const { model, effort } = useAiSettings();
  const aiAnimations = useSettings((s) => s.aiAnimations);
  const keys = useKeys((s) => s.keys);
  const connected = connectedProviders(keys);
  const { id } = activeModel(model, connected);
  const groups = connected.map((p) => ({
    label: PROVIDER_LOOK[p].label,
    options: CATALOG[p].map((m) => ({ value: m.id, label: m.name, hint: m.hint, icon: <ProviderLogo mark={PROVIDER_LOOK[p].mark} /> })),
  }));
  return (
    <>
      <div className="set-group"><ProviderKeys /></div>
      <Group title="Standardmodell">
        <Row label="Modell" hint={connected.length ? "Im Chat stehen die Modelle aller verbundenen Anbieter zur Wahl." : "Verbinde zuerst einen Anbieter."}>
          <Select className="set-select" label="Modell" value={id} disabled={!connected.length} placeholder="Kein Anbieter verbunden" onChange={(m) => useAiSettings.setState({ model: m })} groups={groups} />
        </Row>
        <Row label="Denktiefe" hint="Mehr Tiefe braucht länger und kostet mehr.">
          <SegmentedControl size="sm" value={effort} onChange={(e) => useAiSettings.setState({ effort: e })}
            options={(Object.keys(EFFORT_LABELS) as Effort[]).map((e) => ({ value: e, label: EFFORT_LABELS[e] }))} />
        </Row>
        <Switch label="KI-Animationen" hint="Neue Objekte wachsen ins Bild, die Ansicht leuchtet während der Arbeit." value={aiAnimations} onChange={(v) => useSettings.setState({ aiAnimations: v })} />
      </Group>
    </>
  );
}

function View() {
  const s = useSettings();
  return (
    <>
      <Group title="Darstellung">
        <Switch label="Raster anzeigen" value={s.showGrid} onChange={(showGrid) => useSettings.setState({ showGrid })} />
        <Row label="Rasterstärke">
          <label className="set-slider"><input type="range" aria-label="Rasterstärke" min={0} max={100} step={5} value={s.gridStrength} onChange={(e) => useSettings.setState({ gridStrength: Number(e.target.value) })} /><b>{s.gridStrength} %</b></label>
        </Row>
        <Row label="Raster ausblenden ab" hint="Abstand, ab dem das Raster ausläuft.">
          <label className="set-slider"><input type="range" aria-label="Raster ausblenden ab" min={150} max={1500} step={50} value={s.gridFade} onChange={(e) => useSettings.setState({ gridFade: Number(e.target.value) })} /><b>{s.gridFade} mm</b></label>
        </Row>
        <Switch label="Oberflächenstruktur" hint="Feine, matte Körnung auf den Objekten; nur für die Anzeige." value={s.surfaceTexture} onChange={(surfaceTexture) => useSettings.setState({ surfaceTexture })} />
      </Group>
      <Group title="Leistung">
        <Row label="Qualität" hint="Weniger Schärfe schont Akku und Lüfter.">
          <SegmentedControl size="sm" value={s.quality} onChange={(quality) => useSettings.setState({ quality })}
            options={[{ value: "high", label: "Hoch" }, { value: "balanced", label: "Ausgewogen" }, { value: "eco", label: "Sparsam" }]} />
        </Row>
      </Group>
    </>
  );
}

function Updates() {
  const autoCheck = useUpdatePrefs((s) => s.autoCheck);
  const lastCheck = useUpdatePrefs((s) => s.lastCheck);
  const checking = useUpdater((s) => s.status === "checking" || s.status === "downloading");
  return (
    <Group>
      <Row label="Installierte Version"><Version /></Row>
      <Switch label="Automatisch beim Start prüfen" value={autoCheck} onChange={(v) => useUpdatePrefs.setState({ autoCheck: v })} />
      <Row label="Nach Updates suchen" hint={lastCheck > 0 ? `Zuletzt geprüft: ${new Date(lastCheck).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}` : undefined}>
        <button className="btn-ghost" disabled={!isTauri || checking} onClick={() => void checkForUpdates()}><Icon name="update" size={14} />Jetzt suchen</button>
      </Row>
    </Group>
  );
}

function Developer() {
  const [count, setCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const refresh = () => void readErrors().then((e) => setCount(e.length)).catch(() => setCount(0));
  useEffect(refresh, []);
  const copy = async () => {
    const entries = await readErrors();
    await navigator.clipboard.writeText(entries.length ? formatErrors(entries) : "Keine Fehler protokolliert.");
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <Group>
      <Row label="Fehlerprotokoll" hint="Die letzten 100 Fehler (KI, CAD-Kern, MCP, App). Schlüssel werden nie gespeichert.">
        <b className="set-value">{isTauri ? `${count} ${count === 1 ? "Eintrag" : "Einträge"}` : "nur in der App"}</b>
      </Row>
      <Row label="Protokoll">
        <div className="set-buttons">
          <button className="btn-ghost" disabled={!isTauri} onClick={() => void copy()}><Icon name="duplicate" size={14} />{copied ? "Kopiert" : "Kopieren"}</button>
          <button className="btn-ghost" disabled={!isTauri} onClick={() => void openErrorFolder()}><Icon name="file" size={14} />Ordner öffnen</button>
          <button className="btn-ghost" disabled={!isTauri || !count} onClick={() => void clearErrors().then(refresh)}><Icon name="delete" size={14} />Leeren</button>
        </div>
      </Row>
    </Group>
  );
}

const CONTENT: Record<SettingsSection, () => ReactNode> = {
  general: General,
  ai: Ai,
  mcp: McpSettings,
  view: View,
  printer: () => <Group><div className="set-block"><Printer /></div></Group>,
  updates: Updates,
  developer: Developer,
};

export function SettingsDialog() {
  const open = useSettingsDialog((s) => s.open);
  const section = useSettingsDialog((s) => s.section);
  const close = () => useSettingsDialog.setState({ open: false });
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // An open dropdown takes its own Esc first.
      if (e.key === "Escape" && !document.querySelector("[data-floating]")) {
        e.stopImmediatePropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);
  if (!open) return null;
  const current = SETTINGS_SECTIONS.find((s) => s.id === section)!;
  const Content = CONTENT[section];
  return (
    <div className="help-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      {/* Shortcuts of the app stay quiet while the window is open. */}
      <div className="help settings" role="dialog" aria-label="Einstellungen" onKeyDown={(e) => e.stopPropagation()}>
        <aside className="help-side">
          <div className="help-head">
            <img src={logo} alt="" />
            <div>
              <div className="help-title">Einstellungen</div>
              <div className="help-sub">Cubrix einrichten</div>
            </div>
          </div>
          <nav
            className="help-list scroll"
            aria-label="Abschnitte"
            onKeyDown={(e) => {
              if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
              e.preventDefault();
              const next = stepSection(section, e.key === "ArrowDown" ? 1 : -1);
              useSettingsDialog.setState({ section: next });
              (e.currentTarget.querySelector(`[data-section="${next}"]`) as HTMLElement | null)?.focus();
            }}
          >
            {SETTINGS_SECTIONS.map((s) => (
              <button key={s.id} data-section={s.id} className={`help-item ${s.id === section ? "on" : ""}`} aria-current={s.id === section ? "page" : undefined} onClick={() => useSettingsDialog.setState({ section: s.id })}>
                <Icon name={s.icon as IconName} size={16} />
                <span>{s.title}</span>
              </button>
            ))}
          </nav>
        </aside>
        <article className="help-body scroll" key={section}>
          <button className="help-close icon-btn" onClick={close} data-tip="Schließen" data-kbd="escape" data-tip-pos="bottom-end">
            <X size={16} />
          </button>
          <div className="help-topic-head">
            <span className="help-topic-icon"><Icon name={current.icon as IconName} size={20} /></span>
            <div>
              <h1>{current.title}</h1>
              <p className="set-summary">{current.summary}</p>
            </div>
          </div>
          <Content />
        </article>
      </div>
    </div>
  );
}

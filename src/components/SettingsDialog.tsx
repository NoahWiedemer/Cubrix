// Einstellungen (logo menu): Updates (version, auto-check) and Entwickler (error log).
import { useEffect, useState } from "react";
import { create } from "zustand";
import { X } from "lucide-react";
import { clearErrors, formatErrors, openErrorFolder, readErrors } from "../core/errorLog";
import { isTauri } from "../core/platform";
import { Icon } from "../ui/icons";
import { checkForUpdates, updateSource, useUpdatePrefs, useUpdater } from "../core/updater";

export const useSettingsDialog = create<{ open: boolean }>(() => ({ open: false }));

export function SettingsDialog() {
  const open = useSettingsDialog((s) => s.open);
  const [count, setCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const [version, setVersion] = useState("");
  const autoCheck = useUpdatePrefs((s) => s.autoCheck);
  const lastCheck = useUpdatePrefs((s) => s.lastCheck);
  const checking = useUpdater((s) => s.status === "checking" || s.status === "downloading");

  const refresh = () => void readErrors().then((e) => setCount(e.length)).catch(() => setCount(0));
  useEffect(() => {
    if (!open) return;
    refresh();
    void updateSource.currentVersion().then(setVersion).catch(() => {});
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && useSettingsDialog.setState({ open: false });
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!open) return null;

  const copy = async () => {
    const entries = await readErrors();
    await navigator.clipboard.writeText(entries.length ? formatErrors(entries) : "Keine Fehler protokolliert.");
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="help-backdrop" onMouseDown={(e) => e.target === e.currentTarget && useSettingsDialog.setState({ open: false })}>
      <div className="settings-dialog panel" role="dialog" aria-label="Einstellungen">
        <header>
          <span>Einstellungen</span>
          <button className="icon-btn small" onClick={() => useSettingsDialog.setState({ open: false })} data-tip="Schließen" data-kbd="escape" data-tip-pos="bottom-end">
            <X size={15} />
          </button>
        </header>
        <section>
          <h4 className="tab-heading">Updates</h4>
          <div className="dev-row">
            <Icon name="update" size={15} />
            <span>Installierte Version</span>
            <b>{version ? `v${version}` : "…"}</b>
          </div>
          <button className="toggle" role="switch" aria-checked={autoCheck} onClick={() => useUpdatePrefs.setState({ autoCheck: !autoCheck })}>
            <span>Automatisch beim Start prüfen</span>
            <span className={`switch ${autoCheck ? "on" : ""}`}><i /></span>
          </button>
          <div className="props-actions tight">
            <button className="btn-ghost" disabled={!isTauri || checking} onClick={() => void checkForUpdates()}>
              <Icon name="update" size={14} />Nach Updates suchen
            </button>
            {lastCheck > 0 && <span className="subtle-hint inline">Zuletzt geprüft: {new Date(lastCheck).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}</span>}
          </div>
        </section>
        <section>
          <h4 className="tab-heading">Entwickler</h4>
          <div className="dev-row">
            <Icon name="warn" size={15} />
            <span>Fehlerprotokoll</span>
            <b>{isTauri ? `${count} ${count === 1 ? "Eintrag" : "Einträge"}` : "nur in der App"}</b>
          </div>
          <p className="subtle-hint">Die letzten 100 Fehler (KI, CAD-Kern, Befehle, App). Schlüssel werden nie gespeichert.</p>
          <div className="props-actions tight">
            <button className="btn-ghost" disabled={!isTauri} onClick={() => void copy()}>
              <Icon name="duplicate" size={14} />{copied ? "Kopiert" : "Fehler kopieren"}
            </button>
            <button className="btn-ghost" disabled={!isTauri} onClick={() => void openErrorFolder()}>
              <Icon name="file" size={14} />Ordner öffnen
            </button>
            <button className="btn-ghost" disabled={!isTauri || !count} onClick={() => void clearErrors().then(refresh)}>
              <Icon name="delete" size={14} />Leeren
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

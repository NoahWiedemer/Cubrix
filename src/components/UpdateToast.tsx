// Update notice (bottom right): found version with short notes, download progress,
// restart. Manual checks also show "aktuell" and gentle errors here.
import { X } from "lucide-react";
import { dismissUpdate, installUpdate, updateSource, useUpdater } from "../core/updater";
import { Icon } from "../ui/icons";

/** First few lines of the release notes, without Markdown noise. */
export function shortNotes(notes: string | undefined, max = 4): string[] {
  if (!notes) return [];
  return notes
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .map((l) => l.replace(/^\s*[-*]\s+|\*\*/g, "").trim())
    .filter((l) => l && !/^full changelog|^what's changed$/i.test(l))
    .slice(0, max);
}

const mb = (n: number) => (n / 1024 / 1024).toFixed(1).replace(".", ",");

export function UpdateToast() {
  const { status, update, progress, error, visible } = useUpdater();
  if (!visible || status === "idle") return null;

  let body: React.ReactNode;
  if (status === "checking") body = <div className="upd-line"><span className="spinner small" />Suche nach Updates …</div>;
  else if (status === "none") body = <div className="upd-line"><Icon name="check" size={15} />Cubrix ist auf dem neuesten Stand.</div>;
  else if (status === "error") body = <div className="upd-line muted"><Icon name="warn" size={15} />{error}</div>;
  else if (status === "available" && update) {
    const notes = shortNotes(update.notes);
    body = (
      <>
        <div className="upd-title">Cubrix {update.version} ist verfügbar</div>
        {notes.length > 0 && (
          <ul className="upd-notes">
            {notes.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        )}
        <div className="upd-actions">
          <button className="btn-ghost small" onClick={dismissUpdate}>Später</button>
          <button className="btn-primary small" onClick={() => void installUpdate()}>Jetzt aktualisieren</button>
        </div>
      </>
    );
  } else if (status === "downloading") {
    const pct = progress.total ? Math.min(100, (progress.done / progress.total) * 100) : null;
    body = (
      <>
        <div className="upd-title">Update wird geladen …</div>
        <div className={`upd-bar ${pct === null ? "indeterminate" : ""}`}><i style={pct === null ? undefined : { width: `${pct}%` }} /></div>
        <div className="upd-sub">{progress.total ? `${mb(progress.done)} von ${mb(progress.total)} MB` : progress.done ? `${mb(progress.done)} MB` : "Verbinde …"}</div>
      </>
    );
  } else if (status === "ready") {
    body = (
      <>
        <div className="upd-title">Update installiert</div>
        <div className="upd-sub">Cubrix startet neu, um die neue Version zu laden. Speichere vorher dein Projekt.</div>
        <div className="upd-actions">
          <button className="btn-ghost small" onClick={dismissUpdate}>Später</button>
          <button className="btn-primary small" onClick={() => void updateSource.relaunch()}>Neu starten</button>
        </div>
      </>
    );
  }

  const closable = status !== "downloading";
  const brief = status === "checking" || status === "none" || status === "error";
  return (
    <div className={`update-toast panel ${brief ? "brief" : ""}`} role="status">
      {!brief && <span className="upd-icon"><Icon name="update" size={16} /></span>}
      <div className="upd-main">{body}</div>
      {closable && (
        <button className="icon-btn small" onClick={dismissUpdate} data-tip="Schließen" data-tip-pos="top-end">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

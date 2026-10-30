// Offer to restore unsaved work found by the autosave (after a crash or quitting unsaved).
import { clearAutosave, useRecovery } from "../core/autosave";
import { loadProjectText } from "../core/commandDefs";

export function RecoveryBanner() {
  const { text, name, time } = useRecovery();
  if (!text) return null;
  const dismiss = () => {
    useRecovery.setState({ text: null });
    void clearAutosave();
  };
  return (
    <div className="recovery" role="alert">
      <span className="recovery-text">
        Nicht gespeichertes Projekt <b>„{name}“</b> von {time} gefunden
      </span>
      <button
        className="btn-primary small"
        onClick={() => {
          loadProjectText(text, null, "Wiederhergestellt");
          useRecovery.setState({ text: null });
        }}
      >
        Wiederherstellen
      </button>
      <button className="btn-ghost small" onClick={dismiss}>Verwerfen</button>
    </div>
  );
}

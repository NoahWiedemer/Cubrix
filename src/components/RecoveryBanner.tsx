// Offer to restore unsaved work found by the autosave (after a crash or quitting unsaved).
import { clearAutosave, useRecovery } from "../core/autosave";
import { loadProjectText } from "../core/commandDefs";
import { Icon } from "../ui/icons";

export function RecoveryBanner() {
  const { text, name, time } = useRecovery();
  if (!text) return null;
  const dismiss = () => {
    useRecovery.setState({ text: null });
    void clearAutosave();
  };
  return (
    <div className="recovery" role="alert">
      <Icon name="history" size={16} />
      <span>
        Ungesicherte Arbeit gefunden: <b>{name}</b> ({time})
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

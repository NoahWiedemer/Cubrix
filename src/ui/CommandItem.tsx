import { execute, formatShortcut, getCommand, isEnabled } from "../core/commands";
import { Icon } from "./icons";

/** A menu row bound to a registered command. */
export function CommandItem({ id, params, label, onDone }: { id: string; params?: Record<string, unknown>; label?: string; onDone?: () => void }) {
  const cmd = getCommand(id);
  if (!cmd) return null;
  return (
    <button
      className="menu-item"
      disabled={!isEnabled(id)}
      title={cmd.description}
      onClick={() => {
        onDone?.();
        void execute(id, params);
      }}
    >
      <Icon name={cmd.icon} size={15} />
      {label ?? cmd.label}
      {cmd.shortcut && <span className="hint">{formatShortcut(cmd.shortcut)}</span>}
    </button>
  );
}

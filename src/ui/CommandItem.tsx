import { execute, getCommand, isEnabled } from "../core/commands";
import { MenuItem } from "./Menu";

/** A menu row bound to a registered command. */
export function CommandItem({ id, params, label, onDone }: { id: string; params?: Record<string, unknown>; label?: string; onDone?: () => void }) {
  const cmd = getCommand(id);
  if (!cmd) return null;
  return (
    <MenuItem
      icon={cmd.icon}
      label={label ?? cmd.label}
      shortcut={cmd.shortcut}
      disabled={!isEnabled(id)}
      title={cmd.description}
      onClick={() => {
        onDone?.();
        void execute(id, params);
      }}
    />
  );
}

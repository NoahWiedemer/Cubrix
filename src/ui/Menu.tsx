// Shared macOS-style menu used for every dropdown and context menu.
import type { CSSProperties, ReactNode } from "react";
import { Check } from "lucide-react";
import { Icon, type IconName } from "./icons";
import { Kbd } from "./Tooltip";
import { shortcutKeys } from "../core/commands";

export function Menu({ children, style, className = "" }: { children: ReactNode; style?: CSSProperties; className?: string }) {
  return (
    <div className={`popover menu ${className}`} style={style} role="menu">
      {children}
    </div>
  );
}

export function MenuItem({
  icon,
  iconNode,
  label,
  shortcut,
  checked,
  disabled,
  title,
  onClick,
}: {
  icon?: IconName;
  /** Custom icon element (e.g. a provider logo) instead of a named icon. */
  iconNode?: ReactNode;
  label: ReactNode;
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean;
  title?: string;
  onClick(): void;
}) {
  return (
    <button className="menu-item" role="menuitem" disabled={disabled} title={title} onClick={onClick}>
      <span className="menu-icon">{iconNode ?? (icon && <Icon name={icon} size={16} />)}</span>
      <span className="menu-label">{label}</span>
      {shortcut && <Kbd keys={shortcutKeys(shortcut)} />}
      <span className="menu-check">{checked && <Check size={14} strokeWidth={2.25} />}</span>
    </button>
  );
}

export const MenuSeparator = () => <div className="menu-sep" />;
export const MenuTitle = ({ children }: { children: ReactNode }) => <div className="menu-title">{children}</div>;

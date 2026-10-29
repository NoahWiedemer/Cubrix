// Shared macOS-style menu used for every dropdown and context menu.
import type { CSSProperties, ReactNode } from "react";
import { Check } from "lucide-react";
import { Icon, type IconName } from "./icons";
import { Kbd } from "./Tooltip";
import { shortcutKeys } from "../core/commands";
import { Floating } from "./Floating";

/**
 * A menu. By default it floats in a portal next to its wrapping element: `style.top` /
 * `style.bottom` pick the preferred side, `style.right` aligns it to the right edge and
 * a `style.left` larger than 0 opens it to the side. `inline` keeps it in place (for
 * menus that are already positioned, like the context menu).
 */
export function Menu({ children, style, className = "", inline, matchWidth }: { children: ReactNode; style?: CSSProperties; className?: string; inline?: boolean; matchWidth?: boolean }) {
  if (inline)
    return (
      <div className={`popover menu ${className}`} style={style} role="menu">
        {children}
      </div>
    );
  const { top, bottom, left, right, position: _p, transform: _t, ...rest } = style ?? {};
  const side = bottom !== undefined && top === undefined ? "top" : typeof left === "number" && left > 0 ? "right" : "bottom";
  const align = right !== undefined && right !== "auto" ? "end" : "start";
  void top;
  return (
    <Floating className={`popover menu ${className}`} style={rest} role="menu" side={side} align={align} matchWidth={matchWidth}>
      {children}
    </Floating>
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

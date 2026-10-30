// The app's dropdown: a button with a list in a portal, so no panel clips it. Keyboard as
// on a native select: Enter, Space or arrows open, arrows and typing move, Enter picks,
// Esc closes. Focus never leaves the button, so it is back there by itself.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Floating } from "./Floating";
import { flatten, matchTypeahead, moveActive, type SelectGroup } from "./selectKeys";
import { usePopover } from "./usePopover";

export type { SelectGroup, SelectOption } from "./selectKeys";

const TYPEAHEAD_MS = 600;

export function Select<T extends string>({ value, onChange, groups, label, className = "", disabled, placeholder }: {
  value: T;
  onChange(value: T): void;
  groups: SelectGroup<T>[];
  /** Accessible name; the control has no visible label of its own. */
  label: string;
  className?: string;
  disabled?: boolean;
  placeholder?: ReactNode;
}) {
  const options = flatten(groups);
  const selected = options.findIndex((o) => o.value === value);
  const pop = usePopover();
  const [active, setActive] = useState(0);
  const typed = useRef({ text: "", at: 0 });
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const current = options[selected];

  const open = () => {
    setActive(selected >= 0 ? selected : moveActive(options, -1, 1));
    pop.setOpen(true);
  };
  const pick = (i: number) => {
    const o = options[i];
    if (!o || o.disabled) return;
    pop.setOpen(false);
    if (o.value !== value) onChange(o.value);
  };

  useEffect(() => {
    if (pop.open) list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [pop.open, active]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (!pop.open) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        open();
      }
      return;
    }
    const keys: Record<string, () => void> = {
      ArrowDown: () => setActive(moveActive(options, active, 1)),
      ArrowUp: () => setActive(moveActive(options, active, -1)),
      Home: () => setActive(moveActive(options, -1, 1)),
      End: () => setActive(moveActive(options, options.length, -1)),
      Enter: () => pick(active),
      Tab: () => pop.setOpen(false),
      Escape: () => pop.setOpen(false),
    };
    const run = keys[e.key] ?? (e.key === " " && !typed.current.text ? keys.Enter : undefined);
    if (run) {
      if (e.key !== "Tab") e.preventDefault();
      // Esc closes the list, not the window around it.
      e.stopPropagation();
      return run();
    }
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      const now = Date.now();
      const text = (now - typed.current.at > TYPEAHEAD_MS ? "" : typed.current.text) + e.key;
      typed.current = { text, at: now };
      const hit = matchTypeahead(options, text, active);
      if (hit >= 0) setActive(hit);
    }
  };

  let index = -1;
  return (
    <div ref={pop.ref} className={`ui-select ${className}`}>
      <button
        type="button"
        className={`select-btn ${pop.open ? "open" : ""}`}
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={pop.open}
        aria-controls={pop.open ? id : undefined}
        aria-activedescendant={pop.open ? `${id}-${active}` : undefined}
        disabled={disabled}
        onClick={() => (pop.open ? pop.setOpen(false) : open())}
        onKeyDown={onKeyDown}
      >
        {current?.icon}
        <span>{current?.label ?? placeholder}</span>
        <ChevronDown size={14} />
      </button>
      {pop.open && (
        <Floating className="popover menu ui-select-list" role="listbox" matchWidth>
          <div ref={list} id={id} aria-label={label}>
            {groups.map((g, gi) => (
              <div key={gi} role="group" aria-label={g.label}>
                {g.label && <div className="menu-title">{g.icon}{g.label}</div>}
                {g.options.map((o) => {
                  const i = ++index;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      id={`${id}-${i}`}
                      data-index={i}
                      tabIndex={-1}
                      role="option"
                      aria-selected={o.value === value}
                      disabled={o.disabled}
                      className={`menu-item ${i === active ? "active" : ""}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => !o.disabled && setActive(i)}
                      onClick={() => pick(i)}
                    >
                      {o.icon && <span className="menu-icon">{o.icon}</span>}
                      <span className="menu-label">{o.label}{o.hint && <small>{o.hint}</small>}</span>
                      <span className="menu-check">{o.value === value && <Check size={14} strokeWidth={2.25} />}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </Floating>
      )}
    </div>
  );
}

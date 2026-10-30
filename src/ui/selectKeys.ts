// Keyboard logic of the Select, apart from React.
import type { ReactNode } from "react";

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  hint?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SelectGroup<T extends string = string> {
  label?: string;
  icon?: ReactNode;
  options: SelectOption<T>[];
}

export const flatten = <T extends string>(groups: SelectGroup<T>[]) => groups.flatMap((g) => g.options);

/** Next enabled option from `from` in direction `delta`; stays put at either end. */
export function moveActive(options: SelectOption[], from: number, delta: 1 | -1) {
  for (let i = from + delta; i >= 0 && i < options.length; i += delta) if (!options[i].disabled) return i;
  return from;
}

/** Option starting with `text`: a repeated letter walks on, longer text stays on its match. */
export function matchTypeahead(options: SelectOption[], text: string, from: number) {
  const repeated = text.length > 1 && [...text].every((c) => c === text[0]);
  const query = (repeated ? text[0] : text).toLowerCase();
  const start = text.length === 1 || repeated ? from + 1 : from;
  for (let k = 0; k < options.length; k++) {
    const i = (Math.max(start, 0) + k) % options.length;
    if (!options[i].disabled && options[i].label.toLowerCase().startsWith(query)) return i;
  }
  return -1;
}

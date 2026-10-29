// Hold Space for a temporary hand tool (Figma/Photoshop style): left-drag pans the
// view, releasing Space returns to the active tool. In-progress sketch shapes are
// untouched. Ignored while typing in a text field; key repeat and the browser's
// "Space clicks the focused button" are swallowed.
import { create } from "zustand";

export const useSpacePan = create<{ held: boolean }>(() => ({ held: false }));

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
};

if (typeof window !== "undefined") {
  const set = (held: boolean) => {
    if (useSpacePan.getState().held === held) return;
    useSpacePan.setState({ held });
    document.body.classList.toggle("space-pan", held);
  };
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.code !== "Space" || typing(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) set(true);
    },
    true,
  );
  window.addEventListener(
    "keyup",
    (e) => {
      if (e.code !== "Space" || typing(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      set(false);
    },
    true,
  );
  window.addEventListener("blur", () => set(false));
}

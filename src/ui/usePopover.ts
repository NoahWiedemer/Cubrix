import { useEffect, useRef, useState } from "react";
import { inFloating } from "./Floating";

/** Open/close state for a popover that closes on outside click or Escape. */
export function usePopover<T extends HTMLElement = HTMLDivElement>() {
  const [open, setOpen] = useState(false);
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      // Portal content (the menu itself) counts as inside.
      if (ref.current && !ref.current.contains(e.target as Node) && !inFloating(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

import { useLayoutEffect, useState, type RefObject } from "react";

/** Horizontal correction (px) that keeps a centred popover 8 px inside the window. */
export function useClampX(ref: RefObject<HTMLElement>, centreX: number, centred: boolean) {
  const [dx, setDx] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !centred) return;
    const w = el.offsetWidth;
    const left = centreX - w / 2;
    const fix = left < 8 ? 8 - left : left + w > window.innerWidth - 8 ? window.innerWidth - 8 - (left + w) : 0;
    setDx(fix);
  }, [ref, centreX, centred]);
  return dx;
}

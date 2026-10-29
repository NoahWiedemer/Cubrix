// Popovers and menus render in a portal at the document root, so no panel's
// overflow can clip them. Position: below/above the anchor (flip when there is no
// room), aligned to its start/end edge, shifted and height-capped to stay 8 px inside
// the window. Re-positioned on scroll/resize.
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

const MARGIN = 8;
const GAP = 6;

export interface FloatingProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  role?: string;
  /** Preferred side; flips when it does not fit. */
  side?: "bottom" | "top" | "right";
  align?: "start" | "end" | "center";
  /** At least as wide as the anchor (dropdowns). */
  matchWidth?: boolean;
}

export function Floating({ children, className = "", style, role, side = "bottom", align = "start", matchWidth }: FloatingProps) {
  const marker = useRef<HTMLSpanElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({ visibility: "hidden", left: 0, top: 0 });

  useLayoutEffect(() => {
    const place = () => {
      const anchor = marker.current?.parentElement;
      const el = box.current;
      if (!anchor || !el) return;
      const a = anchor.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.max(el.offsetWidth, matchWidth ? a.width : 0);
      const height = el.scrollHeight;
      // Unused edges are explicitly "auto" so stylesheet offsets can't stretch the box.
      const next: CSSProperties = { minWidth: matchWidth ? a.width : undefined, top: "auto", bottom: "auto", left: "auto", right: "auto", transform: "none" };
      if (side === "right") {
        let left = a.right + GAP;
        if (left + width > vw - MARGIN) left = a.left - GAP - width;
        next.left = Math.max(MARGIN, left);
        next.top = Math.max(MARGIN, Math.min(a.top, vh - MARGIN - height));
        next.maxHeight = vh - 2 * MARGIN;
      } else {
        const below = vh - MARGIN - (a.bottom + GAP);
        const above = a.top - GAP - MARGIN;
        const down = side === "bottom" ? below >= Math.min(height, 240) || below >= above : !(above >= Math.min(height, 240) || above >= below);
        next.maxHeight = Math.max(120, down ? below : above);
        if (down) next.top = a.bottom + GAP;
        else next.bottom = vh - (a.top - GAP);
        let left = align === "end" ? a.right - width : align === "center" ? a.left + a.width / 2 - width / 2 : a.left;
        left = Math.max(MARGIN, Math.min(left, vw - MARGIN - width));
        next.left = left;
      }
      setPos(next);
    };
    place();
    const ro = new ResizeObserver(place);
    if (box.current) ro.observe(box.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [side, align, matchWidth]);

  return (
    <>
      <span ref={marker} hidden />
      {createPortal(
        <div ref={box} data-floating className={`floating ${className}`} role={role} style={{ ...style, ...pos, position: "fixed" }}>
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}

/** True when an event target sits inside any portal popover (for outside-click checks). */
export const inFloating = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.("[data-floating]");

// The WebGL canvas spans the whole main area (behind the sidebars) and never resizes
// when sidebars slide or are resized. The visible part is clipped to the free area,
// and the camera is shifted (view offset) so the scene centre sits in the middle of
// the docked free area. The shift depends only on the dock widths, not on the slide
// animation, so entering or leaving Vorschau moves nothing on screen.
import { create } from "zustand";
import { clampColumnWidth, column } from "./layoutModel";
import type { LayoutData } from "./layoutModel";

/** Current insets (px) of the free area inside the canvas, animated with the sidebars. */
export const useViewportFrame = create<{ left: number; right: number }>(() => ({ left: 0, right: 0 }));

const RAIL = 52 + 8;
const GAP = 8;

/** Docked side widths (rail + left column, right column) in model mode, from the layout. */
export function dockedInsets(l: Pick<LayoutData, "panels" | "width">, windowWidth: number) {
  const side = (s: "left" | "right") => (column(l.panels, s).length ? clampColumnWidth(l.width[s], windowWidth) + GAP : 0);
  return { left: RAIL + side("left"), right: side("right") };
}

/** Horizontal camera shift (px) that centres the scene in the docked free area. */
export function viewShift(insets: { left: number; right: number }) {
  return (insets.left - insets.right) / 2;
}

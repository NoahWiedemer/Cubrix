import { create } from "zustand";

export type SketchTool = "select" | "line" | "rect" | "circle" | "ellipse" | "polygon";

/** Interactive state of the 2D workspace. */
export const useSketch = create<{ tool: SketchTool; activeId: string | null; sides: number }>(() => ({
  tool: "rect",
  activeId: null,
  sides: 6,
}));

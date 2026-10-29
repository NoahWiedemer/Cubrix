import { create } from "zustand";

/** One-shot camera requests from commands (handled by the viewport's camera rig). */
export type ViewRequest =
  | { kind: "iso"; at: number }
  /** Look along a CAD direction (from the camera towards the target). */
  | { kind: "dir"; dir: [number, number, number]; at: number }
  /** Frame a CAD bounding box. */
  | { kind: "fit"; min: [number, number, number]; max: [number, number, number]; at: number };

export const useViewRequest = create<{ request: ViewRequest | null }>(() => ({ request: null }));

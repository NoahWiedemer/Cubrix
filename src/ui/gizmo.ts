import { create } from "zustand";

/** Transform gizmo state: move arrows by default, rotation rings in rotate mode. */
export const useGizmo = create<{ mode: "move" | "rotate"; dragging: boolean }>(() => ({ mode: "move", dragging: false }));

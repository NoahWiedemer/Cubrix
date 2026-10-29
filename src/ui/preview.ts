import { create } from "zustand";

export type PreviewBackground = "dark" | "light" | "studio";

/** State of the presentation ("Vorschau") workspace. */
export const usePreview = create<{
  turntable: boolean;
  background: PreviewBackground;
  captureAt: number;
}>(() => ({ turntable: false, background: "dark", captureAt: 0 }));

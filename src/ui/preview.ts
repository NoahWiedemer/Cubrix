import { create } from "zustand";

export type PreviewBackground = "dark" | "light" | "studio";

/** State of the presentation ("Vorschau") workspace. */
export const usePreview = create<{
  turntable: boolean;
  background: PreviewBackground;
  section: boolean;
  /** Section height in mm (CAD Z). */
  sectionZ: number;
  captureAt: number;
}>(() => ({ turntable: true, background: "studio", section: false, sectionZ: 10, captureAt: 0 }));

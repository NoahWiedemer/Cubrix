// Lets UI outside the canvas (library drag and drop) ask what lies under a screen point.
import type { Vec3 } from "../core/document";

export interface PickResult {
  /** Hit point in the CAD frame (Z up), mm. */
  point: Vec3;
  /** Feature under the pointer, if any. */
  featureId?: string;
  /** True when the hit surface faces up (a place to set something on). */
  facesUp: boolean;
}

export const viewportPick: { pick: ((clientX: number, clientY: number) => PickResult | null) | null } = { pick: null };

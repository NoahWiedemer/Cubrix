// Applies Abrunden/Fasen: too large values are clamped to the largest size that really
// builds for this body (checked in the kernel), no error. Used by the Inspektor and the
// value popover; the result says whether it was clamped so the field can show "max. …".
import { clampEdge } from "../cad/kernel";
import { execute } from "../core/commands";
import { maxEdgeSize } from "../core/commandDefs";
import { findFeature } from "../core/document";
import { useApp } from "../core/store";

export async function applyEdge(id: string, edge: "fillet" | "chamfer", value: number): Promise<{ value: number; limit: number | null }> {
  const s = useApp.getState();
  const f = findFeature(s.nodes[s.currentId].doc, id);
  if (!f) return { value, limit: null };
  if (value <= 0) {
    await execute(`object.${edge}`, { id, radius: 0 });
    return { value: 0, limit: null };
  }
  // The analytic bound is only the first guess; the kernel has the last word.
  const other = (edge === "fillet" ? f.chamfer : f.fillet) ?? 0;
  const base = maxEdgeSize(f);
  const guess = base === null ? value : Math.min(value, Math.max(0.01, Math.floor((base - other - 0.01) * 100) / 100));
  const v = await clampEdge(f, edge, guess);
  if (v <= 0) {
    s.toast("error", `${f.name} lässt sich so nicht ${edge === "fillet" ? "abrunden" : "fasen"}.`);
    return { value: f[edge] ?? 0, limit: null };
  }
  await execute(`object.${edge}`, { id, radius: v });
  return { value: v, limit: v < value ? v : null };
}

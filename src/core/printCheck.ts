import { useApp } from "./store";
import { useMeshes } from "../cad/kernel";
import { geometryKey } from "./document";
import { worldBox } from "./bounds";

export interface PrintCheckResult {
  state: "idle" | "ok" | "warn";
  title: string;
  issues: string[];
}

const mm = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString("de-DE")} mm`;

export function usePrintCheck(): PrintCheckResult {
  const doc = useApp((s) => s.nodes[s.currentId].doc);
  const preview = useApp((s) => s.preview);
  const entries = useMeshes((s) => s.entries);
  const visible = doc.features.filter((f) => f.visible && f.type !== "sketch");
  if (!visible.length) return { state: "idle", title: "Noch nichts zu prüfen", issues: [] };
  if (visible.some((f) => !entries[geometryKey(f)])) return { state: "idle", title: "Wird geprüft …", issues: [] };

  const [vx, vy, vz] = doc.printer.volume;
  const issues: string[] = [];
  for (const f of visible) {
    const t = preview?.id === f.id ? preview.transform : f.transform;
    const b = worldBox(f, entries, t)!;
    if (entries[geometryKey(f)].geometry.index?.count === 0) {
      issues.push(`${f.name} ist leer`);
      continue;
    }
    if (b.min.z > 0.05) issues.push(`${f.name} schwebt ${mm(b.min.z)} über dem Bett`);
    if (b.min.z < -0.05) issues.push(`${f.name} ragt ${mm(-b.min.z)} unter das Bett`);
    if (b.max.z > vz + 0.01) issues.push(`${f.name} ist zu hoch für den Bauraum`);
    if (b.min.x < -vx / 2 - 0.01 || b.max.x > vx / 2 + 0.01 || b.min.y < -vy / 2 - 0.01 || b.max.y > vy / 2 + 0.01)
      issues.push(`${f.name} ragt über das Druckbett hinaus`);
  }
  if (!issues.length) return { state: "ok", title: "Wasserdicht – keine Probleme", issues };
  return { state: "warn", title: issues.length === 1 ? "1 Hinweis" : `${issues.length} Hinweise`, issues };
}

import { execute } from "../core/commands";
import { useDoc } from "../core/store";
import { geometryKey } from "../core/document";
import { useMeshes } from "../cad/kernel";
import { worldBox } from "../core/bounds";
import { meshVolume, overhangArea, rotationOf } from "../core/printAnalysis";
import { usePrintCheck } from "../core/printCheck";
import { Icon } from "../ui/icons";
import { create } from "zustand";
import * as THREE from "three";

/** Overhang overlay (red > 45°) in the viewport, toggled from the Drucker tab. */
export const usePrintView = create<{ overhangs: boolean }>(() => ({ overhangs: false }));

const nf = (n: number, d = 1) => n.toLocaleString("de-DE", { maximumFractionDigits: d, minimumFractionDigits: d });

/** Printability summary for the Drucker tab: size, volume, material, overhangs, hints. */
export function PrintSummary() {
  const doc = useDoc();
  const entries = useMeshes((s) => s.entries);
  const overhangs = usePrintView((s) => s.overhangs);
  const check = usePrintCheck();
  const visible = doc.features.filter((f) => f.visible && entries[geometryKey(f)]);

  const box = new THREE.Box3();
  let volume = 0;
  let overhang = 0;
  for (const f of visible) {
    const e = entries[geometryKey(f)];
    const b = worldBox(f, entries);
    if (b) box.union(b);
    volume += meshVolume(e);
    overhang += overhangArea(e, rotationOf(f.transform)).overhang;
  }
  const size = box.isEmpty() ? [0, 0, 0] : [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z];
  // Rough PLA estimate: ~2 perimeters + 20 % infill ≈ 45 % of the solid volume, 1,24 g/cm³.
  const grams = (volume / 1000) * 1.24 * 0.45;

  return (
    <>
      <h4 className="tab-heading">Druckbarkeit</h4>
      {check.issues.length > 0 && (
        <ul className="issue-list subtle">
          {check.issues.map((i) => <li key={i}><Icon name="warn" size={13} />{i}</li>)}
        </ul>
      )}
      <div className="stats">
        <span>Größe</span><b>{size.map((v) => nf(v)).join(" × ")} mm</b>
        <span>Volumen</span><b>{nf(volume / 1000, 1)} cm³</b>
        <span>Material</span><b>ca. {nf(grams, 0)} g PLA</b>
        <span>Überhänge</span><b className={overhang > 1 ? "warn" : "ok"}>{overhang > 1 ? `${nf(overhang / 100, 1)} cm²` : "keine"}</b>
      </div>
      <div className="props-actions tight">
        <button className="btn-ghost" onClick={() => execute("print.orient")}>
          <Icon name="orient" size={14} />Beste Drucklage
        </button>
        <button className={`btn-ghost ${overhangs ? "on" : ""}`} onClick={() => usePrintView.setState({ overhangs: !overhangs })} aria-pressed={overhangs}>
          <Icon name="warn" size={14} />Überhänge zeigen
        </button>
      </div>
    </>
  );
}

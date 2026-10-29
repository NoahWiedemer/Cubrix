import { execute } from "../core/commands";
import { useDoc } from "../core/store";
import { geometryKey } from "../core/document";
import { useMeshes } from "../cad/kernel";
import { worldBox } from "../core/bounds";
import { PRINTERS, meshVolume, overhangArea, rotationOf } from "../core/printAnalysis";
import { usePrintCheck } from "../core/printCheck";
import { Icon } from "../ui/icons";
import { create } from "zustand";
import * as THREE from "three";

export const usePrintView = create<{ overhangs: boolean }>(() => ({ overhangs: true }));

const nf = (n: number, d = 1) => n.toLocaleString("de-DE", { maximumFractionDigits: d, minimumFractionDigits: d });

/** Right-hand card in the "Druck vorbereiten" workspace. */
export function PrintPanel() {
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
    <aside className="props-overlay in print-panel" onPointerDown={(e) => e.stopPropagation()}>
      <div className="props-title">
        <span className="badge"><Icon name="printer" size={16} /></span>
        <div style={{ minWidth: 0 }}>
          <div className="name">Druck vorbereiten</div>
          <div className="type">{visible.length} {visible.length === 1 ? "Objekt" : "Objekte"}</div>
        </div>
      </div>

      <div className="group">
        <div className="group-label"><span><Icon name="printer" size={15} />Drucker</span></div>
        <select className="select" value={doc.printer.name} onChange={(e) => execute("printer.set", { name: e.target.value })}>
          {PRINTERS.map((p) => (
            <option key={p.name} value={p.name}>{p.name} · {p.volume.join(" × ")} mm</option>
          ))}
        </select>
      </div>

      <div className="group">
        <div className="group-label"><span><Icon name="measure" size={15} />Übersicht</span></div>
        <div className="stats">
          <span>Größe</span><b>{size.map((v) => nf(v)).join(" × ")} mm</b>
          <span>Volumen</span><b>{nf(volume / 1000, 1)} cm³</b>
          <span>Material</span><b>ca. {nf(grams, 0)} g PLA</b>
          <span>Überhänge</span><b className={overhang > 1 ? "warn" : "ok"}>{overhang > 1 ? `${nf(overhang / 100, 1)} cm²` : "keine"}</b>
        </div>
      </div>

      <div className="group">
        <div className="group-label"><span><Icon name="orient" size={15} />Lage</span></div>
        <div className="props-actions tight">
          <button className="btn-ghost" onClick={() => execute("object.dropToBed", { ids: doc.features.map((f) => f.id) })}>
            <Icon name="dropToBed" size={14} />Alles aufs Bett
          </button>
          <button className="btn-ghost" onClick={() => execute("print.orient")}>
            <Icon name="orient" size={14} />Beste Drucklage
          </button>
        </div>
        <label className="toggle-row">
          <input type="checkbox" checked={overhangs} onChange={(e) => usePrintView.setState({ overhangs: e.target.checked })} />
          <span>Überhänge über 45° rot zeigen</span>
        </label>
      </div>

      {check.issues.length > 0 && (
        <div className="group">
          <div className="group-label"><span><Icon name="warn" size={15} />Hinweise</span></div>
          <ul className="issue-list">
            {check.issues.map((i) => <li key={i}>{i}</li>)}
          </ul>
        </div>
      )}

      <div className="group">
        <div className="group-label"><span><Icon name="export" size={15} />Exportieren</span></div>
        <div className="export-grid">
          {(["stl", "3mf", "obj", "step"] as const).map((f) => (
            <button key={f} className={`btn-ghost ${f === "3mf" ? "primary-soft" : ""}`} onClick={() => execute(`export.${f}`)}>
              <Icon name="export" size={14} />{f.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div style={{ height: 8 }} />
    </aside>
  );
}


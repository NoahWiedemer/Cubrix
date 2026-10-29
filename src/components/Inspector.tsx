import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { create } from "zustand";
import * as THREE from "three";
import { execute, shortcutKeys } from "../core/commands";
import { Kbd } from "../ui/Tooltip";
import { SNAPS } from "./StatusBar";
import { useApp, useDoc } from "../core/store";
import { geometryKey, isSolid, type Vec3 } from "../core/document";
import { useMeshes } from "../cad/kernel";
import { worldBox } from "../core/bounds";
import { PRINTERS } from "../core/printAnalysis";
import { useSettings } from "../ui/settings";
import { SegmentedControl } from "../ui/SegmentedControl";
import { Icon } from "../ui/icons";
import { PropertiesPanel } from "./PropertiesPanel";

type Tab = "props" | "printer" | "view";
const useInspector = create<{ tab: Tab }>(() => ({ tab: "props" }));

const nf = (n: number) => (Math.round(n * 10) / 10).toLocaleString("de-DE");

/** Quiet scene info when nothing is selected. */
function SceneInfo() {
  const doc = useDoc();
  const entries = useMeshes((s) => s.entries);
  const solids = doc.features.filter((f) => f.visible && isSolid(f));
  const box = new THREE.Box3();
  for (const f of solids) {
    const b = entries[geometryKey(f)] ? worldBox(f, entries) : null;
    if (b) box.union(b);
  }
  if (!solids.length) return null;
  const size = box.isEmpty() ? null : [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z];
  return (
    <div className="scene-info">
      <div><span>Objekte</span><b>{doc.features.length}</b></div>
      {size && <div><span>Gesamtgröße</span><b>{size.map(nf).join(" × ")} mm</b></div>}
    </div>
  );
}

function Printer() {
  const doc = useDoc();
  const preset = PRINTERS.find((p) => p.name === doc.printer.name);
  const [custom, setCustom] = useState<Vec3>(doc.printer.volume);
  return (
    <div className="inspector-section">
      <div className="group-label"><span><Icon name="printer" size={15} />Drucker</span></div>
      <div className="printer-list">
        {PRINTERS.map((p) => (
          <button key={p.name} className={`printer-row ${p.name === doc.printer.name ? "on" : ""}`} onClick={() => execute("printer.set", { name: p.name })}>
            <span>{p.name}</span>
            <span className="printer-dim">{p.volume.join(" × ")}</span>
          </button>
        ))}
        <button className={`printer-row ${!preset ? "on" : ""}`} onClick={() => execute("printer.set", { name: "Eigener Drucker", volume: custom })}>
          <span>Eigener Drucker</span>
          <span className="printer-dim">{custom.join(" × ")}</span>
        </button>
      </div>
      <div className="group-label" style={{ marginTop: 14 }}><span><Icon name="measure" size={15} />Bauraum (mm)</span></div>
      <div className="field-row">
        {custom.map((v, i) => (
          <div className="field" key={i}>
            <label>{"BTH"[i]}</label>
            <input
              value={v}
              inputMode="numeric"
              onChange={(e) => {
                const next = [...custom] as Vec3;
                next[i] = Number(e.target.value.replace(",", ".")) || 0;
                setCustom(next);
              }}
              onBlur={() => execute("printer.set", { name: "Eigener Drucker", volume: custom })}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
          </div>
        ))}
      </div>
      <VolumeToggles />
    </div>
  );
}

/** Build-volume display options (Drucker tab). */
function VolumeToggles() {
  const showVolume = useSettings((s) => s.showVolume);
  const volumeStrong = useSettings((s) => s.volumeStrong);
  return (
    <>
      <Toggle label="Bauraum anzeigen" value={showVolume} onChange={(v) => useSettings.setState({ showVolume: v })} />
      {showVolume && <Toggle label="Bauraum deutlich" value={volumeStrong} onChange={(v) => useSettings.setState({ volumeStrong: v })} />}
    </>
  );
}

function Toggle({ label, kbd, value, onChange }: { label: string; kbd?: string; value: boolean; onChange(v: boolean): void }) {
  return (
    <button className="toggle" role="switch" aria-checked={value} onClick={() => onChange(!value)}>
      <span>{label}{kbd && <Kbd keys={shortcutKeys(kbd)} />}</span>
      <span className={`switch ${value ? "on" : ""}`}><i /></span>
    </button>
  );
}

function View() {
  const s = useSettings();
  const snap = useApp((st) => st.snap);
  const [more, setMore] = useState(false);
  return (
    <div className="inspector-section view-tab">
      <section>
        <h4>Raster</h4>
        <Toggle label="Raster anzeigen" kbd="g" value={s.showGrid} onChange={(showGrid) => useSettings.setState({ showGrid })} />
        {s.showGrid && (
          <label className="slider-row">
            <span>Stärke</span>
            <input type="range" min={0} max={100} step={5} value={s.gridStrength} onChange={(e) => useSettings.setState({ gridStrength: Number(e.target.value) })} />
            <b>{s.gridStrength} %</b>
          </label>
        )}
      </section>
      <section>
        <h4>Einrasten</h4>
        <SegmentedControl size="sm" className="block" value={String(snap)} onChange={(v) => execute("view.snap", { mm: Number(v) })}
          options={SNAPS.map((mm) => ({ value: String(mm), label: mm === 0 ? "Aus" : mm.toLocaleString("de-DE") }))} />
      </section>
      <section>
        <h4>Kamera</h4>
        <SegmentedControl size="sm" className="block" value={s.projection} onChange={(mode) => execute("view.projection", { mode })}
          options={[{ value: "perspective", label: "Perspektive" }, { value: "orthographic", label: "Orthografisch" }]} />
      </section>
      <button className="more-row" onClick={() => setMore(!more)}>
        {more ? <ChevronDown size={14} /> : <ChevronRight size={14} />}Mehr
      </button>
      {more && (
        <label className="slider-row">
          <span>Raster ausblenden ab</span>
          <input type="range" min={150} max={1500} step={50} value={s.gridFade} onChange={(e) => useSettings.setState({ gridFade: Number(e.target.value) })} />
          <b>{s.gridFade} mm</b>
        </label>
      )}
    </div>
  );
}

/** Tab bar shown in the inspector panel's header. */
export function InspectorTabs() {
  const tab = useInspector((s) => s.tab);
  return (
    <SegmentedControl size="sm" className="block inspector-tabs" value={tab} onChange={(t) => useInspector.setState({ tab: t })}
      options={[{ value: "props", label: "Inspektor" }, { value: "printer", label: "Drucker" }, { value: "view", label: "Ansicht" }]} />
  );
}

/** Inspector content: properties of the selection, printer and view settings. */
export function InspectorBody() {
  const tab = useInspector((s) => s.tab);
  const hasSelection = useApp((s) => s.selection.length > 0);
  return (
    <div className="scroll inspector-body props-overlay-look">
      {tab === "props" && (hasSelection ? <PropertiesPanel /> : <SceneInfo />)}
      {tab === "printer" && <Printer />}
      {tab === "view" && <View />}
    </div>
  );
}

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
import { MANUAL, PRINTERS } from "../core/printAnalysis";
import { usePopover } from "../ui/usePopover";
import { MenuItem } from "../ui/Menu";
import { PrintSummary } from "./PrintPanel";
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
  const manual = !PRINTERS.some((p) => p.name === doc.printer.name);
  const pop = usePopover();
  const [query, setQuery] = useState("");
  const list = PRINTERS.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));
  const setVolume = (i: number, v: number) => {
    const volume = [...doc.printer.volume] as Vec3;
    volume[i] = v;
    void execute("printer.set", { name: MANUAL, volume });
  };
  return (
    <div className="inspector-section printer-tab">
      <h4 className="tab-heading">Drucker</h4>
      <div ref={pop.ref} style={{ position: "relative" }}>
        <button className={`select-btn ${pop.open ? "open" : ""}`} onClick={() => { setQuery(""); pop.setOpen(!pop.open); }}>
          <Icon name="printer" size={15} />
          <span>{manual ? MANUAL : doc.printer.name}</span>
          <ChevronDown size={14} />
        </button>
        {pop.open && (
          <div className="popover menu select-menu" role="menu">
            <input className="select-search" autoFocus placeholder="Drucker suchen…" value={query} onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") pop.setOpen(false); }} />
            {"manuell".includes(query.toLowerCase()) && (
              <MenuItem icon="measure" label={MANUAL} checked={manual} onClick={() => { void execute("printer.set", { name: MANUAL, volume: doc.printer.volume }); pop.setOpen(false); }} />
            )}
            {list.map((p) => (
              <MenuItem key={p.name} label={<span className="printer-opt"><span>{p.name}</span><span className="printer-dim">{p.volume.join(" × ")}</span></span>}
                checked={p.name === doc.printer.name} onClick={() => { void execute("printer.set", { name: p.name }); pop.setOpen(false); }} />
            ))}
          </div>
        )}
      </div>
      <div className="field-row">
        {doc.printer.volume.map((v, i) => (
          <NumberInput key={`${doc.printer.name}-${i}`} label={"XYZ"[i]} value={v} readOnly={!manual} onCommit={(n) => setVolume(i, n)} />
        ))}
      </div>
      <div className="field-caption"><span>Breite</span><span>Tiefe</span><span>Höhe</span></div>
      {!manual && <p className="hint">Werte ändern schaltet auf „Manuell“.</p>}
      <VolumeToggles />
      <PrintSummary />
    </div>
  );
}

/** Small mm field; editing a preset's value switches the printer to "Manuell". */
function NumberInput({ label, value, readOnly, onCommit }: { label: string; value: number; readOnly: boolean; onCommit(v: number): void }) {
  const [text, setText] = useState(String(value));
  return (
    <div className={`field ${readOnly ? "preset" : ""}`}>
      <label>{label}</label>
      <input
        value={text}
        inputMode="numeric"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const n = Number(text.replace(",", "."));
          if (Number.isFinite(n) && n !== value) onCommit(n);
          else setText(String(value));
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
      <span className="unit">mm</span>
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

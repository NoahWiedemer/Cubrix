import { useEffect, useRef, useState } from "react";
import { Link2, Link2Off } from "lucide-react";
import { execute } from "../core/commands";
import { useApp, useDoc } from "../core/store";
import { featureTypeLabel, type Feature, type PrimitiveFeature, type Transform, type Vec3 } from "../core/document";
import { useMeshes } from "../cad/kernel";
import { worldBox } from "../core/bounds";
import { Icon } from "../ui/icons";
import { featureIcon } from "./ObjectTree";
import { useLayout } from "../ui/layout";

const show = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");
const parse = (s: string) => Number(s.trim().replace(",", "."));

interface NumberFieldProps {
  value: number;
  label?: string;
  axis?: "x" | "y" | "z";
  unit?: string;
  step?: number;
  min?: number;
  readOnly?: boolean;
  onCommit(v: number): void;
  /** Called continuously while scrubbing the label; commit follows on release. */
  onPreview?(v: number): void;
}

function NumberField({ value, label, axis, unit = "mm", step = 1, min, readOnly, onCommit, onPreview }: NumberFieldProps) {
  const [text, setText] = useState(show(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(show(value));
  }, [value]);

  const clamp = (v: number) => (min !== undefined ? Math.max(min, v) : v);
  const commit = (v: number) => {
    if (!Number.isFinite(v)) return setText(show(value));
    v = clamp(v);
    setText(show(v));
    if (Math.abs(v - value) > 1e-9) onCommit(v);
  };

  const scrub = (e: React.PointerEvent<HTMLLabelElement>) => {
    if (readOnly) return;
    e.preventDefault();
    const startX = e.clientX;
    const start = value;
    let current = value;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const unit = step * (ev.altKey ? 0.1 : 1);
      const raw = start + ((ev.clientX - startX) / 4) * unit * (ev.shiftKey ? 10 : 1);
      current = clamp(Math.round(Math.round(raw / unit) * unit * 1000) / 1000);
      setText(show(current));
      onPreview?.(current);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      if (Math.abs(current - start) > 1e-9) onCommit(current);
      else onPreview?.(start);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  const inputRef = useRef<HTMLInputElement>(null);
  // Long values shrink a little instead of being clipped by the unit.
  const fontSize = text.length > 6 ? 12 : text.length > 4 ? 13 : undefined;
  return (
    <div
      className="field"
      onMouseDown={(e) => {
        // The whole box is the hit target (except the scrub label): focus and select all.
        if ((e.target as HTMLElement).tagName === "LABEL" || readOnly) return;
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }}
    >
      {label && (
        <label className={axis} onPointerDown={scrub} title={readOnly ? undefined : "Ziehen zum Ändern"}>
          {label}
        </label>
      )}
      <input
        ref={inputRef}
        value={text}
        readOnly={readOnly}
        style={fontSize ? { fontSize } : undefined}
        inputMode="decimal"
        onFocus={(e) => {
          focused.current = true;
          e.target.select();
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          focused.current = false;
          commit(parse(text));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setText(show(value));
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const d = (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            commit(parse(text) + d);
          }
        }}
      />
      {unit && text.length <= 3 && <span className="unit">{unit}</span>}
    </div>
  );
}

const PARAM_FIELDS: Record<PrimitiveFeature["type"], { key: string; label: string }[]> = {
  box: [{ key: "width", label: "Breite" }, { key: "depth", label: "Tiefe" }, { key: "height", label: "Höhe" }],
  cylinder: [{ key: "diameter", label: "Durchmesser" }, { key: "height", label: "Höhe" }],
  sphere: [{ key: "diameter", label: "Durchmesser" }],
  cone: [{ key: "bottomDiameter", label: "Ø unten" }, { key: "topDiameter", label: "Ø oben" }, { key: "height", label: "Höhe" }],
  torus: [{ key: "diameter", label: "Außen-Ø" }, { key: "thickness", label: "Ringdicke" }],
};

function cols(n: number) {
  return n === 3 ? "" : n === 2 ? "two" : "one";
}

function Dimensions({ f }: { f: Feature }) {
  const [locked, setLocked] = useState(false);
  const entries = useMeshes((s) => s.entries);

  if (f.type === "boolean") {
    const b = worldBox(f, entries);
    const size = b ? [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z] : [0, 0, 0];
    return (
      <div className="group">
        <div className="group-label"><span><Icon name="measure" size={15} />Abmessungen</span></div>
        <div className="field-row">
          {size.map((v, i) => <NumberField key={i} value={v} readOnly onCommit={() => {}} />)}
        </div>
        <div className="field-caption"><span>Breite</span><span>Tiefe</span><span>Höhe</span></div>
      </div>
    );
  }

  if (f.type === "sketch") return null;
  const fields = f.type === "extrude" ? [{ key: "height", label: "Höhe" }] : PARAM_FIELDS[f.type];
  const params = (f.type === "extrude" ? { height: f.height } : f.params) as Record<string, number>;
  const set = (key: string, v: number) => {
    let patch: Record<string, number> = { [key]: v };
    if (locked && params[key] > 0) {
      const ratio = v / params[key];
      patch = Object.fromEntries(fields.map(({ key: k }) => [k, Math.round(params[k] * ratio * 100) / 100]));
      patch[key] = v;
    }
    void execute("object.setParams", { id: f.id, params: patch });
  };

  return (
    <div className="group">
      <div className="group-label">
        <span><Icon name="measure" size={15} />Maße</span>
        {fields.length > 1 && (
          <button className={`lock ${locked ? "on" : ""}`} onClick={() => setLocked(!locked)} title={locked ? "Proportionen gesperrt" : "Proportionen sperren"}>
            {locked ? <Link2 size={14} /> : <Link2Off size={14} />}
          </button>
        )}
      </div>
      <div className={`field-row ${cols(fields.length)}`}>
        {fields.map(({ key }) => (
          <NumberField key={key} value={params[key]} min={key === "topDiameter" ? 0 : 0.1} onCommit={(v) => set(key, v)} />
        ))}
      </div>
      <div className={`field-caption ${cols(fields.length)}`} style={fields.length === 1 ? { gridTemplateColumns: "1fr" } : undefined}>
        {fields.map(({ key, label }) => <span key={key}>{label}</span>)}
      </div>
    </div>
  );
}

function TransformFields({ f, kind }: { f: Feature; kind: "position" | "rotation" }) {
  const preview = useApp((s) => (s.preview?.id === f.id ? s.preview.transform : null));
  const t = preview ?? f.transform;
  const values = t[kind];
  const update = (i: number, v: number): Transform => {
    const next = [...values] as Vec3;
    next[i] = v;
    return { ...f.transform, [kind]: next };
  };
  return (
    <div className="group">
      <div className="group-label">
        <span><Icon name={kind === "position" ? "position" : "rotateCw"} size={15} />{kind === "position" ? "Position" : "Drehung"}</span>
        <span className="group-unit">{kind === "position" ? "mm" : "°"}</span>
      </div>
      <div className="field-row">
        {(["x", "y", "z"] as const).map((axis, i) => (
          <NumberField
            key={axis}
            label={axis.toUpperCase()}
            axis={axis}
            unit={kind === "position" ? "mm" : "°"}
            step={kind === "position" ? useApp.getState().snap || 0.5 : 1}
            value={values[i]}
            onPreview={(v) => useApp.setState({ preview: { id: f.id, transform: update(i, v) } })}
            onCommit={(v) => {
              const tr = update(i, v);
              void execute("object.transform", { id: f.id, [kind]: tr[kind] }).then((ok) => !ok && useApp.setState({ preview: null }));
            }}
          />
        ))}
      </div>
    </div>
  );
}

function SingleObject({ f }: { f: Feature }) {
  return (
    <>
      <div className="props-title">
        <span className="badge"><Icon name={featureIcon(f)} size={16} /></span>
        <div style={{ minWidth: 0 }}>
          <div className="name">{f.name}</div>
          <div className="type">{featureTypeLabel(f)}{f.visible ? "" : " · ausgeblendet"}</div>
        </div>
      </div>
      <Dimensions f={f} />
      <TransformFields f={f} kind="position" />
      <TransformFields f={f} kind="rotation" />
      {f.type !== "sphere" && f.type !== "torus" && (
        <div className="group">
          <div className="group-label"><span><Icon name="fillet" size={15} />Kanten</span></div>
          <div className="field-row two">
            <NumberField value={f.fillet ?? 0} min={0} step={0.5} onCommit={(v) => execute("object.fillet", { id: f.id, radius: v })} />
            <NumberField value={f.chamfer ?? 0} min={0} step={0.5} onCommit={(v) => execute("object.chamfer", { id: f.id, radius: v })} />
          </div>
          <div className="field-caption two"><span>Abrunden</span><span>Fase</span></div>
        </div>
      )}
      <div className="props-actions">
        <button className="btn-ghost" onClick={() => execute("object.duplicate")}><Icon name="duplicate" size={14} />Duplizieren</button>
        <button className="btn-ghost" onClick={() => execute("object.dropToBed")}><Icon name="dropToBed" size={14} />Aufs Bett</button>
        {f.type === "boolean" && <button className="btn-ghost" onClick={() => execute("boolean.split")}><Icon name="boolean" size={14} />Auflösen</button>}
        <button className="btn-ghost danger" onClick={() => execute("object.delete")}><Icon name="delete" size={14} />Löschen</button>
      </div>
    </>
  );
}

export function PropertiesPanel() {
  const doc = useDoc();
  const selection = useApp((s) => s.selection);
  const selected = selection.map((id) => doc.features.find((f) => f.id === id)).filter(Boolean) as Feature[];

  return (
    <div className="scroll props-body">
        {selected.length === 1 && <SingleObject key={selected[0].id} f={selected[0]} />}
        {selected.length > 1 && (
          <>
            <div className="props-title">
              <span className="badge"><Icon name="select" size={16} /></span>
              <div>
                <div className="name">{selected.length} Objekte</div>
                <div className="type">{selected.map((f) => f.name).join(", ")}</div>
              </div>
            </div>
            <div className="props-actions">
              {selected.length === 2 && (
                <>
                  <button className="btn-ghost" onClick={() => execute("boolean.union")}><Icon name="union" size={14} />Vereinen</button>
                  <button className="btn-ghost" onClick={() => execute("boolean.subtract")}><Icon name="subtract" size={14} />Abziehen</button>
                  <button className="btn-ghost" onClick={() => execute("boolean.intersect")}><Icon name="intersect" size={14} />Schnittmenge</button>
                </>
              )}
              <button className="btn-ghost" onClick={() => execute("object.duplicate")}><Icon name="duplicate" size={14} />Duplizieren</button>
              <button className="btn-ghost" onClick={() => execute("object.dropToBed")}><Icon name="dropToBed" size={14} />Aufs Bett</button>
              <button className="btn-ghost danger" onClick={() => execute("object.delete")}><Icon name="delete" size={14} />Löschen</button>
            </div>
            {selected.length === 2 && (
              <div className="props-empty">Beim Abziehen wird <b>{selected[1].name}</b> aus <b>{selected[0].name}</b> herausgeschnitten.</div>
            )}
          </>
        )}
    </div>
  );
}

/**
 * Floats over the viewport's right edge so selecting never resizes the canvas.
 * Stays mounted briefly after deselecting to fade out.
 */
export function PropertiesOverlay() {
  const hasSelection = useApp((s) => s.selection.length > 0);
  const enabled = useLayout((s) => s.panels.props.open);
  const [shown, setShown] = useState(hasSelection);
  useEffect(() => {
    if (hasSelection) setShown(true);
    else {
      const t = setTimeout(() => setShown(false), 160);
      return () => clearTimeout(t);
    }
  }, [hasSelection]);
  if (!enabled || !shown) return null;
  return (
    <aside className={`props-overlay ${hasSelection ? "in" : "out"}`} onPointerDown={(e) => e.stopPropagation()}>
      <PropertiesPanel />
    </aside>
  );
}

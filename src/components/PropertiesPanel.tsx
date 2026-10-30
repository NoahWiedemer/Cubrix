import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlignCenter, AlignLeft, AlignRight, Bold, ChevronDown, ChevronRight, Link2, Link2Off } from "lucide-react";
import { SegmentedControl } from "../ui/SegmentedControl";
import { textOf } from "../core/commandDefs";
import { applyEdge } from "../ui/applyEdge";
import { useEdgePick } from "../ui/edgePick";
import { profileBounds } from "../core/scale";
import { SHAPE_LABELS, shapeFields } from "../core/shapeFields";
import { SHAPE_DEFAULTS, type ExtraType } from "../core/shapeDefs";
import { clearPreview, execute, previewCommand } from "../core/commands";
import { useApp, useDoc } from "../core/store";
import { featureTypeLabel, findFeature, hasNoEdges, type Feature, type GroupFeature, type PrimitiveFeature, type Transform, type Vec3 } from "../core/document";
import { useMeshes, useMissingFonts } from "../cad/kernel";
import { FontPicker } from "./FontPicker";
import { Appearance } from "./ColorRow";
import { worldBox } from "../core/bounds";
import { Icon } from "../ui/icons";
import { featureIcon } from "./ObjectTree";

const show = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");
const parse = (s: string) => Number(s.trim().replace(",", "."));

interface NumberFieldProps {
  value: number;
  /** Scrub handle on the left: an axis letter or a tiny icon. */
  label?: ReactNode;
  axis?: "x" | "y" | "z";
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  readOnly?: boolean;
  onCommit(v: number): void;
  /** Called continuously while scrubbing the label; commit follows on release. */
  onPreview?(v: number): void;
  /** Typing "150%" calls this with 1.5 (size fields: scale the whole object). */
  onPercent?(factor: number): void;
  /** Several objects with different values: shows "Gemischt", a typed value sets all. */
  mixed?: boolean;
  /** Scrubbing reports the relative change instead of a value (several objects). */
  onDelta?(delta: number, done: boolean): void;
  /** Kernel-heavy fields: only Enter or releasing the scrub handle applies; blur reverts. */
  enterOnly?: boolean;
}

/** Tiny corner glyphs as scrub handles for the Kanten fields. */
const FilletGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 11V7a5 5 0 0 1 5-5h4" /></svg>
);
const ChamferGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 11V6l4-4h5" /></svg>
);

function NumberField({ value, label, axis, unit = "mm", step = 1, min, max, readOnly, onCommit, onPreview, onPercent, mixed, onDelta, enterOnly }: NumberFieldProps) {
  const initial = () => (mixed ? "" : show(value));
  const [text, setText] = useState(initial);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(initial());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, mixed]);

  const clamp = (v: number) => Math.min(max ?? Infinity, min !== undefined ? Math.max(min, v) : v);
  const commit = (v: number) => {
    if (!Number.isFinite(v)) return setText(initial());
    v = clamp(v);
    setText(show(v));
    if (mixed || Math.abs(v - value) > 1e-9) onCommit(v);
  };

  const scrub = (e: React.PointerEvent<HTMLElement>, threshold = 2) => {
    if (readOnly) return;
    e.preventDefault();
    const startX = e.clientX;
    const start = value;
    let current = value;
    let moved = threshold === 0;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      if (!moved) {
        if (Math.abs(ev.clientX - startX) < threshold) return;
        moved = true;
      }
      const unit = step * (ev.altKey ? 0.1 : 1);
      const raw = start + ((ev.clientX - startX) / 4) * unit * (ev.shiftKey ? 10 : 1);
      current = clamp(Math.round(Math.round(raw / unit) * unit * 1000) / 1000);
      if (onDelta) {
        const d = current - start;
        setText(mixed ? `${d >= 0 ? "+" : ""}${show(d)}` : show(current));
        onDelta(d, false);
        return;
      }
      setText(show(current));
      onPreview?.(current);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      if (!moved) {
        // A click without dragging: type a value instead.
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }
      if (onDelta) {
        onDelta(current - start, true);
        if (mixed) setText("");
        return;
      }
      if (Math.abs(current - start) > 1e-9) onCommit(current);
      else onPreview?.(start);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  const inputRef = useRef<HTMLInputElement>(null);
  const enterPressed = useRef(false);
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
        <label className={`${axis ?? ""} ${typeof label === "string" ? "" : "icon"}`} onPointerDown={scrub} title={readOnly ? undefined : "Ziehen zum Ändern"}>
          {label}
        </label>
      )}
      <input
        ref={inputRef}
        value={text}
        readOnly={readOnly}
        placeholder={mixed ? "Gemischt" : undefined}
        style={fontSize ? { fontSize } : undefined}
        inputMode="decimal"
        onFocus={(e) => {
          focused.current = true;
          e.target.select();
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          focused.current = false;
          if (mixed && !text.trim()) return;
          if (enterOnly && !enterPressed.current) return setText(initial());
          enterPressed.current = false;
          const pct = /^\s*([\d.,]+)\s*%\s*$/.exec(text);
          if (pct && onPercent) {
            const k = Number(pct[1].replace(",", ".")) / 100;
            setText(show(value));
            if (k > 0 && k !== 1) onPercent(k);
            return;
          }
          commit(parse(text));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            enterPressed.current = true;
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "Escape") {
            setText(initial());
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const d = (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            commit(parse(text) + d);
          }
        }}
      />
      {unit && text && text.length <= 3 && <span className="unit">{unit}</span>}
    </div>
  );
}

const EDGE_FILTER_LABELS: Record<string, string> = { top: "obere Kanten", bottom: "untere Kanten", vertical: "senkrechte Kanten", horizontal: "waagerechte Kanten", x: "Kanten parallel X", y: "Kanten parallel Y" };

const PARAM_FIELDS: Record<PrimitiveFeature["type"], { key: string; label: string }[]> = {
  ...(Object.fromEntries(
    Object.entries(SHAPE_DEFAULTS).map(([t, d]) => [t, Object.entries(d.labels).map(([key, label]) => ({ key, label }))]),
  ) as Record<ExtraType, { key: string; label: string }[]>),
  box: [{ key: "width", label: "Breite" }, { key: "depth", label: "Tiefe" }, { key: "height", label: "Höhe" }],
  cylinder: [{ key: "diameter", label: "Durchmesser" }, { key: "height", label: "Höhe" }],
  sphere: [{ key: "diameter", label: "Durchmesser" }],
  cone: [{ key: "bottomDiameter", label: "Ø unten" }, { key: "topDiameter", label: "Ø oben" }, { key: "height", label: "Höhe" }],
  torus: [{ key: "diameter", label: "Außen-Ø" }, { key: "thickness", label: "Ringdicke" }],
  pyramid: [{ key: "width", label: "Grundkante" }, { key: "height", label: "Höhe" }],
  prism: [{ key: "diameter", label: "Ø" }, { key: "height", label: "Höhe" }, { key: "sides", label: "Ecken" }],
  tube: [{ key: "diameter", label: "Außen-Ø" }, { key: "inner", label: "Innen-Ø" }, { key: "height", label: "Höhe" }],
  hemisphere: [{ key: "diameter", label: "Durchmesser" }],
  wedge: [{ key: "width", label: "Länge" }, { key: "depth", label: "Breite" }, { key: "height", label: "Höhe" }],
  plate: [{ key: "width", label: "Breite" }, { key: "depth", label: "Tiefe" }, { key: "height", label: "Dicke" }],
  counterbore: [{ key: "diameter", label: "Loch-Ø" }, { key: "length", label: "Länge" }, { key: "headDiameter", label: "Kopf-Ø" }],
  nut: [{ key: "acrossFlats", label: "SW" }, { key: "height", label: "Höhe" }],
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

  if (f.type === "text") return null;
  if (f.type === "sketch" || f.type === "extrude") return <><ProfileSize f={f} /><ShapeList f={f} /></>;
  if (f.type === "import") return <ImportSize f={f} />;
  if (f.type === "group") return null;
  const fields = PARAM_FIELDS[f.type];
  const params = f.params as Record<string, number>;
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
          <button className={`lock ${locked ? "on" : ""}`} onClick={() => setLocked(!locked)} data-tip={locked ? "Proportional: an (Maße ändern sich gemeinsam)" : "Proportional: aus"} data-tip-pos="bottom-end">
            {locked ? <Link2 size={14} /> : <Link2Off size={14} />}<span>Proportional</span>
          </button>
        )}
      </div>
      <div className={`field-row ${cols(fields.length)}`}>
        {fields.map(({ key, label }) => (
          <NumberField key={key} label={label[0]} value={params[key]} min={key === "topDiameter" ? 0 : 0.1} onCommit={(v) => set(key, v)}
            onPercent={(k) => void execute("object.scale", { id: f.id, factor: [k, k, k] })} />
        ))}
      </div>
      <div className={`field-caption ${cols(fields.length)}`} style={fields.length === 1 ? { gridTemplateColumns: "1fr" } : undefined}>
        {fields.map(({ key, label }) => <span key={key}>{label}</span>)}
      </div>
    </div>
  );
}

/** Imports scale uniformly: the size fields scale the whole part proportionally. */
function ImportSize({ f }: { f: Feature & { type: "import" } }) {
  const entries = useMeshes((s) => s.entries);
  const b = worldBox(f, entries);
  const size = b ? [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z] : [0, 0, 0];
  return (
    <div className="group">
      <div className="group-label"><span><Icon name="measure" size={15} />Maße</span><span className="muted-note">proportional</span></div>
      <div className="field-row">
        {size.map((v, i) => (
          <NumberField key={i} label={"BTH"[i]} value={Math.round(v * 100) / 100} min={0.1}
            onCommit={(n) => v > 0 && void execute("object.scale", { id: f.id, factor: [n / v, n / v, n / v] })}
            onPercent={(k) => void execute("object.scale", { id: f.id, factor: [k, k, k] })} />
        ))}
      </div>
      <div className="field-caption"><span>Breite</span><span>Tiefe</span><span>Höhe</span></div>
    </div>
  );
}

/** Breite / Tiefe / Höhe of a sketch or extruded profile; Höhe 0 = flat, > 0 extrudes. */
function ProfileSize({ f }: { f: Feature & { type: "sketch" | "extrude" } }) {
  const b = profileBounds(f.type === "sketch" ? f.shapes : f.profile);
  const revolve = f.type === "extrude" ? f.revolve : undefined;
  const values = [b ? b.maxX - b.minX : 0, b ? b.maxY - b.minY : 0, f.type === "extrude" ? f.height : 0];
  const keys = ["width", "depth", "height"] as const;
  // A turned body: profile width and height, plus the axis distance instead of an extrusion height.
  const shown = revolve ? [0, 1] : [0, 1, 2];
  return (
    <div className="group">
      <div className="group-label"><span><Icon name="measure" size={15} />{revolve ? "Profil" : "Maße"}</span></div>
      <div className="field-row">
        {shown.map((i) => (
          <NumberField
            key={keys[i]}
            label={revolve ? "BH"[i] : "BTH"[i]}
            value={Math.round(values[i] * 100) / 100}
            min={i === 2 ? 0 : 0.1}
            onCommit={(n) => void execute("shape.setSize", { id: f.id, [keys[i]]: n })}
            onPercent={(k) => void execute("object.scale", { id: f.id, factor: [k, k, k] })}
          />
        ))}
        {revolve && (
          <NumberField
            label="A"
            value={revolve.offset}
            min={0}
            step={0.5}
            onCommit={(n) => void execute("sketch.revolve", { id: f.id, offset: n })}
          />
        )}
      </div>
      <div className="field-caption">
        {revolve ? <><span>Breite</span><span>Höhe</span><span>Achsabstand</span></> : <><span>Breite</span><span>Tiefe</span><span>Höhe</span></>}
      </div>
    </div>
  );
}

/** Each shape of a sketch with its own dimensions (collapsed by default for more than four shapes). */
function ShapeList({ f }: { f: Feature & { type: "sketch" | "extrude" } }) {
  const shapes = f.type === "sketch" ? f.shapes : f.profile;
  const [open, setOpen] = useState(shapes.length <= 4);
  if (!shapes.length) return null;
  const counts: Record<string, number> = {};
  return (
    <div className="group shape-list">
      <button className="group-label as-toggle" onClick={() => setOpen(!open)}>
        <span><Icon name="sketch" size={15} />Formen <span className="muted">{shapes.length}</span></span>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {open &&
        shapes.map((s, i) => {
          counts[s.kind] = (counts[s.kind] ?? 0) + 1;
          const fields = shapeFields(s);
          return (
            <div key={i} className="shape-item">
              <div className="shape-name">{SHAPE_LABELS[s.kind]} {counts[s.kind]}</div>
              {[fields.filter((fs) => fs.key !== "x" && fs.key !== "y"), fields.filter((fs) => fs.key === "x" || fs.key === "y")].map((row, r) => (
                <div key={r} className="field-grid">
                  {row.map((fs) => (
                    <div key={fs.key} className="field-cell">
                      <NumberField
                        label={fs.label}
                        unit={fs.unit}
                        value={fs.value}
                        min={fs.min}
                        step={fs.step ?? (fs.key === "sides" ? 1 : 0.5)}
                        onCommit={(v) => void execute("sketch.setShape", { id: f.id, index: i, [fs.key]: v })}
                      />
                      {/* X/Y explain themselves (the centre of the shape). */}
                      {r === 0 && <span className="field-cap">{fs.caption}</span>}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          );
        })}
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

/** Text settings for a text body or a body with embossed/engraved text; edits rebuild the solid. */
function TextSection({ f }: { f: Feature }) {
  const t = textOf(f);
  const [draft, setDraft] = useState<string | null>(null);
  const missingFonts = useMissingFonts((s) => s.missing);
  if (!t) return null;
  const missing = missingFonts.includes(t.params.font);
  const p = t.params;
  const edit = (patch: Record<string, unknown>) => void execute("text.edit", { id: f.id, ...patch });
  const commitText = () => {
    if (draft !== null && draft.trim() && draft !== p.text) edit({ text: draft });
    setDraft(null);
  };
  return (
    <div className="group text-section">
      <div className="group-label"><span><Icon name="text" size={15} />Text</span></div>
      <div className="field text-field">
        <input
          value={draft ?? p.text}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setDraft(null);
          }}
        />
      </div>
      {p.onFace && (
        <SegmentedControl size="sm" className="block" value={p.onFace} onChange={(mode) => edit({ mode })}
          options={[{ value: "emboss", label: "Prägen" }, { value: "engrave", label: "Gravieren" }]} />
      )}
      <FontPicker value={p.font} onChange={(font) => edit({ font })} />
      {missing && <p className="hint">„{p.font}“ ist hier nicht installiert – ersatzweise Inter.</p>}
      <div className="field-row two">
        <NumberField value={p.size} min={0.5} step={0.5} unit="mm" onCommit={(v) => edit({ size: v })} />
        <NumberField value={p.depth} min={0.1} step={0.2} unit="mm" onCommit={(v) => edit({ depth: v })} />
      </div>
      <div className="field-caption two"><span>Höhe</span><span>{p.onFace === "engrave" ? "Tiefe" : p.onFace ? "Höhe über Fläche" : "Tiefe"}</span></div>
      <div className="text-row">
        <SegmentedControl size="sm" className="icons" value={p.align} onChange={(align) => edit({ align })}
          options={[
            { value: "left", icon: <AlignLeft size={15} />, tip: "Links" },
            { value: "center", icon: <AlignCenter size={15} />, tip: "Mitte" },
            { value: "right", icon: <AlignRight size={15} />, tip: "Rechts" },
          ]} />
        <button className={`btn-ghost bold-toggle ${p.bold ? "on" : ""}`} onClick={() => edit({ bold: !p.bold })} aria-pressed={p.bold}>
          <Bold size={14} />Fett
        </button>
      </div>
    </div>
  );
}

function SingleObject({ f }: { f: Feature }) {
  const edgePicking = useEdgePick((st) => st.id === f.id);
  const pickedCount = useEdgePick((st) => st.picked.length);
  // Set when a value was clamped to what the geometry allows ("max. 3,4 mm").
  const [edgeLimit, setEdgeLimit] = useState<{ edge: "fillet" | "chamfer"; max: number } | null>(null);
  const [edgeField, setEdgeField] = useState(0);
  const edgeApply = (edge: "fillet" | "chamfer", v: number) => {
    void applyEdge(f.id, edge, v).then((r) => {
      setEdgeLimit(r.limit !== null ? { edge, max: r.limit } : null);
      setEdgeField((n) => n + 1); // show what really applies, not what was typed
    });
  };
  return (
    <>
      <div className="props-title">
        <span className="badge"><Icon name={featureIcon(f)} size={16} /></span>
        <div className="name" title={featureTypeLabel(f)}>{f.name}{f.visible ? "" : <span className="muted"> · ausgeblendet</span>}</div>
      </div>
      <TextSection f={f} />
      <Dimensions f={f} />
      <TransformFields f={f} kind="position" />
      <TransformFields f={f} kind="rotation" />
      {!hasNoEdges(f) && f.type !== "sketch" && (
        <div className="group">
          <div className="group-label">
            <span><Icon name="fillet" size={15} />Kanten{edgePicking && <em className="edge-max"> {pickedCount ? `${pickedCount} gewählt` : "alle"}</em>}</span>
            <button className={`lock ${edgePicking ? "on" : ""}`} onClick={() => void execute("tool.edges")} data-tip="Einzelne Kanten wählen" data-kbd="shift+e" data-tip-pos="bottom-end">
              <span>Kanten wählen</span>
            </button>
          </div>
          <div className="field-row two">
            {(["fillet", "chamfer"] as const).map((k) => (
              <NumberField
                key={`${k}-${edgeField}`}
                label={k === "fillet" ? <FilletGlyph /> : <ChamferGlyph />}
                value={f[k] ?? 0}
                min={0}
                step={0.5}
                enterOnly
                onCommit={(v) => edgeApply(k, v)}
              />
            ))}
          </div>
          <div className="field-caption two">
            <span>Abrunden{edgeLimit?.edge === "fillet" && <em className="edge-max"> max. {show(edgeLimit.max)} mm</em>}</span>
            <span>Fase{edgeLimit?.edge === "chamfer" && <em className="edge-max"> max. {show(edgeLimit.max)} mm</em>}</span>
          </div>
          {f.edgeOps?.map((op, i) => (
            <div key={i} className="edge-op">
              <Icon name={op.kind} size={14} />
              <span>{op.kind === "fillet" ? "Abrunden" : "Fase"} {show(op.size)} mm · {op.filter ? EDGE_FILTER_LABELS[op.filter] : `${op.refs?.length ?? 0} ${op.refs?.length === 1 ? "Kante" : "Kanten"}`}</span>
              <button className="icon-btn small" onClick={() => void execute("edges.remove", { id: f.id, index: i })} data-tip="Entfernen" data-tip-pos="left"><Icon name="delete" size={13} /></button>
            </div>
          ))}
        </div>
      )}
      {f.type !== "sketch" && f.type !== "group" && <ShellSection f={f} />}
      {f.type === "group" ? <GroupAppearance f={f} /> : <Appearance key={f.id + (f.color ?? "")} ids={[f.id]} color={f.color} material={f.material} />}
    </>
  );
}

/** Position, rotation and size of several objects: shared values, or "Gemischt". */
function MultiFields({ features }: { features: Feature[] }) {
  const ids = features.map((f) => f.id);
  const axisRow = (kind: "position" | "rotation", unit: string) => (
    <div className="field-row">
      {(["x", "y", "z"] as const).map((axis, i) => {
        const first = features[0].transform[kind][i];
        const same = features.every((f) => f.transform[kind][i] === first);
        return (
          <NumberField
            key={axis}
            label={axis.toUpperCase()}
            axis={axis}
            unit={unit}
            value={same ? first : 0}
            mixed={!same}
            onCommit={(v) => void execute("objects.setAxis", { ids, kind, axis: i, value: v })}
            onDelta={(d, done) => {
              if (!done) return void previewCommand("objects.setAxis", { ids, kind, axis: i, delta: d });
              clearPreview();
              if (d !== 0) void execute("objects.setAxis", { ids, kind, axis: i, delta: d });
            }}
          />
        );
      })}
    </div>
  );
  // Same kind and same size: edit the real dimensions, else only relative scaling.
  const first = features[0] as PrimitiveFeature;
  const sameSize = "params" in first && first.type in PARAM_FIELDS && features.every((f) => f.type === first.type && "params" in f && JSON.stringify(f.params) === JSON.stringify(first.params));
  const fields = sameSize ? PARAM_FIELDS[first.type] : [];
  return (
    <>
      <div className="group">
        <div className="group-label"><span><Icon name="measure" size={15} />Maße</span>{!sameSize && <span className="muted-note">Gemischt</span>}</div>
        {sameSize ? (
          <>
            <div className={`field-row ${cols(fields.length)}`}>
              {fields.map(({ key, label }) => (
                <NumberField key={key} label={label[0]} value={(first.params as Record<string, number>)[key]} min={0.1}
                  onCommit={(v) => void execute("objects.setParams", { ids, params: { [key]: v } })}
                  onPercent={(k) => void execute("objects.scaleBy", { ids, factor: [k, k, k] })} />
              ))}
            </div>
            <div className={`field-caption ${cols(fields.length)}`} style={fields.length === 1 ? { gridTemplateColumns: "1fr" } : undefined}>
              {fields.map(({ key, label }) => <span key={key}>{label}</span>)}
            </div>
          </>
        ) : (
          <>
            <div className="field-row one">
              <NumberField label="S" unit="%" value={100} min={1} step={5} onCommit={(v) => void execute("objects.scaleBy", { ids, factor: [v / 100, v / 100, v / 100] })} />
            </div>
            <div className="field-caption" style={{ gridTemplateColumns: "1fr" }}><span>Größe aller (jedes Objekt um sich selbst)</span></div>
          </>
        )}
      </div>
      <div className="group">
        <div className="group-label"><span><Icon name="position" size={15} />Position</span><span className="group-unit">mm</span></div>
        {axisRow("position", "mm")}
      </div>
      <div className="group">
        <div className="group-label"><span><Icon name="rotateCw" size={15} />Drehung</span><span className="group-unit">°</span></div>
        {axisRow("rotation", "°")}
      </div>
    </>
  );
}

/** A group's look summarises its members (setting it applies to all of them). */
function GroupAppearance({ f }: { f: GroupFeature }) {
  const leaves: Feature[] = [];
  const walk = (x: Feature) => (x.type === "group" ? x.children.forEach(walk) : leaves.push(x));
  walk(f);
  const first = leaves[0];
  return (
    <Appearance
      key={f.id}
      ids={[f.id]}
      color={first?.color}
      material={first?.material}
      mixedColor={leaves.some((l) => l.color !== first?.color)}
      mixedMaterial={leaves.some((l) => (l.material ?? "matte") !== (first?.material ?? "matte"))}
    />
  );
}

/** Aushöhlen: wall thickness plus which side stays open. */
function ShellSection({ f }: { f: Feature }) {
  const open = f.shell?.open ?? "top";
  return (
    <div className="group">
      <div className="group-label"><span><Icon name="shell" size={15} />Aushöhlen</span></div>
      <div className="field-row two">
        <NumberField
          label="W"
          value={f.shell?.thickness ?? 0}
          min={0}
          step={0.4}
          enterOnly
          onCommit={(v) => void execute("object.shell", { id: f.id, thickness: v, open })}
        />
        <SegmentedControl
          size="sm"
          value={open}
          onChange={(o) => void execute("object.shell", { id: f.id, thickness: f.shell?.thickness ?? 1.6, open: o })}
          options={[
            { value: "top", label: "Oben" },
            { value: "bottom", label: "Unten" },
            { value: "none", label: "Zu" },
          ]}
        />
      </div>
      <div className="field-caption two"><span>Wand</span><span>Offen</span></div>
    </div>
  );
}

export function PropertiesPanel() {
  const doc = useDoc();
  const selection = useApp((s) => s.selection);
  const selected = selection.map((id) => findFeature(doc, id)).filter(Boolean) as Feature[];

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
            <MultiFields features={selected} />
            {selected.length === 2 && (
            <div className="props-actions">
                <>
                  <button className="btn-ghost" onClick={() => execute("boolean.union")}><Icon name="union" size={14} />Vereinen</button>
                  <button className="btn-ghost" onClick={() => execute("boolean.subtract")}><Icon name="subtract" size={14} />Abziehen</button>
                  <button className="btn-ghost" onClick={() => execute("boolean.intersect")}><Icon name="intersect" size={14} />Schnittmenge</button>
                </>
            </div>
            )}
            {selected.length === 2 && (
              <div className="props-empty">Beim Abziehen wird <b>{selected[1].name}</b> aus <b>{selected[0].name}</b> herausgeschnitten.</div>
            )}
            <Appearance
              ids={selected.map((f) => f.id)}
              color={selected[0].color}
              material={selected[0].material}
              mixedColor={!selected.every((f) => f.color === selected[0].color)}
              mixedMaterial={!selected.every((f) => (f.material ?? "matte") === (selected[0].material ?? "matte"))}
            />
          </>
        )}
    </div>
  );
}

// 2D sketching on the bed plane: renders sketches and handles the drawing tools
// (line, rectangle, circle, polygon) with snapping, live dimensions and typed values.
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Html, Line } from "@react-three/drei";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { execute } from "../core/commands";
import { useApp } from "../core/store";
import { shapePoints, isClosed, type SketchFeature, type SketchShape } from "../core/document";
import { useSketch } from "../ui/sketch";

const MINT = "#6ee7c5";
type P = [number, number];
const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString("de-DE");

/** A sketch as thin outlines with softly filled closed regions. */
export function SketchObject({ f }: { f: SketchFeature }) {
  const selected = useApp((s) => s.selection.includes(f.id));
  const inSketch = useApp((s) => s.workspace === "sketch");
  const active = useSketch((s) => s.activeId === f.id) && inSketch;
  if (!f.visible) return null;
  const color = selected || active ? MINT : "#8a979f";
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (useSketch.getState().tool !== "select" && inSketch) return;
    e.stopPropagation();
    void execute("selection.set", { ids: [f.id], mode: e.shiftKey ? "toggle" : "replace" });
    if (inSketch) useSketch.setState({ activeId: f.id });
  };
  const [x, y, z] = f.transform.position;
  return (
    <group position={[x, y, z + 0.05]}>
      {f.shapes.map((s, i) => (
        <ShapeView key={i} shape={s} color={color} fill={selected || active} onClick={onClick} />
      ))}
    </group>
  );
}

function ShapeView({ shape, color, fill, onClick }: { shape: SketchShape; color: string; fill: boolean; onClick(e: ThreeEvent<MouseEvent>): void }) {
  const pts = useMemo(() => shapePoints(shape), [shape]);
  const closed = isClosed(shape);
  const geometry = useMemo(() => {
    if (!closed || pts.length < 3) return null;
    return new THREE.ShapeGeometry(new THREE.Shape(pts.map(([a, b]) => new THREE.Vector2(a, b))));
  }, [pts, closed]);
  const line = useMemo(() => {
    const l = pts.map(([a, b]) => [a, b, 0] as [number, number, number]);
    if (closed && l.length) l.push(l[0]);
    return l;
  }, [pts, closed]);
  if (line.length < 2) return null;
  return (
    <>
      {geometry && (
        <mesh geometry={geometry} onClick={onClick} renderOrder={1}>
          <meshBasicMaterial color={MINT} transparent opacity={fill ? 0.12 : 0.05} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
      )}
      <Line points={line} color={color} lineWidth={1.6} onClick={onClick} />
    </>
  );
}

function Label({ at, children }: { at: [number, number]; children: React.ReactNode }) {
  return (
    <Html position={[at[0], at[1], 0.1]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
      <div className="dim-label live">{children}</div>
    </Html>
  );
}

/** Drawing surface + previews; active only in the 2D workspace with a drawing tool. */
export function SketchDraw({ sketches }: { sketches: SketchFeature[] }) {
  const tool = useSketch((s) => s.tool);
  const sides = useSketch((s) => s.sides);
  const camera = useThree((s) => s.camera);
  const [points, setPoints] = useState<P[]>([]);
  const [cursor, setCursor] = useState<P | null>(null);
  const [typed, setTyped] = useState<string[]>([]);
  const [field, setField] = useState(0);
  const state = useRef({ points, cursor, typed, field });
  state.current = { points, cursor, typed, field };

  const reset = () => {
    state.current.points = [];
    setPoints([]);
    setTyped([]);
    setField(0);
  };
  useEffect(reset, [tool]);

  const vertices = useMemo(() => sketches.flatMap((s) => s.shapes.flatMap((sh) => (sh.kind === "circle" ? [[sh.cx, sh.cy] as P] : shapePoints(sh, 8)))), [sketches]);

  const snapPoint = (p: P): P => {
    const tol = (camera as THREE.OrthographicCamera).isOrthographicCamera ? 9 / (camera as THREE.OrthographicCamera).zoom : 2;
    let best: P | null = null;
    let d = tol;
    for (const v of [...vertices, ...state.current.points]) {
      const dd = Math.hypot(v[0] - p[0], v[1] - p[1]);
      if (dd < d) {
        d = dd;
        best = v;
      }
    }
    if (best) return best;
    const g = useApp.getState().snap || 0.1;
    return [Math.round(p[0] / g) * g, Math.round(p[1] / g) * g];
  };

  const commit = (shape: SketchShape) => {
    void execute("sketch.addShape", { sketchId: useSketch.getState().activeId ?? undefined, shape }).then((ok) => {
      if (ok) useSketch.setState({ activeId: useApp.getState().selection[0] ?? null });
    });
    reset();
  };

  const shapeFor = (a: P, b: P, values: number[] = []): SketchShape | null => {
    if (tool === "rect") {
      const w = values[0] ? values[0] * Math.sign(b[0] - a[0] || 1) : b[0] - a[0];
      const h = values[1] ? values[1] * Math.sign(b[1] - a[1] || 1) : b[1] - a[1];
      if (Math.abs(w) < 0.1 || Math.abs(h) < 0.1) return null;
      return { kind: "rect", x: Math.min(a[0], a[0] + w), y: Math.min(a[1], a[1] + h), w: Math.abs(w), h: Math.abs(h) };
    }
    const r = values[0] ? values[0] / 2 : Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (r < 0.1) return null;
    if (tool === "circle") return { kind: "circle", cx: a[0], cy: a[1], r };
    if (tool === "polygon") return { kind: "polygon", cx: a[0], cy: a[1], r, sides };
    return null;
  };

  // Typed dimensions while drawing: digits, comma, Tab between fields, Enter applies.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = state.current;
      if ((e.target as HTMLElement).closest("input, textarea")) return;
      if (e.key === "Escape" && s.points.length) {
        e.stopImmediatePropagation();
        e.preventDefault();
        reset();
        return;
      }
      if (!s.points.length || !s.cursor) return;
      if (/^[0-9.,]$/.test(e.key)) {
        e.stopImmediatePropagation();
        e.preventDefault();
        const t = [...s.typed];
        t[s.field] = (t[s.field] ?? "") + (e.key === "," ? "." : e.key);
        setTyped(t);
      } else if (e.key === "Backspace" && s.typed[s.field]) {
        e.stopImmediatePropagation();
        e.preventDefault();
        const t = [...s.typed];
        t[s.field] = t[s.field].slice(0, -1);
        setTyped(t);
      } else if (e.key === "Tab") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setField((s.field + 1) % (tool === "rect" ? 2 : 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopImmediatePropagation();
        const values = s.typed.map((v) => Number(v) || 0);
        if (tool === "line") {
          const last = s.points[s.points.length - 1];
          if (values[0]) {
            const dir = [s.cursor[0] - last[0], s.cursor[1] - last[1]];
            const len = Math.hypot(dir[0], dir[1]) || 1;
            const p: P = [last[0] + (dir[0] / len) * values[0], last[1] + (dir[1] / len) * values[0]];
            setPoints([...s.points, p]);
            setTyped([]);
          } else if (s.points.length >= 2) {
            commit({ kind: "poly", points: s.points, closed: false });
          }
          return;
        }
        const shape = shapeFor(s.points[0], s.cursor, values);
        if (shape) commit(shape);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, sides]);

  if (tool === "select") return null;

  const toCad = (e: ThreeEvent<PointerEvent | MouseEvent>): P => {
    const p = e.point; // world (Y-up) → CAD (Z-up)
    return snapPoint([p.x, -p.z]);
  };

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const p = toCad(e);
    // Read through the ref so fast consecutive clicks never see stale state.
    const pts = state.current.points;
    const push = (next: P[]) => {
      state.current.points = next;
      setPoints(next);
    };
    if (tool === "line") {
      if (pts.length >= 3 && Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) < 1e-6) {
        commit({ kind: "poly", points: pts, closed: true });
        return;
      }
      push([...pts, p]);
      setTyped([]);
      return;
    }
    if (!pts.length) {
      push([p]);
      return;
    }
    const shape = shapeFor(pts[0], p, state.current.typed.map((v) => Number(v) || 0));
    if (shape) commit(shape);
  };

  const preview: SketchShape | null =
    cursor && points.length
      ? tool === "line"
        ? { kind: "poly", points: [...points, cursor], closed: false }
        : shapeFor(points[0], cursor, typed.map((v) => Number(v) || 0))
      : null;

  const a = points[0];
  return (
    <group>
      <mesh
        position={[0, 0, 0]}
        onPointerMove={(e) => setCursor(toCad(e))}
        onPointerDown={onDown}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (tool === "line" && points.length >= 2) commit({ kind: "poly", points, closed: false });
        }}
      >
        <planeGeometry args={[4000, 4000]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {preview && <ShapeView shape={preview} color={MINT} fill onClick={() => {}} />}
      {cursor && (
        <mesh position={[cursor[0], cursor[1], 0.1]} renderOrder={30}>
          <circleGeometry args={[(camera as THREE.OrthographicCamera).isOrthographicCamera ? 3.5 / (camera as THREE.OrthographicCamera).zoom : 0.8, 16]} />
          <meshBasicMaterial color={MINT} depthTest={false} toneMapped={false} />
        </mesh>
      )}
      {preview && cursor && a && tool === "rect" && preview.kind === "rect" && (
        <Label at={cursor}>
          <TypedValue value={fmt(preview.w)} typed={typed[0]} active={field === 0} /> × <TypedValue value={fmt(preview.h)} typed={typed[1]} active={field === 1} /> mm
        </Label>
      )}
      {preview && cursor && (preview.kind === "circle" || preview.kind === "polygon") && (
        <Label at={cursor}>
          Ø <TypedValue value={fmt(preview.r * 2)} typed={typed[0]} active /> mm
        </Label>
      )}
      {cursor && tool === "line" && points.length > 0 && (
        <Label at={cursor}>
          <TypedValue
            value={fmt(Math.hypot(cursor[0] - points[points.length - 1][0], cursor[1] - points[points.length - 1][1]))}
            typed={typed[0]}
            active
          />{" "}
          mm
        </Label>
      )}
    </group>
  );
}

function TypedValue({ value, typed, active }: { value: string; typed?: string; active: boolean }) {
  return <span className={`typed ${typed ? "set" : ""} ${active ? "active" : ""}`}>{typed ? typed.replace(".", ",") : value}</span>;
}

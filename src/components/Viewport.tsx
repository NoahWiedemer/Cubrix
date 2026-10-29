import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import {
  ContactShadows,
  Environment,
  GizmoHelper,
  Grid,
  Html,
  Lightformer,
  Line,
  OrbitControls,
  PivotControls,
} from "@react-three/drei";
import { SelectionOutline, registerMesh } from "./SelectionOutline";
import { AxisIndicator } from "./AxisIndicator";
import { execute } from "../core/commands";
import { useApp, useDoc } from "../core/store";
import { type Feature, type Transform, type Vec3 } from "../core/document";
import { getGeometry, useKernel, useMeshes, type GeometryEntry } from "../cad/kernel";
import { transformMatrix, worldBox } from "../core/bounds";
import { geometryKey } from "../core/document";
import { Toolbar } from "./Toolbar";
import { PRIMITIVES } from "./LeftRail";
import { Icon } from "../ui/icons";
import { usePrintCheck } from "../core/printCheck";
import { TriangleAlert } from "lucide-react";

const ACCENT = "#6ee7c5";
const deg = THREE.MathUtils.degToRad;
const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString("de-DE");

function useTransform(f: Feature): Transform {
  const preview = useApp((s) => (s.preview?.id === f.id ? s.preview.transform : null));
  return preview ?? f.transform;
}

// ── Objects ──────────────────────────────────────────────────────────────────

function FeatureObject({ f }: { f: Feature }) {
  const [entry, setEntry] = useState<GeometryEntry | null>(null);
  const key = geometryKey(f);
  useEffect(() => {
    let alive = true;
    getGeometry(f)
      .then((e) => {
        if (!alive) return;
        setEntry(e);
        if (e.warning) useApp.getState().toast("info", e.warning);
      })
      .catch((err) => alive && useApp.getState().toast("error", `${f.name}: ${err.message}`));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const t = useTransform(f);
  const selected = useApp((s) => s.selection.includes(f.id));
  const hovered = useApp((s) => s.hoveredId === f.id);
  if (!entry || !f.visible) return null;

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > 4) return;
    const multi = e.shiftKey || e.metaKey || e.ctrlKey;
    void execute("selection.set", { ids: [f.id], mode: multi ? "toggle" : "replace" });
  };

  return (
    <group position={t.position} rotation={new THREE.Euler(deg(t.rotation[0]), deg(t.rotation[1]), deg(t.rotation[2]), "XYZ")}>
      <mesh
        ref={(m) => registerMesh(f.id, m)}
        geometry={entry.geometry}
        castShadow
        receiveShadow
        onClick={onClick}
        onPointerOver={(e) => {
          e.stopPropagation();
          useApp.setState({ hoveredId: f.id });
        }}
        onPointerOut={() => useApp.getState().hoveredId === f.id && useApp.setState({ hoveredId: null })}
      >
        <meshStandardMaterial
          color={selected ? "#a6b0b7" : hovered ? "#9ea7ae" : "#959ea6"}
          roughness={0.62}
          metalness={0.04}
          envMapIntensity={0.55}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>
      <lineSegments geometry={entry.edges} raycast={() => null}>
        <lineBasicMaterial color={selected ? ACCENT : "#2b3237"} transparent opacity={selected ? 0.75 : 0.85} />
      </lineSegments>
    </group>
  );
}

// ── Gizmo ────────────────────────────────────────────────────────────────────

function SelectionGizmo({ f }: { f: Feature }) {
  const t = useTransform(f);
  const matrix = useMemo(() => transformMatrix(t), [t]);
  const start = useRef<Transform>(f.transform);

  return (
    <PivotControls
      matrix={matrix}
      autoTransform={false}
      fixed
      scale={96}
      lineWidth={2.5}
      depthTest={false}
      disableScaling
      annotations
      annotationsClass="dim-label live"
      axisColors={["#ef6b73", "#7fd67a", "#6aa8ff"]}
      hoveredColor={ACCENT}
      onDragStart={() => {
        start.current = f.transform;
      }}
      onDrag={(mL) => {
        const pos = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        mL.decompose(pos, quat, new THREE.Vector3());
        const s0 = start.current;
        const q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(s0.rotation.map(deg) as Vec3), "XYZ"));
        const rotating = q0.angleTo(quat) > 1e-5;
        const snap = useApp.getState().snap;
        const snapTo = (v: number, step: number) => (step > 0 ? Math.round(v / step) * step : Math.round(v * 100) / 100);
        let transform: Transform;
        if (rotating) {
          const e = new THREE.Euler().setFromQuaternion(quat, "XYZ");
          transform = {
            position: s0.position,
            rotation: [e.x, e.y, e.z].map((r) => snapTo(THREE.MathUtils.radToDeg(r), 1) + 0) as Vec3,
          };
        } else {
          transform = { position: pos.toArray().map((v) => snapTo(v, snap) + 0) as Vec3, rotation: s0.rotation };
        }
        useApp.setState({ preview: { id: f.id, transform } });
      }}
      onDragEnd={() => {
        const p = useApp.getState().preview;
        if (!p) return;
        void execute("object.transform", { id: f.id, position: p.transform.position, rotation: p.transform.rotation }).then(
          (changed) => !changed && useApp.setState({ preview: null }),
        );
      }}
    />
  );
}

// ── Dimensions ───────────────────────────────────────────────────────────────

function Dimension({ from, to, label }: { from: Vec3; to: Vec3; label: string }) {
  const mid = from.map((v, i) => (v + to[i]) / 2) as Vec3;
  return (
    <group>
      <Line points={[from, to]} color="#6b757d" lineWidth={1} dashed dashSize={1.5} gapSize={1} depthTest={false} transparent opacity={0.8} />
      <Html position={mid} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <div className="dim-label">{label}</div>
      </Html>
    </group>
  );
}

function Dimensions({ f }: { f: Feature }) {
  const entries = useMeshes((s) => s.entries);
  const t = useTransform(f);
  const b = worldBox(f, entries, t);
  if (!b) return null;
  const o = 5;
  const { min, max } = b;
  return (
    <>
      <Dimension from={[min.x, min.y - o, min.z]} to={[max.x, min.y - o, min.z]} label={`${fmt(max.x - min.x)} mm`} />
      <Dimension from={[max.x + o, min.y, min.z]} to={[max.x + o, max.y, min.z]} label={`${fmt(max.y - min.y)} mm`} />
      <Dimension from={[max.x + o, min.y - o, min.z]} to={[max.x + o, min.y - o, max.z]} label={`${fmt(max.z - min.z)} mm`} />
    </>
  );
}

// ── Print bed ────────────────────────────────────────────────────────────────

function Bed({ volume }: { volume: Vec3 }) {
  const [w, d, h] = volume;
  const box = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)), [w, d, h]);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.15, 0]} receiveShadow raycast={() => null}>
        <planeGeometry args={[w + 6, d + 6]} />
        <meshStandardMaterial color="#1e2428" roughness={0.95} metalness={0} />
      </mesh>
      <Grid
        args={[w, d]}
        position={[0, 0.01, 0]}
        cellSize={5}
        cellThickness={0.7}
        cellColor="#2f383e"
        sectionSize={25}
        sectionThickness={1}
        sectionColor="#435058"
        fadeDistance={1200}
        followCamera={false}
        infiniteGrid={false}
      />
      <Grid
        position={[0, -0.3, 0]}
        cellSize={25}
        cellThickness={0.5}
        cellColor="#1c2226"
        sectionSize={125}
        sectionThickness={0.8}
        sectionColor="#232a2f"
        fadeDistance={700}
        fadeStrength={2.2}
        infiniteGrid
      />
      <lineSegments geometry={box} position={[0, h / 2, 0]} raycast={() => null}>
        <lineBasicMaterial color="#3a454c" transparent opacity={0.5} />
      </lineSegments>
    </group>
  );
}

function Lights() {
  return (
    <>
      <ambientLight intensity={0.35} />
      <hemisphereLight args={["#dfe7ec", "#1a1e21", 0.55]} />
      <directionalLight position={[120, 220, 160]} intensity={1.35} />
      <directionalLight position={[-160, 90, -120]} intensity={0.35} color="#bcd6ff" />
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={2.2} position={[0, 6, 6]} scale={[12, 4, 1]} />
        <Lightformer form="rect" intensity={1.2} position={[-8, 2, -2]} rotation-y={Math.PI / 2} scale={[10, 3, 1]} />
        <Lightformer form="rect" intensity={0.8} position={[8, 3, -4]} rotation-y={-Math.PI / 2} scale={[10, 3, 1]} />
        <Lightformer form="ring" intensity={0.6} color="#6ee7c5" position={[0, 8, -10]} scale={4} />
      </Environment>
    </>
  );
}

// ── Viewport ─────────────────────────────────────────────────────────────────

export function Viewport() {
  const doc = useDoc();
  const selection = useApp((s) => s.selection);
  const workspace = useApp((s) => s.workspace);
  const kernel = useKernel();
  const check = usePrintCheck();
  const down = useRef<[number, number] | null>(null);
  const single = selection.length === 1 ? doc.features.find((f) => f.id === selection[0] && f.visible) : undefined;

  return (
    <div
      className="panel viewport"
      onPointerDown={(e) => (down.current = [e.clientX, e.clientY])}
    >
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [150, 135, 205], fov: 35, near: 0.5, far: 5000 }}
        gl={{ antialias: true }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
        }}
        onPointerMissed={(e) => {
          const d = down.current;
          if (d && Math.hypot(e.clientX - d[0], e.clientY - d[1]) < 4) void execute("selection.clear");
        }}
      >
        <Lights />
        <Bed volume={doc.printer.volume} />
        <ContactShadows position={[0, 0.02, 0]} scale={160} blur={2.4} far={60} opacity={0.55} resolution={512} color="#000000" />
        {/* CAD frame: Z up, millimetres */}
        <group rotation={[-Math.PI / 2, 0, 0]}>
          {doc.features.map((f) => (
            <FeatureObject key={f.id} f={f} />
          ))}
          {single && workspace === "model" && (
            <>
              <SelectionGizmo key={single.id} f={single} />
              <Dimensions f={single} />
            </>
          )}
        </group>
        <OrbitControls makeDefault enableDamping dampingFactor={0.12} target={[0, 12, 0]} minDistance={20} maxDistance={1500} />
        <SelectionOutline />
        <GizmoHelper alignment="top-right" margin={[62, 62]} renderPriority={2}>
          <AxisIndicator />
        </GizmoHelper>
      </Canvas>

      {kernel.status !== "ready" || kernel.busy > 0 ? (
        <div className="vp-badge">
          {kernel.status === "error" ? (
            <>CAD-Kern konnte nicht geladen werden: {kernel.error}</>
          ) : (
            <>
              <span className="spinner" />
              {kernel.status === "loading" ? "CAD-Kern wird geladen …" : "Berechne Geometrie …"}
            </>
          )}
        </div>
      ) : (
        check.state === "warn" && (
          <div className="vp-badge warn" title={check.issues.join(", ")}>
            <TriangleAlert size={14} />
            {check.issues[0]}
            {check.issues.length > 1 && <span className="more">+{check.issues.length - 1}</span>}
          </div>
        )
      )}

      {doc.features.length === 0 && kernel.status === "ready" && workspace === "model" && (
        <div className="empty-state">
          <h2>Leeres Druckbett</h2>
          <p>Beginne mit einem Grundkörper – du kannst ihn danach frei verändern.</p>
          <div className="empty-actions">
            <button className="chip" onClick={() => execute("file.example")}>
              <Icon name="shapes" size={15} />
              Beispiel
            </button>
            {PRIMITIVES.slice(0, 3).map((p) => (
              <button key={p.id} className="chip" onClick={() => execute(p.id)}>
                <Icon name={p.icon} size={15} />
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {workspace === "model" && <Toolbar />}

      {workspace !== "model" && (
        <div className="soon">
          <div className="soon-card">
            <Icon name={workspace === "sketch" ? "sketch" : workspace === "print" ? "export" : "visible"} size={22} />
            <h2>
              {workspace === "sketch" ? "2D-Skizzen" : workspace === "print" ? "Druck vorbereiten" : "Vorschau"} kommt bald
            </h2>
            <p>
              {workspace === "sketch"
                ? "Hier zeichnest du bald Formen in 2D und ziehst sie in die Höhe."
                : workspace === "print"
                  ? "Hier richtest du bald dein Modell auf dem Druckbett aus und prüfst Überhänge."
                  : "Hier siehst du bald eine Schicht-Vorschau deines Drucks."}
            </p>
            <button className="chip" style={{ margin: "0 auto" }} onClick={() => useApp.setState({ workspace: "model" })}>
              Zurück zum Modell
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

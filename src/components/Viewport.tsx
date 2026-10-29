import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { Gizmo, useGizmo } from "./Gizmo";
import {
  ContactShadows,
  Environment,
  GizmoHelper,
  Grid,
  Html,
  Lightformer,
  OrbitControls,
} from "@react-three/drei";
import { SelectionOutline, registerMesh } from "./SelectionOutline";
import { AxisIndicator } from "./AxisIndicator";
import { execute } from "../core/commands";
import { useApp, useDoc } from "../core/store";
import { type Feature, type Transform, type Vec3 } from "../core/document";
import { getGeometry, KernelError, useKernel, useMeshes, type GeometryEntry } from "../cad/kernel";
import { worldBox } from "../core/bounds";
import { geometryKey } from "../core/document";
import { Toolbar } from "./Toolbar";
import { PropertiesOverlay } from "./PropertiesPanel";
import { PRIMITIVES } from "./LeftRail";
import { Icon } from "../ui/icons";

const ACCENT = "#6ee7c5";
const deg = THREE.MathUtils.degToRad;
const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString("de-DE");

function useTransform(f: Feature): Transform {
  const preview = useApp((s) => (s.preview?.id === f.id ? s.preview.transform : null));
  return preview ?? f.transform;
}

// ── Objects ──────────────────────────────────────────────────────────────────

function FeatureObject({ f, order }: { f: Feature; order: number }) {
  const [entry, setEntry] = useState<GeometryEntry | null>(null);
  const key = geometryKey(f);
  useEffect(() => {
    let alive = true;
    getGeometry(f)
      .then((e) => alive && setEntry(e))
      .catch((err) => {
        if (!alive) return;
        const app = useApp.getState();
        app.toast("error", err instanceof KernelError && err.edgeTreatment ? err.message : `${f.name}: ${err.message}`);
        // A rejected rounding/chamfer step is taken back so the model never shows a value it can't build.
        const node = app.nodes[app.currentId];
        if (err instanceof KernelError && err.edgeTreatment && node.parentId && /^object\.(fillet|chamfer)$/.test(node.commandId))
          app.jumpTo(node.parentId);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const t = useTransform(f);
  const selected = useApp((s) => s.selection.includes(f.id));
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
          color="#9aa3aa"
          roughness={0.62}
          metalness={0.04}
          envMapIntensity={0.55}
          polygonOffset
          // Coplanar faces of different bodies resolve deterministically:
          // the selected body wins, then later bodies over earlier ones.
          polygonOffsetFactor={1}
          polygonOffsetUnits={selected ? 1 : 2 + Math.max(0, 40 - order) * 2}
        />
      </mesh>
      <lineSegments geometry={entry.edges} raycast={() => null}>
        <lineBasicMaterial color={selected ? ACCENT : "#2b3237"} transparent opacity={selected ? 0.75 : 0.85} />
      </lineSegments>
    </group>
  );
}

// ── Dimensions ───────────────────────────────────────────────────────────────

/** One compact label per axis at the middle of a bounding-box edge; shown only on hover or while dragging. */
function Dimensions({ f }: { f: Feature }) {
  const entries = useMeshes((s) => s.entries);
  const t = useTransform(f);
  const hovered = useApp((s) => s.hoveredId === f.id || s.preview?.id === f.id);
  const dragging = useGizmo((s) => s.dragging);
  const b = worldBox(f, entries, t);
  if (!b || !(hovered || dragging)) return null;
  const { min, max } = b;
  const labels: [Vec3, string][] = [
    [[(min.x + max.x) / 2, min.y, min.z], `${fmt(max.x - min.x)}`],
    [[max.x, (min.y + max.y) / 2, min.z], `${fmt(max.y - min.y)}`],
    [[max.x, min.y, (min.z + max.z) / 2], `${fmt(max.z - min.z)}`],
  ];
  return (
    <>
      {labels.map(([at, text], i) => (
        <Html key={i} position={at} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
          <div className={`dim-label axis-${"xyz"[i]}`}>{text} mm</div>
        </Html>
      ))}
    </>
  );
}

function SelectedGizmo({ f }: { f: Feature }) {
  const t = useTransform(f);
  return <Gizmo f={f} transform={t} />;
}

/** Keeps near/far tight around the scene for good depth precision at any zoom. */
function DepthRange() {
  useFrame(({ camera, controls }) => {
    const target = (controls as unknown as { target?: THREE.Vector3 } | null)?.target ?? new THREE.Vector3();
    const dist = camera.position.distanceTo(target);
    const near = Math.max(0.05, dist / 200);
    const far = Math.max(2000, dist * 12);
    if (Math.abs(camera.near - near) > near * 0.05 || Math.abs(camera.far - far) > far * 0.05) {
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
    }
  });
  return null;
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
          {doc.features.map((f, i) => (
            <FeatureObject key={f.id} f={f} order={i} />
          ))}
          {single && workspace === "model" && (
            <>
              <SelectedGizmo key={single.id} f={single} />
              <Dimensions f={single} />
            </>
          )}
        </group>
        <DepthRange />
        <OrbitControls makeDefault enableDamping dampingFactor={0.12} target={[0, 12, 0]} minDistance={20} maxDistance={1500} />
        <SelectionOutline />
        <GizmoHelper alignment="bottom-left" margin={[58, 58]} renderPriority={2}>
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
      ) : null}

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
      {workspace === "model" && <PropertiesOverlay />}

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

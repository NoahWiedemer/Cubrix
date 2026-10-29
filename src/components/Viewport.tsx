import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { Gizmo, useGizmo } from "./Gizmo";
import {
  ContactShadows,
  GizmoHelper,
  Grid,
  Html,
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
import { CameraRig } from "./CameraRig";
import { QUALITY, useSettings } from "../ui/settings";
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
          color="#99a1a8"
          roughness={0.6}
          metalness={0}
          envMapIntensity={0.18}
          polygonOffset
          // Coplanar faces of different bodies resolve deterministically:
          // the selected body wins, then later bodies over earlier ones.
          polygonOffsetFactor={1}
          polygonOffsetUnits={selected ? 1 : 2 + Math.max(0, 40 - order) * 2}
        />
      </mesh>
      <lineSegments geometry={entry.edges} raycast={() => null}>
        <lineBasicMaterial color={selected ? ACCENT : "#14181b"} transparent opacity={selected ? 0.8 : 0.55} />
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
    if ((camera as THREE.OrthographicCamera).isOrthographicCamera) return;
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
      <Grid
        args={[w, d]}
        position={[0, 0.01, 0]}
        cellSize={5}
        cellThickness={0.7}
        cellColor="#262e33"
        sectionSize={25}
        sectionThickness={0.9}
        sectionColor="#36414a"
        fadeDistance={900}
        fadeStrength={1.4}
        followCamera={false}
        infiniteGrid={false}
      />
      <Grid
        position={[0, -0.3, 0]}
        cellSize={25}
        cellThickness={0.5}
        cellColor="#181d21"
        sectionSize={125}
        sectionThickness={0.7}
        sectionColor="#1d2327"
        fadeDistance={700}
        fadeStrength={2.2}
        infiniteGrid
      />
      <lineSegments geometry={box} position={[0, h / 2, 0]} raycast={() => null}>
        <lineBasicMaterial color="#3a454c" transparent opacity={0.35} />
      </lineSegments>
    </group>
  );
}

/** Neutral studio look: PMREM room environment plus key, fill and rim lights. */
function Lights() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    // three ≥ r163: scene.environment uses scene.environmentIntensity, not material.envMapIntensity.
    scene.environmentIntensity = 0.16;
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);
  return (
    <>
      <hemisphereLight args={["#e8eef2", "#101315", 0.35]} />
      {/* key: upper front-left */}
      <directionalLight position={[-140, 220, 160]} intensity={1.45} />
      {/* cool fill */}
      <directionalLight position={[200, 70, 80]} intensity={0.22} color="#d6e4ff" />
      {/* rim */}
      <directionalLight position={[-40, 120, -220]} intensity={0.45} color="#f2fffb" />
    </>
  );
}

/** Small projection toggle next to the axis indicator. */
function ViewControls() {
  const projection = useSettings((s) => s.projection);
  return (
    <div className="view-controls">
      <button
        className={projection === "perspective" ? "on" : ""}
        onClick={() => execute("view.projection", { mode: "perspective" })}
        data-tip="Perspektive"
        data-kbd="o"
        data-tip-pos="top"
      >
        <Icon name="perspective" size={15} />
      </button>
      <button
        className={projection === "orthographic" ? "on" : ""}
        onClick={() => execute("view.projection", { mode: "orthographic" })}
        data-tip="Orthografisch"
        data-kbd="o"
        data-tip-pos="top"
      >
        <Icon name="projection" size={15} />
      </button>
      <span className="vc-sep" />
      <button onClick={() => execute("view.iso")} data-tip="Isometrische Ansicht" data-kbd="i" data-tip-pos="top">
        <Icon name="iso" size={15} />
      </button>
    </div>
  );
}

// ── Viewport ─────────────────────────────────────────────────────────────────

export function Viewport() {
  const doc = useDoc();
  const selection = useApp((s) => s.selection);
  const workspace = useApp((s) => s.workspace);
  const kernel = useKernel();
  const quality = QUALITY[useSettings((s) => s.quality)];
  const down = useRef<[number, number] | null>(null);
  const single = selection.length === 1 ? doc.features.find((f) => f.id === selection[0] && f.visible) : undefined;

  return (
    <div
      className="panel viewport"
      onPointerDown={(e) => (down.current = [e.clientX, e.clientY])}
    >
      <Canvas
        shadows
        dpr={[1, quality.dpr]}
        camera={{ position: [150, 135, 205], fov: 35, near: 0.5, far: 5000 }}
        gl={{ antialias: true }}
        onCreated={(state) => {
          const { gl } = state;
          if (import.meta.env.DEV) Object.assign(window, { __viewer: state });
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 0.85;
        }}
        onPointerMissed={(e) => {
          const d = down.current;
          if (d && Math.hypot(e.clientX - d[0], e.clientY - d[1]) < 4) void execute("selection.clear");
        }}
      >
        <Lights />
        <Bed volume={doc.printer.volume} />
        {quality.shadows > 0 && (
          <ContactShadows position={[0, 0.02, 0]} scale={180} blur={2.8} far={70} opacity={0.42} resolution={quality.shadows} color="#000000" />
        )}
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
        <CameraRig />
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
      <ViewControls />

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

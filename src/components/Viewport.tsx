import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { Gizmo, useGizmo } from "./Gizmo";
import {
  ContactShadows,
  GizmoHelper,
  Html,
  Line,
} from "@react-three/drei";
import { SelectionOutline, registerMesh, useMeshObjects } from "./SelectionOutline";
import { AxisIndicator } from "./AxisIndicator";
import { execute } from "../core/commands";
import { useApp, useDoc } from "../core/store";
import { type Feature, type SketchFeature, type Transform, type Vec3 } from "../core/document";
import { getGeometry, KernelError, useKernel, useMeshes, type GeometryEntry } from "../cad/kernel";
import { worldBox } from "../core/bounds";
import { geometryKey } from "../core/document";
import { Toolbar } from "./Toolbar";
import { GroundGrid } from "./GroundGrid";
import { openContextMenu } from "./ContextMenu";
import { SegmentedControl } from "../ui/SegmentedControl";
import { SketchDraw, SketchObject } from "./SketchLayer";
import { SketchToolbar } from "./SketchToolbar";
import { PreviewControls, PreviewEffects, ViewportCapture } from "./PreviewControls";
import { usePreview } from "../ui/preview";
import { usePrintView } from "./PrintPanel";
import { CameraRig } from "./CameraRig";
import { useSettings } from "../ui/settings";
import { placeText, useTextTool } from "../ui/textTool";
import { viewportPick } from "../ui/viewportPick";
import { volumeCorners, volumeEdges } from "../ui/buildVolume";
import { useViewportFrame } from "../ui/viewportFrame";
import { useAiRun } from "../ai/run";
import { Icon } from "../ui/icons";

const ACCENT = "#6ee7c5";
const deg = THREE.MathUtils.degToRad;
const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString("de-DE");

function useTransform(f: Feature): Transform {
  const preview = useApp((s) => (s.preview?.id === f.id ? s.preview.transform : null));
  return preview ?? f.transform;
}

/**
 * Tints faces red where they point down steeper than 45° (overhangs). Uses world
 * space: the scene is Y-up, so "down" is -Y. Faces lying on the bed are excluded.
 */
function overhangShader(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vWorldN;\nvarying vec3 vWorldP;")
    .replace(
      "#include <worldpos_vertex>",
      "#include <worldpos_vertex>\nvWorldN = normalize(mat3(modelMatrix) * objectNormal);\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;",
    );
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vWorldN;\nvarying vec3 vWorldP;")
    .replace(
      "#include <dithering_fragment>",
      `#include <dithering_fragment>
      float down = -normalize(vWorldN).y;
      float over = smoothstep(0.69, 0.73, down) * step(0.15, vWorldP.y);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.86, 0.28, 0.27), over * 0.85);`,
    );
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
  const presenting = useApp((s) => s.workspace === "preview");
  const anim = useBuildAnimation(f.id, t.position);
  const overhangsOn = usePrintView((s) => s.overhangs);
  const showOverhangs = overhangsOn && !presenting;
  if (!entry || !f.visible) return null;

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (presenting) return; // Vorschau: clicks only orbit
    e.stopPropagation();
    if (e.delta > 4) return;
    if (useTextTool.getState().active) {
      // Scene is Y-up; the CAD frame is Z-up: (x, y, z)cad = (x, -z, y)world.
      placeText({ x: e.nativeEvent.clientX, y: e.nativeEvent.clientY }, [e.point.x, -e.point.z, e.point.y], f.id);
      return;
    }
    const multi = e.shiftKey || e.metaKey || e.ctrlKey;
    void execute("selection.set", { ids: [f.id], mode: multi ? "toggle" : "replace" });
  };

  return (
    <group ref={anim.outer} position={t.position} rotation={new THREE.Euler(deg(t.rotation[0]), deg(t.rotation[1]), deg(t.rotation[2]), "XYZ")}>
      <group ref={anim.inner}>
      <mesh
        ref={(m) => registerMesh(f.id, m)}
        geometry={entry.geometry}
        castShadow
        receiveShadow
        onClick={onClick}
        onContextMenu={(e) => {
          if (presenting) return;
          e.stopPropagation();
          e.nativeEvent.preventDefault();
          if (!useApp.getState().selection.includes(f.id)) void execute("selection.set", { ids: [f.id] });
          openContextMenu(e.nativeEvent.clientX, e.nativeEvent.clientY);
        }}
        onPointerOver={(e) => {
          if (presenting) return;
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
          key={showOverhangs ? "overhang" : "plain"}
          onBeforeCompile={showOverhangs ? overhangShader : undefined}
          customProgramCacheKey={() => (showOverhangs ? "overhang" : "plain")}
        />
      </mesh>
      <lineSegments geometry={entry.edges} raycast={() => null} visible={!presenting}>
        <lineBasicMaterial color={selected ? ACCENT : "#14181b"} transparent opacity={selected ? 0.8 : 0.55} />
      </lineSegments>
      {/* Mint edge glow while materializing (fades out). */}
      <lineSegments geometry={entry.edges} raycast={() => null} renderOrder={5}>
        <lineBasicMaterial ref={anim.glow} color={ACCENT} transparent opacity={0} depthTest={false} toneMapped={false} />
      </lineSegments>
      </group>
    </group>
  );
}

const reducedMotion = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * AI build animations: objects created during a run grow from their base (CAD Z) with
 * a fading mint edge glow (boolean results only glow), and AI moves tween instead of
 * jumping. Runs alongside the operations; nothing waits for it.
 */
function useBuildAnimation(id: string, target: Vec3) {
  const outer = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);
  const glow = useRef<THREE.LineBasicMaterial>(null);
  const shown = useRef<THREE.Vector3 | null>(null);
  const start = useRef<number | null>(null);
  useFrame((_, dt) => {
    const on = useSettings.getState().aiAnimations && !reducedMotion;
    const run = useAiRun.getState();
    // Position tween (AI only).
    const g = outer.current;
    if (g) {
      const goal = new THREE.Vector3(...target);
      if (!shown.current || !on || !run.running) shown.current = goal.clone();
      else shown.current.lerp(goal, Math.min(1, dt / 0.09));
      g.position.copy(shown.current);
    }
    const b = run.born[id];
    const i = inner.current;
    const m = glow.current;
    if (!b || !on) {
      if (i && i.scale.z !== 1) i.scale.set(1, 1, 1);
      if (m && m.opacity) m.opacity = 0;
      return;
    }
    // The clock starts when the mesh first renders, plus the batch stagger.
    if (start.current === null) {
      if (!i) return;
      start.current = performance.now() + b.delay * ((import.meta.env.DEV && (window as unknown as { __animSlow?: number }).__animSlow) || 1);
    }
    // Dev only: window.__animSlow stretches the animation for frame captures.
    const slow = (import.meta.env.DEV && (window as unknown as { __animSlow?: number }).__animSlow) || 1;
    const k = Math.max(0, Math.min(1, (performance.now() - start.current) / ((b.kind === "grow" ? 340 : 520) * slow)));
    if (i) {
      if (b.kind === "grow") {
        // Ease-out with a hint of overshoot, from the base upwards.
        const e = 1 - Math.pow(1 - k, 3);
        const z = Math.max(0.001, e + Math.sin(k * Math.PI) * 0.06);
        const xy = 0.86 + 0.14 * e;
        i.scale.set(xy, xy, z);
      } else i.scale.set(1, 1, 1);
    }
    if (m) m.opacity = (1 - k) * 0.9;
    if (k >= 1) {
      start.current = null;
      const born = { ...useAiRun.getState().born };
      delete born[id];
      useAiRun.setState({ born });
    }
  });
  return { outer, inner, glow };
}

// ── Dimensions ───────────────────────────────────────────────────────────────

/** One compact label per axis at the middle of a bounding-box edge; shown only while dragging a handle. */
function Dimensions({ f }: { f: Feature }) {
  const entries = useMeshes((s) => s.entries);
  const t = useTransform(f);
  const dragging = useGizmo((s) => s.dragging);
  const b = worldBox(f, entries, t);
  if (!b || !dragging) return null;
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

/**
 * Build-volume frame drawn like an open box: the vertical edge at the bed corner
 * nearest to the camera, and the two top edges meeting above it, fade out so no
 * frame line ever sits in front of the model.
 */
function BuildVolume({ w, d, h, strong }: { w: number; d: number; h: number; strong: boolean }) {
  // Rebuilt whenever any dimension changes (the old geometries are disposed).
  const edges = useMemo(() => {
    const list = volumeEdges(w, d, h).map((e) => ({
      ...e,
      geometry: new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...e.a), new THREE.Vector3(...e.b)]),
    }));
    return { corners: volumeCorners(w, d), list };
  }, [w, d, h]);
  useEffect(() => () => edges.list.forEach((e) => e.geometry.dispose()), [edges]);
  const mats = useRef<THREE.LineBasicMaterial[]>([]);
  useFrame(({ camera }, dt) => {
    let nearest = 0;
    let best = Infinity;
    edges.corners.forEach(([cx, cz], i) => {
      const dd = Math.hypot(camera.position.x - cx, camera.position.z - cz);
      if (dd < best) {
        best = dd;
        nearest = i;
      }
    });
    edges.list.forEach((e, i) => {
      const m = mats.current[i];
      if (!m) return;
      const target = e.corners.includes(nearest) ? 0 : strong ? 0.7 : 0.3;
      // ~120 ms exponential fade
      m.opacity += (target - m.opacity) * Math.min(1, dt / 0.04);
      m.visible = m.opacity > 0.01;
    });
  });
  return (
    <group>
      {edges.list.map((e, i) => (
        <lineSegments key={i} geometry={e.geometry} raycast={() => null}>
          <lineBasicMaterial ref={(m) => { if (m) mats.current[i] = m; }} color={strong ? "#56646d" : "#3a454c"} transparent opacity={0.35} />
        </lineSegments>
      ))}
    </group>
  );
}

/** Invisible bed plane that catches the text tool's click (CAD frame, z = 0). */
function TextPlacementPlane() {
  return (
    <mesh
      position={[0, 0, 0]}
      onClick={(e) => {
        e.stopPropagation();
        if (e.delta > 4) return;
        placeText({ x: e.nativeEvent.clientX, y: e.nativeEvent.clientY }, [Math.round(e.point.x), Math.round(-e.point.z), 0]);
      }}
    >
      <planeGeometry args={[4000, 4000]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  );
}

// ── Print bed ────────────────────────────────────────────────────────────────

function Bed({ volume }: { volume: Vec3 }) {
  const [w, d, h] = volume;
  const showVolume = useSettings((s) => s.showVolume);
  const volumeStrong = useSettings((s) => s.volumeStrong);
  const showGrid = useSettings((s) => s.showGrid);
  const gridStrength = useSettings((s) => s.gridStrength);
  const snap = useApp((s) => s.snap);
  const gridFade = useSettings((s) => s.gridFade);
  const outline = useMemo(() => [[-w / 2, 0.02, -d / 2], [w / 2, 0.02, -d / 2], [w / 2, 0.02, d / 2], [-w / 2, 0.02, d / 2], [-w / 2, 0.02, -d / 2]] as [number, number, number][], [w, d]);
  return (
    <group>
      {showGrid && <GroundGrid fade={gridFade} step={snap} strength={gridStrength} />}
      {showVolume && (
        <>
          <Line points={outline} color={volumeStrong ? "#6f808a" : "#46535b"} lineWidth={1.2} />
          <BuildVolume w={w} d={d} h={h} strong={volumeStrong} />
        </>
      )}
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
      <hemisphereLight args={["#eef3f6", "#0a0c0e", 0.6]} />
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
      <SegmentedControl
        size="sm"
        className="icons bare"
        value={projection}
        onChange={(mode) => execute("view.projection", { mode })}
        options={[
          { value: "perspective", icon: <Icon name="perspective" size={17} />, tip: "Perspektive", kbd: "o" },
          { value: "orthographic", icon: <Icon name="projection" size={17} />, tip: "Orthografisch", kbd: "o" },
        ]}
      />
      <span className="vc-sep" />
      <button onClick={() => execute("view.iso")} data-tip="Isometrische Ansicht" data-kbd="i" data-tip-pos="bottom">
        <Icon name="iso" size={17} />
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
  const background = usePreview((s) => s.background);
  const shadowKey = useApp((s) => s.currentId) + useMeshes((s) => Object.keys(s.entries).length);
  const down = useRef<[number, number] | null>(null);
  const single = selection.length === 1 ? doc.features.find((f) => f.id === selection[0] && f.visible) : undefined;
  const textTool = useTextTool((s) => s.active);
  const frame = useViewportFrame();
  const aiRunning = useAiRun((s) => s.running) && workspace !== "preview";
  const aiAnimations = useSettings((s) => s.aiAnimations);
  const free = { left: frame.left, right: frame.right };

  return (
    <div
      onContextMenu={(e) => e.preventDefault()}
      className={`viewport ${workspace === "preview" ? `bg-${background}` : ""} ${textTool ? "placing-text" : ""}`}
      style={{ clipPath: `inset(0 ${free.right}px 0 ${free.left}px round 12px)` }}
      onPointerDown={(e) => (down.current = [e.clientX, e.clientY])}
    >
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [150, 135, 205], fov: 35, near: 0.5, far: 5000 }}
        gl={{ antialias: true, preserveDrawingBuffer: false }}
        onCreated={(state) => {
          const { gl } = state;
          if (import.meta.env.DEV) Object.assign(window, { __viewer: state });
          viewportPick.pick = (x, y) => {
            const { camera, raycaster, gl: renderer } = state.get();
            const r = renderer.domElement.getBoundingClientRect();
            if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
            raycaster.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), camera);
            const meshes = useMeshObjects.getState().meshes;
            const ids = new Map(Object.entries(meshes).map(([id, m]) => [m, id]));
            const hit = raycaster.intersectObjects([...ids.keys()], false)[0];
            // Scene is Y-up; CAD is Z-up: (x, y, z)cad = (x, -z, y)scene.
            if (hit) {
              const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3();
              return { point: [hit.point.x, -hit.point.z, hit.point.y], featureId: ids.get(hit.object as THREE.Mesh), facesUp: n.y > 0.7 };
            }
            const p = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
            return p ? { point: [p.x, -p.z, 0], facesUp: true } : null;
          };
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 0.85;
        }}
        onPointerMissed={(e) => {
          if (workspace === "preview") return;
          const d = down.current;
          if (d && Math.hypot(e.clientX - d[0], e.clientY - d[1]) < 4) void execute("selection.clear");
        }}
      >
        <Lights />
        {workspace !== "preview" && <Bed volume={doc.printer.volume} />}
        <PreviewEffects />
        <ViewportCapture />
        {(
          // Rendered once per document state, not every frame (keeps orbiting cheap).
          <ContactShadows key={shadowKey} frames={1} position={[0, 0.02, 0]} scale={180} blur={2.8} far={70} opacity={0.42} resolution={1024} color="#000000" />
        )}
        {/* CAD frame: Z up, millimetres */}
        <group rotation={[-Math.PI / 2, 0, 0]}>
          {doc.features.map((f, i) =>
            f.type === "sketch" ? <SketchObject key={f.id} f={f} /> : <FeatureObject key={f.id} f={f} order={i} />,
          )}
          {textTool && <TextPlacementPlane />}
          {workspace === "sketch" && <SketchDraw sketches={doc.features.filter((f): f is SketchFeature => f.type === "sketch" && f.visible)} />}
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
        {workspace !== "preview" && (
          <GizmoHelper alignment="bottom-left" margin={[free.left + 58, 58]} renderPriority={2}>
            <AxisIndicator />
          </GizmoHelper>
        )}
      </Canvas>

      <div className="vp-free" style={free}>
      <div className="vp-frame" />
      {/* Siri-style glow while the AI works: CSS only, the canvas never re-renders for it. */}
      <div className={`ai-glow ${aiRunning && aiAnimations ? "on" : ""}`} aria-hidden>
        <span className="ai-glow-edge" />
        <span className="ai-glow-blur" />
      </div>
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


      {workspace === "model" && <Toolbar />}
      {workspace === "preview" && <PreviewControls />}
      <ViewControls />

      {workspace === "sketch" && <SketchToolbar />}
      </div>
    </div>
  );
}

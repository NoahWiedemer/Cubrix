import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { create } from "zustand";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { materialOf } from "../core/materials";
import { nextDrill } from "../ui/drill";
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
import { findFeature, groupsOf, parentsOf, type BooleanFeature, type Feature, type GroupFeature, type SketchFeature, type Transform, type Vec3 } from "../core/document";
import { getGeometry, KernelError, useKernel, useMeshes, type GeometryEntry } from "../cad/kernel";
import { SELECTION_ID, composeTransform, worldBox } from "../core/bounds";
import { geometryKey } from "../core/document";
import { Toolbar } from "./Toolbar";
import { GroundGrid } from "./GroundGrid";
import { openContextMenu } from "./ContextMenu";
import { SegmentedControl } from "../ui/SegmentedControl";
import { Kbd } from "../ui/Tooltip";
import { SketchDraw, SketchObject } from "./SketchLayer";
import { SketchToolbar } from "./SketchToolbar";
import { PreviewControls, PreviewEffects, ViewportCapture } from "./PreviewControls";
import { usePreview } from "../ui/preview";
import { usePrintView } from "./PrintPanel";
import { CameraRig } from "./CameraRig";
import { useSettings } from "../ui/settings";
import { placeText, useTextTool } from "../ui/textTool";
import { addMeasurePoint, angleAt, setMeasureMode, useMeasure } from "../ui/measureTool";
import { viewportPick } from "../ui/viewportPick";
import { makeRectPicker, setPickInRect, useBoxSelect } from "./BoxSelect";
import { volumeCorners, volumeEdges } from "../ui/buildVolume";
import { useViewportFrame } from "../ui/viewportFrame";
import { useAiRun } from "../ai/run";
import { Icon } from "../ui/icons";

const ACCENT = "#6ee7c5";
const deg = THREE.MathUtils.degToRad;
const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString("de-DE");

function useTransform(f: Feature): Transform {
  const preview = useApp((s) => (s.preview?.id === f.id ? s.preview.transform : null));
  // While a multi-selection is dragged, every selected object follows the shared motion.
  const shared = useApp((s) => (s.preview?.id === SELECTION_ID && s.selection.includes(f.id) ? s.preview.transform : null));
  return preview ?? (shared ? composeTransform(shared, f.transform) : f.transform);
}

const IDENTITY: Transform = { position: [0, 0, 0], rotation: [0, 0, 0] };

/** One gizmo for several selected objects, at their combined bounding box. */
function SelectionGizmo({ features }: { features: Feature[] }) {
  const entries = useMeshes((s) => s.entries);
  const motion = useApp((s) => (s.preview?.id === SELECTION_ID ? s.preview.transform : IDENTITY));
  const box = new THREE.Box3();
  for (const m of features) {
    const b = worldBox(m, entries, composeTransform(motion, m.transform));
    if (b) box.union(b);
  }
  const virtual = useMemo(
    () => ({ id: SELECTION_ID, name: "Auswahl", type: "group", visible: true, transform: IDENTITY, children: features }) as Feature,
    [features],
  );
  return <Gizmo f={virtual} transform={motion} multi={{ ids: features.map((f) => f.id), box: box.isEmpty() ? null : box }} />;
}

/**
 * Tints faces red where they point down steeper than 45° (overhangs). Uses world
 * space: the scene is Y-up, so "down" is -Y. Faces lying on the bed are excluded.
 */
/**
 * Fine matte micro-texture (display only): world-space value noise (grain ≈ 0.45 mm, so it
 * needs no UVs and is the same on every object) slightly tilts the normal and varies the
 * roughness. It fades out where the grain gets denser than a pixel, so there's no moiré.
 */
const SURFACE_GLSL = /* glsl */ `
  // 3D simplex noise (Gustavson): isotropic, no lattice or diagonal artifacts.
  vec4 sPerm(vec4 x) { return mod(((x * 34.0) + 10.0) * x, 289.0); }
  float sSimplex(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - 0.5;
    i = mod(i, 289.0);
    vec4 p = sPerm(sPerm(sPerm(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    const vec3 ns = vec3(0.285714285714, -0.928571428571, 0.142857142857);
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = inversesqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }
  // Two octaves, each faded out before its features reach pixel size (w = feature/px ratio).
  float sGrain(vec3 p, float w) {
    float a = 1.0 - smoothstep(0.18, 0.45, w);
    float b = 1.0 - smoothstep(0.18, 0.45, w * 2.1);
    return sSimplex(p) * a + 0.5 * sSimplex(p * 2.1 + 17.3) * b;
  }
`;

/** The studio environment map (set by <Lights>), shared by all object materials. */
const useStudioEnv = create<{ env: THREE.Texture | null }>(() => ({ env: null }));

/** Wood fill: the picked colour pulled towards a warm light wood (neutral = plain wood). */
function woodTint(color?: string) {
  const wood = new THREE.Color("#b98a57");
  return color ? new THREE.Color(color).lerp(wood, 0.55).getStyle() : wood.getStyle();
}

function surfaceShader(shader: THREE.WebGLProgramParametersWithUniforms, overhang: boolean, grain: boolean, wood = false) {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vWorldN;\nvarying vec3 vWorldP;")
    .replace(
      "#include <worldpos_vertex>",
      "#include <worldpos_vertex>\nvWorldN = normalize(mat3(modelMatrix) * objectNormal);\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;",
    );
  shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vWorldN;\nvarying vec3 vWorldP;\n" + SURFACE_GLSL);
  if (grain)
    shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <roughnessmap_fragment>",
      `#include <roughnessmap_fragment>
      // Fine matte grain, ~0.08 mm features in world space (3D noise, so no UV/projection seams).
      vec3 sp = vWorldP / 0.08;
      float sW = length(fwidth(sp));
      float sN = sGrain(sp, sW);
      roughnessFactor = clamp(roughnessFactor + sN * 0.03, 0.0, 1.0);`,
    )
    .replace(
      "#include <normal_fragment_maps>",
      `#include <normal_fragment_maps>
      if (sW < 0.45) {
        float e = 0.2;
        vec3 g = vec3(sGrain(sp + vec3(e, 0, 0), sW), sGrain(sp + vec3(0, e, 0), sW), sGrain(sp + vec3(0, 0, e), sW)) - sN;
        vec3 gv = mat3(viewMatrix) * (g / e);
        // Only the part of the gradient along the surface tilts the normal.
        vec3 tilt = gv - dot(gv, normal) * normal;
        normal = normalize(normal - tilt * 0.035);
      }`,
    );
  if (wood)
    // Soft growth rings around the vertical axis, slightly wobbly, darkening the colour.
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>
      {
        // Rings about 2 mm apart, gently bent by low-frequency noise; fine fibre streaks along them.
        float ring = length(vWorldP.xz) * 3.1 + sSimplex(vWorldP * vec3(0.08, 0.02, 0.08)) * 2.2;
        float band = smoothstep(0.6, 1.0, abs(sin(ring)));
        float fibre = sSimplex(vWorldP * vec3(0.6, 6.0, 0.6)) * 0.5 + 0.5;
        diffuseColor.rgb *= 1.0 - 0.13 * band - 0.04 * fibre;
      }`,
    );
  if (overhang)
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <dithering_fragment>",
      `#include <dithering_fragment>
      float down = -normalize(vWorldN).y;
      float over = smoothstep(0.69, 0.73, down) * step(0.15, vWorldP.y);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.86, 0.28, 0.27), over * 0.85);`,
    );
}


// ── Objects ──────────────────────────────────────────────────────────────────

/**
 * A group: its members inside the group's transform. The group's own (compound) mesh is
 * only requested for its bounding box (gizmo anchor, dimensions), never drawn.
 */
function GroupObject({ f, order, root }: { f: GroupFeature; order: number; root?: string }) {
  const t = useTransform(f);
  useEffect(() => {
    void getGeometry(f).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometryKey(f)]);
  if (!f.visible) return null;
  return (
    <group position={t.position} rotation={new THREE.Euler(deg(t.rotation[0]), deg(t.rotation[1]), deg(t.rotation[2]), "XYZ")}>
      {f.children.map((c, i) =>
        c.type === "group" ? <GroupObject key={c.id} f={c} order={order + i} root={root ?? f.id} /> : c.type === "sketch" ? null : <FeatureObject key={c.id} f={c} order={order + i} root={root ?? f.id} />,
      )}
    </group>
  );
}

/** From the outermost group down to the object itself (booleans count as one object). */
function pickChain(id: string): string[] {
  const { nodes, currentId } = useApp.getState();
  return [...groupsOf(nodes[currentId].doc, id).map((g) => g.id), id];
}

function FeatureObject({ f, order, root }: { f: Feature; order: number; root?: string }) {
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
        if (err instanceof KernelError && err.edgeTreatment && node.parentId && /^object\.(fillet|chamfer|shell)$/.test(node.commandId))
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
  const grain = useSettings((s) => s.surfaceTexture);
  const studioEnv = useStudioEnv((s) => s.env);
  const look = materialOf(f.material);
  const useGrain = grain && look.grain;
  const programKey = `surface-${showOverhangs ? "overhang" : "plain"}-${useGrain ? "grain" : "flat"}${look.wood ? "-wood" : ""}`;
  if (!entry || !f.visible) return null;

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (presenting) return; // Vorschau: clicks only orbit
    // Locked objects (or members of a locked group) let the click through to whatever is behind.
    const st = useApp.getState();
    if ((f.locked || groupsOf(st.nodes[st.currentId].doc, f.id).some((g) => g.locked)) && !useMeasure.getState().active) return;
    e.stopPropagation();
    if (e.delta > 4) return;
    if (useMeasure.getState().active) {
      addMeasurePoint(snapToCorner(e));
      return;
    }
    if (useTextTool.getState().active) {
      // Scene is Y-up; the CAD frame is Z-up: (x, y, z)cad = (x, -z, y)world.
      placeText({ x: e.nativeEvent.clientX, y: e.nativeEvent.clientY }, [e.point.x, -e.point.z, e.point.y], f.id);
      return;
    }
    const chain = pickChain(f.id);
    if (e.metaKey || e.ctrlKey) {
      // ⌘-click drills in: one level deeper each time, from the object back to the top.
      const { selection } = useApp.getState();
      void execute("selection.set", { ids: [nextDrill(chain, selection)] });
      return;
    }
    // Shift adds to the selection; a plain click always takes the outermost group.
    void execute("selection.set", { ids: [chain[0]], mode: e.shiftKey ? "toggle" : "replace" });
  };
  // Double-click inside a group selects just this member.
  const onDoubleClick = (e: ThreeEvent<MouseEvent>) => {
    if (presenting || !root || f.locked) return;
    e.stopPropagation();
    void execute("selection.set", { ids: [f.id] });
  };

  return (
    <group ref={anim.outer} position={t.position} rotation={new THREE.Euler(deg(t.rotation[0]), deg(t.rotation[1]), deg(t.rotation[2]), "XYZ")}>
      <group ref={anim.inner}>
      <mesh
        ref={(m) => registerMesh(f.id, m)}
        geometry={entry.geometry}
        castShadow={look.opacity === undefined}
        receiveShadow
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => {
          if (presenting) return;
          e.stopPropagation();
          e.nativeEvent.preventDefault();
          // Keep a drilled-in selection; otherwise take the outermost group.
          const chain = pickChain(f.id);
          if (!chain.some((id) => useApp.getState().selection.includes(id))) void execute("selection.set", { ids: [chain[0]] });
          openContextMenu(e.nativeEvent.clientX, e.nativeEvent.clientY);
        }}
        onPointerOver={(e) => {
          if (presenting) return;
          e.stopPropagation();
          useApp.setState({ hoveredId: f.id });
        }}
        onPointerOut={() => useApp.getState().hoveredId === f.id && useApp.setState({ hoveredId: null })}
      >
        <meshPhysicalMaterial
          color={look.wood ? woodTint(f.color) : (f.color ?? "#99a1a8")}
          roughness={look.roughness}
          metalness={look.metalness}
          // Own env map so each material sets its reflection strength (scene.environment
          // has one global intensity, tuned for matt).
          envMap={studioEnv}
          envMapIntensity={look.env}
          clearcoat={look.clearcoat ?? 0}
          clearcoatRoughness={look.clearcoatRoughness ?? 0}
          sheen={look.sheen ?? 0}
          sheenRoughness={0.35}
          sheenColor={look.sheen ? "#ffffff" : "#000000"}
          transparent={look.opacity !== undefined}
          opacity={look.opacity ?? 1}
          polygonOffset
          // Coplanar faces of different bodies resolve deterministically:
          // the selected body wins, then later bodies over earlier ones.
          polygonOffsetFactor={1}
          polygonOffsetUnits={selected ? 1 : 2 + Math.max(0, 40 - order) * 2}
          key={programKey}
          onBeforeCompile={(sh) => surfaceShader(sh, showOverhangs, useGrain, !!look.wood)}
          customProgramCacheKey={() => programKey}
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

/**
 * A selected operand inside a boolean: drawn as a translucent ghost in its parents'
 * frames (cut tools reddish, unions mint, the base neutral) with its own gizmo. Edits go
 * to the operand; the parent result is rebuilt.
 */
function OperandEditor({ f, parents }: { f: Feature; parents: BooleanFeature[] }) {
  const parent = parents[parents.length - 1];
  const index = parent.children.findIndex((c) => c.id === f.id);
  const tint = index === 0 ? "#b9c2c8" : parent.op === "subtract" ? "#e5786b" : parent.op === "union" ? ACCENT : "#7fb6e0";
  const wrap = (node: React.ReactNode, i = 0): React.ReactNode => {
    if (i >= parents.length) return node;
    const t = parents[i].transform;
    return (
      <group position={t.position} rotation={new THREE.Euler(deg(t.rotation[0]), deg(t.rotation[1]), deg(t.rotation[2]), "XYZ")}>
        {wrap(node, i + 1)}
      </group>
    );
  };
  return wrap(
    <>
      <OperandGhost f={f} color={tint} />
      <SelectedGizmo key={f.id} f={f} />
    </>,
  );
}

function OperandGhost({ f, color }: { f: Feature; color: string }) {
  const [entry, setEntry] = useState<GeometryEntry | null>(null);
  const key = geometryKey(f);
  useEffect(() => {
    let alive = true;
    getGeometry(f).then((e) => alive && setEntry(e)).catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const t = useTransform(f);
  if (!entry) return null;
  return (
    <group position={t.position} rotation={new THREE.Euler(deg(t.rotation[0]), deg(t.rotation[1]), deg(t.rotation[2]), "XYZ")}>
      <mesh geometry={entry.geometry} renderOrder={8} raycast={() => null}>
        <meshBasicMaterial color={color} transparent opacity={f.visible ? 0.22 : 0.08} depthWrite={false} toneMapped={false} />
      </mesh>
      <lineSegments geometry={entry.edges} renderOrder={9} raycast={() => null}>
        <lineBasicMaterial color={color} transparent opacity={0.9} depthTest={false} toneMapped={false} />
      </lineSegments>
    </group>
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

/** Measure point from a click on a body: the nearest mesh corner if it's close on screen, else the hit point (CAD frame). */
function snapToCorner(e: ThreeEvent<MouseEvent>): Vec3 {
  const hit = e.point.clone();
  const mesh = e.object as THREE.Mesh;
  const pos = mesh.geometry?.getAttribute("position");
  const tol = e.camera.position.distanceTo(hit) * 0.025;
  let best = hit;
  if (pos) {
    const v = new THREE.Vector3();
    let d = tol;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      const dd = v.distanceTo(hit);
      if (dd < d) {
        d = dd;
        best = v.clone();
      }
    }
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  return [r(best.x), r(-best.z), r(best.y)];
}

/** Invisible bed plane catching measure clicks (CAD frame, z = 0). */
function MeasurePlane() {
  return (
    <mesh
      onClick={(e) => {
        e.stopPropagation();
        if (e.delta > 4) return;
        const r = (n: number) => Math.round(n * 100) / 100;
        addMeasurePoint([r(e.point.x), r(-e.point.z), 0]);
      }}
    >
      <planeGeometry args={[4000, 4000]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  );
}

/** Measured points, the line between them and the distance label (CAD frame). */
function MeasureOverlay() {
  const points = useMeasure((s) => s.points);
  const mode = useMeasure((s) => s.mode);
  if (!points.length) return null;
  const fmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString("de-DE");
  const dots = points.map((p, i) => (
    <mesh key={i} position={p} renderOrder={30} raycast={() => null}>
      <sphereGeometry args={[0.6, 16, 12]} />
      <meshBasicMaterial color={ACCENT} depthTest={false} toneMapped={false} />
    </mesh>
  ));
  if (mode === "angle") {
    const [a, v, c] = points;
    const arc: Vec3[] = [];
    let label: Vec3 | null = null;
    if (c) {
      // Arc between the arms at a third of the shorter arm, label just outside it.
      const u = new THREE.Vector3(a[0] - v[0], a[1] - v[1], a[2] - v[2]);
      const w = new THREE.Vector3(c[0] - v[0], c[1] - v[1], c[2] - v[2]);
      const r = Math.max(1.5, Math.min(u.length(), w.length()) / 3);
      const un = u.clone().normalize();
      const wn = w.clone().normalize();
      for (let i = 0; i <= 24; i++) {
        const d = un.clone().lerp(wn, i / 24);
        if (d.lengthSq() < 1e-9) continue;
        d.normalize().multiplyScalar(r);
        arc.push([v[0] + d.x, v[1] + d.y, v[2] + d.z]);
      }
      const mid = un.clone().add(wn);
      const dir = mid.lengthSq() > 1e-9 ? mid.normalize() : new THREE.Vector3(0, 0, 1);
      label = [v[0] + dir.x * r * 1.9, v[1] + dir.y * r * 1.9, v[2] + dir.z * r * 1.9];
    }
    return (
      <>
        {dots}
        {v && <Line points={[a, v]} color={ACCENT} lineWidth={2} depthTest={false} renderOrder={29} />}
        {c && <Line points={[v, c]} color={ACCENT} lineWidth={2} depthTest={false} renderOrder={29} />}
        {arc.length > 1 && <Line points={arc} color={ACCENT} lineWidth={1.5} depthTest={false} renderOrder={29} />}
        {c && label && (
          <Html position={label} center zIndexRange={[40, 0]} style={{ pointerEvents: "none" }}>
            <div className="measure-label">
              <b>{fmt(angleAt(a, v, c))}°</b>
            </div>
          </Html>
        )}
      </>
    );
  }
  const [a, b] = points;
  const mid: Vec3 | null = b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2] : null;
  return (
    <>
      {dots}
      {b && <Line points={[a, b]} color={ACCENT} lineWidth={2} depthTest={false} renderOrder={29} />}
      {b && mid && (
        <Html position={mid} center zIndexRange={[40, 0]} style={{ pointerEvents: "none" }}>
          <div className="measure-label">
            <b>{fmt(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]))} mm</b>
            <span>ΔX {fmt(b[0] - a[0])} · ΔY {fmt(b[1] - a[1])} · ΔZ {fmt(b[2] - a[2])}</span>
          </div>
        </Html>
      )}
    </>
  );
}

/** Abstand/Winkel switch shown while measuring (top centre). */
function MeasureModeSwitch() {
  const mode = useMeasure((s) => s.mode);
  const n = useMeasure((s) => s.points.length);
  const hint = mode === "angle" ? ["Ersten Schenkel anklicken", "Scheitelpunkt anklicken", "Zweiten Schenkel anklicken"][n] : ["Ersten Punkt anklicken", "Zweiten Punkt anklicken"][n];
  return (
    <div className="vp-badge measure-mode">
      <SegmentedControl size="sm" value={mode} onChange={(m) => setMeasureMode(m)} options={[{ value: "distance", label: "Abstand" }, { value: "angle", label: "Winkel" }]} />
      <span className="hint">{hint ?? "Neuer Klick misst neu"}</span>
      <Kbd keys={["Tab"]} />
    </div>
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
    useStudioEnv.setState({ env });
    // three ≥ r163: scene.environment uses scene.environmentIntensity, not material.envMapIntensity.
    scene.environmentIntensity = 0.16;
    return () => {
      scene.environment = null;
      useStudioEnv.setState({ env: null });
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
  const single = selection.length === 1 ? findFeature(doc, selection[0]) : undefined;
  const singleParents = single ? parentsOf(doc, single.id) : [];
  const selected = useMemo(() => selection.map((id) => findFeature(doc, id)).filter((f): f is Feature => !!f), [selection, doc]);
  const multiMovable =
    selected.length > 1 && selected.every((f) => !f.locked && parentsOf(doc, f.id).length === 0 && groupsOf(doc, f.id).every((g) => g.transform.position.every((v) => v === 0) && g.transform.rotation.every((v) => v === 0)));
  // The gizmo works in world space; members of a moved or turned group are edited in the Inspektor.
  const insideMovedGroup = !!single && groupsOf(doc, single.id).some((g) => g.transform.position.some((v) => v !== 0) || g.transform.rotation.some((v) => v !== 0));
  const textTool = useTextTool((s) => s.active);
  const measuring = useMeasure((s) => s.active);
  const box = useBoxSelect();
  const frame = useViewportFrame();
  const aiRunning = useAiRun((s) => s.modeling) && workspace !== "preview";
  const aiAnimations = useSettings((s) => s.aiAnimations);
  const free = { left: frame.left, right: frame.right };
  const isolated = useApp((s) => s.isolated);

  return (
    <div
      onContextMenu={(e) => e.preventDefault()}
      className={`viewport ${workspace === "preview" ? `bg-${background}` : ""} ${textTool ? "placing-text" : ""} ${measuring ? "measuring" : ""}`}
      style={{ clipPath: `inset(0 ${free.right}px 0 ${free.left}px round 12px)` }}
      onPointerDown={(e) => (down.current = [e.clientX, e.clientY])}
      onPointerDownCapture={box.onPointerDownCapture}
    >
      {box.overlay}
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [150, 135, 205], fov: 35, near: 0.5, far: 5000 }}
        gl={{ antialias: true, preserveDrawingBuffer: false }}
        onCreated={(state) => {
          const { gl } = state;
          if (import.meta.env.DEV) Object.assign(window, { __viewer: state });
          setPickInRect(makeRectPicker(() => state.get().camera, () => state.get().gl.domElement));
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
            isolated && !isolated.includes(f.id) ? null : f.type === "sketch" ? <SketchObject key={f.id} f={f} /> : f.type === "group" ? <GroupObject key={f.id} f={f} order={i} /> : <FeatureObject key={f.id} f={f} order={i} />,
          )}
          {textTool && <TextPlacementPlane />}
          {measuring && <MeasurePlane />}
          {measuring && <MeasureOverlay />}
          {workspace === "sketch" && <SketchDraw sketches={doc.features.filter((f): f is SketchFeature => f.type === "sketch" && f.visible)} />}
          {single && workspace === "model" && singleParents.length === 0 && !single.locked && !insideMovedGroup && (
            <>
              <SelectedGizmo key={single.id} f={single} />
              <Dimensions f={single} />
            </>
          )}
          {multiMovable && workspace === "model" && <SelectionGizmo key={selection.join()} features={selected} />}
          {single && workspace === "model" && singleParents.length > 0 && <OperandEditor f={single} parents={singleParents} />}
        </group>
        <DepthRange />
        <CameraRig />
        <SelectionOutline />
        {workspace !== "preview" && (
          // Top right, level with the projection toggle, ~78 % size; follows the free area.
          <GizmoHelper alignment="top-right" margin={[free.right + 44, 46]} renderPriority={2}>
            <group scale={0.78}>
              <AxisIndicator />
            </group>
          </GizmoHelper>
        )}
      </Canvas>

      <div className="vp-free" style={free}>
      <div className="vp-frame" />
      {/* Siri-style glow while the AI works: CSS only, the canvas never re-renders for it. */}
      <div className={`ai-glow ${aiRunning && aiAnimations ? "on" : ""}`} aria-hidden>
        <span className="w1" />
        <span className="w2" />
        <span className="w3" />
        <span className="w4" />
      </div>
      {/* Crisp mint frame, same trigger and fade as the glow. */}
      <div className={`ai-frame ${aiRunning && aiAnimations ? "on" : ""}`} aria-hidden />
      {measuring && <MeasureModeSwitch />}
      {isolated && workspace !== "preview" && !measuring && (
        <div className="vp-badge iso">
          <Icon name="isolate" size={14} />
          Isoliert: {isolated.length === 1 ? "1 Objekt" : `${isolated.length} Objekte`}
          <button onClick={() => void execute("view.isolate")} data-tip="Isolierung beenden" data-kbd="shift+h" data-tip-pos="bottom">Beenden</button>
        </div>
      )}
      {kernel.status !== "ready" || kernel.busy > 0 ? (
        <div className={`vp-badge ${isolated && workspace !== "preview" ? "below" : ""}`}>
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

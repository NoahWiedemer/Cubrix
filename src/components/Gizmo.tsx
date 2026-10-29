// Minimal transform gizmo: thin axis arrows for moving; rotation rings only in
// rotate mode (R). Everything is sized in screen pixels and ignores depth.
import { useSpacePan } from "../ui/spacePan";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useGizmo } from "../ui/gizmo";
import { AXIS_COLORS, AXIS_HOVER, mix } from "../ui/axisColors";
import { clearPreview, execute, previewCommand } from "../core/commands";
import { useApp } from "../core/store";
import type { Feature, Transform, Vec3 } from "../core/document";
import { useMeshes } from "../cad/kernel";
import { worldBox } from "../core/bounds";
import { gizmoAnchor } from "../ui/gizmoAnchor";
import { ROUND_TYPES, scalesUniformly } from "../core/scale";

export { useGizmo };

const AXES = [0, 1, 2].map((i) => ({
  axis: new THREE.Vector3(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0),
  color: AXIS_COLORS[i],
  hover: AXIS_HOVER[i],
}));
// Plane handles: [first axis, second axis, normal axis].
const PLANES: [number, number, number][] = [[0, 1, 2], [0, 2, 1], [1, 2, 0]];
const PLANE_SIZE = 24; // px, corner quadrant anchored at the origin
const ARROW = 88; // px
const RING = 62; // px

const deg = THREE.MathUtils.degToRad;
const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString("de-DE");

function quatOf(t: Transform) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(deg(t.rotation[0]), deg(t.rotation[1]), deg(t.rotation[2]), "XYZ"));
}

interface Drag {
  kind: "move" | "rotate" | "plane" | "scale";
  /** Scale: extents at drag start (CAD X/Y/Z) and whether X/Y grow on both sides. */
  size?: Vec3;
  symmetric?: boolean;
  index: number;
  start: Transform;
  center: THREE.Vector3; // CAD frame
  axisWorld: THREE.Vector3;
  centerWorld: THREE.Vector3;
  from: THREE.Vector3; // world point or direction at drag start
}

/** Hit areas always win against bodies (the gizmo sits inside the selected body). */
function priorityRaycast(this: THREE.Mesh, rc: THREE.Raycaster, hits: THREE.Intersection[]) {
  const n = hits.length;
  THREE.Mesh.prototype.raycast.call(this, rc, hits);
  for (let i = n; i < hits.length; i++) hits[i].distance -= 1e6;
}

/** Eases a group's scale toward `target` (~100 ms). */
function useEasedScale(target: number) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    const k = Math.min(1, dt / 0.035);
    const v = g.scale.x + (target - g.scale.x) * k;
    g.scale.set(v, v, v);
  });
  return ref;
}

function Arrow({ axis, color, hover, on, dim, onDown, hoverProps, cube = false }: {
  axis: THREE.Vector3; color: string; hover: string; on: boolean; dim: boolean;
  onDown: (e: ThreeEvent<PointerEvent>) => void; hoverProps: Record<string, unknown>;
  /** Scale handle: a cube tip instead of the cone. */
  cube?: boolean;
}) {
  const quat = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis), [axis]);
  const tip = useEasedScale(on ? 1.15 : 1);
  const shaft = useEasedScale(on ? 1.15 : 1);
  const c = on ? hover : color;
  const opacity = dim ? 0.45 : 1;
  return (
    <group quaternion={quat}>
      <group ref={shaft}>
        <mesh position={[0, (ARROW - 4) / 2, 0]} renderOrder={20} scale={[on ? 1.5 : 1, 1, on ? 1.5 : 1]}>
          <cylinderGeometry args={[0.85, 0.85, ARROW - 4, 8]} />
          <meshBasicMaterial color={c} depthTest={false} transparent opacity={opacity} toneMapped={false} />
        </mesh>
      </group>
      <group position={[0, ARROW + 6, 0]}>
        <group ref={tip}>
          <mesh renderOrder={20}>
            {cube ? <boxGeometry args={[9, 9, 9]} /> : <coneGeometry args={[3.2, 18, 24]} />}
            <meshBasicMaterial color={c} depthTest={false} transparent opacity={opacity} toneMapped={false} />
          </mesh>
        </group>
      </group>
      {/* Generous invisible hit target */}
      <mesh position={[0, PLANE_SIZE + (ARROW - PLANE_SIZE + 16) / 2, 0]} raycast={priorityRaycast} onPointerDown={onDown} {...hoverProps}>
        <cylinderGeometry args={[9, 9, ARROW - PLANE_SIZE + 22, 8]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    </group>
  );
}

export function Gizmo({ f, transform }: { f: Feature; transform: Transform }) {
  const { camera, gl, size } = useThree();
  const controls = useThree((s) => s.controls) as unknown as { enabled: boolean } | null;
  const entries = useMeshes((s) => s.entries);
  const mode = useGizmo((s) => s.mode);
  const group = useRef<THREE.Group>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [label, setLabel] = useState<{ text: string; at: Vec3 } | null>(null);
  const drag = useRef<Drag | null>(null);
  const scaleFactor = useRef<Vec3 | null>(null);
  const cornerRef = useRef<THREE.Group>(null);
  const lastPreview = useRef(0);

  const box = worldBox(f, entries, transform);
  const center = useMemo(() => (box ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3(...transform.position)), [box, transform]);

  // While the kernel rebuilds a preview there is briefly no box: keep the last anchor.
  const lastAnchor = useRef<THREE.Vector3 | null>(null);
  const anchor = useMemo(() => {
    const a = box ? gizmoAnchor(box, f.type, mode) : (lastAnchor.current ?? center);
    lastAnchor.current = a;
    return a;
  }, [box, f.type, mode, center]);

  // Keep a constant on-screen size: one local unit = one CSS pixel.
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const wp = g.getWorldPosition(new THREE.Vector3());
    let unit: number;
    if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
      const c = camera as THREE.OrthographicCamera;
      unit = (c.top - c.bottom) / c.zoom / size.height;
    } else {
      const c = camera as THREE.PerspectiveCamera;
      unit = (2 * Math.tan(deg(c.fov) / 2) * wp.distanceTo(c.position)) / size.height;
    }
    g.scale.setScalar(unit);
    if (cornerRef.current && box) cornerRef.current.position.copy(box.max).sub(anchor).divideScalar(unit);
  });

  const ray = (ev: PointerEvent) => {
    const r = gl.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, camera);
    return rc.ray;
  };

  // Closest point on the axis line to the pointer ray.
  const onAxis = (r: THREE.Ray, origin: THREE.Vector3, dir: THREE.Vector3) => {
    const w0 = origin.clone().sub(r.origin);
    const b = dir.dot(r.direction);
    const d = dir.dot(w0);
    const e = r.direction.dot(w0);
    const denom = 1 - b * b;
    const s = denom < 1e-6 ? 0 : (b * e - d) / denom;
    return origin.clone().addScaledVector(dir, s);
  };

  const onPlane = (r: THREE.Ray, origin: THREE.Vector3, normal: THREE.Vector3) =>
    r.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin), new THREE.Vector3());

  const begin = (kind: Drag["kind"], index: number) => (e: ThreeEvent<PointerEvent>) => {
    if (useSpacePan.getState().held) return; // Space + drag pans instead
    e.stopPropagation();
    const g = group.current!;
    const parent = g.parent!;
    const axisLocal =
      kind === "scale" && index === 4 && box
        ? box.max.clone().sub(anchor).normalize()
        : kind === "scale" && index === 3
          ? new THREE.Vector3(1, 1, 1).normalize()
          : AXES[kind === "plane" ? PLANES[index][2] : index].axis;
    const axisWorld = axisLocal.clone().transformDirection(parent.matrixWorld);
    const centerWorld = g.getWorldPosition(new THREE.Vector3());
    const r = ray(e.nativeEvent);
    const from =
      kind === "move" || kind === "scale" ? onAxis(r, centerWorld, axisWorld) : kind === "plane" ? onPlane(r, centerWorld, axisWorld) : onPlane(r, centerWorld, axisWorld)?.sub(centerWorld);
    if (!from) return;
    const size = box ? (box.getSize(new THREE.Vector3()).toArray() as Vec3) : undefined;
    drag.current = { kind, index, start: transform, center: center.clone(), axisWorld, centerWorld, from, size, symmetric: ROUND_TYPES.has(f.type) };
    if (controls) controls.enabled = false;
    useGizmo.setState({ dragging: true });
    gl.domElement.style.cursor = "grabbing";

    const move = (ev: PointerEvent) => {
      const d = drag.current!;
      const r = ray(ev);
      const a = AXES[d.kind === "plane" ? PLANES[d.index][2] : d.index].axis;
      let next: Transform;
      if (d.kind === "scale") {
        const delta = onAxis(r, d.centerWorld, d.axisWorld).sub(d.from).dot(d.axisWorld);
        const snap = useApp.getState().snap;
        const size = d.size!;
        let k: number;
        if (d.index === 4) {
          // Corner handle: proportional, the opposite top corner follows the pointer.
          const diag = Math.hypot(...size);
          k = (diag + delta) / diag;
        } else if (d.index === 3) {
          // Centre handle: proportional, driven along the screen-facing diagonal.
          const diag = Math.hypot(...size);
          k = (diag + delta * 2) / diag;
        } else {
          const L0 = size[d.index];
          // Round bodies scale around their centre in X/Y, so both sides move.
          const grow = d.symmetric && d.index < 2 ? delta * 2 : delta;
          let L = Math.max(0.5, L0 + grow);
          if (snap > 0) L = Math.max(snap, Math.round(L / snap) * snap);
          k = L / L0;
        }
        k = Math.max(0.02, k);
        const uniform = d.index >= 3 || ev.shiftKey || scalesUniformly(f);
        const factor: Vec3 = uniform ? [k, k, k] : (size.map((_, i) => (i === d.index ? k : 1)) as Vec3);
        scaleFactor.current = factor;
        const dims = size.map((v, i) => fmt(v * factor[i])).join(" × ") + " mm";
        setLabel({ text: uniform ? `${Math.round(k * 100)} % · ${dims}` : dims, at: d.center.toArray() as Vec3 });
        // Live preview, throttled: every update rebuilds the solid in the kernel.
        const now = performance.now();
        if (now - lastPreview.current > 70) {
          lastPreview.current = now;
          previewCommand("object.scale", { id: f.id, factor });
        }
        return;
      }
      if (d.kind === "plane") {
        const p = onPlane(r, d.centerWorld, d.axisWorld);
        if (!p) return;
        // World delta back into the CAD frame of the parent group.
        const inv = group.current!.parent!.matrixWorld.clone().invert();
        const local = p.clone().applyMatrix4(inv).sub(d.from.clone().applyMatrix4(inv));
        const snap = useApp.getState().snap;
        const pos = [...d.start.position] as Vec3;
        for (const k of PLANES[d.index].slice(0, 2)) {
          const target = d.start.position[k] + local.getComponent(k);
          pos[k] = snap > 0 ? Math.round(target / snap) * snap : Math.round(target * 100) / 100;
        }
        next = { ...d.start, position: pos };
        const [k1, k2] = PLANES[d.index];
        setLabel({
          text: `${"XYZ"[k1]} ${fmt(pos[k1] - d.start.position[k1])} · ${"XYZ"[k2]} ${fmt(pos[k2] - d.start.position[k2])} mm`,
          at: d.center.toArray() as Vec3,
        });
      } else if (d.kind === "move") {
        const delta = onAxis(r, d.centerWorld, d.axisWorld).sub(d.from).dot(d.axisWorld);
        const snap = useApp.getState().snap;
        const pos = [...d.start.position] as Vec3;
        const target = d.start.position[d.index] + delta;
        pos[d.index] = snap > 0 ? Math.round(target / snap) * snap : Math.round(target * 100) / 100;
        next = { ...d.start, position: pos };
        const moved = pos[d.index] - d.start.position[d.index];
        const tip = d.center.clone().addScaledVector(a, 0);
        setLabel({ text: `${moved >= 0 ? "+" : "−"}${fmt(Math.abs(moved))} mm`, at: tip.toArray() as Vec3 });
      } else {
        const p = onPlane(r, d.centerWorld, d.axisWorld);
        if (!p) return;
        const now = p.sub(d.centerWorld);
        let angle = Math.atan2(d.from.clone().cross(now).dot(d.axisWorld), d.from.dot(now));
        const step = ev.shiftKey ? 1 : 15;
        angle = deg(Math.round(THREE.MathUtils.radToDeg(angle) / step) * step);
        const q = new THREE.Quaternion().setFromAxisAngle(a, angle);
        const rot = q.clone().multiply(quatOf(d.start));
        const e = new THREE.Euler().setFromQuaternion(rot, "XYZ");
        // Rotate around the visual centre, not the object's base point.
        const p0 = new THREE.Vector3(...d.start.position).sub(d.center).applyQuaternion(q).add(d.center);
        next = {
          position: p0.toArray().map((v) => Math.round(v * 1000) / 1000) as Vec3,
          rotation: [e.x, e.y, e.z].map((r) => Math.round(THREE.MathUtils.radToDeg(r) * 1000) / 1000 + 0) as Vec3,
        };
        setLabel({ text: `${fmt(THREE.MathUtils.radToDeg(angle))}°`, at: d.center.toArray() as Vec3 });
      }
      useApp.setState({ preview: { id: f.id, transform: next } });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      drag.current = null;
      setLabel(null);
      gl.domElement.style.cursor = "";
      if (controls) controls.enabled = true;
      useGizmo.setState({ dragging: false });
      if (scaleFactor.current) {
        const factor = scaleFactor.current;
        scaleFactor.current = null;
        clearPreview();
        void execute("object.scale", { id: f.id, factor });
        return;
      }
      const p = useApp.getState().preview;
      if (!p) return;
      void execute("object.transform", { id: f.id, position: p.transform.position, rotation: p.transform.rotation }).then(
        (changed) => !changed && useApp.setState({ preview: null }),
      );
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const hoverProps = (i: number) => ({
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      setHover(i);
      gl.domElement.style.cursor = "grab";
    },
    onPointerOut: () => {
      setHover(null);
      if (!drag.current) gl.domElement.style.cursor = "";
    },
  });

  const anyActive = hover !== null || !!drag.current;
  const active = (i: number) =>
    hover === i || (!!drag.current && (drag.current.kind === "plane" ? drag.current.index + 10 : drag.current.index) === i);

  return (
    <>
      <group ref={group} position={anchor}>
        {mode === "move" &&
          AXES.map(({ axis, color, hover: hc }, i) => (
            <Arrow key={i} axis={axis} color={color} hover={hc} on={active(i)} dim={anyActive && !active(i)} onDown={begin("move", i)} hoverProps={hoverProps(i)} />
          ))}
        {mode === "move" &&
          PLANES.map(([a, b], i) => {
            const id = 10 + i;
            const on = active(id);
            const u = AXES[a].axis.clone().multiplyScalar(PLANE_SIZE / 2);
            const v = AXES[b].axis.clone().multiplyScalar(PLANE_SIZE / 2);
            const normal = AXES[PLANES[i][2]].axis;
            const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
            const color = on ? mix(AXES[a].hover, AXES[b].hover) : mix(AXES[a].color, AXES[b].color);
            return (
              <group key={`p${i}`} position={u.add(v)} quaternion={quat}>
                <mesh renderOrder={19} raycast={priorityRaycast} onPointerDown={begin("plane", i)} {...hoverProps(id)}>
                  <planeGeometry args={[PLANE_SIZE, PLANE_SIZE]} />
                  <meshBasicMaterial color={color} depthTest={false} transparent opacity={on ? 0.55 : anyActive ? 0.1 : 0.22} side={THREE.DoubleSide} toneMapped={false} />
                </mesh>
                <lineSegments renderOrder={20} raycast={() => null}>
                  <edgesGeometry args={[new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE)]} />
                  <lineBasicMaterial color={color} depthTest={false} transparent opacity={on ? 1 : anyActive ? 0.4 : 0.85} toneMapped={false} />
                </lineSegments>
              </group>
            );
          })}
        {mode === "scale" &&
          AXES.map(({ axis, color, hover: hc }, i) => (
            <Arrow key={`s${i}`} cube axis={axis} color={color} hover={hc} on={active(i)} dim={anyActive && !active(i)} onDown={begin("scale", i)} hoverProps={hoverProps(i)} />
          ))}
        {mode === "scale" && (
          <mesh renderOrder={21} raycast={priorityRaycast} onPointerDown={begin("scale", 3)} {...hoverProps(3)}>
            <boxGeometry args={[active(3) ? 17 : 14, active(3) ? 17 : 14, active(3) ? 17 : 14]} />
            <meshBasicMaterial color={active(3) ? "#ffffff" : "#d9dfe3"} depthTest={false} transparent opacity={anyActive && !active(3) ? 0.45 : 1} toneMapped={false} />
          </mesh>
        )}
        {mode === "scale" && box && (
          // Opposite top corner of the bounding box: drag to scale proportionally.
          <group ref={cornerRef}>
            <mesh renderOrder={21} raycast={priorityRaycast} onPointerDown={begin("scale", 4)} {...hoverProps(4)}>
              <boxGeometry args={[active(4) ? 13 : 10, active(4) ? 13 : 10, active(4) ? 13 : 10]} />
              <meshBasicMaterial color={active(4) ? "#ffffff" : "#d9dfe3"} depthTest={false} transparent opacity={anyActive && !active(4) ? 0.45 : 1} toneMapped={false} />
            </mesh>
          </group>
        )}
        {mode === "scale" && (hover === 3 || hover === 4) && !drag.current && (
          <Html position={[0, 0, 0]} zIndexRange={[30, 0]} style={{ pointerEvents: "none", transform: "translate(14px, -30px)" }}>
            <div className="dim-label">Proportional skalieren</div>
          </Html>
        )}
        {mode === "rotate" &&
          AXES.map(({ axis, color, hover: hc }, i) => {
            const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis);
            const c = active(i) ? hc : color;
            return (
              <group key={i} quaternion={quat}>
                <mesh renderOrder={20}>
                  <torusGeometry args={[RING, active(i) ? 1.4 : 0.9, 6, 96]} />
                  <meshBasicMaterial color={c} depthTest={false} transparent toneMapped={false} />
                </mesh>
                <mesh raycast={priorityRaycast} onPointerDown={begin("rotate", i)} {...hoverProps(i)}>
                  <torusGeometry args={[RING, 7, 6, 64]} />
                  <meshBasicMaterial visible={false} />
                </mesh>
              </group>
            );
          })}
      </group>
      {label && (
        <Html position={label.at} zIndexRange={[30, 0]} style={{ pointerEvents: "none", transform: "translate(14px, 14px)" }}>
          <div className="dim-label live">{label.text}</div>
        </Html>
      )}
    </>
  );
}

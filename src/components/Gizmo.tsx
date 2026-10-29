// Minimal transform gizmo: thin axis arrows for moving; rotation rings only in
// rotate mode (R). Everything is sized in screen pixels and ignores depth.
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useGizmo } from "../ui/gizmo";
import { AXIS_COLORS, AXIS_HOVER, mix } from "../ui/axisColors";
import { execute } from "../core/commands";
import { useApp } from "../core/store";
import type { Feature, Transform, Vec3 } from "../core/document";
import { useMeshes } from "../cad/kernel";
import { worldBox } from "../core/bounds";

export { useGizmo };

const AXES = [0, 1, 2].map((i) => ({
  axis: new THREE.Vector3(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0),
  color: AXIS_COLORS[i],
  hover: AXIS_HOVER[i],
  letter: "XYZ"[i],
}));
// Plane handles: [first axis, second axis, normal axis].
const PLANES: [number, number, number][] = [[0, 1, 2], [0, 2, 1], [1, 2, 0]];
const PLANE_OFFSET = 22; // px from the centre
const PLANE_SIZE = 13; // px
const ARROW = 88; // px
const RING = 62; // px

const deg = THREE.MathUtils.degToRad;
const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString("de-DE");

function quatOf(t: Transform) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(deg(t.rotation[0]), deg(t.rotation[1]), deg(t.rotation[2]), "XYZ"));
}

interface Drag {
  kind: "move" | "rotate" | "plane";
  index: number;
  start: Transform;
  center: THREE.Vector3; // CAD frame
  axisWorld: THREE.Vector3;
  centerWorld: THREE.Vector3;
  from: THREE.Vector3; // world point or direction at drag start
}

const letterCache = new Map<string, THREE.Texture>();
function letterTexture(letter: string, color: string) {
  const key = letter + color;
  let tex = letterCache.get(key);
  if (!tex) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = color;
    ctx.font = "650 40px 'Inter Variable', Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(letter, 32, 34);
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    letterCache.set(key, tex);
  }
  return tex;
}

function AxisLetter({ letter, color, y }: { letter: string; color: string; y: number }) {
  return (
    <sprite position={[0, y, 0]} scale={16} renderOrder={21} raycast={() => null}>
      <spriteMaterial map={letterTexture(letter, color)} depthTest={false} transparent toneMapped={false} />
    </sprite>
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

  const box = worldBox(f, entries, transform);
  const center = useMemo(() => (box ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3(...transform.position)), [box, transform]);

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
    e.stopPropagation();
    const g = group.current!;
    const parent = g.parent!;
    const axisWorld = AXES[kind === "plane" ? PLANES[index][2] : index].axis.clone().transformDirection(parent.matrixWorld);
    const centerWorld = g.getWorldPosition(new THREE.Vector3());
    const r = ray(e.nativeEvent);
    const from =
      kind === "move" ? onAxis(r, centerWorld, axisWorld) : kind === "plane" ? onPlane(r, centerWorld, axisWorld) : onPlane(r, centerWorld, axisWorld)?.sub(centerWorld);
    if (!from) return;
    drag.current = { kind, index, start: transform, center: center.clone(), axisWorld, centerWorld, from };
    if (controls) controls.enabled = false;
    useGizmo.setState({ dragging: true });

    const move = (ev: PointerEvent) => {
      const d = drag.current!;
      const r = ray(ev);
      const a = AXES[d.kind === "plane" ? PLANES[d.index][2] : d.index].axis;
      let next: Transform;
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
      if (controls) controls.enabled = true;
      useGizmo.setState({ dragging: false });
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
      gl.domElement.style.cursor = "";
    },
  });

  const active = (i: number) =>
    hover === i || (!!drag.current && (drag.current.kind === "plane" ? drag.current.index + 10 : drag.current.index) === i);

  return (
    <>
      <group ref={group} position={center}>
        {mode === "move" &&
          AXES.map(({ axis, color, hover: hc, letter }, i) => {
            const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
            const on = active(i);
            const c = on ? hc : color;
            return (
              <group key={i} quaternion={quat}>
                <mesh position={[0, 14 + (ARROW - 14) / 2, 0]} renderOrder={20}>
                  <cylinderGeometry args={[on ? 1.4 : 0.9, on ? 1.4 : 0.9, ARROW - 14, 8]} />
                  <meshBasicMaterial color={c} depthTest={false} transparent toneMapped={false} />
                </mesh>
                <mesh position={[0, ARROW + 6, 0]} renderOrder={20}>
                  <coneGeometry args={[on ? 5.5 : 4.5, 13, 20]} />
                  <meshBasicMaterial color={c} depthTest={false} transparent toneMapped={false} />
                </mesh>
                <AxisLetter letter={letter} color={c} y={ARROW + 24} />
                {/* Generous invisible hit target */}
                <mesh position={[0, 14 + ARROW / 2, 0]} onPointerDown={begin("move", i)} {...hoverProps(i)}>
                  <cylinderGeometry args={[8, 8, ARROW + 8, 8]} />
                  <meshBasicMaterial visible={false} />
                </mesh>
              </group>
            );
          })}
        {mode === "move" &&
          PLANES.map(([a, b], i) => {
            const id = 10 + i;
            const on = active(id);
            const u = AXES[a].axis.clone().multiplyScalar(PLANE_OFFSET + PLANE_SIZE / 2);
            const v = AXES[b].axis.clone().multiplyScalar(PLANE_OFFSET + PLANE_SIZE / 2);
            const normal = AXES[PLANES[i][2]].axis;
            const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
            const color = on ? mix(AXES[a].hover, AXES[b].hover) : mix(AXES[a].color, AXES[b].color);
            return (
              <group key={`p${i}`} position={u.add(v)} quaternion={quat}>
                <mesh renderOrder={19} onPointerDown={begin("plane", i)} {...hoverProps(id)}>
                  <planeGeometry args={[PLANE_SIZE, PLANE_SIZE]} />
                  <meshBasicMaterial color={color} depthTest={false} transparent opacity={on ? 0.55 : 0.28} side={THREE.DoubleSide} toneMapped={false} />
                </mesh>
                <lineSegments renderOrder={20} raycast={() => null}>
                  <edgesGeometry args={[new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE)]} />
                  <lineBasicMaterial color={color} depthTest={false} transparent opacity={0.9} toneMapped={false} />
                </lineSegments>
              </group>
            );
          })}
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
                <mesh onPointerDown={begin("rotate", i)} {...hoverProps(i)}>
                  <torusGeometry args={[RING, 7, 6, 64]} />
                  <meshBasicMaterial visible={false} />
                </mesh>
              </group>
            );
          })}
        <mesh renderOrder={21}>
          <sphereGeometry args={[3, 16, 12]} />
          <meshBasicMaterial color="#e7ebee" depthTest={false} transparent toneMapped={false} />
        </mesh>
      </group>
      {label && (
        <Html position={label.at} zIndexRange={[30, 0]} style={{ pointerEvents: "none", transform: "translate(14px, 14px)" }}>
          <div className="dim-label live">{label.text}</div>
        </Html>
      )}
    </>
  );
}

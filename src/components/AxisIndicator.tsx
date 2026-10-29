import { useState } from "react";
import * as THREE from "three";
import { Html, Line, useGizmoContext } from "@react-three/drei";
import { AXIS_COLORS } from "../ui/axisColors";

// CAD axes expressed in the internal Y-up scene frame.
// The gizmo's greens, muted (≈65 % saturation/brightness) so the tripod stays calm.
const muted = (hex: string) => "#" + new THREE.Color(hex).offsetHSL(0, -0.18, -0.06).getHexString();
const AXES = [
  { label: "X", color: muted(AXIS_COLORS[0]), dir: new THREE.Vector3(1, 0, 0) },
  { label: "Y", color: muted(AXIS_COLORS[1]), dir: new THREE.Vector3(0, 0, -1) },
  { label: "Z", color: muted(AXIS_COLORS[2]), dir: new THREE.Vector3(0, 1, 0) },
];

const LENGTH = 34;

function Axis({ label, color, dir }: (typeof AXES)[number]) {
  const { tweenCamera } = useGizmoContext();
  const [hover, setHover] = useState(false);
  const tip = dir.clone().multiplyScalar(LENGTH);
  return (
    <group>
      <Line points={[[0, 0, 0], tip.toArray()]} color={color} lineWidth={hover ? 3 : 2} />
      {/* No letters: a small dot at the tip; a larger invisible target makes it easy to click. */}
      <mesh position={tip.toArray()}>
        <sphereGeometry args={[hover ? 3.3 : 2.5, 16, 12]} />
        <meshBasicMaterial color={color} depthTest={false} />
      </mesh>
      <mesh
        position={tip.toArray()}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
        }}
        onPointerOut={() => setHover(false)}
        onClick={(e) => {
          e.stopPropagation();
          tweenCamera(dir);
        }}
      >
        <sphereGeometry args={[11, 8, 6]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {hover && (
        <Html position={tip.toArray()} style={{ pointerEvents: "none", transform: "translate(10px, -26px)" }}>
          <div className="dim-label">{label}-Achse · Ansicht entlang {label}</div>
        </Html>
      )}
    </group>
  );
}

/** Small axis tripod that turns with the camera; click an axis tip to look along that axis. */
export function AxisIndicator() {
  return (
    <group>
      {AXES.map((a) => (
        <Axis key={a.label} {...a} />
      ))}
    </group>
  );
}

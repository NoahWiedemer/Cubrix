import { useMemo, useState } from "react";
import * as THREE from "three";
import { Line, useGizmoContext } from "@react-three/drei";
import { AXIS_COLORS } from "../ui/axisColors";

// CAD axes expressed in the internal Y-up scene frame.
const AXES = [
  { label: "X", color: AXIS_COLORS[0], dir: new THREE.Vector3(1, 0, 0) },
  { label: "Y", color: AXIS_COLORS[1], dir: new THREE.Vector3(0, 0, -1) },
  { label: "Z", color: AXIS_COLORS[2], dir: new THREE.Vector3(0, 1, 0) },
];

const LENGTH = 34;

function labelTexture(text: string, color: string) {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = color;
  ctx.font = "650 76px 'Inter Variable', Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, size / 2, size / 2 + 4);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function Axis({ label, color, dir }: (typeof AXES)[number]) {
  const { tweenCamera } = useGizmoContext();
  const [hover, setHover] = useState(false);
  const tex = useMemo(() => labelTexture(label, color), [label, color]);
  const tip = dir.clone().multiplyScalar(LENGTH);
  return (
    <group>
      <Line points={[[0, 0, 0], tip.toArray()]} color={color} lineWidth={2} />
      <sprite
        position={dir.clone().multiplyScalar(LENGTH + 11).toArray()}
        scale={hover ? 20 : 17}
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
        <spriteMaterial map={tex} transparent depthTest={false} toneMapped={false} />
      </sprite>
    </group>
  );
}

/** Small X/Y/Z axis tripod that turns with the camera; click a letter to look along that axis. */
export function AxisIndicator() {
  return (
    <group>
      {AXES.map((a) => (
        <Axis key={a.label} {...a} />
      ))}
    </group>
  );
}

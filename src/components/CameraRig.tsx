// Switches between perspective and orthographic cameras while keeping the framing,
// and handles one-shot view requests (isometric preset).
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useSettings } from "../ui/settings";
import { useViewRequest } from "../ui/view";

type Controls = { target: THREE.Vector3; update(): void; object: THREE.Camera };

export function CameraRig() {
  const projection = useSettings((s) => s.projection);
  const { camera, set, size } = useThree();
  const controls = useThree((s) => s.controls) as unknown as Controls | null;
  const persp = useRef<THREE.PerspectiveCamera>(camera as THREE.PerspectiveCamera);
  const target = useRef(new THREE.Vector3(0, 12, 0));
  const ortho = useMemo(() => {
    const c = new THREE.OrthographicCamera(-1, 1, 1, -1, -20000, 20000);
    return c;
  }, []);

  // Keep the ortho frustum in CSS pixels so zoom = pixels per millimetre.
  useFrame(() => {
    ortho.left = -size.width / 2;
    ortho.right = size.width / 2;
    ortho.top = size.height / 2;
    ortho.bottom = -size.height / 2;
    ortho.updateProjectionMatrix();
    if (controls) target.current.copy(controls.target);
  });

  useEffect(() => {
    const from = camera;
    const to = projection === "orthographic" ? ortho : persp.current;
    if (from === to) return;
    const fov = THREE.MathUtils.degToRad(persp.current.fov);
    const dist = from.position.distanceTo(target.current);
    to.position.copy(from.position);
    to.quaternion.copy(from.quaternion);
    to.up.copy(from.up);
    if (to === ortho) {
      // Same apparent size at the target: visible height = 2·d·tan(fov/2).
      ortho.zoom = size.height / (2 * dist * Math.tan(fov / 2));
    } else if ((from as THREE.OrthographicCamera).isOrthographicCamera) {
      const zoom = (from as THREE.OrthographicCamera).zoom;
      const d = size.height / (2 * zoom * Math.tan(fov / 2));
      const dir = from.position.clone().sub(target.current).normalize();
      to.position.copy(target.current).addScaledVector(dir, d);
    }
    to.updateProjectionMatrix();
    set({ camera: to });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projection]);

  const request = useViewRequest((s) => s.request);
  useEffect(() => {
    if (!request || request.kind !== "iso") return;
    const t = target.current;
    const dist = camera.position.distanceTo(t);
    // CAD (1, -1, 1) = front-right-top; the scene is Y-up, so that is (1, 1, 1) here.
    const dir = new THREE.Vector3(1, 1, 1).normalize();
    camera.position.copy(t).addScaledVector(dir, dist);
    camera.up.set(0, 1, 0);
    camera.lookAt(t);
    controls?.update();
  }, [request, camera, controls]);

  return (
    <OrbitControls
      key={projection}
      makeDefault
      enableDamping
      dampingFactor={0.12}
      target={target.current.toArray()}
      minDistance={20}
      maxDistance={1500}
      minZoom={0.3}
      maxZoom={60}
    />
  );
}

// Camera: orbit controls plus one tween for all view changes (projection toggle,
// 2D top view, isometric preset) that keeps the framing continuous.
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useSettings } from "../ui/settings";
import { useViewRequest } from "../ui/view";
import { usePreview } from "../ui/preview";
import { useApp } from "../core/store";
import { cameraState } from "../ui/cameraState";
import type { Vec3 } from "../core/document";
import { useSpacePan } from "../ui/spacePan";
import { useLayout } from "../ui/layout";
import { dockedInsets, viewShift } from "../ui/viewportFrame";

type Controls = { target: THREE.Vector3; update(): void; object: THREE.Camera };

const BASE_FOV = 35;
/** Field of view at which the perspective camera hands over to the orthographic one. */
const ORTHO_FOV = 4;
/** Same duration and easing for every camera transition. */
const TWEEN_MS = 320;

export function CameraRig() {
  const projection = useSettings((s) => s.projection);
  const inPreview = useApp((s) => s.workspace === "preview");
  const turntableOn = usePreview((s) => s.turntable);
  const turntable = inPreview && turntableOn;
  const { camera, set, size } = useThree();
  const controls = useThree((s) => s.controls) as unknown as Controls | null;
  const persp = useRef<THREE.PerspectiveCamera>(camera as THREE.PerspectiveCamera);
  const target = useRef(new THREE.Vector3(0, 12, 0));
  const ortho = useMemo(() => {
    const c = new THREE.OrthographicCamera(-1, 1, 1, -1, -20000, 20000);
    return c;
  }, []);

  // Both cameras always match the canvas (the inactive one too, so swapping never
  // shows a stale aspect) and share the view offset that centres the scene in the
  // docked free area. The ortho frustum is in CSS pixels so zoom = pixels per mm.
  const panels = useLayout((s) => s.panels);
  const widths = useLayout((s) => s.width);
  const shift = viewShift(dockedInsets({ panels, width: widths }, size.width + 16));
  useFrame(() => {
    ortho.left = -size.width / 2;
    ortho.right = size.width / 2;
    ortho.top = size.height / 2;
    ortho.bottom = -size.height / 2;
    const p = persp.current;
    if (p.aspect !== size.width / size.height) p.aspect = size.width / size.height;
    for (const c of [p, ortho]) {
      const v = c.view;
      if (!v || v.offsetX !== -shift || v.fullWidth !== size.width || v.fullHeight !== size.height)
        c.setViewOffset(size.width, size.height, -shift, 0, size.width, size.height);
    }
    p.updateProjectionMatrix();
    ortho.updateProjectionMatrix();
    if (controls) target.current.copy(controls.target);
  });

  // ── One camera tween for every view change ─────────────────────────────────
  // Orientation is slerped; the projection blends perspective ↔ orthographic as a
  // dolly zoom (the visible height H at the target stays continuous, the field of
  // view narrows to ~4° and the real orthographic camera takes over at the end).
  // Sketch enter/exit, the projection toggle and the iso preset all use it, and a
  // new request mid-tween simply starts from wherever the camera is.
  const workspace = useApp((s) => s.workspace);
  const spacePan = useSpacePan((s) => s.held);
  const tween = useRef<{
    q0: THREE.Quaternion; q1: THREE.Quaternion;
    h0: number; h1: number;
    f0: number; f1: number;
    /** Orbit target from → to (fit / zoom to selection). */
    t0: THREE.Vector3; t1: THREE.Vector3;
    proj: "perspective" | "orthographic";
    start: number;
  } | null>(null);

  /** Visible height (mm) at the target for the current camera. */
  const visibleHeight = () => {
    const c = camera as THREE.PerspectiveCamera & THREE.OrthographicCamera;
    if (c.isOrthographicCamera) return size.height / c.zoom;
    return 2 * c.position.distanceTo(target.current) * Math.tan(THREE.MathUtils.degToRad(c.fov) / 2);
  };
  const orientationFor = (dir: THREE.Vector3) => {
    const m = new THREE.Matrix4().lookAt(dir, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
    return new THREE.Quaternion().setFromRotationMatrix(m);
  };

  const startTween = (dir: THREE.Vector3 | null, h: number | null, proj: "perspective" | "orthographic", newTarget?: THREE.Vector3) => {
    const c = camera as THREE.PerspectiveCamera & THREE.OrthographicCamera;
    const h0 = visibleHeight();
    const f0 = c.isOrthographicCamera ? ORTHO_FOV : c.fov;
    const q0 = c.quaternion.clone();
    // The tween always renders through the perspective camera.
    if (c !== persp.current) {
      const p = persp.current;
      p.quaternion.copy(q0);
      p.fov = f0;
      p.position.copy(target.current).add(new THREE.Vector3(0, 0, 1).applyQuaternion(q0).multiplyScalar(h0 / (2 * Math.tan(THREE.MathUtils.degToRad(f0) / 2))));
      p.far = 40000;
      p.updateProjectionMatrix();
      set({ camera: p });
    }
    tween.current = {
      q0,
      q1: dir ? orientationFor(dir.clone().normalize()) : q0.clone(),
      h0,
      h1: h ?? h0,
      f0,
      f1: proj === "orthographic" ? ORTHO_FOV : BASE_FOV,
      t0: target.current.clone(),
      t1: (newTarget ?? target.current).clone(),
      proj,
      start: performance.now(),
    };
    const ctl = controls as unknown as { enabled: boolean } | null;
    if (ctl) ctl.enabled = false;
  };

  useFrame((state) => {
    const tw = tween.current;
    if (!tw) return;
    // Controls get recreated when the camera object changes; keep them off while tweening.
    const live = state.controls as unknown as { enabled: boolean } | null;
    if (live) live.enabled = false;
    // Dev only: window.__tweenMs slows the tween down for frame captures.
    const ms = (import.meta.env.DEV && (window as unknown as { __tweenMs?: number }).__tweenMs) || TWEEN_MS;
    const k = Math.min(1, (performance.now() - tw.start) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    const p = persp.current;
    const q = tw.q0.clone().slerp(tw.q1, e);
    const fov = Math.exp(THREE.MathUtils.lerp(Math.log(tw.f0), Math.log(tw.f1), e));
    const h = THREE.MathUtils.lerp(tw.h0, tw.h1, e);
    const d = h / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
    target.current.lerpVectors(tw.t0, tw.t1, e);
    p.fov = fov;
    p.far = Math.max(5000, d + 5000);
    p.quaternion.copy(q);
    p.position.copy(target.current).add(new THREE.Vector3(0, 0, 1).applyQuaternion(q).multiplyScalar(d));
    p.updateProjectionMatrix();
    if (k < 1) return;
    tween.current = null;
    if (tw.proj === "orthographic") {
      ortho.position.copy(p.position);
      ortho.quaternion.copy(q);
      ortho.zoom = size.height / h;
      ortho.updateProjectionMatrix();
      set({ camera: ortho });
    } else {
      p.far = 5000;
      p.updateProjectionMatrix();
    }
    const ctl = state.controls as unknown as (Controls & { enabled: boolean }) | null;
    if (ctl) {
      ctl.target.copy(target.current);
      ctl.enabled = true;
      ctl.update();
    }
  });

  // Project files save and restore the camera.
  useEffect(() => {
    cameraState.get = () => {
      const c = camera as THREE.PerspectiveCamera & THREE.OrthographicCamera;
      const r = (v: number) => Math.round(v * 1000) / 1000;
      return {
        position: c.position.toArray().map(r) as Vec3,
        target: target.current.toArray().map(r) as Vec3,
        projection: c.isOrthographicCamera ? "orthographic" : "perspective",
        zoom: c.isOrthographicCamera ? c.zoom : undefined,
      };
    };
    cameraState.set = (d) => {
      tween.current = null;
      target.current.set(...d.target);
      const ctl = controls as unknown as Controls | null;
      if (ctl) ctl.target.set(...d.target);
      useSettings.setState({ projection: d.projection });
      const cam = d.projection === "orthographic" ? ortho : persp.current;
      cam.position.set(...d.position);
      cam.lookAt(target.current);
      if (d.projection === "orthographic" && d.zoom) ortho.zoom = d.zoom;
      cam.updateProjectionMatrix();
      set({ camera: cam });
      ctl?.update();
    };
  });

  // Projection toggle (O, Ansicht menu, Inspektor).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      if (projection === "orthographic") startTween(null, null, "orthographic");
      return;
    }
    if (tween.current?.proj === projection) return; // already heading there (2D workspace)
    startTween(null, null, projection);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projection]);

  // 2D workspace: glide to a top view (orthographic) and back to the previous view afterwards.
  const saved = useRef<{ dir: THREE.Vector3; h: number; projection: "perspective" | "orthographic" } | null>(null);
  useEffect(() => {
    if (workspace === "sketch" && !saved.current) {
      const dir = camera.position.clone().sub(target.current).normalize();
      saved.current = { dir, h: visibleHeight(), projection: useSettings.getState().projection };
      // A hair towards +Z (CAD front) so CAD +Y points up on screen.
      startTween(new THREE.Vector3(0, 1, 0.0005), Math.max(visibleHeight(), 120), "orthographic");
      useSettings.setState({ projection: "orthographic" });
    } else if (workspace !== "sketch" && saved.current) {
      const back = saved.current;
      saved.current = null;
      startTween(back.dir, back.h, back.projection);
      useSettings.setState({ projection: back.projection });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace]);

  const request = useViewRequest((s) => s.request);
  useEffect(() => {
    if (!request) return;
    const proj = useSettings.getState().projection;
    // CAD (x, y, z) → scene (x, z, −y).
    const scene = (v: [number, number, number]) => new THREE.Vector3(v[0], v[2], -v[1]);
    if (request.kind === "iso") {
      // CAD (1, -1, 1) = front-right-top; the scene is Y-up, so that is (1, 1, 1) here.
      startTween(new THREE.Vector3(1, 1, 1), null, proj);
    } else if (request.kind === "dir") {
      // Camera sits opposite the viewing direction; a hair off the pole keeps "up" stable.
      const d = scene(request.dir).negate();
      if (Math.abs(d.y) > 0.999) d.z += 0.0005;
      startTween(d, null, proj);
    } else {
      const a = scene(request.min), b = scene(request.max);
      const centre = a.clone().add(b).multiplyScalar(0.5);
      const radius = Math.max(5, a.distanceTo(b) / 2);
      startTween(null, radius * 3.2, proj, centre);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  return (
    <OrbitControls
      makeDefault
      enableRotate={workspace !== "sketch"}
      // Space held: left-drag pans (the temporary hand tool).
      mouseButtons={{ LEFT: spacePan ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
      // Direct camera by default; "Leicht" adds a short glide.
      enableDamping={false}
      dampingFactor={0.3}
      zoomToCursor
      rotateSpeed={0.9}
      panSpeed={1}
      zoomSpeed={1.1}
      autoRotate={turntable}
      autoRotateSpeed={0.8}
      target={target.current.toArray()}
      minDistance={20}
      maxDistance={1500}
      minZoom={0.3}
      maxZoom={60}
    />
  );
}

// Box selection: Shift + drag on an empty spot in the viewport draws a rectangle and
// selects every body whose screen-space centre lies inside (added to the selection).
// A plain drag still orbits.
import { useEffect, useState } from "react";
import * as THREE from "three";
import { execute } from "../core/commands";
import { useMeshObjects } from "./SelectionOutline";
import { viewportPick } from "../ui/viewportPick";

type Rect = { x0: number; y0: number; x1: number; y1: number };

/** Ids of meshes whose projected bounding-box centre lies in the screen rectangle. */
export let pickInRect: ((r: Rect) => string[]) | null = null;
export function setPickInRect(fn: typeof pickInRect) {
  pickInRect = fn;
}

export function useBoxSelect(): { onPointerDownCapture(e: React.PointerEvent): void; overlay: React.ReactNode } {
  const [rect, setRect] = useState<Rect | null>(null);
  useEffect(() => () => setRect(null), []);
  const onPointerDownCapture = (e: React.PointerEvent) => {
    if (!e.shiftKey || e.button !== 0) return;
    const hit = viewportPick.pick?.(e.clientX, e.clientY);
    if (hit?.featureId) return; // Shift+click on a body toggles it (normal handling)
    e.stopPropagation(); // keep the orbit controls out of it
    e.preventDefault();
    const r: Rect = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY };
    setRect(r);
    const move = (ev: PointerEvent) => setRect({ ...r, x1: ev.clientX, y1: ev.clientY });
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setRect(null);
      const box = { x0: Math.min(r.x0, ev.clientX), y0: Math.min(r.y0, ev.clientY), x1: Math.max(r.x0, ev.clientX), y1: Math.max(r.y0, ev.clientY) };
      if (box.x1 - box.x0 < 4 && box.y1 - box.y0 < 4) return;
      const ids = pickInRect?.(box) ?? [];
      if (ids.length) void execute("selection.set", { ids, mode: "add" });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const overlay = rect ? (
    <div
      className="box-select"
      style={{ left: Math.min(rect.x0, rect.x1), top: Math.min(rect.y0, rect.y1), width: Math.abs(rect.x1 - rect.x0), height: Math.abs(rect.y1 - rect.y0) }}
    />
  ) : null;
  return { onPointerDownCapture, overlay };
}

/** Installed by the viewport once it has a camera. */
export function makeRectPicker(getCamera: () => THREE.Camera, canvas: () => HTMLCanvasElement) {
  return (r: Rect) => {
    const cam = getCamera();
    const c = canvas().getBoundingClientRect();
    const out: string[] = [];
    const box = new THREE.Box3();
    const centre = new THREE.Vector3();
    for (const [id, mesh] of Object.entries(useMeshObjects.getState().meshes)) {
      if (!mesh.visible) continue;
      box.setFromObject(mesh).getCenter(centre).project(cam);
      const x = c.left + ((centre.x + 1) / 2) * c.width;
      const y = c.top + ((1 - centre.y) / 2) * c.height;
      if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) out.push(id);
    }
    return out;
  };
}

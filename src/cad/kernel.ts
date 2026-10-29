// Main-thread client for the CAD worker plus a small geometry cache.
import * as THREE from "three";
import { create } from "zustand";
import { geometryKey, type Feature } from "../core/document";
import type { MeshData, WorkerRequest, WorkerResponse } from "./protocol";

type Pending = { resolve: (r: WorkerResponse) => void };
type Distribute<T> = T extends unknown ? Omit<T, "id"> : never;

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const p = pending.get(ev.data.id);
      pending.delete(ev.data.id);
      p?.resolve(ev.data);
    };
  }
  return worker;
}

function request(msg: Distribute<WorkerRequest>): Promise<WorkerResponse> {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, { resolve });
    getWorker().postMessage({ ...msg, id });
  });
}

export interface KernelState {
  status: "loading" | "ready" | "error";
  busy: number;
  error?: string;
}

export const useKernel = create<KernelState>(() => ({ status: "loading", busy: 0 }));

export function initKernel() {
  request({ kind: "init" }).then((r) =>
    useKernel.setState(r.ok ? { status: "ready" } : { status: "error", error: r.error }),
  );
}

export interface GeometryEntry {
  geometry: THREE.BufferGeometry;
  edges: THREE.BufferGeometry;
  /** Bounding box in the feature's local frame. */
  box: THREE.Box3;
  warning?: string;
}

const cache = new Map<string, Promise<GeometryEntry>>();

/** Resolved geometry by geometry key, for synchronous consumers (bounds, print check). */
export const useMeshes = create<{ entries: Record<string, GeometryEntry> }>(() => ({ entries: {} }));

function toThree(mesh: MeshData): GeometryEntry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(mesh.vertices, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const edges = new THREE.BufferGeometry();
  edges.setAttribute("position", new THREE.BufferAttribute(mesh.edges, 3));
  return { geometry, edges, box: geometry.boundingBox!.clone() };
}

/** Meshes a feature in its local frame (its own transform is applied by the viewport). */
export function getGeometry(f: Feature): Promise<GeometryEntry> {
  const key = geometryKey(f);
  let p = cache.get(key);
  if (!p) {
    const local = { ...f, transform: { position: [0, 0, 0], rotation: [0, 0, 0] } } as Feature;
    useKernel.setState((s) => ({ busy: s.busy + 1 }));
    p = request({ kind: "mesh", feature: local }).then((r) => {
      useKernel.setState((s) => ({ busy: s.busy - 1 }));
      if (!r.ok || r.kind !== "mesh") {
        cache.delete(key);
        throw new Error(r.ok ? "Unerwartete Antwort" : r.error);
      }
      const entry = { ...toThree(r.mesh), warning: r.warning };
      useMeshes.setState((s) => ({ entries: { ...s.entries, [key]: entry } }));
      return entry;
    });
    cache.set(key, p);
  }
  return p;
}

export async function exportFeatures(
  features: Feature[],
  format: "stl" | "3mf",
  name: string,
): Promise<Uint8Array> {
  const r = await request({ kind: "export", features, format, name });
  if (!r.ok || r.kind !== "export") throw new Error(r.ok ? "Unerwartete Antwort" : r.error);
  return new Uint8Array(r.data);
}

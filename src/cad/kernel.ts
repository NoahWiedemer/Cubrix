// Main-thread client for the CAD worker plus a small geometry cache.
import * as THREE from "three";
import { create } from "zustand";
import { geometryKey, type Feature } from "../core/document";
import type { ExportFormat, MeshData, WorkerRequest, WorkerResponse } from "./protocol";
import { fontKey, isBundledFont } from "./fontKeys";

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

export class KernelError extends Error {
  constructor(message: string, readonly edgeTreatment = false) {
    super(message);
  }
}

export interface GeometryEntry {
  geometry: THREE.BufferGeometry;
  edges: THREE.BufferGeometry;
  /** Bounding box in the feature's local frame. */
  box: THREE.Box3;
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

// ── System fonts ─────────────────────────────────────────────────────────────
const fontLoads = new Map<string, Promise<boolean>>();

/** Fonts that are not installed here; their text falls back to Inter (shown as a note). */
export const useMissingFonts = create<{ missing: string[] }>(() => ({ missing: [] }));

/** Makes sure an installed family is registered in the worker; false = unavailable. */
export function ensureFont(font: string, bold: boolean): Promise<boolean> {
  if (isBundledFont(font)) return Promise.resolve(true);
  const name = fontKey(font, bold);
  let p = fontLoads.get(name);
  if (!p) {
    p = (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const data = await invoke<ArrayBuffer>("font_bytes", { family: font, weight: bold ? 700 : 400 });
        const r = await request({ kind: "font", name, data });
        if (!r.ok) throw new Error(r.error);
        return true;
      } catch {
        useMissingFonts.setState((s) => (s.missing.includes(font) ? s : { missing: [...s.missing, font] }));
        return false;
      }
    })();
    fontLoads.set(name, p);
  }
  return p;
}

/** Loads the system fonts a feature uses; unavailable ones are swapped for Inter. */
async function withFonts(f: Feature): Promise<Feature> {
  if (f.type === "text") return (await ensureFont(f.params.font, f.params.bold)) ? f : { ...f, params: { ...f.params, font: "inter" } };
  if (f.type === "boolean") return { ...f, children: (await Promise.all(f.children.map(withFonts))) as [Feature, Feature] };
  return f;
}

/** Meshes a feature in its local frame (its own transform is applied by the viewport). */
export function getGeometry(f: Feature): Promise<GeometryEntry> {
  const key = geometryKey(f);
  let p = cache.get(key);
  if (!p) {
    const local = { ...f, transform: { position: [0, 0, 0], rotation: [0, 0, 0] } } as Feature;
    useKernel.setState((s) => ({ busy: s.busy + 1 }));
    p = withFonts(local).then((feature) => request({ kind: "mesh", feature })).then((r) => {
      useKernel.setState((s) => ({ busy: s.busy - 1 }));
      if (!r.ok || r.kind !== "mesh") {
        cache.delete(key);
        throw new KernelError(r.ok ? "Unerwartete Antwort" : r.error, !r.ok && !!r.edgeTreatment);
      }
      const entry = toThree(r.mesh);
      useMeshes.setState((s) => ({ entries: { ...s.entries, [key]: entry } }));
      return entry;
    });
    cache.set(key, p);
  }
  return p;
}

export async function exportFeatures(
  features: Feature[],
  format: ExportFormat,
  name: string,
): Promise<Uint8Array> {
  const r = await request({ kind: "export", features: await Promise.all(features.map(withFonts)), format, name });
  if (!r.ok || r.kind !== "export") throw new Error(r.ok ? "Unerwartete Antwort" : r.error);
  return new Uint8Array(r.data);
}

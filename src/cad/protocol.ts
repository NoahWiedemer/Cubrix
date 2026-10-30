import type { Feature } from "../core/document";

export type ExportFormat = "stl" | "3mf" | "obj" | "step";

export interface MeshData {
  vertices: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  edges: Float32Array;
}

export type WorkerRequest =
  | { id: number; kind: "init" }
  | { id: number; kind: "mesh"; feature: Feature }
  /** Largest working fillet/chamfer up to `value` (0 = none works). */
  | { id: number; kind: "edgeMax"; feature: Feature; edge: "fillet" | "chamfer"; value: number }
  /** Registers an imported file (STL/STEP) under its asset id. */
  | { id: number; kind: "asset"; assetId: string; format: "stl" | "step"; data: ArrayBuffer }
  /** Registers font bytes under a name (system fonts for text). */
  | { id: number; kind: "font"; name: string; data: ArrayBuffer }
  | { id: number; kind: "export"; features: Feature[]; format: ExportFormat; name: string };

export type WorkerResponse =
  | { id: number; ok: true; kind: "init" }
  | { id: number; ok: true; kind: "font" }
  | { id: number; ok: true; kind: "asset"; triangles?: number }
  | { id: number; ok: true; kind: "mesh"; mesh: MeshData }
  | { id: number; ok: true; kind: "edgeMax"; value: number }
  | { id: number; ok: true; kind: "export"; data: ArrayBuffer; mtl?: string }
  | { id: number; ok: false; error: string; edgeTreatment?: boolean };

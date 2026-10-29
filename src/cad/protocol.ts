import type { Feature } from "../core/document";

export interface MeshData {
  vertices: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  edges: Float32Array;
}

export type WorkerRequest =
  | { id: number; kind: "init" }
  | { id: number; kind: "mesh"; feature: Feature }
  | { id: number; kind: "export"; features: Feature[]; format: "stl" | "3mf"; name: string };

export type WorkerResponse =
  | { id: number; ok: true; kind: "init" }
  | { id: number; ok: true; kind: "mesh"; mesh: MeshData; warning?: string }
  | { id: number; ok: true; kind: "export"; data: ArrayBuffer }
  | { id: number; ok: false; error: string };

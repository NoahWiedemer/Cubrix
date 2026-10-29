/// <reference lib="webworker" />
// CAD kernel worker: replicad on top of OpenCascade (WASM). Builds B-rep solids
// from document features, meshes them for the viewport and writes STL / 3MF.

import opencascade from "replicad-opencascadejs";
import wasmUrl from "replicad-opencascadejs/wasm?url";
import { makeCompound, setOC, type Face, type Shape3D } from "replicad";
import { buildLocal, buildPlaced, EdgeTreatmentError } from "./build";
import { zipSync, strToU8 } from "fflate";
import type { MeshData, WorkerRequest, WorkerResponse } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

let ready: Promise<void> | null = null;
function init() {
  if (!ready) {
    ready = (async () => {
      const OC = await (opencascade as unknown as (o: object) => Promise<unknown>)({
        locateFile: () => wasmUrl,
      });
      setOC(OC as Parameters<typeof setOC>[0]);
    })();
  }
  return ready;
}

// Small LRU of local shapes keyed by geometry, so moving objects never re-meshes.
const meshCache = new Map<string, MeshData>();

function meshShape(shape: Shape3D): MeshData {
  const m = shape.mesh({ tolerance: 0.01, angularTolerance: 0.12 });
  const e = shape.meshEdges({ tolerance: 0.01, angularTolerance: 0.12 });
  const keep = featureEdges(shape);
  const lines: number[] = [];
  for (const g of e.edgeGroups) {
    if (!keep.has(g.edgeId)) continue;
    for (let i = g.start * 3; i < (g.start + g.count) * 3; i++) lines.push(e.lines[i]);
  }
  return {
    vertices: new Float32Array(m.vertices),
    normals: new Float32Array(m.normals),
    indices: new Uint32Array(m.triangles),
    edges: new Float32Array(lines),
  };
}

/**
 * Edges worth drawing: skips seams (only one adjacent face), degenerated edges
 * (sphere poles) and edges between tangent-continuous faces (e.g. fillet borders).
 */
function featureEdges(shape: Shape3D): Set<number> {
  const adjacent = new Map<number, Face[]>();
  for (const face of shape.faces)
    for (const edge of face.edges) {
      const list = adjacent.get(edge.hashCode) ?? [];
      if (!list.some((f) => f.isSame(face))) list.push(face);
      adjacent.set(edge.hashCode, list);
    }
  const keep = new Set<number>();
  for (const edge of shape.edges) {
    const faces = adjacent.get(edge.hashCode) ?? [];
    if (edge.length < 1e-6 || faces.length < 2) continue;
    const p = edge.pointAt(0.5);
    const n1 = faces[0].normalAt(p);
    const n2 = faces[1].normalAt(p);
    const smooth = n1.dot(n2) > Math.cos((3 * Math.PI) / 180);
    p.delete();
    n1.delete();
    n2.delete();
    if (!smooth) keep.add(edge.hashCode);
  }
  return keep;
}

function exportStl(shapes: Shape3D[]): ArrayBuffer {
  const meshes = shapes.map((s) => s.mesh({ tolerance: 0.01, angularTolerance: 5 }));
  const triCount = meshes.reduce((n, m) => n + m.triangles.length / 3, 0);
  const buf = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buf);
  const header = strToU8("Modelonio STL export");
  new Uint8Array(buf).set(header.subarray(0, 80));
  view.setUint32(80, triCount, true);
  let o = 84;
  for (const m of meshes) {
    const v = m.vertices;
    for (let t = 0; t < m.triangles.length; t += 3) {
      const ia = m.triangles[t] * 3, ib = m.triangles[t + 1] * 3, ic = m.triangles[t + 2] * 3;
      const ux = v[ib] - v[ia], uy = v[ib + 1] - v[ia + 1], uz = v[ib + 2] - v[ia + 2];
      const wx = v[ic] - v[ia], wy = v[ic + 1] - v[ia + 1], wz = v[ic + 2] - v[ia + 2];
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      for (const val of [nx, ny, nz]) { view.setFloat32(o, val, true); o += 4; }
      for (const i of [ia, ib, ic])
        for (let k = 0; k < 3; k++) { view.setFloat32(o, v[i + k], true); o += 4; }
      view.setUint16(o, 0, true);
      o += 2;
    }
  }
  return buf;
}

function export3mf(shapes: Shape3D[], names: string[]): ArrayBuffer {
  const objects: string[] = [];
  const items: string[] = [];
  shapes.forEach((s, idx) => {
    const m = s.mesh({ tolerance: 0.01, angularTolerance: 5 });
    const verts: string[] = [];
    for (let i = 0; i < m.vertices.length; i += 3)
      verts.push(`<vertex x="${m.vertices[i].toFixed(4)}" y="${m.vertices[i + 1].toFixed(4)}" z="${m.vertices[i + 2].toFixed(4)}"/>`);
    const tris: string[] = [];
    for (let i = 0; i < m.triangles.length; i += 3)
      tris.push(`<triangle v1="${m.triangles[i]}" v2="${m.triangles[i + 1]}" v3="${m.triangles[i + 2]}"/>`);
    const id = idx + 1;
    const name = names[idx].replace(/[<>&"]/g, "");
    objects.push(`<object id="${id}" name="${name}" type="model"><mesh><vertices>${verts.join("")}</vertices><triangles>${tris.join("")}</triangles></mesh></object>`);
    items.push(`<item objectid="${id}"/>`);
  });
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="de-DE" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Application">Modelonio</metadata>
<resources>${objects.join("")}</resources>
<build>${items.join("")}</build>
</model>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;
  const zip = zipSync({
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rels),
    "3D/3dmodel.model": strToU8(model),
  });
  return zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer;
}

function exportObj(shapes: Shape3D[], names: string[]): ArrayBuffer {
  const out: string[] = ["# Modelonio OBJ export (mm)"];
  let offset = 1;
  shapes.forEach((s, idx) => {
    const m = s.mesh({ tolerance: 0.01, angularTolerance: 0.1 });
    out.push(`o ${names[idx].replace(/\s+/g, "_")}`);
    for (let i = 0; i < m.vertices.length; i += 3)
      out.push(`v ${m.vertices[i].toFixed(4)} ${m.vertices[i + 1].toFixed(4)} ${m.vertices[i + 2].toFixed(4)}`);
    for (let i = 0; i < m.triangles.length; i += 3)
      out.push(`f ${m.triangles[i] + offset} ${m.triangles[i + 1] + offset} ${m.triangles[i + 2] + offset}`);
    offset += m.vertices.length / 3;
  });
  return strToU8(out.join("\n") + "\n").buffer as ArrayBuffer;
}

async function exportStep(shapes: Shape3D[]): Promise<ArrayBuffer> {
  const compound = shapes.length === 1 ? shapes[0] : (makeCompound(shapes) as Shape3D);
  return compound.blobSTEP().arrayBuffer();
}

function post(msg: WorkerResponse, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer);
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  try {
    await init();
    if (req.kind === "init") return post({ id: req.id, ok: true, kind: "init" });

    if (req.kind === "mesh") {
      const key = JSON.stringify(req.feature);
      let mesh = meshCache.get(key);
      if (!mesh) {
        const shape = buildLocal(req.feature);
        mesh = meshShape(shape);
        shape.delete();
        meshCache.set(key, mesh);
        if (meshCache.size > 64) meshCache.delete(meshCache.keys().next().value!);
      }
      // Copies are sent so the cache keeps its own buffers.
      const out: MeshData = {
        vertices: mesh.vertices.slice(),
        normals: mesh.normals.slice(),
        indices: mesh.indices.slice(),
        edges: mesh.edges.slice(),
      };
      return post(
        { id: req.id, ok: true, kind: "mesh", mesh: out },
        [out.vertices.buffer, out.normals.buffer, out.indices.buffer, out.edges.buffer],
      );
    }

    if (req.kind === "export") {
      const shapes = req.features.map((f) => buildPlaced(f));
      const names = req.features.map((f) => f.name);
      const data =
        req.format === "stl"
          ? exportStl(shapes)
          : req.format === "3mf"
            ? export3mf(shapes, names)
            : req.format === "obj"
              ? exportObj(shapes, names)
              : await exportStep(shapes);
      shapes.forEach((s) => s.delete());
      return post({ id: req.id, ok: true, kind: "export", data }, [data]);
    }
  } catch (e) {
    const error = e instanceof EdgeTreatmentError || e instanceof Error ? e.message : `CAD-Fehler (${String(e)})`;
    post({ id: req.id, ok: false, error, edgeTreatment: e instanceof EdgeTreatmentError });
  }
};

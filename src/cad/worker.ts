/// <reference lib="webworker" />
// CAD kernel worker: replicad on top of OpenCascade (WASM). Builds B-rep solids
// from document features, meshes them for the viewport and writes STL / 3MF.

import opencascade from "replicad-opencascadejs";
import wasmUrl from "replicad-opencascadejs/wasm?url";
import { importSTEP, makeCompound, setOC, type Face, type Shape3D } from "replicad";
import { materialOf } from "../core/materials";
import { buildLocal, buildPlaced, EdgeTreatmentError, importedShapes } from "./build";
import { zipSync, strToU8 } from "fflate";
import { loadFonts, registerFont } from "./text";
import { stlToSolid } from "./stl";
import inter400 from "@fontsource/inter/files/inter-latin-400-normal.woff?url";
import inter700 from "@fontsource/inter/files/inter-latin-700-normal.woff?url";
import slab400 from "@fontsource/roboto-slab/files/roboto-slab-latin-400-normal.woff?url";
import slab700 from "@fontsource/roboto-slab/files/roboto-slab-latin-700-normal.woff?url";
import mono400 from "@fontsource/roboto-mono/files/roboto-mono-latin-400-normal.woff?url";
import mono700 from "@fontsource/roboto-mono/files/roboto-mono-latin-700-normal.woff?url";

const FONT_URLS: Record<string, string> = {
  "inter-400": inter400,
  "inter-700": inter700,
  "roboto-slab-400": slab400,
  "roboto-slab-700": slab700,
  "roboto-mono-400": mono400,
  "roboto-mono-700": mono700,
};
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
      await loadFonts(async (name) => (await fetch(FONT_URLS[name])).arrayBuffer());
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
  const meshes = shapes.map((s) => s.mesh({ tolerance: 0.01, angularTolerance: 0.1 }));
  const triCount = meshes.reduce((n, m) => n + m.triangles.length / 3, 0);
  const buf = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buf);
  const header = strToU8("Cubrix STL export");
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

function export3mf(shapes: Shape3D[], names: string[], colors: (string | undefined)[], materials: (string | undefined)[] = []): ArrayBuffer {
  const objects: string[] = [];
  const items: string[] = [];
  // One base material per distinct colour + display material; slicers (Bambu Studio,
  // PrusaSlicer) read it as the part colour, the name says the finish ("Seide Rot").
  const NEUTRAL = "#99a1a8";
  const keyOf = (i: number) => (colors[i] || materials[i] ? `${colors[i] ?? NEUTRAL}|${materials[i] ?? "matte"}` : "");
  const palette = [...new Set(shapes.map((_, i) => keyOf(i)).filter(Boolean))];
  const baseName = (key: string) => {
    const [color, material] = key.split("|");
    return `${materialOf(material).label} ${color === NEUTRAL ? "Neutral" : color.toUpperCase()}`;
  };
  const MAT = 1000;
  shapes.forEach((s, idx) => {
    const m = s.mesh({ tolerance: 0.01, angularTolerance: 0.1 });
    const verts: string[] = [];
    for (let i = 0; i < m.vertices.length; i += 3)
      verts.push(`<vertex x="${m.vertices[i].toFixed(4)}" y="${m.vertices[i + 1].toFixed(4)}" z="${m.vertices[i + 2].toFixed(4)}"/>`);
    const tris: string[] = [];
    for (let i = 0; i < m.triangles.length; i += 3)
      tris.push(`<triangle v1="${m.triangles[i]}" v2="${m.triangles[i + 1]}" v3="${m.triangles[i + 2]}"/>`);
    const id = idx + 1;
    const name = names[idx].replace(/[<>&"]/g, "");
    const key = keyOf(idx);
    const mat = key ? ` pid="${MAT}" pindex="${palette.indexOf(key)}"` : "";
    objects.push(`<object id="${id}" name="${name}" type="model"${mat}><mesh><vertices>${verts.join("")}</vertices><triangles>${tris.join("")}</triangles></mesh></object>`);
    items.push(`<item objectid="${id}"/>`);
  });
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="de-DE" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Application">Cubrix</metadata>
<resources>${palette.length ? `<basematerials id="${MAT}">${palette.map((k) => `<base name="${baseName(k)}" displaycolor="${k.split("|")[0].toUpperCase()}FF"/>`).join("")}</basematerials>` : ""}${objects.join("")}</resources>
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

/** OBJ plus a matching MTL with one material per colour (referenced as <name>.mtl). */
function exportObj(shapes: Shape3D[], names: string[], colors: (string | undefined)[], mtlName: string): { obj: ArrayBuffer; mtl: string | null } {
  const palette = [...new Set(colors.filter((c): c is string => !!c))];
  const out: string[] = ["# Cubrix OBJ export (mm)"];
  if (palette.length) out.push(`mtllib ${mtlName}`);
  let offset = 1;
  shapes.forEach((s, idx) => {
    const m = s.mesh({ tolerance: 0.01, angularTolerance: 0.1 });
    out.push(`o ${names[idx].replace(/\s+/g, "_")}`);
    if (colors[idx]) out.push(`usemtl farbe${palette.indexOf(colors[idx]!) + 1}`);
    for (let i = 0; i < m.vertices.length; i += 3)
      out.push(`v ${m.vertices[i].toFixed(4)} ${m.vertices[i + 1].toFixed(4)} ${m.vertices[i + 2].toFixed(4)}`);
    for (let i = 0; i < m.triangles.length; i += 3)
      out.push(`f ${m.triangles[i] + offset} ${m.triangles[i + 1] + offset} ${m.triangles[i + 2] + offset}`);
    offset += m.vertices.length / 3;
  });
  const rgb = (c: string) => [1, 3, 5].map((i) => (parseInt(c.slice(i, i + 2), 16) / 255).toFixed(4)).join(" ");
  const mtl = palette.length ? palette.map((c, i) => `newmtl farbe${i + 1}\nKd ${rgb(c)}\nKa 0 0 0\nd 1\n`).join("\n") : null;
  return { obj: strToU8(out.join("\n") + "\n").buffer as ArrayBuffer, mtl };
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

    if (req.kind === "asset") {
      if (!importedShapes.has(req.assetId)) {
        const blob = new Blob([req.data]);
        const raw = (req.format === "step" ? await importSTEP(blob) : stlToSolid(req.data)) as Shape3D;
        // Stand it on the bed, centred like every other body.
        const b = raw.boundingBox;
        const [min, max] = b.bounds;
        importedShapes.set(req.assetId, raw.translate(-(min[0] + max[0]) / 2, -(min[1] + max[1]) / 2, -min[2]));
      }
      return post({ id: req.id, ok: true, kind: "asset" });
    }

    if (req.kind === "font") {
      await registerFont(req.name, req.data);
      return post({ id: req.id, ok: true, kind: "font" });
    }

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
      const colors = req.features.map((f) => f.color);
      let objResult: { obj: ArrayBuffer; mtl: string | null } | undefined;
      const data =
        req.format === "stl"
          ? exportStl(shapes)
          : req.format === "3mf"
            ? export3mf(shapes, names, colors, req.features.map((f) => f.material))
            : req.format === "obj"
              ? (objResult = exportObj(shapes, names, colors, `${req.name.replace(/[^\w.-]+/g, "_")}.mtl`)).obj
              : await exportStep(shapes);
      shapes.forEach((s) => s.delete());
      return post({ id: req.id, ok: true, kind: "export", data, mtl: objResult?.mtl ?? undefined }, [data]);
    }
  } catch (e) {
    const error = e instanceof EdgeTreatmentError || e instanceof Error ? e.message : `CAD-Fehler (${String(e)})`;
    post({ id: req.id, ok: false, error, edgeTreatment: e instanceof EdgeTreatmentError });
  }
};

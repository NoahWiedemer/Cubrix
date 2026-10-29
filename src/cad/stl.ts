// STL → OpenCascade solid. replicad's importSTL relies on OCC's STL reader, which fails
// in this WASM build, so the triangles are parsed here and sewn into a solid instead.
import { makePolygon, makeSolid, type Shape3D } from "replicad";

export function parseStl(buf: ArrayBuffer): number[][] {
  const view = new DataView(buf);
  const n = buf.byteLength >= 84 ? view.getUint32(80, true) : 0;
  const tris: number[][] = [];
  if (buf.byteLength === 84 + n * 50) {
    for (let i = 0; i < n; i++) {
      const o = 84 + i * 50 + 12;
      tris.push(Array.from({ length: 9 }, (_, k) => view.getFloat32(o + k * 4, true)));
    }
    return tris;
  }
  // ASCII
  const text = new TextDecoder().decode(buf);
  const v = [...text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].map((m) => [+m[1], +m[2], +m[3]]);
  for (let i = 0; i + 2 < v.length; i += 3) tris.push([...v[i], ...v[i + 1], ...v[i + 2]]);
  return tris;
}

export function stlToSolid(buf: ArrayBuffer): Shape3D {
  const tris = parseStl(buf);
  if (!tris.length) throw new Error("Die STL-Datei enthält keine Dreiecke.");
  if (tris.length > 200_000) throw new Error("Die STL-Datei ist zu groß (über 200 000 Dreiecke).");
  const faces = [];
  for (const t of tris) {
    const a = [t[0], t[1], t[2]] as [number, number, number], b = [t[3], t[4], t[5]] as [number, number, number], c = [t[6], t[7], t[8]] as [number, number, number];
    // Skip degenerate triangles (zero area) — they break sewing.
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
    if (Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) < 1e-12) continue;
    faces.push(makePolygon([a, b, c]));
  }
  return makeSolid(faces) as Shape3D;
}

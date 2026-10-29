// Build-volume wireframe edges (scene frame, Y up), from the printer's volume only.
export interface VolumeEdge {
  a: [number, number, number];
  b: [number, number, number];
  /** Bed corners this edge touches (to fade the one nearest the camera). */
  corners: number[];
}

export function volumeCorners(w: number, d: number): [number, number][] {
  const x = w / 2, z = d / 2;
  return [[-x, -z], [x, -z], [x, z], [-x, z]];
}

export function volumeEdges(w: number, d: number, h: number): VolumeEdge[] {
  const corners = volumeCorners(w, d);
  const list: VolumeEdge[] = [];
  corners.forEach(([cx, cz], i) => {
    const [nx, nz] = corners[(i + 1) % 4];
    list.push({ a: [cx, 0, cz], b: [cx, h, cz], corners: [i] }); // vertical
    list.push({ a: [cx, h, cz], b: [nx, h, nz], corners: [i, (i + 1) % 4] }); // top
  });
  return list;
}

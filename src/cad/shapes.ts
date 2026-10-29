// Additional library shapes (parametric, kernel-built). Every solid stands on z = 0
// and is centred on the origin in X/Y, like the basic primitives.
import { draw, drawCircle, drawEllipse, drawPolysides, drawRectangle, drawRoundedRectangle, genericSweep, makeBaseBox, makeCompound, makeCylinder, makeHelix, makePolygon, makeSphere, type Drawing, type Shape3D } from "replicad";

const extrude = (d: Drawing, h: number) => d.sketchOnPlane("XY").extrude(h) as Shape3D;
/** Revolves a closed profile drawn in (radius, z) around the Z axis. */
const revolve = (d: Drawing) => d.sketchOnPlane("XZ").revolve([0, 0, 1]) as Shape3D;
/** Extrudes a side profile drawn in (x, z) by `depth` in Y, centred. */
const sideExtrude = (d: Drawing, depth: number) => (d.sketchOnPlane("XZ").extrude(depth) as Shape3D).translateY(depth / 2);

/**
 * Metric-style thread: a trapezoid tooth (60° flanks, ISO depth 0.6134·P) swept along a
 * real helix, next to a core cylinder. The two solids stay a compound (fusing a swept
 * thread into its core takes seconds); booleans handle them one by one (build.ts).
 * `clearance` > 0 makes an inner-thread tool: everything grows by that much.
 */
function thread(diameter: number, pitch: number, length: number, clearance = 0): Shape3D {
  const P = Math.max(0.2, pitch);
  const h = 0.6134 * P;
  const rMaj = diameter / 2 + clearance;
  const rMin = Math.max(0.2, rMaj - h);
  if (length < P * 1.5) throw new Error(`Das Gewinde muss mindestens ${(Math.ceil(P * 15) / 10).toLocaleString("de-DE")} mm lang sein.`);
  if (rMin < P) throw new Error("Die Steigung ist für diesen Durchmesser zu groß.");
  const base = 0.875 * P;
  const tip = 0.125 * P;
  const z0 = base / 2;
  // The tooth reaches 0.1 mm into the core so the solids overlap cleanly.
  const r0 = rMin - 0.1;
  const tooth = makePolygon([[r0, 0, z0 - base / 2], [rMaj, 0, z0 - tip / 2], [rMaj, 0, z0 + tip / 2], [r0, 0, z0 + base / 2]]).outerWire();
  const ridge = genericSweep(tooth as never, makeHelix(P, length - base, r0, [0, 0, z0]), { frenet: true }) as Shape3D;
  // Ridge first: cutting it after the core silently fails in OCC (it would only touch the
  // already removed core), cutting it first works.
  return makeCompound([ridge, makeCylinder(rMin, length)]) as Shape3D;
}

export const EXTRA_BUILDERS: Record<string, (p: Record<string, number>) => Shape3D> = {
  thread: ({ diameter, pitch, length }) => thread(diameter, pitch, length),
  // Inner thread: subtract it from a part; it pokes 0.5 mm out on both ends for a clean cut.
  threadhole: ({ diameter, pitch, length }) => thread(diameter, pitch, length + 1, 0.3).translateZ(-0.5),
  capsule: ({ diameter, height }) => {
    const r = diameter / 2;
    const mid = Math.max(0.01, height - diameter);
    return makeCylinder(r, mid).translateZ(r).fuse(makeSphere(r).translateZ(r)).fuse(makeSphere(r).translateZ(r + mid));
  },
  ellipsoid: ({ diameter, height }) => {
    const r = diameter / 2, h = height / 2;
    // Right half of the ellipse, revolved.
    const half = drawEllipse(r, h).cut(drawRectangle(2 * r + 2, 2 * h + 2).translate(-(r + 1), 0));
    return revolve(half).translateZ(h);
  },
  star: ({ diameter, inner, points, height }) => {
    const n = Math.max(3, Math.round(points));
    const R = diameter / 2, ri = Math.min(inner, diameter - 0.2) / 2;
    const pts: [number, number][] = [];
    for (let i = 0; i < n * 2; i++) {
      const a = Math.PI / 2 + (i * Math.PI) / n;
      const rr = i % 2 ? ri : R;
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    let pen = draw(pts[0]);
    for (const p of pts.slice(1)) pen = pen.lineTo(p);
    return extrude(pen.close(), height);
  },
  roundedbox: ({ width, depth, height, radius }) => {
    const r = Math.max(0.1, Math.min(radius, Math.min(width, depth, height) / 2 - 0.05));
    return makeBaseBox(width, depth, height).fillet(r);
  },
  gear: ({ module, teeth, height, bore }) => {
    // Simplified spur gear: trapezoid teeth on the root circle (good enough to print and mesh).
    const z = Math.max(6, Math.round(teeth));
    const rp = (module * z) / 2, ra = rp + module, rf = Math.max(0.5, rp - 1.25 * module);
    const pts: [number, number][] = [];
    const step = (2 * Math.PI) / z;
    for (let i = 0; i < z; i++) {
      const a = i * step;
      const at = (r: number, t: number): [number, number] => [Math.cos(a + t * step) * r, Math.sin(a + t * step) * r];
      pts.push(at(rf, 0), at(rf, 0.15), at(ra, 0.32), at(ra, 0.53), at(rf, 0.7));
    }
    let pen = draw(pts[0]);
    for (const p of pts.slice(1)) pen = pen.lineTo(p);
    let profile: Drawing = pen.close();
    if (bore > 0) profile = profile.cut(drawCircle(Math.min(bore, rf * 1.6) / 2));
    return extrude(profile, height);
  },
  countersink: ({ diameter, length, headDiameter }) => {
    // Screw hole tool with a 90° countersink at the top (subtract it from a part).
    const hd = Math.max(headDiameter, diameter + 0.4);
    const sink = (hd - diameter) / 2;
    const profile = draw([0, 0]).lineTo([diameter / 2, 0]).lineTo([diameter / 2, length - sink]).lineTo([hd / 2, length]).lineTo([0, length]).close();
    return revolve(profile);
  },
  hook: ({ width, height, thickness, depth }) => {
    // J-hook in the XZ plane: a back plate, a curved bottom and a short tip.
    const t = thickness, w = Math.max(width, 3 * t), r = w / 2;
    const outer = draw([-r, height])
      .lineTo([-r, r])
      .threePointsArcTo([r, r], [0, 0])
      .lineTo([r, r + Math.min(height * 0.35, 2 * r)])
      .lineTo([r - t, r + Math.min(height * 0.35, 2 * r)])
      .lineTo([r - t, r])
      .threePointsArcTo([-r + t, r], [0, t])
      .lineTo([-r + t, height])
      .close();
    return sideExtrude(outer, depth);
  },
  pin: ({ diameter, length, headDiameter, headHeight }) =>
    makeCylinder(headDiameter / 2, headHeight).fuse(makeCylinder(diameter / 2, length).translateZ(headHeight)),
  clip: ({ width, height, thickness, depth }) => {
    // U-shaped snap clip with inward lips at the top.
    const t = thickness, w = width / 2, lip = Math.min(t, w * 0.4);
    const p = draw([-w, 0])
      .lineTo([w, 0])
      .lineTo([w, height])
      .lineTo([w - t - lip, height - lip * 0.6])
      .lineTo([w - t, height - lip * 1.6])
      .lineTo([w - t, t])
      .lineTo([-w + t, t])
      .lineTo([-w + t, height - lip * 1.6])
      .lineTo([-w + t + lip, height - lip * 0.6])
      .lineTo([-w, height])
      .close();
    return sideExtrude(p, depth);
  },
  heart: ({ size, height }) => {
    const s = size / 2;
    const p = draw([0, -s])
      .cubicBezierCurveTo([-s, s * 0.25], [-s * 0.15, -s * 0.55], [-s, -s * 0.2])
      .cubicBezierCurveTo([0, s * 0.45], [-s, s * 0.85], [-s * 0.15, s * 0.95])
      .cubicBezierCurveTo([s, s * 0.25], [s * 0.15, s * 0.95], [s, s * 0.85])
      .cubicBezierCurveTo([0, -s], [s, -s * 0.2], [s * 0.15, -s * 0.55])
      .close();
    return extrude(p, height);
  },
  arrow: ({ length, width, height }) => {
    const L = length / 2, w = width / 2, shaft = w * 0.45, head = Math.min(length * 0.4, width * 1.2);
    const p = draw([-L, -shaft]).lineTo([L - head, -shaft]).lineTo([L - head, -w]).lineTo([L, 0]).lineTo([L - head, w]).lineTo([L - head, shaft]).lineTo([-L, shaft]).close();
    return extrude(p, height);
  },
  knob: ({ diameter, height }) => {
    const r = diameter / 2, dome = Math.min(r * 0.5, height * 0.4);
    const p = draw([0, 0]).lineTo([r * 0.92, 0]).lineTo([r, height * 0.15]).lineTo([r, height - dome]).threePointsArcTo([0, height], [r * 0.72, height - dome * 0.3]).close();
    const body = revolve(p);
    // Grip ribs around the side.
    const ribs = Math.max(8, Math.round(diameter * 0.6));
    let grip = body;
    for (let i = 0; i < ribs; i++) {
      const a = (i / ribs) * Math.PI * 2;
      grip = grip.cut(makeCylinder(diameter * 0.04, height).translate(Math.cos(a) * r, Math.sin(a) * r, height * 0.18));
    }
    return grip;
  },
  handle: ({ length, height, thickness, depth }) => {
    // Bow handle: two feet and an arch, profile in XZ.
    const L = length / 2, t = thickness;
    const p = draw([-L, 0])
      .lineTo([-L + t * 1.6, 0])
      .lineTo([-L + t * 1.6, height - t * 1.6])
      .threePointsArcTo([L - t * 1.6, height - t * 1.6], [0, height - t])
      .lineTo([L - t * 1.6, 0])
      .lineTo([L, 0])
      .lineTo([L, height - t])
      .threePointsArcTo([-L, height - t], [0, height])
      .close();
    return sideExtrude(p, depth);
  },
  vase: ({ diameter, height, wall }) => {
    const r = diameter / 2, w = Math.max(0.8, wall);
    const outer = draw([0, 0]).lineTo([r * 0.6, 0]).cubicBezierCurveTo([r * 0.55, height], [r * 1.3, height * 0.35], [r * 0.2, height * 0.75]).lineTo([0, height]).close();
    const inner = draw([0, w]).lineTo([r * 0.6 - w, w]).cubicBezierCurveTo([r * 0.55 - w, height + 1], [r * 1.3 - w, height * 0.35], [r * 0.2 - w, height * 0.75]).lineTo([0, height + 1]).close();
    return revolve(outer).cut(revolve(inner));
  },
  bowl: ({ diameter, height, wall }) => {
    const r = diameter / 2, w = Math.max(0.8, wall);
    const outer = draw([0, 0]).lineTo([r * 0.45, 0]).cubicBezierCurveTo([r, height], [r * 0.85, 0], [r, height * 0.55]).lineTo([0, height]).close();
    const inner = draw([0, w]).lineTo([r * 0.45 - w, w]).cubicBezierCurveTo([r - w, height + 1], [r * 0.85 - w, w], [r - w, height * 0.55]).lineTo([0, height + 1]).close();
    return revolve(outer).cut(revolve(inner));
  },
  honeycomb: ({ width, depth, height, cell, wall }) => {
    const r = cell / 2, c = Math.max(4, cell + wall);
    let plate: Drawing = drawRoundedRectangle(width, depth, Math.min(3, width / 4, depth / 4));
    const dx = c * Math.sqrt(3) / 2, dy = c;
    for (let i = -Math.floor(width / dx / 2) + 1; i <= Math.floor(width / dx / 2) - 1; i++)
      for (let j = -Math.floor(depth / dy / 2); j <= Math.floor(depth / dy / 2); j++) {
        const x = i * dx, y = j * dy + (i % 2 ? dy / 2 : 0);
        if (Math.abs(x) + r > width / 2 - wall || Math.abs(y) + r > depth / 2 - wall) continue;
        plate = plate.cut(drawPolysides(r, 6).translate(x, y));
      }
    return extrude(plate, height);
  },
  slotted: ({ width, depth, height, slots, slotWidth }) => {
    const n = Math.max(1, Math.round(slots));
    let plate: Drawing = drawRoundedRectangle(width, depth, Math.min(3, width / 4, depth / 4));
    const pitch = width / (n + 1), len = depth * 0.6;
    for (let i = 1; i <= n; i++) plate = plate.cut(drawRoundedRectangle(slotWidth, len, slotWidth / 2 - 0.01).translate(-width / 2 + i * pitch, 0));
    return extrude(plate, height);
  },
};

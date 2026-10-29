// File import helpers (pure, testable): 3MF → binary STL per object, SVG → sketch shapes.
import { unzipSync, strFromU8 } from "fflate";
import type { PathSegment, SketchShape } from "./document";

/** Binary STL from vertex and triangle index arrays. */
export function toBinaryStl(vertices: number[], triangles: number[]): Uint8Array {
  const n = triangles.length / 3;
  const buf = new ArrayBuffer(84 + n * 50);
  const view = new DataView(buf);
  view.setUint32(80, n, true);
  let o = 84;
  for (let t = 0; t < triangles.length; t += 3) {
    const [a, b, c] = [triangles[t] * 3, triangles[t + 1] * 3, triangles[t + 2] * 3];
    const u = [vertices[b] - vertices[a], vertices[b + 1] - vertices[a + 1], vertices[b + 2] - vertices[a + 2]];
    const w = [vertices[c] - vertices[a], vertices[c + 1] - vertices[a + 1], vertices[c + 2] - vertices[a + 2]];
    const nrm = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const len = Math.hypot(...nrm) || 1;
    for (const v of nrm) { view.setFloat32(o, v / len, true); o += 4; }
    for (const i of [a, b, c]) for (let k = 0; k < 3; k++) { view.setFloat32(o, vertices[i + k], true); o += 4; }
    o += 2;
  }
  return new Uint8Array(buf);
}

/** Each mesh object of a 3MF file as a binary STL (millimetres; unit attribute respected). */
export function threeMfObjects(data: Uint8Array): { name: string; stl: Uint8Array }[] {
  const files = unzipSync(data);
  const modelKey = Object.keys(files).find((k) => /3dmodel\.model$/i.test(k)) ?? Object.keys(files).find((k) => k.endsWith(".model"));
  if (!modelKey) throw new Error("Keine 3MF-Modelldatei gefunden.");
  const xml = strFromU8(files[modelKey]);
  const unit = /<model[^>]*unit="(\w+)"/.exec(xml)?.[1] ?? "millimeter";
  const scale = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 }[unit] ?? 1;
  const out: { name: string; stl: Uint8Array }[] = [];
  const objRe = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
  for (let m; (m = objRe.exec(xml)); ) {
    const name = /name="([^"]*)"/.exec(m[1])?.[1] ?? `Objekt ${out.length + 1}`;
    const body = m[2];
    if (!/<mesh/.test(body)) continue;
    const vertices: number[] = [];
    const triangles: number[] = [];
    for (const v of body.matchAll(/<vertex\b[^>]*x="([^"]+)"[^>]*y="([^"]+)"[^>]*z="([^"]+)"/g)) vertices.push(+v[1] * scale, +v[2] * scale, +v[3] * scale);
    for (const t of body.matchAll(/<triangle\b[^>]*v1="(\d+)"[^>]*v2="(\d+)"[^>]*v3="(\d+)"/g)) triangles.push(+t[1], +t[2], +t[3]);
    if (triangles.length) out.push({ name, stl: toBinaryStl(vertices, triangles) });
  }
  if (!out.length) throw new Error("Die 3MF-Datei enthält keine Netze.");
  return out;
}

// ── SVG ──────────────────────────────────────────────────────────────────────

type P = [number, number];

/** Parses an SVG into closed sketch shapes in mm (Y up, centred on the origin). Curves stay curves. */
export function svgToShapes(text: string): SketchShape[] {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const svg = doc.querySelector("svg");
  if (!svg) throw new Error("Keine gültige SVG-Datei.");
  const vb = (svg.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
  const widthAttr = svg.getAttribute("width") ?? "";
  // mm per user unit: from a physical width when given, else 96 dpi pixels.
  const physical = /([\d.]+)\s*(mm|cm|in|pt)/.exec(widthAttr);
  const unitMm = physical ? +physical[1] * ({ mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72 } as Record<string, number>)[physical[2]] : null;
  const k = unitMm && vb.length === 4 && vb[2] > 0 ? unitMm / vb[2] : 25.4 / 96;
  const tp = ([x, y]: P): P => [x * k, -y * k];
  const shapes: SketchShape[] = [];
  const num = (el: Element, a: string) => parseFloat(el.getAttribute(a) ?? "0") || 0;

  for (const el of Array.from(svg.querySelectorAll("path, rect, circle, ellipse, polygon, polyline"))) {
    const tag = el.tagName.toLowerCase();
    if (tag === "rect") {
      const [x, y] = tp([num(el, "x"), num(el, "y") + num(el, "height")]);
      const w = num(el, "width") * k, h = num(el, "height") * k, r = Math.max(num(el, "rx"), num(el, "ry")) * k;
      shapes.push(r > 0 ? { kind: "rrect", x, y, w, h, r } : { kind: "rect", x, y, w, h });
    } else if (tag === "circle") {
      const [cx, cy] = tp([num(el, "cx"), num(el, "cy")]);
      shapes.push({ kind: "circle", cx, cy, r: num(el, "r") * k });
    } else if (tag === "ellipse") {
      const [cx, cy] = tp([num(el, "cx"), num(el, "cy")]);
      shapes.push({ kind: "ellipse", cx, cy, rx: num(el, "rx") * k, ry: num(el, "ry") * k });
    } else if (tag === "polygon" || tag === "polyline") {
      const v = (el.getAttribute("points") ?? "").trim().split(/[\s,]+/).map(Number);
      const pts: P[] = [];
      for (let i = 0; i + 1 < v.length; i += 2) pts.push(tp([v[i], v[i + 1]]));
      if (pts.length >= 3) shapes.push({ kind: "poly", points: pts, closed: tag === "polygon" });
    } else {
      shapes.push(...pathToShapes(el.getAttribute("d") ?? "", tp));
    }
  }
  if (!shapes.length) throw new Error("In der SVG wurden keine Formen gefunden.");
  return centre(shapes);
}

/** SVG path data → path shapes (one per subpath). Béziers and arcs become smooth splines. */
export function pathToShapes(d: string, tp: (p: P) => P): SketchShape[] {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  const out: SketchShape[] = [];
  let i = 0, cmd = "", cur: P = [0, 0], start: P = [0, 0], lastCtrl: P | null = null;
  let segs: PathSegment[] = [];
  let startT: P | null = null;
  const nextNum = () => parseFloat(tokens[i++]);
  const flush = (closed: boolean) => {
    if (startT && segs.length >= (closed ? 2 : 1)) out.push({ kind: "path", start: startT, segments: segs, closed });
    segs = [];
    startT = null;
  };
  const lineTo = (p: P) => { segs.push({ type: "line", to: tp(p) }); cur = p; };
  const curveTo = (pts: P[]) => { for (const p of pts) segs.push({ type: "spline", to: tp(p) }); cur = pts[pts.length - 1]; };
  const bez = (p0: P, c1: P, c2: P, p3: P): P[] => [1 / 3, 2 / 3, 1].map((t) => {
    const u = 1 - t;
    return [0, 1].map((j) => u ** 3 * p0[j] + 3 * u * u * t * c1[j] + 3 * u * t * t * c2[j] + t ** 3 * p3[j]) as P;
  });
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const at = (x: number, y: number): P => (rel ? [cur[0] + x, cur[1] + y] : [x, y]);
    switch (cmd.toUpperCase()) {
      case "M": {
        flush(false);
        const p = at(nextNum(), nextNum());
        cur = start = p;
        startT = tp(p);
        cmd = rel ? "l" : "L"; // further pairs are lines
        break;
      }
      case "L": lineTo(at(nextNum(), nextNum())); lastCtrl = null; break;
      case "H": { const x = nextNum(); lineTo([rel ? cur[0] + x : x, cur[1]]); lastCtrl = null; break; }
      case "V": { const y = nextNum(); lineTo([cur[0], rel ? cur[1] + y : y]); lastCtrl = null; break; }
      case "C": { const c1 = at(nextNum(), nextNum()), c2 = at(nextNum(), nextNum()), p = at(nextNum(), nextNum()); curveTo(bez(cur, c1, c2, p)); lastCtrl = c2; break; }
      case "S": {
        const c1: P = lastCtrl ? [2 * cur[0] - lastCtrl[0], 2 * cur[1] - lastCtrl[1]] : cur;
        const c2 = at(nextNum(), nextNum()), p = at(nextNum(), nextNum());
        curveTo(bez(cur, c1, c2, p)); lastCtrl = c2; break;
      }
      case "Q": case "T": {
        const q: P = cmd.toUpperCase() === "Q" ? at(nextNum(), nextNum()) : lastCtrl ? [2 * cur[0] - lastCtrl[0], 2 * cur[1] - lastCtrl[1]] : cur;
        const p = at(nextNum(), nextNum());
        curveTo(bez(cur, [cur[0] + (2 / 3) * (q[0] - cur[0]), cur[1] + (2 / 3) * (q[1] - cur[1])], [p[0] + (2 / 3) * (q[0] - p[0]), p[1] + (2 / 3) * (q[1] - p[1])], p));
        lastCtrl = q; break;
      }
      case "A": {
        i += 5; // rx ry rotation large-arc sweep: approximated by a smooth curve through the midpoint
        const p = at(nextNum(), nextNum());
        curveTo([[(cur[0] + p[0]) / 2, (cur[1] + p[1]) / 2], p]);
        lastCtrl = null; break;
      }
      case "Z":
        if (Math.hypot(cur[0] - start[0], cur[1] - start[1]) > 1e-9) lineTo(start);
        flush(true);
        cur = start;
        break;
      default:
        i++;
    }
  }
  flush(false);
  return out.filter((s) => s.kind === "path" && s.closed);
}

function centre(shapes: SketchShape[]): SketchShape[] {
  // Lazy import avoided: compute bounds from the shapes' own coordinates.
  const xs: number[] = [], ys: number[] = [];
  const add = ([x, y]: P) => { xs.push(x); ys.push(y); };
  for (const s of shapes) {
    if (s.kind === "path") { add(s.start); s.segments.forEach((g) => add(g.to)); }
    else if (s.kind === "poly") s.points.forEach(add);
    else if (s.kind === "rect" || s.kind === "rrect") { add([s.x, s.y]); add([s.x + s.w, s.y + s.h]); }
    else if (s.kind === "circle") { add([s.cx - s.r, s.cy - s.r]); add([s.cx + s.r, s.cy + s.r]); }
    else if (s.kind === "ellipse") { add([s.cx - s.rx, s.cy - s.ry]); add([s.cx + s.rx, s.cy + s.ry]); }
  }
  const dx = -(Math.min(...xs) + Math.max(...xs)) / 2, dy = -(Math.min(...ys) + Math.max(...ys)) / 2;
  const m = ([x, y]: P): P => [Math.round((x + dx) * 1000) / 1000, Math.round((y + dy) * 1000) / 1000];
  return shapes.map((s) => {
    switch (s.kind) {
      case "path": return { ...s, start: m(s.start), segments: s.segments.map((g) => (g.type === "arc" ? { ...g, to: m(g.to), via: m(g.via) } : { ...g, to: m(g.to) })) };
      case "poly": return { ...s, points: s.points.map(m) };
      case "rect": case "rrect": { const [x, y] = m([s.x, s.y]); return { ...s, x, y }; }
      case "circle": case "ellipse": case "polygon": case "slot": { const [cx, cy] = m([s.cx, s.cy]); return { ...s, cx, cy }; }
    }
  });
}

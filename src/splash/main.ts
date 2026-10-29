// Boot splash: a cube is "printed" layer by layer under a glowing mint layer line,
// then its edges resolve and the wordmark fades in. Plain SVG + rAF, no 3D engine.
import "./splash.css";
import pkg from "../../package.json";

const W = 640, H = 400;
const CX = 320, BASE = 214; // front-bottom corner of the cube
const S = 92; // edge length in px
const DX = S * Math.cos(Math.PI / 6), DY = S * Math.sin(Math.PI / 6);
const HEIGHT = S;
const PRINT_MS = 1500, EDGES_MS = 380;

type P = [number, number];
const front = (h: number): P => [CX, BASE - h];
const right = (h: number): P => [CX + DX, BASE - DY - h];
const back = (h: number): P => [CX, BASE - 2 * DY - h];
const left = (h: number): P => [CX - DX, BASE - DY - h];
const pts = (...p: P[]) => p.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");

const root = document.getElementById("splash")!;
root.innerHTML = `
<div class="card" id="card">
  <svg viewBox="0 0 ${W} ${H}">
    <defs>
      <linearGradient id="top" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a5adb3"/><stop offset="1" stop-color="#8d959c"/></linearGradient>
      <linearGradient id="lf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6f777e"/><stop offset="1" stop-color="#5a6268"/></linearGradient>
      <linearGradient id="rt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4b5258"/><stop offset="1" stop-color="#3b4146"/></linearGradient>
      <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <radialGradient id="shadow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#000" stop-opacity="0.45"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    </defs>
    <g id="grid" opacity="0.5"></g>
    <ellipse cx="${CX}" cy="${BASE - DY + 4}" rx="${DX * 1.35}" ry="${DY * 1.25}" fill="url(#shadow)"/>
    <polygon id="left" fill="url(#lf)"/>
    <polygon id="right" fill="url(#rt)"/>
    <polygon id="topf" fill="url(#top)"/>
    <polyline id="layerBack" fill="none" stroke="#6ee7c5" stroke-opacity="0.35" stroke-width="1.2"/>
    <polyline id="layer" fill="none" stroke="#6ee7c5" stroke-width="1.8" filter="url(#glow)"/>
    <g id="edges" fill="none" stroke="#6ee7c5" stroke-width="1.3" stroke-linejoin="round" opacity="0"></g>
  </svg>
  <div class="word" id="word">Albedo<span class="tagline">CAD für den 3D-Druck</span></div>
  <div class="meta"><span id="status">Starte …</span><span>Version ${pkg.version}</span></div>
  <div class="progress" id="progress"></div>
</div>`;

// Faint isometric bed grid under the cube, fading out towards the edges.
const grid = document.getElementById("grid")!;
const lines: string[] = [];
const u: P = [Math.cos(Math.PI / 6), -Math.sin(Math.PI / 6)]; // along the right edge
const v: P = [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)]; // along the left edge
const C: P = [CX, BASE - DY];
const STEP = 23, L = 360;
for (let k = -9; k <= 9; k++) {
  for (const [a, b] of [[u, v], [v, u]] as [P, P][]) {
    const p: P = [C[0] + b[0] * k * STEP, C[1] + b[1] * k * STEP];
    lines.push(`<line x1="${p[0] - a[0] * L}" y1="${p[1] - a[1] * L}" x2="${p[0] + a[0] * L}" y2="${p[1] + a[1] * L}"/>`);
  }
}
grid.innerHTML = `<defs><radialGradient id="gridFade" cx="${CX}" cy="${C[1]}" r="230" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient><mask id="gridMask"><rect width="${W}" height="${H}" fill="url(#gridFade)"/></mask></defs><g mask="url(#gridMask)" stroke="#2c353a" stroke-width="1">${lines.join("")}</g>`;

const $ = (id: string) => document.getElementById(id)!;
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

function draw(h: number, edges: number) {
  $("left").setAttribute("points", pts(left(0), front(0), front(h), left(h)));
  $("right").setAttribute("points", pts(front(0), right(0), right(h), front(h)));
  $("topf").setAttribute("points", pts(front(h), right(h), back(h), left(h)));
  const printing = h < HEIGHT - 0.01;
  $("layer").setAttribute("points", printing ? pts(left(h), front(h), right(h)) : "");
  $("layerBack").setAttribute("points", printing ? pts(right(h), back(h), left(h)) : "");
  const e = $("edges");
  e.setAttribute("opacity", String(edges * 0.85));
  if (edges > 0 && !e.innerHTML)
    e.innerHTML = `<polygon points="${pts(front(HEIGHT), right(HEIGHT), back(HEIGHT), left(HEIGHT))}"/>
      <polyline points="${pts(left(HEIGHT), left(0), front(0), right(0), right(HEIGHT))}"/>
      <line x1="${front(0)[0]}" y1="${front(0)[1]}" x2="${front(HEIGHT)[0]}" y2="${front(HEIGHT)[1]}"/>`;
}

// Debug / frame export: ?t=0.8 renders a frozen frame at 0.8 s.
const frozen = new URLSearchParams(location.search).get("t");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
let speed = 1;
let elapsed = 0;
let last = performance.now();
let done = false;

function frame(t: number) {
  const p = Math.min(1, t / PRINT_MS);
  const e = Math.min(1, Math.max(0, (t - PRINT_MS) / EDGES_MS));
  draw(HEIGHT * ease(p), ease(e));
  if (t > PRINT_MS + 120) $("word").classList.add("in");
  return t >= PRINT_MS + EDGES_MS;
}

if (frozen !== null) {
  frame(Number(frozen) * 1000);
} else if (reduced) {
  frame(PRINT_MS + EDGES_MS);
  done = true;
} else {
  const tick = (now: number) => {
    elapsed += (now - last) * speed;
    last = now;
    done = frame(elapsed);
    if (!done) requestAnimationFrame(tick);
    else maybeFinish();
  };
  requestAnimationFrame(tick);
}

// Startup progress from the main window (forwarded by the Rust side).
const STEPS: Record<string, [number, string]> = {
  ui: [0.45, "Oberfläche geladen"],
  kernel: [0.9, "CAD-Kern bereit"],
  ready: [1, "Bereit"],
};
let ready = false;
async function maybeFinish() {
  if (!ready || !done || frozen !== null) return;
  $("card").classList.add("out");
  setTimeout(async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    void invoke("splash_finished");
  }, 240);
}

if ("__TAURI_INTERNALS__" in window && frozen === null) {
  void import("@tauri-apps/api/event").then(({ listen }) => {
    void listen<string>("boot-progress", ({ payload }) => {
      const step = STEPS[payload];
      if (!step) return;
      $("progress").style.width = `${step[0] * 100}%`;
      $("status").textContent = step[1];
      if (payload === "ready") {
        ready = true;
        speed = 3; // finish the remaining animation quickly once the app is ready
        void maybeFinish();
      }
    });
  });
}

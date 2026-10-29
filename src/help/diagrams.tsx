// Small illustrative SVG diagrams for help topics where a screenshot doesn't fit.
const MINT = "#6ee7c5";
const LINE = "#3a454c";
const TEXT = "#a1aab2";

function Navigation() {
  const card = (x: number, title: string, lines: [string, string][]) => (
    <g transform={`translate(${x} 20)`}>
      <rect width="250" height="170" rx="14" fill="#1b2024" stroke={LINE} />
      <text x="20" y="32" fill="#e7ebee" fontSize="15" fontWeight="600">{title}</text>
      {lines.map(([a, b], i) => (
        <g key={i} transform={`translate(20 ${62 + i * 36})`}>
          <rect width="96" height="24" rx="6" fill="rgba(110,231,197,0.12)" stroke="rgba(110,231,197,0.3)" />
          <text x="48" y="16" textAnchor="middle" fill={MINT} fontSize="12">{a}</text>
          <text x="110" y="16" fill={TEXT} fontSize="13">{b}</text>
        </g>
      ))}
    </g>
  );
  return (
    <svg viewBox="0 0 560 210">
      {card(20, "Maus", [["Links ziehen", "Drehen"], ["Rechts ziehen", "Verschieben"], ["Mausrad", "Zoomen"]])}
      {card(290, "Trackpad", [["1 Finger ziehen", "Drehen"], ["2 Finger klicken", "Verschieben"], ["2 Finger wischen", "Zoomen"]])}
    </svg>
  );
}

function Extrude() {
  // Iso projection helpers
  const iso = (x: number, y: number, z: number) => [280 + (x - y) * 0.87, 150 + (x + y) * 0.5 - z] as const;
  const poly = (pts: (readonly [number, number])[]) => pts.map((p) => p.join(",")).join(" ");
  const base = [iso(-60, -40, 0), iso(60, -40, 0), iso(60, 40, 0), iso(-60, 40, 0)];
  const top = [iso(-60, -40, 60), iso(60, -40, 60), iso(60, 40, 60), iso(-60, 40, 60)];
  return (
    <svg viewBox="0 0 560 230">
      <polygon points={poly(base)} fill="rgba(110,231,197,0.1)" stroke={MINT} strokeWidth="2" />
      <polygon points={poly([base[0], base[3], top[3], top[0]])} fill="#5b636a" opacity="0.85" />
      <polygon points={poly([base[3], base[2], top[2], top[3]])} fill="#444b51" opacity="0.85" />
      <polygon points={poly(top)} fill="#8d959c" stroke={MINT} strokeWidth="1.5" />
      <line x1={iso(60, 40, 0)[0] + 40} y1={iso(60, 40, 0)[1]} x2={iso(60, 40, 60)[0] + 40} y2={iso(60, 40, 60)[1]} stroke={MINT} strokeWidth="2" markerEnd="url(#arr)" />
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill={MINT} />
        </marker>
      </defs>
      <text x={iso(60, 40, 30)[0] + 52} y={iso(60, 40, 30)[1] + 4} fill={MINT} fontSize="14">Höhe</text>
      <text x="40" y="210" fill={TEXT} fontSize="13">Skizze (mint) → Höhe im Inspektor → Körper</text>
    </svg>
  );
}

function Boolean() {
  const pair = (x: number, label: string, mode: "union" | "subtract" | "intersect") => (
    <g transform={`translate(${x} 20)`}>
      <defs>
        <clipPath id={`c-${mode}`}><circle cx="95" cy="70" r="45" /></clipPath>
        <mask id={`m-${mode}`}><rect width="170" height="140" fill="#fff" /><circle cx="95" cy="70" r="45" fill="#000" /></mask>
      </defs>
      {mode === "union" && (
        <>
          <rect x="25" y="30" width="80" height="80" rx="6" fill="#8d959c" />
          <circle cx="95" cy="70" r="45" fill="#8d959c" />
        </>
      )}
      {mode === "subtract" && (
        <>
          <rect x="25" y="30" width="80" height="80" rx="6" fill="#8d959c" mask={`url(#m-${mode})`} />
          <circle cx="95" cy="70" r="45" fill="none" stroke={MINT} strokeDasharray="4 4" />
        </>
      )}
      {mode === "intersect" && (
        <>
          <rect x="25" y="30" width="80" height="80" rx="6" fill="none" stroke={LINE} />
          <circle cx="95" cy="70" r="45" fill="none" stroke={LINE} />
          <rect x="25" y="30" width="80" height="80" rx="6" fill="#8d959c" clipPath={`url(#c-${mode})`} />
        </>
      )}
      <text x="85" y="150" textAnchor="middle" fill={TEXT} fontSize="14">{label}</text>
    </g>
  );
  return (
    <svg viewBox="0 0 560 190">
      {pair(10, "Vereinen", "union")}
      {pair(195, "Abziehen", "subtract")}
      {pair(380, "Schnittmenge", "intersect")}
    </svg>
  );
}

export function Diagram({ id }: { id: string }) {
  if (id === "navigation") return <Navigation />;
  if (id === "extrude") return <Extrude />;
  if (id === "boolean") return <Boolean />;
  return null;
}

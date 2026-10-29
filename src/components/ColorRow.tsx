// "Farbe": filament-like swatches, recent custom colours and a custom picker (hex).
// Applies to every selected object as one history entry; the pick becomes the colour
// for new objects too.
import { useState } from "react";
import { execute } from "../core/commands";
import { useSettings } from "../ui/settings";

export const SWATCHES: { hex: string; name: string }[] = [
  { hex: "#f2f1ec", name: "Weiß" },
  { hex: "#2a2c2f", name: "Schwarz" },
  { hex: "#8d959b", name: "Grau" },
  { hex: "#d8443b", name: "Rot" },
  { hex: "#f08a2c", name: "Orange" },
  { hex: "#f2c531", name: "Gelb" },
  { hex: "#3e9f4f", name: "Grün" },
  { hex: "#6ee7c5", name: "Mint" },
  { hex: "#2f6fd6", name: "Blau" },
  { hex: "#7c55c9", name: "Lila" },
  { hex: "#e46aa6", name: "Pink" },
  { hex: "#d7e2e3", name: "Natur (PETG)" },
];

/** Applies a colour to objects and remembers it for new ones. */
export function applyColor(ids: string[], hex: string | null) {
  void execute("object.setColor", { ids, color: hex ?? "" });
  useSettings.setState((s) => ({
    lastColor: hex,
    recentColors: hex && !SWATCHES.some((w) => w.hex === hex) ? [hex, ...s.recentColors.filter((c) => c !== hex)].slice(0, 6) : s.recentColors,
  }));
}

export function ColorSwatches({ ids, current, onPicked }: { ids: string[]; current?: string; onPicked?: () => void }) {
  const recent = useSettings((s) => s.recentColors);
  const pick = (hex: string | null) => {
    applyColor(ids, hex);
    onPicked?.();
  };
  return (
    <div className="swatches">
      <button className={`swatch none ${!current ? "on" : ""}`} data-tip="Neutral" data-tip-pos="top" onClick={() => pick(null)} />
      {SWATCHES.map((w) => (
        <button key={w.hex} className={`swatch ${current === w.hex ? "on" : ""}`} style={{ background: w.hex }} data-tip={w.name} data-tip-pos="top" onClick={() => pick(w.hex)} />
      ))}
      {recent.map((hex) => (
        <button key={hex} className={`swatch ${current === hex ? "on" : ""}`} style={{ background: hex }} data-tip={hex} data-tip-pos="top" onClick={() => pick(hex)} />
      ))}
    </div>
  );
}

export function ColorRow({ ids, current }: { ids: string[]; current?: string }) {
  const [hex, setHex] = useState(current ?? "");
  const valid = /^#[0-9a-f]{6}$/i.test(hex);
  return (
    <div className="group color-row">
      <div className="group-label"><span>Farbe</span></div>
      <ColorSwatches ids={ids} current={current} />
      <div className="color-custom">
        <label className="color-well" style={{ background: valid ? hex : current ?? "#99a1a8" }} data-tip="Eigene Farbe" data-tip-pos="top">
          <input type="color" value={valid ? hex : current ?? "#99a1a8"} onChange={(e) => setHex(e.target.value)} onBlur={(e) => applyColor(ids, e.target.value.toLowerCase())} />
        </label>
        <div className="field">
          <input
            value={hex}
            placeholder="#rrggbb"
            onChange={(e) => setHex(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && valid) applyColor(ids, hex.toLowerCase());
            }}
            onBlur={() => valid && hex.toLowerCase() !== current && applyColor(ids, hex.toLowerCase())}
          />
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef } from "react";
import { setCaptureViewport } from "../ai/agent";
import { useFrame, useThree } from "@react-three/fiber";
import { execute } from "../core/commands";
import { useApp } from "../core/store";
import { usePreview, type PreviewBackground } from "../ui/preview";
import { Icon } from "../ui/icons";
import { SegmentedControl } from "../ui/SegmentedControl";

const BGS: { id: PreviewBackground; label: string }[] = [
  { id: "dark", label: "Dunkel" },
  { id: "studio", label: "Studio" },
  { id: "light", label: "Hell" },
];

/** Floating controls of the Vorschau workspace. */
export function PreviewControls() {
  const p = usePreview();
  return (
    <div className="toolbar preview-bar">
      <div className="toolbar-set">
        <button className={`tool ${p.turntable ? "active" : ""}`} onClick={() => usePreview.setState({ turntable: !p.turntable })} data-tip="Langsam drehen" data-tip-pos="top">
          <Icon name="turntable" size={18} />Drehteller
        </button>
        <div className="tool-sep" />
        <SegmentedControl
          size="sm"
          className="bare"
          tipPos="top"
          value={p.background}
          onChange={(background) => usePreview.setState({ background })}
          options={BGS.map((b) => ({ value: b.id, label: b.label, icon: <span className={`bg-swatch ${b.id}`} /> }))}
        />
        <div className="tool-sep" />
        <button className="tool" onClick={() => execute("view.screenshot")} data-tip="Bild als PNG speichern" data-tip-pos="top">
          <Icon name="camera" size={18} />Bild speichern
        </button>
      </div>
    </div>
  );
}

/** Lets the AI agent grab a PNG of the viewport right after a frame is rendered. */
export function ViewportCapture() {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const pending = useRef<((v: string | null) => void)[]>([]);
  useEffect(() => {
    setCaptureViewport(
      () =>
        new Promise((resolve) => {
          pending.current.push(resolve);
          invalidate();
        }),
    );
  }, [invalidate]);
  useFrame(() => {
    if (!pending.current.length) return;
    const waiting = pending.current.splice(0);
    const src = gl.domElement;
    const scale = Math.min(1, 1024 / Math.max(src.width, src.height));
    const c = document.createElement("canvas");
    c.width = Math.round(src.width * scale);
    c.height = Math.round(src.height * scale);
    const ctx = c.getContext("2d")!;
    // The canvas is transparent over the viewport's CSS background.
    ctx.fillStyle = "#14181b";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(src, 0, 0, c.width, c.height);
    const data = c.toDataURL("image/png").split(",")[1] ?? null;
    waiting.forEach((r) => r(data));
  }, 3);
  return null;
}

/** Saves a PNG screenshot right after the next rendered frame. */
export function PreviewEffects() {
  const gl = useThree((s) => s.gl);

  useFrame(() => {
    const { captureAt } = usePreview.getState();
    if (!captureAt) return;
    usePreview.setState({ captureAt: 0 });
    // Read the frame we just rendered before the browser clears the buffer.
    gl.domElement.toBlob(async (blob) => {
      if (!blob) return;
      const { saveFile } = await import("../core/platform");
      const name = `${useApp.getState().nodes[useApp.getState().currentId].doc.name}.png`;
      const path = await saveFile(name, { name: "PNG-Bild", extensions: ["png"] }, new Uint8Array(await blob.arrayBuffer()));
      if (path) useApp.getState().toast("success", "Bild gespeichert");
    }, "image/png");
  }, 3);

  return null;
}

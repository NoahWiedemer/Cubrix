import { useEffect, useRef } from "react";
import { setCaptureViewport } from "../ai/agent";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { execute } from "../core/commands";
import { useApp } from "../core/store";
import { usePreview, type PreviewBackground } from "../ui/preview";
import { Icon } from "../ui/icons";

const BGS: { id: PreviewBackground; label: string }[] = [
  { id: "studio", label: "Studio" },
  { id: "dark", label: "Dunkel" },
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
        {BGS.map((b) => (
          <button key={b.id} className={`tool ${p.background === b.id ? "active" : ""}`} onClick={() => usePreview.setState({ background: b.id })}>
            <span className={`bg-swatch ${b.id}`} />
            {b.label}
          </button>
        ))}
        <div className="tool-sep" />
        <button className={`tool ${p.section ? "active" : ""}`} onClick={() => usePreview.setState({ section: !p.section })} data-tip="Schnittansicht: ins Innere schauen" data-tip-pos="top">
          <Icon name="section" size={18} />Schnitt
        </button>
        {p.section && (
          <label className="section-slider">
            <input type="range" min={0} max={120} step={0.5} value={p.sectionZ} onChange={(e) => usePreview.setState({ sectionZ: Number(e.target.value) })} />
            <span>{p.sectionZ.toLocaleString("de-DE")} mm</span>
          </label>
        )}
        <div className="tool-sep" />
        <button className="tool" onClick={() => execute("view.screenshot")} data-tip="Bild als PNG speichern" data-tip-pos="top">
          <Icon name="camera" size={18} />Bild speichern
        </button>
      </div>
    </div>
  );
}

/** Applies the section plane to all meshes and captures PNG screenshots after rendering. */
/** Lets the AI agent grab a PNG of the viewport right after a frame is rendered. */
export function ViewportCapture() {
  const gl = useThree((s) => s.gl);
  const pending = useRef<((v: string | null) => void)[]>([]);
  useEffect(() => {
    setCaptureViewport(() => new Promise((resolve) => pending.current.push(resolve)));
  }, []);
  useFrame(() => {
    if (!pending.current.length) return;
    const waiting = pending.current.splice(0);
    const src = gl.domElement;
    const scale = Math.min(1, 1024 / Math.max(src.width, src.height));
    const c = document.createElement("canvas");
    c.width = Math.round(src.width * scale);
    c.height = Math.round(src.height * scale);
    c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
    const data = c.toDataURL("image/png").split(",")[1] ?? null;
    waiting.forEach((r) => r(data));
  }, 3);
  return null;
}

export function PreviewEffects() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const preview = useApp((s) => s.workspace === "preview");
  const { section, sectionZ } = usePreview();

  useEffect(() => {
    gl.localClippingEnabled = true;
    // CAD Z is the scene's Y axis; keep everything below the cut.
    const planes = preview && section ? [new THREE.Plane(new THREE.Vector3(0, -1, 0), sectionZ)] : [];
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      const isFeatureLine = (o as THREE.LineSegments).isLineSegments && o.parent?.children.some((c) => c.layers.isEnabled(1));
      if (m && ((o as THREE.Mesh).layers?.isEnabled(1) || isFeatureLine)) {
        m.clippingPlanes = planes;
        m.clipShadows = true;
        m.side = planes.length ? THREE.DoubleSide : THREE.FrontSide;
        m.needsUpdate = true;
      }
    });
  });

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

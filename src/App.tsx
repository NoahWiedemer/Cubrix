import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { installShortcuts } from "./core/commands";
import { useApp } from "./core/store";
import { TopBar } from "./components/TopBar";
import { LeftRail } from "./components/LeftRail";
import { DockColumn } from "./components/Dock";
import { Viewport } from "./components/Viewport";
import { StatusBar } from "./components/StatusBar";
import { Toasts } from "./components/Toasts";
import { TooltipLayer } from "./ui/Tooltip";
import { ValuePopover } from "./components/ValuePopover";
import { RotatePopover } from "./components/RotatePopover";
import { ContextMenu } from "./components/ContextMenu";
import { HelpCenter } from "./help/HelpCenter";
import { useViewportFrame } from "./ui/viewportFrame";
import { Library } from "./components/Library";
import { SettingsDialog } from "./components/SettingsDialog";
import { ProviderDialog } from "./components/ProviderKeys";

/**
 * Sidebars slide out (width → 0, slight offset, fade) when entering Vorschau and back in
 * afterwards, in parallel with the camera tween, so the canvas grows smoothly instead
 * of jumping. Inner content keeps its natural width while the wrapper narrows.
 */
function SideSlide({ side, hidden, children }: { side: "left" | "right"; hidden: boolean; children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.offsetWidth));
    ro.observe(el);
    setWidth(el.offsetWidth);
    return () => ro.disconnect();
  }, []);
  return (
    <div className={`side-slide ${side} ${hidden ? "out" : ""}`} style={{ width: hidden ? 0 : (width ?? "auto") }} aria-hidden={hidden}>
      <div ref={inner} className="side-slide-inner">{children}</div>
    </div>
  );
}

/** Placeholder in the flex row: its rect is the free area the viewport is clipped to. */
function ViewportSlot() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    const main = el.parentElement!;
    const measure = () => {
      const m = main.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(main).paddingLeft) || 0;
      useViewportFrame.setState({ left: Math.round(r.left - m.left - pad), right: Math.round(m.right - r.right - pad) });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(main);
    measure();
    return () => ro.disconnect();
  }, []);
  return <div ref={ref} className="viewport-slot" />;
}

export function App() {
  const preview = useApp((s) => s.workspace === "preview");
  useEffect(() => installShortcuts(), []);

  // Keep the native window title in sync with the project name.
  const name = useApp((s) => s.nodes[s.currentId].doc.name);
  useEffect(() => {
    document.title = `${name} – Albedo`;
  }, [name]);

  return (
    <div className={`app ${preview ? "presenting" : ""}`}>
      <TopBar />
      <div className="main">
        <SideSlide side="left" hidden={preview}>
          <LeftRail />
          <DockColumn side="left" />
        </SideSlide>
        <ViewportSlot />
        <Viewport />
        <SideSlide side="right" hidden={preview}>
          <DockColumn side="right" />
        </SideSlide>
      </div>
      <StatusBar />
      <Toasts />
      <TooltipLayer />
      <ContextMenu />
      <ValuePopover />
      <RotatePopover />
      <Library />
      <HelpCenter />
      <SettingsDialog />
      <ProviderDialog />
    </div>
  );
}

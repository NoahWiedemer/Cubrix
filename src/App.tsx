import { useEffect } from "react";
import { installShortcuts } from "./core/commands";
import { useApp } from "./core/store";
import { TopBar } from "./components/TopBar";
import { LeftRail } from "./components/LeftRail";
import { DockColumn } from "./components/Dock";
import { Viewport } from "./components/Viewport";
import { StatusBar } from "./components/StatusBar";
import { Toasts } from "./components/Toasts";
import { TooltipLayer } from "./ui/Tooltip";

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
        {!preview && <LeftRail />}
        {!preview && <DockColumn side="left" />}
        <Viewport />
        {!preview && <DockColumn side="right" />}
      </div>
      <StatusBar />
      <Toasts />
      <TooltipLayer />
    </div>
  );
}

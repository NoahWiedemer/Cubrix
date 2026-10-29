import { useEffect } from "react";
import { installShortcuts } from "./core/commands";
import { useApp } from "./core/store";
import { TopBar } from "./components/TopBar";
import { LeftRail } from "./components/LeftRail";
import { DockColumn } from "./components/Dock";
import { Viewport } from "./components/Viewport";
import { StatusBar } from "./components/StatusBar";
import { Toasts } from "./components/Toasts";

export function App() {
  useEffect(() => installShortcuts(), []);

  // Keep the native window title in sync with the project name.
  const name = useApp((s) => s.nodes[s.currentId].doc.name);
  useEffect(() => {
    document.title = `${name} – Modelonio`;
  }, [name]);

  return (
    <div className="app">
      <TopBar />
      <div className="main">
        <LeftRail />
        <DockColumn side="left" />
        <Viewport />
        <DockColumn side="right" />
      </div>
      <StatusBar />
      <Toasts />
    </div>
  );
}

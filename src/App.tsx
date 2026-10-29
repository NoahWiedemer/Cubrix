import { useEffect } from "react";
import { installShortcuts } from "./core/commands";
import { useApp } from "./core/store";
import { TopBar } from "./components/TopBar";
import { LeftRail } from "./components/LeftRail";
import { ObjectTree } from "./components/ObjectTree";
import { HistoryPanel } from "./components/HistoryPanel";
import { Viewport } from "./components/Viewport";
import { PropertiesPanel } from "./components/PropertiesPanel";
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
        <div className="column">
          <ObjectTree />
          <HistoryPanel />
        </div>
        <Viewport />
        <div className="column">
          <PropertiesPanel />
        </div>
      </div>
      <StatusBar />
      <Toasts />
    </div>
  );
}

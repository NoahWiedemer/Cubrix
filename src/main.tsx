import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import "./styles.css";
import "./core/commandDefs";
import { App } from "./App";
import { initKernel, useKernel } from "./cad/kernel";
import { isTauri } from "./core/platform";
import { isMac, listCommands, toToolDefinition, execute } from "./core/commands";
import { useApp } from "./core/store";

if (isTauri && isMac) document.documentElement.classList.add("mac-tauri");
initKernel();

// In the desktop shell, mirror the kernel status to the terminal (useful when launching via `tauri dev`).
if (isTauri) {
  useKernel.subscribe((k, prev) => {
    if (k.status !== prev.status)
      void import("@tauri-apps/api/core").then(({ invoke }) =>
        invoke("log_status", { message: k.status === "ready" ? "CAD-Kern bereit" : `CAD-Kern: ${k.status} ${k.error ?? ""}` }),
      );
  });
}

// `?beispiel` opens the example project (handy for demos and screenshots).
if (new URLSearchParams(location.search).has("beispiel"))
  void execute("file.example").then(() => {
    const s = useApp.getState();
    void execute("selection.set", { ids: [s.nodes[s.currentId].doc.features[0].id] });
  });

// Handy for debugging and the upcoming AI integration: window.modelonio.execute("primitive.box", {...})
Object.assign(window, {
  modelonio: { execute, commands: () => listCommands().map(toToolDefinition), state: useApp.getState },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

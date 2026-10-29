import "./migrate";
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

if (isTauri && isMac) {
  document.documentElement.classList.add("mac-tauri");
  // In fullscreen the traffic lights are hidden, so the logo moves back to normal padding.
  void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
    const win = getCurrentWindow();
    const sync = async () => document.documentElement.classList.toggle("fullscreen", await win.isFullscreen());
    await sync();
    await win.onResized(() => void sync());
  });
}
initKernel();

// In the desktop shell: mirror the kernel status to the terminal and drive the splash screen.
if (isTauri) {
  const boot = (step: string) => void import("@tauri-apps/api/core").then(({ invoke }) => invoke("boot_progress", { step }));
  useKernel.subscribe((k, prev) => {
    if (k.status === prev.status) return;
    void import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke("log_status", { message: k.status === "ready" ? "CAD-Kern bereit" : `CAD-Kern: ${k.status} ${k.error ?? ""}` }),
    );
    // Never keep the window hidden: an error also ends the splash.
    if (k.status === "ready") boot("kernel");
    boot("ready");
    if (import.meta.env.DEV && k.status === "ready") void import("./ai/e2e").then((m) => m.runE2E());
  });
  requestAnimationFrame(() => boot("ui"));
}

// `?beispiel` opens the example project (handy for demos and screenshots).
if (new URLSearchParams(location.search).has("beispiel"))
  void execute("file.example").then(() => {
    const s = useApp.getState();
    void execute("selection.set", { ids: [s.nodes[s.currentId].doc.features[0].id] });
  });

// Handy for debugging and scripting: window.albedo.execute("primitive.box", {...})
Object.assign(window, {
  albedo: { execute, commands: () => listCommands().map(toToolDefinition), state: useApp.getState },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

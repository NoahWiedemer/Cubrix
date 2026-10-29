// Dev-only end-to-end run of real AI requests (see e2e_config in lib.rs).
import { invoke } from "@tauri-apps/api/core";
import { runAgent } from "./agent";
import { tauriTransport, type Provider } from "./providers";
import { modelInfo } from "./models";
import { useApp } from "../core/store";

const log = (message: string) => invoke("log_status", { message: `E2E ${message}` });

export async function runE2E() {
  const cfg = await invoke<string | null>("e2e_config");
  if (!cfg) return;
  for (const job of cfg.split(";;")) {
    const [provider, model, prompt] = job.split("|") as [Provider, string, string];
    const info = modelInfo(provider, model);
    await log(`START ${info.name} (${provider}): ${prompt}`);
    const before = useApp.getState().nodes[useApp.getState().currentId].doc.features.length;
    const t0 = performance.now();
    try {
      let text = "";
      await runAgent({
        provider,
        model: info.id,
        effort: info.effort ? "medium" : null,
        transport: tauriTransport,
        history: [],
        prompt,
        signal: new AbortController().signal,
        events: {
          onText: (d) => (text += d),
          onStep: (s) => void log(`  Schritt ${s.ok ? "OK" : "FEHLER"}: ${s.label}${s.error ? ` – ${s.error}` : ""}`),
        },
      });
      const s = useApp.getState();
      const node = s.nodes[s.currentId];
      const doc = node.doc;
      await log(`  Antwort: ${text.replace(/\s+/g, " ").slice(0, 300)}`);
      await log(`  Objekte: ${before} -> ${doc.features.length} (${doc.features.map((f) => f.name).join(", ")})`);
      await log(`  Verlauf: letzter Eintrag source=${node.source}, Gruppe=${node.group ? `"${node.group.prompt}"` : "keine"}`);
      await log(`ENDE ${info.name}: ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    } catch (e) {
      await log(`FEHLER ${info.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

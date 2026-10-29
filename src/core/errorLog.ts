// Background error log: AI, kernel and command failures plus uncaught errors are
// persisted by the Rust side (newest 100, keys redacted) for "Fehler kopieren".
import { isTauri } from "./platform";

export type ErrorSource = "ai" | "kernel" | "command" | "js";

export function logError(source: ErrorSource, message: string, details?: unknown) {
  if (!isTauri) return;
  void import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("log_error", { entry: { source, message: String(message).slice(0, 1000), details: details ?? null } }))
    .catch(() => {});
}

export async function readErrors(): Promise<{ time: number; source: string; message: string; details?: unknown; version?: string }[]> {
  if (!isTauri) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke("errors_read");
}

export async function clearErrors() {
  if (!isTauri) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("errors_clear");
}

export async function openErrorFolder() {
  if (!isTauri) return;
  const { invoke } = await import("@tauri-apps/api/core");
  const dir = await invoke<string>("errors_dir");
  const { openPath } = await import("@tauri-apps/plugin-opener");
  await openPath(dir);
}

/** Readable text for the clipboard. */
export function formatErrors(entries: Awaited<ReturnType<typeof readErrors>>) {
  return entries
    .map((e) => {
      const when = new Date(e.time).toLocaleString("de-DE");
      const details = e.details ? `\n  ${JSON.stringify(e.details)}` : "";
      return `[${when}] ${e.source} (v${e.version ?? "?"}): ${e.message}${details}`;
    })
    .join("\n");
}

/** Uncaught errors and promise rejections. */
export function installErrorHooks() {
  window.addEventListener("error", (e) => logError("js", e.message, { file: e.filename, line: e.lineno, stack: e.error?.stack?.slice(0, 1500) }));
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    logError("js", r instanceof Error ? r.message : String(r), { stack: r instanceof Error ? r.stack?.slice(0, 1500) : undefined });
  });
}

// In-app updates via GitHub Releases (tauri-plugin-updater reads latest.json of the
// newest release). A quiet check runs ~10 s after start at most once a day; the manual
// check ("Nach Updates suchen") also reports "aktuell" and errors.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { logError } from "./errorLog";
import { isTauri } from "./platform";

export interface UpdateInfo {
  version: string;
  notes?: string;
  date?: string;
  /** Downloads and installs; reports progress in bytes. */
  install(onProgress: (done: number, total: number | null) => void): Promise<void>;
}

/** Where updates come from. Swapped for a mock in tests and the dev E2E hook. */
export const updateSource = {
  async check(): Promise<UpdateInfo | null> {
    const { check } = await import("@tauri-apps/plugin-updater");
    const u = await check();
    if (!u) return null;
    return {
      version: u.version,
      notes: u.body,
      date: u.date,
      async install(onProgress) {
        let done = 0;
        let total: number | null = null;
        await u.downloadAndInstall((ev) => {
          if (ev.event === "Started") total = ev.data.contentLength ?? null;
          else if (ev.event === "Progress") done += ev.data.chunkLength;
          onProgress(done, total);
        });
      },
    };
  },
  async relaunch() {
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  },
  currentVersion: async (): Promise<string> => {
    if (!isTauri) return __APP_VERSION__;
    const { getVersion } = await import("@tauri-apps/api/app");
    return getVersion();
  },
};

export type UpdateStatus = "idle" | "checking" | "none" | "available" | "downloading" | "ready" | "error";

interface UpdaterState {
  status: UpdateStatus;
  update: UpdateInfo | null;
  progress: { done: number; total: number | null };
  error: string | null;
  /** Show the toast (manual checks and found updates; hidden by "Später"). */
  visible: boolean;
}

export const useUpdater = create<UpdaterState>(() => ({
  status: "idle",
  update: null,
  progress: { done: 0, total: null },
  error: null,
  visible: false,
}));

export const useUpdatePrefs = create<{ autoCheck: boolean; lastCheck: number }>()(
  persist(() => ({ autoCheck: true as boolean, lastCheck: 0 }), { name: "cubrix.updates" }),
);

const DAY = 24 * 60 * 60 * 1000;

/** Whether the quiet start-up check is due. */
export function autoCheckDue(prefs: { autoCheck: boolean; lastCheck: number }, now = Date.now()) {
  return prefs.autoCheck && now - prefs.lastCheck >= DAY;
}

/** Turns updater/network errors into a calm German sentence. */
export function friendlyUpdateError(err: unknown): string {
  const raw = String((err as Error)?.message ?? err).toLowerCase();
  if (/404|not found|valid release json|no release/.test(raw)) return "Es ist noch keine Version zum Aktualisieren veröffentlicht.";
  if (/network|offline|dns|connect|timed? ?out|failed to fetch|error sending request/.test(raw))
    return "Keine Verbindung zum Update-Server. Bist du online?";
  if (/signature/.test(raw)) return "Das Update konnte nicht verifiziert werden und wurde nicht installiert.";
  return "Die Suche nach Updates hat nicht geklappt.";
}

export async function checkForUpdates({ quiet = false } = {}) {
  const s = useUpdater.getState();
  if (s.status === "checking" || s.status === "downloading") return;
  useUpdater.setState({ status: "checking", error: null, visible: !quiet || s.visible });
  try {
    const update = await updateSource.check();
    useUpdatePrefs.setState({ lastCheck: Date.now() });
    if (update) useUpdater.setState({ status: "available", update, visible: true });
    else useUpdater.setState({ status: "none", update: null, visible: !quiet });
  } catch (err) {
    logError("js", `Update-Prüfung fehlgeschlagen: ${String((err as Error)?.message ?? err)}`);
    useUpdater.setState({ status: "error", error: friendlyUpdateError(err), visible: !quiet });
  }
}

export async function installUpdate() {
  const { update } = useUpdater.getState();
  if (!update) return;
  useUpdater.setState({ status: "downloading", progress: { done: 0, total: null }, visible: true });
  try {
    await update.install((done, total) => useUpdater.setState({ progress: { done, total } }));
    useUpdater.setState({ status: "ready" });
  } catch (err) {
    logError("js", `Update-Installation fehlgeschlagen: ${String((err as Error)?.message ?? err)}`);
    useUpdater.setState({ status: "error", error: "Das Update konnte nicht installiert werden. Bitte später erneut versuchen.", visible: true });
  }
}

export const dismissUpdate = () => useUpdater.setState({ visible: false });

/** Quiet check after start (only in the app, at most once per day). */
export function scheduleAutoCheck(delay = 10_000) {
  if (!isTauri || !autoCheckDue(useUpdatePrefs.getState())) return;
  window.setTimeout(() => void checkForUpdates({ quiet: true }), delay);
}

import { beforeEach, describe, expect, it, vi } from "vitest";
import { autoCheckDue, checkForUpdates, friendlyUpdateError, installUpdate, updateSource, useUpdater } from "../src/core/updater";
import { shortNotes } from "../src/components/UpdateToast";

const reset = () => useUpdater.setState({ status: "idle", update: null, progress: { done: 0, total: null }, error: null, visible: false });

describe("updater", () => {
  beforeEach(reset);

  it("checks at most once per day and only when enabled", () => {
    const now = Date.UTC(2026, 9, 29, 12);
    expect(autoCheckDue({ autoCheck: true, lastCheck: 0 }, now)).toBe(true);
    expect(autoCheckDue({ autoCheck: true, lastCheck: now - 3600_000 }, now)).toBe(false);
    expect(autoCheckDue({ autoCheck: true, lastCheck: now - 25 * 3600_000 }, now)).toBe(true);
    expect(autoCheckDue({ autoCheck: false, lastCheck: 0 }, now)).toBe(false);
  });

  it("maps errors to gentle messages", () => {
    expect(friendlyUpdateError(new Error("Could not fetch a valid release JSON from the remote"))).toMatch(/noch keine Version/);
    expect(friendlyUpdateError("error sending request for url")).toMatch(/Verbindung/);
    expect(friendlyUpdateError("signature verification failed")).toMatch(/verifiziert/);
    expect(friendlyUpdateError("boom")).toMatch(/nicht geklappt/);
  });

  it("quiet check stays hidden when up to date or failing, manual check reports", async () => {
    vi.spyOn(updateSource, "check").mockResolvedValueOnce(null);
    await checkForUpdates({ quiet: true });
    expect(useUpdater.getState()).toMatchObject({ status: "none", visible: false });
    vi.spyOn(updateSource, "check").mockRejectedValueOnce(new Error("404 Not Found"));
    await checkForUpdates({ quiet: true });
    expect(useUpdater.getState()).toMatchObject({ status: "error", visible: false });
    vi.spyOn(updateSource, "check").mockResolvedValueOnce(null);
    await checkForUpdates();
    expect(useUpdater.getState()).toMatchObject({ status: "none", visible: true });
  });

  it("found update is shown, downloads with progress and becomes ready", async () => {
    const install = vi.fn(async (p: (d: number, t: number | null) => void) => {
      p(50, 100);
      p(100, 100);
    });
    vi.spyOn(updateSource, "check").mockResolvedValueOnce({ version: "0.2.0", notes: "- Neu", install });
    await checkForUpdates({ quiet: true });
    expect(useUpdater.getState()).toMatchObject({ status: "available", visible: true });
    await installUpdate();
    expect(install).toHaveBeenCalled();
    expect(useUpdater.getState()).toMatchObject({ status: "ready", progress: { done: 100, total: 100 } });
  });

  it("shortens release notes", () => {
    expect(shortNotes("## What's Changed\n* **Neu:** Updates in der App\n- Feinere Oberfläche\n\n**Full Changelog**: x")).toEqual(["Neu: Updates in der App", "Feinere Oberfläche"]);
  });
});

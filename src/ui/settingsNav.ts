// Sections of the settings window; the one opened last is remembered.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { IconName } from "./icons";

export const SETTINGS_SECTIONS = [
  { id: "general", title: "Allgemein", icon: "settings", summary: "Version, Hilfe und Tastenkürzel." },
  { id: "ai", title: "KI & Modelle", icon: "sparkle", summary: "Anbieter, Schlüssel und das Modell für den KI-Assistenten." },
  { id: "mcp", title: "MCP", icon: "plug", summary: "Externe Werkzeuge für den KI-Assistenten anschließen." },
  { id: "view", title: "Ansicht", icon: "iso", summary: "Darstellung der 3D-Ansicht und Leistung." },
  { id: "printer", title: "Drucker", icon: "printer", summary: "Drucker und Bauraum dieses Projekts." },
  { id: "updates", title: "Updates", icon: "update", summary: "Cubrix aktuell halten." },
  { id: "developer", title: "Entwickler", icon: "warn", summary: "Fehlerprotokoll für die Fehlersuche." },
] as const satisfies readonly { id: string; title: string; icon: IconName; summary: string }[];

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["id"];

export function resolveSection(id: unknown): SettingsSection {
  return SETTINGS_SECTIONS.find((s) => s.id === id)?.id ?? SETTINGS_SECTIONS[0].id;
}

/** The section above or below in the list, wrapping around (arrow keys). */
export function stepSection(id: SettingsSection, delta: number): SettingsSection {
  const n = SETTINGS_SECTIONS.length;
  const i = SETTINGS_SECTIONS.findIndex((s) => s.id === id);
  return SETTINGS_SECTIONS[(i + delta + n) % n].id;
}

export const useSettingsDialog = create<{ open: boolean; section: SettingsSection }>()(
  persist((): { open: boolean; section: SettingsSection } => ({ open: false, section: SETTINGS_SECTIONS[0].id }), {
    name: "cubrix.settingsDialog",
    partialize: (s) => ({ section: s.section }),
    merge: (stored, state) => ({ ...state, section: resolveSection((stored as { section?: unknown } | undefined)?.section) }),
  }),
);

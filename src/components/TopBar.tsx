import { useState } from "react";
import { ChevronDown, Undo2, Redo2, PanelsTopLeft } from "lucide-react";
import logo1x from "../assets/brand/modelonio-logo-ohne-hintergrund-256.png";
import logo2x from "../assets/brand/modelonio-logo-ohne-hintergrund-512.png";
import { Menu, MenuItem, MenuSeparator, MenuTitle } from "../ui/Menu";
import { Icon, type IconName } from "../ui/icons";
import { SegmentedControl } from "../ui/SegmentedControl";
import { QUALITY_LABELS, useSettings } from "../ui/settings";
import { PANEL_ICONS, PANEL_TITLES, useLayout, type PanelId } from "../ui/layout";
import { execute } from "../core/commands";
import { useApp, useDoc, type Workspace } from "../core/store";
import { usePopover } from "../ui/usePopover";
import { CommandItem } from "../ui/CommandItem";

const TABS: { id: Workspace; label: string; key: string; icon: IconName }[] = [
  { id: "model", label: "Modell", key: "1", icon: "box" },
  { id: "sketch", label: "2D", key: "2", icon: "penTool" },
  { id: "print", label: "Druck vorbereiten", key: "3", icon: "printer" },
  { id: "preview", label: "Vorschau", key: "4", icon: "visible" },
];

export function TopBar() {
  const doc = useDoc();
  const workspace = useApp((s) => s.workspace);
  const canUndo = useApp((s) => !!s.nodes[s.currentId].parentId);
  const canRedo = useApp((s) => !!s.nodes[s.currentId].activeChildId);
  const hasVisible = doc.features.some((f) => f.visible);
  const [editing, setEditing] = useState(false);
  const fileMenu = usePopover();
  const exportMenu = usePopover();
  const viewMenu = usePopover();
  const panels = useLayout((s) => s.panels);
  const projection = useSettings((s) => s.projection);
  const quality = useSettings((s) => s.quality);
  const inertia = useSettings((s) => s.inertia);
  const showVolume = useSettings((s) => s.showVolume);
  const volumeStrong = useSettings((s) => s.volumeStrong);

  const commitName = (value: string) => {
    setEditing(false);
    void execute("document.rename", { name: value });
  };

  return (
    <header className="topbar" data-tauri-drag-region>
      <div className="topbar-left" data-tauri-drag-region>
        <div ref={fileMenu.ref} style={{ position: "relative" }}>
          <button className="logo" onClick={() => fileMenu.setOpen(!fileMenu.open)} data-tip="Datei" data-tip-pos="bottom">
            <img src={logo1x} srcSet={`${logo1x} 1x, ${logo2x} 2x`} alt="" />
            Albedo
            <ChevronDown size={13} color="var(--text-3)" />
          </button>
          {fileMenu.open && (
            <Menu style={{ top: 36, left: 0 }}>
              {["file.new", "file.open", "file.save", "file.saveAs"].map((id) => (
                <CommandItem key={id} id={id} onDone={() => fileMenu.setOpen(false)} />
              ))}
              <MenuSeparator />
              <CommandItem id="export.stl" onDone={() => fileMenu.setOpen(false)} />
              <CommandItem id="export.3mf" onDone={() => fileMenu.setOpen(false)} />
            </Menu>
          )}
        </div>
        <div className="divider-v" />
        <div className="project">
          {editing ? (
            <input
              className="project-name"
              autoFocus
              defaultValue={doc.name}
              onFocus={(e) => e.target.select()}
              onBlur={(e) => commitName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setEditing(false);
              }}
            />
          ) : (
            <button className="project-name" onClick={() => setEditing(true)} data-tip="Umbenennen" data-tip-pos="bottom">
              {doc.name}
            </button>
          )}
        </div>
      </div>

      <SegmentedControl
        className="tabs"
        value={workspace}
        onChange={(w) => execute("workspace.set", { workspace: w })}
        options={TABS.map((t) => ({ value: t.id, label: t.label, icon: <Icon name={t.icon} size={16} />, tip: `Arbeitsbereich ${t.label}`, kbd: t.key }))}
      />

      <div className="topbar-right" data-tauri-drag-region>
        <button className="icon-btn" disabled={!canUndo} onClick={() => execute("history.undo")} data-tip="Rückgängig" data-kbd="mod+z" data-tip-pos="bottom">
          <Undo2 size={16} strokeWidth={1.75} />
        </button>
        <button className="icon-btn" disabled={!canRedo} onClick={() => execute("history.redo")} data-tip="Wiederholen" data-kbd="shift+mod+z" data-tip-pos="bottom">
          <Redo2 size={16} strokeWidth={1.75} />
        </button>
        <div ref={viewMenu.ref} style={{ position: "relative" }}>
          <button className={`icon-btn ${viewMenu.open ? "active" : ""}`} onClick={() => viewMenu.setOpen(!viewMenu.open)} data-tip={viewMenu.open ? undefined : "Ansicht"} data-tip-pos="bottom">
            <PanelsTopLeft size={16} strokeWidth={1.75} />
          </button>
          {viewMenu.open && (
            <Menu style={{ top: 38, right: 0 }}>
              <MenuTitle>Panels</MenuTitle>
              {(Object.keys(PANEL_TITLES) as PanelId[]).map((id) => (
                <MenuItem
                  key={id}
                  icon={PANEL_ICONS[id]}
                  label={PANEL_TITLES[id]}
                  checked={panels[id].open}
                  onClick={() => useLayout.getState().setPanel(id, panels[id].open ? { open: false } : { open: true, collapsed: false })}
                />
              ))}
              <MenuSeparator />
              <MenuTitle>Kamera</MenuTitle>
              <MenuItem icon="perspective" label="Perspektive" shortcut="o" checked={projection === "perspective"} onClick={() => execute("view.projection", { mode: "perspective" })} />
              <MenuItem icon="projection" label="Orthografisch" shortcut="o" checked={projection === "orthographic"} onClick={() => execute("view.projection", { mode: "orthographic" })} />
              <MenuItem icon="iso" label="Isometrisch" shortcut="i" onClick={() => { execute("view.iso"); viewMenu.setOpen(false); }} />
              <MenuItem icon="boxes" label="Bauraum anzeigen" checked={showVolume} onClick={() => useSettings.setState({ showVolume: !showVolume })} />
              {showVolume && (
                <MenuItem icon="sparkle" label="Bauraum deutlich" checked={volumeStrong} onClick={() => useSettings.setState({ volumeStrong: !volumeStrong })} />
              )}
              <MenuItem icon="orient" label="Kamera-Trägheit" checked={inertia === "light"} onClick={() => useSettings.setState({ inertia: inertia === "light" ? "off" : "light" })} />
              <MenuSeparator />
              <MenuTitle>Darstellungsqualität</MenuTitle>
              <div className="menu-seg">
                <SegmentedControl
                  size="sm"
                  className="block"
                  value={quality}
                  onChange={(q) => useSettings.setState({ quality: q })}
                  options={(["high", "balanced", "fast"] as const).map((q) => ({ value: q, label: QUALITY_LABELS[q] }))}
                />
              </div>
              <MenuSeparator />
              <MenuItem icon="reset" label="Layout zurücksetzen" onClick={() => { useLayout.getState().reset(); viewMenu.setOpen(false); }} />
            </Menu>
          )}
        </div>
        <div ref={exportMenu.ref} style={{ position: "relative" }}>
          <button className="btn-primary" disabled={!hasVisible} onClick={() => exportMenu.setOpen(!exportMenu.open)}>
            Exportieren
            <span className="sep" />
            <ChevronDown size={14} />
          </button>
          {exportMenu.open && (
            <Menu style={{ top: 38, right: 0 }}>
              <MenuTitle>Für den Slicer</MenuTitle>
              <CommandItem id="export.stl" label="STL (.stl)" onDone={() => exportMenu.setOpen(false)} />
              <CommandItem id="export.3mf" label="3MF (.3mf)" onDone={() => exportMenu.setOpen(false)} />
              <MenuSeparator />
              <CommandItem id="file.save" label="Projekt speichern" onDone={() => exportMenu.setOpen(false)} />
            </Menu>
          )}
        </div>
      </div>
    </header>
  );
}

import { useState } from "react";
import { ChevronDown, Undo2, Redo2 } from "lucide-react";
import { execute, formatShortcut } from "../core/commands";
import { useApp, useDoc, type Workspace } from "../core/store";
import { usePopover } from "../ui/usePopover";
import { CommandItem } from "../ui/CommandItem";

const TABS: { id: Workspace; label: string }[] = [
  { id: "model", label: "Modell" },
  { id: "sketch", label: "2D" },
  { id: "print", label: "Druck vorbereiten" },
  { id: "preview", label: "Vorschau" },
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

  const commitName = (value: string) => {
    setEditing(false);
    void execute("document.rename", { name: value });
  };

  return (
    <header className="topbar" data-tauri-drag-region>
      <div className="topbar-left" data-tauri-drag-region>
        <div ref={fileMenu.ref} style={{ position: "relative" }}>
          <button className="logo" onClick={() => fileMenu.setOpen(!fileMenu.open)} data-tip="Datei" data-tip-pos="bottom">
            <img src="/logo.svg" alt="" />
            Modelonio
            <ChevronDown size={13} color="var(--text-3)" />
          </button>
          {fileMenu.open && (
            <div className="popover" style={{ top: 36, left: 0 }}>
              {["file.new", "file.open", "file.save", "file.saveAs"].map((id) => (
                <CommandItem key={id} id={id} onDone={() => fileMenu.setOpen(false)} />
              ))}
              <div className="menu-sep" />
              <CommandItem id="export.stl" onDone={() => fileMenu.setOpen(false)} />
              <CommandItem id="export.3mf" onDone={() => fileMenu.setOpen(false)} />
            </div>
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

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${workspace === t.id ? "active" : ""}`}
            onClick={() => useApp.setState({ workspace: t.id })}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="topbar-right" data-tauri-drag-region>
        <button className="icon-btn" disabled={!canUndo} onClick={() => execute("history.undo")} data-tip={`Rückgängig  ${formatShortcut("mod+z")}`} data-tip-pos="bottom">
          <Undo2 size={16} strokeWidth={1.75} />
        </button>
        <button className="icon-btn" disabled={!canRedo} onClick={() => execute("history.redo")} data-tip={`Wiederholen  ${formatShortcut("shift+mod+z")}`} data-tip-pos="bottom">
          <Redo2 size={16} strokeWidth={1.75} />
        </button>
        <div ref={exportMenu.ref} style={{ position: "relative" }}>
          <button className="btn-primary" disabled={!hasVisible} onClick={() => exportMenu.setOpen(!exportMenu.open)}>
            Exportieren
            <span className="sep" />
            <ChevronDown size={14} />
          </button>
          {exportMenu.open && (
            <div className="popover" style={{ top: 38, right: 0 }}>
              <div className="menu-title">Für den Slicer</div>
              <CommandItem id="export.stl" label="STL (.stl)" onDone={() => exportMenu.setOpen(false)} />
              <CommandItem id="export.3mf" label="3MF (.3mf)" onDone={() => exportMenu.setOpen(false)} />
              <div className="menu-sep" />
              <CommandItem id="file.save" label="Projekt speichern" onDone={() => exportMenu.setOpen(false)} />
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

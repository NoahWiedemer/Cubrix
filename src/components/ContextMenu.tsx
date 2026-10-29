// Right-click menu for bodies (viewport and object tree); the action bar stays minimal.
import { useEffect } from "react";
import { create } from "zustand";
import { Menu, MenuItem, MenuSeparator } from "../ui/Menu";
import { execute, getCommand, isEnabled } from "../core/commands";
import { findFeature, parentsOf } from "../core/document";
import { openValuePopover } from "./ValuePopover";
import { openRotatePopover } from "./RotatePopover";
import { openColorPopover } from "./ColorRow";
import { openPatternPopover } from "./PatternPopover";
import { useApp } from "../core/store";
import { CommandItem } from "../ui/CommandItem";

export const useContextMenu = create<{ at: { x: number; y: number } | null }>(() => ({ at: null }));
export const openContextMenu = (x: number, y: number) => useContextMenu.setState({ at: { x, y } });

export function ContextMenu() {
  const at = useContextMenu((s) => s.at);
  useEffect(() => {
    if (!at) return;
    const close = () => useContextMenu.setState({ at: null });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const t = setTimeout(() => window.addEventListener("pointerdown", close, { once: true }), 0);
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [at]);
  if (!at) return null;
  const done = () => useContextMenu.setState({ at: null });
  const st = useApp.getState();
  const doc = st.nodes[st.currentId].doc;
  const sel = st.selection.length === 1 ? st.selection[0] : null;
  const isOperand = !!sel && parentsOf(doc, sel).length > 0;
  const isBoolean = !!sel && findFeature(doc, sel)?.type === "boolean";
  const x = Math.min(at.x, window.innerWidth - 260);
  const y = Math.min(at.y, window.innerHeight - 320);
  return (
    <div style={{ position: "fixed", left: x, top: y, zIndex: 300 }} onPointerDown={(e) => e.stopPropagation()}>
      <Menu inline style={{ position: "static" }}>
        <CommandItem id="object.duplicate" onDone={done} />
        <CommandItem id="object.dropToBed" onDone={done} />
        <CommandItem id="object.setVisibility" label="Ein-/Ausblenden" onDone={done} />
        <MenuItem
          icon="rotate"
          label="Drehen …"
          disabled={useApp.getState().selection.length !== 1}
          onClick={() => {
            done();
            openRotatePopover({ id: useApp.getState().selection[0], at });
          }}
        />
        <MenuSeparator />
        {["object.fillet", "object.chamfer", "object.shell"].map((id) => (
          <MenuItem
            key={id}
            icon={getCommand(id)!.icon}
            label={`${getCommand(id)!.label} …`}
            disabled={!isEnabled(id)}
            onClick={() => {
              done();
              // The same spot turns into a compact value input with live preview.
              openValuePopover({ command: id, param: id === "object.shell" ? "thickness" : "radius", at });
            }}
          />
        ))}
        <MenuSeparator />
        <MenuItem
          icon="pattern"
          label="Muster / Spiegeln …"
          disabled={useApp.getState().selection.length !== 1 || isOperand}
          onClick={() => {
            done();
            openPatternPopover({ id: useApp.getState().selection[0], at });
          }}
        />
        <MenuItem
          icon="background"
          label="Farbe …"
          disabled={!useApp.getState().selection.length}
          onClick={() => {
            done();
            const ids = useApp.getState().selection;
            const doc = useApp.getState().nodes[useApp.getState().currentId].doc;
            const first = doc.features.find((f) => f.id === ids[0]);
            openColorPopover({ ids, current: first?.color, at });
          }}
        />
        {isOperand && (
          <>
            <MenuSeparator />
            <CommandItem id="operand.extract" onDone={done} />
            <CommandItem id="operand.remove" onDone={done} />
            <MenuItem icon="union" label="Verbund: Vereinen" onClick={() => { done(); void execute("boolean.setOp", { op: "union" }); }} />
            <MenuItem icon="subtract" label="Verbund: Abziehen" onClick={() => { done(); void execute("boolean.setOp", { op: "subtract" }); }} />
            <MenuItem icon="intersect" label="Verbund: Schnittmenge" onClick={() => { done(); void execute("boolean.setOp", { op: "intersect" }); }} />
          </>
        )}
        {isBoolean && <CommandItem id="boolean.split" onDone={done} />}
        <MenuSeparator />
        {!isOperand && <CommandItem id="object.delete" onDone={done} />}
      </Menu>
    </div>
  );
}

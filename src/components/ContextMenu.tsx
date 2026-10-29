// Right-click menu for bodies (viewport and object tree); the action bar stays minimal.
import { useEffect } from "react";
import { create } from "zustand";
import { Menu, MenuSeparator } from "../ui/Menu";
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
  const x = Math.min(at.x, window.innerWidth - 260);
  const y = Math.min(at.y, window.innerHeight - 320);
  return (
    <div style={{ position: "fixed", left: x, top: y, zIndex: 300 }} onPointerDown={(e) => e.stopPropagation()}>
      <Menu style={{ position: "static" }}>
        <CommandItem id="object.duplicate" onDone={done} />
        <CommandItem id="object.dropToBed" onDone={done} />
        <CommandItem id="object.setVisibility" label="Ein-/Ausblenden" onDone={done} />
        <MenuSeparator />
        <CommandItem id="object.fillet" onDone={done} />
        <CommandItem id="object.chamfer" onDone={done} />
        <MenuSeparator />
        <CommandItem id="object.delete" onDone={done} />
      </Menu>
    </div>
  );
}

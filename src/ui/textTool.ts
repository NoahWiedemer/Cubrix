// Text placement tool (T): the next click on the bed places free-standing text,
// a click on a body embosses text there. Both open the inline text input.
import { create } from "zustand";
import type { Vec3 } from "../core/document";
import { openValuePopover } from "../components/ValuePopover";

export const useTextTool = create<{ active: boolean }>(() => ({ active: false }));

/** Opens the text input at the click; `target` set = emboss on that body. */
export function placeText(at: { x: number; y: number }, position: Vec3, target?: string) {
  useTextTool.setState({ active: false });
  openValuePopover({
    command: "text.create",
    param: "text",
    kind: "text",
    initial: "Text",
    at,
    params: target ? { mode: "emboss", targetId: target, position } : { position },
  });
}

// Esc leaves the tool.
if (typeof window !== "undefined")
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && useTextTool.getState().active) useTextTool.setState({ active: false });
  });

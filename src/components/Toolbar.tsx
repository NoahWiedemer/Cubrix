import { execute, getCommand, isEnabled } from "../core/commands";
import { useApp, useDoc } from "../core/store";
import { findFeature, hasNoEdges, parentsOf } from "../core/document";
import { Icon, type IconName } from "../ui/icons";
import { PRIMITIVES } from "./LeftRail";
import { useGizmo } from "../ui/gizmo";
import { useSketch } from "../ui/sketch";
import { useTextTool } from "../ui/textTool";
import { openValuePopover } from "./ValuePopover";
import { openRotatePopover } from "./RotatePopover";
import { openPatternPopover } from "./PatternPopover";

/** Commands that ask for one value first (same inline popover as the context menu). */
const VALUE_COMMANDS: Record<string, string> = { "object.fillet": "radius", "object.chamfer": "radius" };

function CommandTool({ id, icon, label, tip: tipText, active }: { id: string; icon?: IconName; label?: string; tip?: string; active?: boolean }) {
  const cmd = getCommand(id)!;
  const tip = tipText ?? cmd.description.split(".")[0];
  const run = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (id === "object.pattern") {
      const sel = useApp.getState().selection;
      if (sel.length === 1) return openPatternPopover({ id: sel[0], at: { x: r.left + r.width / 2, y: r.top }, placement: "above" });
    }
    if (id === "tool.rotate") {
      const sel = useApp.getState().selection;
      if (sel.length === 1) return openRotatePopover({ id: sel[0], at: { x: r.left + r.width / 2, y: r.top }, placement: "above" });
    }
    const param = VALUE_COMMANDS[id];
    if (!param) return void execute(id);
    openValuePopover({ command: id, param, at: { x: r.left + r.width / 2, y: r.top }, placement: "above" });
  };
  return (
    <button className={`tool ${active ? "active" : ""}`} onClick={run} data-tip={tip} data-kbd={cmd.shortcut} data-tip-pos="top">
      <Icon name={icon ?? cmd.icon} size={18} />
      {label ?? cmd.label}
    </button>
  );
}

/**
 * Contextual toolbar: only the tools that apply to the current selection are shown.
 * Nothing selected → create; one body → modify it; two bodies → combine them.
 */
export function Toolbar() {
  const doc = useDoc();
  const selection = useApp((s) => s.selection).filter((id) => !!findFeature(doc, id));
  const single = selection.length === 1 ? findFeature(doc, selection[0]) : undefined;
  const operand = !!single && parentsOf(doc, single.id).length > 0;
  const rotate = useGizmo((s) => s.mode === "rotate");
  const scale = useGizmo((s) => s.mode === "scale");
  const textTool = useTextTool((s) => s.active);
  const mode = selection.length === 0 ? "create" : selection.length === 1 ? "single" : selection.length === 2 ? "pair" : "many";

  return (
    <div className="toolbar">
      <div className="toolbar-set" key={mode}>
        {mode === "create" &&
          PRIMITIVES.map((p) => <CommandTool key={p.id} id={p.id} icon={p.icon} label={p.label} />)}
        {mode === "create" && <CommandTool id="tool.text" active={textTool} tip="Text: aufs Druckbett klicken" />}
        {mode === "single" && single?.type === "sketch" && (
          <>
            {isEnabled("sketch.smooth") && <CommandTool id="sketch.smooth" tip="Kantige Kontur in eine glatte Kurve umwandeln" />}
            {isEnabled("sketch.revolve") && <CommandTool id="sketch.revolve" label="Drehen" tip="Drehkörper: das Profil dreht sich um eine Achse links davon (Vase, Becher, Knopf)" />}
            <button className="tool" onClick={() => { useSketch.setState({ activeId: single.id }); void execute("workspace.sketch"); }} data-tip="Skizze im 2D-Modus bearbeiten" data-tip-pos="top">
              <Icon name="sketch" size={18} />In 2D bearbeiten
            </button>
          </>
        )}
        {mode === "single" && single?.type !== "sketch" && (
          <>
            <CommandTool id="tool.rotate" active={rotate} />
            <CommandTool id="tool.scale" active={scale} />
            <CommandTool id="object.pattern" label="Muster" tip="Reihe, Raster, Kreis oder Spiegeln" />
            {single && (single.type === "extrude") && isEnabled("sketch.smooth") && <CommandTool id="sketch.smooth" tip="Kantige Kontur in eine glatte Kurve umwandeln" />}
            {single && !hasNoEdges(single) && (
              <>
                <CommandTool id="object.fillet" />
                <CommandTool id="object.chamfer" />
              </>
            )}
            {single?.type === "boolean" && <CommandTool id="boolean.split" />}
            <CommandTool id="tool.text" active={textTool} tip="Text prägen: auf den Körper klicken" />
          </>
        )}
        {(mode === "pair" || mode === "many") && (
          <>
            <CommandTool id="tool.rotate" active={rotate} />
            <CommandTool id="tool.scale" active={scale} />
            <span className="toolbar-sep" />
            {mode === "pair" && <CommandTool id="object.stackOn" tip="Zweites ausgewähltes Objekt mittig oben auf das erste setzen" />}
            <CommandTool id="boolean.union" />
            <CommandTool id="boolean.subtract" />
            <CommandTool id="boolean.intersect" />
          </>
        )}
        {mode !== "create" && !operand && (
          <>
            <span className="toolbar-sep" />
            <CommandTool id="object.duplicate" />
            <CommandTool id="object.dropToBed" label="Ablegen" tip="Auf das Druckbett ablegen" />
            <CommandTool id="object.delete" />
          </>
        )}
        {operand && (
          <>
            <span className="toolbar-sep" />
            <CommandTool id="operand.extract" label="Lösen" tip="Aus dem Verbund lösen (wird eigenes Objekt)" />
            <CommandTool id="operand.remove" label="Entfernen" tip="Aus dem Verbund entfernen" />
          </>
        )}
      </div>
    </div>
  );
}

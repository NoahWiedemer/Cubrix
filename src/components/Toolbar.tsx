import { execute, getCommand } from "../core/commands";
import { useApp, useDoc } from "../core/store";
import { Icon, type IconName } from "../ui/icons";
import { PRIMITIVES } from "./LeftRail";
import { useGizmo } from "../ui/gizmo";
import { useSketch } from "../ui/sketch";

function CommandTool({ id, icon, label, active }: { id: string; icon?: IconName; label?: string; active?: boolean }) {
  const cmd = getCommand(id)!;
  const tip = cmd.description.split(".")[0];
  return (
    <button className={`tool ${active ? "active" : ""}`} onClick={() => execute(id)} data-tip={tip} data-kbd={cmd.shortcut} data-tip-pos="top">
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
  const selection = useApp((s) => s.selection).filter((id) => doc.features.some((f) => f.id === id));
  const single = selection.length === 1 ? doc.features.find((f) => f.id === selection[0]) : undefined;
  const rotate = useGizmo((s) => s.mode === "rotate");
  const mode = selection.length === 0 ? "create" : selection.length === 1 ? "single" : selection.length === 2 ? "pair" : "many";

  return (
    <div className="toolbar">
      <div className="toolbar-set" key={mode}>
        {mode === "create" &&
          PRIMITIVES.map((p) => <CommandTool key={p.id} id={p.id} icon={p.icon} label={p.label} />)}
        {mode === "single" && single?.type === "sketch" && (
          <>
            <button className="tool" onClick={() => { useSketch.setState({ activeId: single.id }); void execute("workspace.sketch"); }} data-tip="Skizze im 2D-Modus bearbeiten" data-tip-pos="top">
              <Icon name="sketch" size={18} />In 2D bearbeiten
            </button>
            <CommandTool id="sketch.extrude" label="In 3D ziehen" />
          </>
        )}
        {mode === "single" && single?.type !== "sketch" && (
          <>
            <CommandTool id="tool.rotate" active={rotate} />
            {single && single.type !== "sphere" && single.type !== "torus" && (
              <>
                <CommandTool id="object.fillet" />
                <CommandTool id="object.chamfer" />
              </>
            )}
            {single?.type === "boolean" && <CommandTool id="boolean.split" />}
          </>
        )}
        {mode === "pair" && (
          <>
            <CommandTool id="boolean.union" />
            <CommandTool id="boolean.subtract" />
            <CommandTool id="boolean.intersect" />
          </>
        )}
      </div>
    </div>
  );
}

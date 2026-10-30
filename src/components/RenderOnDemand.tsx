import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { useApp } from "../core/store";
import { useMeshes } from "../cad/kernel";
import { useAiRun } from "../ai/run";
import { useSettings } from "../ui/settings";
import { usePreview } from "../ui/preview";
import { useGizmo } from "../ui/gizmo";
import { useEdgePick } from "../ui/edgePick";
import { useMeasure } from "../ui/measureTool";
import { useSketch } from "../ui/sketch";
import { useLayout } from "../ui/layout";
import { useViewportFrame } from "../ui/viewportFrame";
import { usePrintView } from "./PrintPanel";
import { useMeshObjects } from "./SelectionOutline";

/**
 * The canvas only draws when something changed (frameloop "demand"), so an idle window
 * costs nothing. Camera moves and scene-graph edits request frames on their own; this
 * covers the state that per-frame hooks read directly, without going through React props.
 */
export function RenderOnDemand() {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const stores = [useApp, useMeshes, useMeshObjects, useAiRun, useSettings, usePreview, useGizmo, useEdgePick, useMeasure, useSketch, useLayout, useViewportFrame, usePrintView];
    const stop = stores.map((s) => (s as { subscribe(fn: () => void): () => void }).subscribe(() => invalidate()));
    return () => stop.forEach((fn) => fn());
  }, [invalidate]);
  return null;
}

// Live state of an AI run, for the chat status row, the panel indicator and the
// viewport animations (objects that appear during a run "materialize").
import { create } from "zustand";
import { useApp } from "../core/store";

export interface AiRunState {
  running: boolean;
  /** The agent is changing the model right now (drives the viewport glow). */
  modeling: boolean;
  startedAt: number;
  /** Plain-German current activity ("Denkt nach …", "Erstellt 21 Formen …"). */
  phase: string;
  /** Feature id → stagger delay (ms) and kind, for objects created during the run.
   *  The animation starts when the object's mesh first shows up (the kernel may take a moment). */
  born: Record<string, { delay: number; kind: "grow" | "glow" }>;
}

export const useAiRun = create<AiRunState>(() => ({ running: false, modeling: false, startedAt: 0, phase: "", born: {} }));

let modelingTimer: number | undefined;
/** Called for every scene-changing command of a run; the glow fades after 4 s without one. */
export function markModeling() {
  if (!useAiRun.getState().running) return;
  if (!useAiRun.getState().modeling) useAiRun.setState({ modeling: true });
  window.clearTimeout(modelingTimer);
  modelingTimer = window.setTimeout(() => useAiRun.setState({ modeling: false }), 4000);
}

let external = false;
let externalTimer: number | undefined;
/** External clients run without a chat: a burst of calls counts as a run and ends 5 s after the last. */
export function touchExternal(phase: string) {
  if (!useAiRun.getState().running) {
    startRun();
    external = true;
    setPhase(phase);
  }
  if (!external) return; // the chat's own run is in charge
  window.clearTimeout(externalTimer);
  externalTimer = window.setTimeout(endRun, 5000);
}

let known = new Set<string>(useApp.getState().nodes[useApp.getState().currentId].doc.features.map((f) => f.id));

export const startRun = () => {
  external = false;
  window.clearTimeout(externalTimer);
  // Everything already in the model is "known"; only objects made during the run animate.
  const s = useApp.getState();
  known = new Set(s.nodes[s.currentId].doc.features.map((f) => f.id));
  useAiRun.setState({ running: true, modeling: false, startedAt: performance.now(), phase: "Denkt nach …", born: {} });
};
export const endRun = () => {
  external = false;
  window.clearTimeout(externalTimer);
  window.clearTimeout(modelingTimer);
  useAiRun.setState({ running: false, modeling: false, phase: "" });
};
export const setPhase = (phase: string) => useAiRun.setState({ phase });

// New features during a run get a staggered start: a batch of 21 pips pops in like a
// wave, but never takes longer than ~0.35 s in total so the agent is not slowed down.
useApp.subscribe((s, prev) => {
  const doc = s.nodes[s.currentId].doc;
  if (prev && s.currentId === prev.currentId && s.draft === prev.draft) return;
  const ids = doc.features.map((f) => f.id);
  if (useAiRun.getState().running) {
    const fresh = doc.features.filter((f) => !known.has(f.id));
    if (fresh.length) {
      const stagger = Math.min(28, 350 / fresh.length);
      const born = { ...useAiRun.getState().born };
      fresh.forEach((f, i) => (born[f.id] = { delay: i * stagger, kind: f.type === "boolean" ? "glow" : "grow" }));
      useAiRun.setState({ born });
    }
  }
  known = new Set(ids);
});

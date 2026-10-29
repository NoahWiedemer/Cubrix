// Live state of an AI run, for the chat status row, the panel indicator and the
// viewport animations (objects that appear during a run "materialize").
import { create } from "zustand";
import { useApp } from "../core/store";

export interface AiRunState {
  running: boolean;
  startedAt: number;
  /** Plain-German current activity ("Denkt nach …", "Erstellt 21 Formen …"). */
  phase: string;
  /** Feature id → stagger delay (ms) and kind, for objects created during the run.
   *  The animation starts when the object's mesh first shows up (the kernel may take a moment). */
  born: Record<string, { delay: number; kind: "grow" | "glow" }>;
}

export const useAiRun = create<AiRunState>(() => ({ running: false, startedAt: 0, phase: "", born: {} }));

let known = new Set<string>(useApp.getState().nodes[useApp.getState().currentId].doc.features.map((f) => f.id));

export const startRun = () => {
  // Everything already in the model is "known"; only objects made during the run animate.
  const s = useApp.getState();
  known = new Set(s.nodes[s.currentId].doc.features.map((f) => f.id));
  useAiRun.setState({ running: true, startedAt: performance.now(), phase: "Denkt nach …", born: {} });
};
export const endRun = () => useAiRun.setState({ running: false, phase: "" });
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

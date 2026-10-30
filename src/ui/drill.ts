/**
 * ⌘-click drill-down: `chain` runs from the outermost group to the clicked object. The
 * next pick is one level below what is selected now, and wraps back to the top.
 */
export function nextDrill(chain: string[], selection: string[]): string {
  const deepest = chain.reduce((found, id, i) => (selection.includes(id) ? i : found), -1);
  return chain[(deepest + 1) % chain.length];
}

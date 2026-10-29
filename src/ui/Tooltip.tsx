// One global tooltip layer: any element with data-tip (and optional data-kbd="mod+z")
// gets a small delayed tooltip with the shortcut rendered as keycaps.
import { useEffect, useState } from "react";
import { shortcutKeys } from "../core/commands";

interface Tip {
  text: string;
  keys: string[];
  x: number;
  y: number;
  pos: string;
}

export function Kbd({ keys }: { keys: string[] }) {
  return (
    <span className="kbd-row">
      {keys.map((k, i) => (
        <kbd key={i} className="keycap">{k}</kbd>
      ))}
    </span>
  );
}

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    let timer: number | undefined;
    let current: HTMLElement | null = null;
    const hide = () => {
      window.clearTimeout(timer);
      current = null;
      setTip(null);
    };
    const over = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-tip]");
      if (el === current) return;
      hide();
      if (!el || !el.dataset.tip) return;
      current = el;
      timer = window.setTimeout(() => {
        if (current !== el || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        const pos = el.dataset.tipPos ?? "bottom";
        const x = pos === "right" ? r.right + 10 : pos === "bottom-end" ? r.right : r.left + r.width / 2;
        const y = pos === "right" ? r.top + r.height / 2 : pos === "top" ? r.top - 10 : r.bottom + 8;
        setTip({ text: el.dataset.tip!, keys: el.dataset.kbd ? shortcutKeys(el.dataset.kbd) : [], x, y, pos });
      }, 400);
    };
    window.addEventListener("mouseover", over);
    window.addEventListener("pointerdown", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      window.removeEventListener("mouseover", over);
      window.removeEventListener("pointerdown", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  if (!tip) return null;
  return (
    <div className={`tooltip pos-${tip.pos}`} style={{ left: tip.x, top: tip.y }} role="tooltip">
      <span>{tip.text}</span>
      {tip.keys.length > 0 && <Kbd keys={tip.keys} />}
    </div>
  );
}

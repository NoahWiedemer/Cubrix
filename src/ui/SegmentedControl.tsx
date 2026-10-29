// One segmented control for every option group: a highlight pill glides to the
// selected option (transform-only, ~200 ms) and label colours crossfade.
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

export interface Segment<T extends string> {
  value: T;
  label?: ReactNode;
  icon?: ReactNode;
  tip?: string;
  kbd?: string;
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  className = "",
  size = "md",
  tipPos = "bottom",
}: {
  value: T;
  options: Segment<T>[];
  onChange(v: T): void;
  className?: string;
  size?: "sm" | "md";
  tipPos?: "top" | "bottom";
}) {
  const wrap = useRef<HTMLDivElement>(null);
  // Full-width bars have equal segments: the pill is positioned by index in pure CSS.
  const equal = className.split(" ").includes("block");
  const index = options.findIndex((o) => o.value === value);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  const first = useRef(true);

  useLayoutEffect(() => {
    const measure = () => {
      const el = wrap.current?.querySelector<HTMLButtonElement>(`[data-value="${CSS.escape(value)}"]`);
      if (el) setPill({ x: el.offsetLeft, w: el.offsetWidth });
    };
    measure();
    // Buttons can change size without the wrapper doing so (web fonts loading, flex reflow).
    const ro = new ResizeObserver(measure);
    if (wrap.current) {
      ro.observe(wrap.current);
      wrap.current.querySelectorAll("button").forEach((b) => ro.observe(b));
    }
    void document.fonts?.ready.then(measure);
    return () => ro.disconnect();
  }, [value, options.length]);

  useLayoutEffect(() => {
    if (pill) requestAnimationFrame(() => (first.current = false));
  }, [pill]);

  return (
    <div ref={wrap} className={`segmented ${size} ${className}`} role="tablist" style={{ ["--n" as string]: options.length }}>
      {equal && index >= 0 && <span className="segmented-pill equal" style={{ transform: `translateX(calc(${index} * (100% + 2px)))` }} />}
      {!equal && pill && (
        <span
          className={`segmented-pill ${first.current ? "no-anim" : ""}`}
          style={{ width: pill.w, transform: `translateX(${pill.x}px)` }}
        />
      )}
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          data-value={o.value}
          className={o.value === value ? "on" : ""}
          onClick={() => onChange(o.value)}
          data-tip={o.tip}
          data-kbd={o.kbd}
          data-tip-pos={tipPos}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

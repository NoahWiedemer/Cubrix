import { useEffect, useRef, useState } from "react";

/** Eases a number towards its target (ease-out cubic) over `ms`. */
export function useAnimatedNumber(target: number, ms: number): number {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  const current = useRef(target);
  useEffect(() => {
    from.current = current.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const v = from.current + (target - from.current) * (1 - Math.pow(1 - t, 3));
      current.current = v;
      setValue(v);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

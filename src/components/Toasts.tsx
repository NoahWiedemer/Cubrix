import { CheckCircle2, AlertCircle, Info } from "lucide-react";
import { useApp } from "../core/store";

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === "success" ? <CheckCircle2 size={16} /> : t.kind === "error" ? <AlertCircle size={16} /> : <Info size={16} />}
          {t.text}
        </div>
      ))}
    </div>
  );
}

// Voice input: first click records, second click stops, transcribes (OpenAI, via Rust)
// and hands the text to `onText`. Esc cancels.
import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { useApp } from "../core/store";
import { isTauri } from "../core/platform";
import { friendlyError, type FriendlyError } from "../ai/errors";

async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

const blobToBase64 = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = reject;
    r.readAsDataURL(b);
  });

export function VoiceButton({ onText, onError, disabled }: { onText(t: string): void; onError(e: FriendlyError): void; disabled?: boolean }) {
  const [state, setState] = useState<"idle" | "recording" | "transcribing">("idle");
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const rec = useRef<{ recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; ctx: AudioContext; raf: number; timer: number; cancelled: boolean } | null>(null);

  const cleanup = () => {
    const r = rec.current;
    if (!r) return;
    cancelAnimationFrame(r.raf);
    clearInterval(r.timer);
    r.stream.getTracks().forEach((t) => t.stop());
    void r.ctx.close();
    rec.current = null;
    setLevel(0);
  };

  const start = async () => {
    if (isTauri && !(await invoke<boolean>("ai_has_key", { provider: "openai" }).catch(() => false))) {
      useApp.getState().toast("info", "Für Spracheingabe wird ein OpenAI-Schlüssel benötigt.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const r = { recorder, stream, chunks: [] as Blob[], ctx, raf: 0, timer: 0, cancelled: false };
      const meter = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
        setLevel(Math.min(1, peak / 64));
        r.raf = requestAnimationFrame(meter);
      };
      meter();
      const t0 = Date.now();
      r.timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - t0) / 1000)), 250);
      recorder.ondataavailable = (e) => e.data.size && r.chunks.push(e.data);
      recorder.onstop = async () => {
        const cancelled = r.cancelled;
        const blob = new Blob(r.chunks, { type: recorder.mimeType || "audio/webm" });
        cleanup();
        if (cancelled || blob.size < 1000) return setState("idle");
        setState("transcribing");
        try {
          const text = await invoke<string>("ai_transcribe", { audio: await blobToBase64(blob), mime: blob.type });
          if (text.trim()) onText(text.trim());
        } catch (e) {
          onError(friendlyError(e));
        } finally {
          setState("idle");
        }
      };
      recorder.start();
      rec.current = r;
      setSeconds(0);
      setState("recording");
    } catch (e) {
      onError({ title: "Kein Zugriff auf das Mikrofon.", details: String(e) });
    }
  };

  const stop = (cancel = false) => {
    const r = rec.current;
    if (!r) return;
    r.cancelled = cancel;
    r.recorder.stop();
  };

  useEffect(() => {
    if (state !== "recording") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        stop(true);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [state]);

  useEffect(() => () => stop(true), []);

  if (state === "transcribing")
    return (
      <span className="voice-btn busy" data-tip="Wird umgewandelt …" data-tip-pos="top">
        <span className="spinner" />
      </span>
    );
  if (state === "recording")
    return (
      <>
        <span className="voice-timer">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span>
        <button className="voice-btn recording" onClick={() => stop()} data-tip="Aufnahme beenden und senden (Esc bricht ab)" data-tip-pos="top" style={{ ["--level" as string]: level }}>
          <Square size={11} fill="currentColor" />
        </button>
      </>
    );
  return (
    <button className="voice-btn" disabled={disabled} onClick={start} data-tip="Spracheingabe" data-tip-pos="top">
      <Mic size={15} />
    </button>
  );
}

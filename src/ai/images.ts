// Pictures for the AI: scaled to at most 1568 px on the long edge and compressed as JPEG
// before they go into a message (that is also the size both providers work with).
import type { Message } from "./providers";

export const MAX_EDGE = 1568;
export const MAX_IMAGES = 6;
/** Pictures sent along with a request; older ones become a short placeholder. */
export const SENT_IMAGES = 4;
export const ACCEPTED = "image/png,image/jpeg,image/webp,image/heic,image/heif";

export interface ChatImage {
  /** data:image/jpeg;base64,… */
  url: string;
  width: number;
  height: number;
}

export function fitSize(w: number, h: number, max = MAX_EDGE): [number, number] {
  const k = Math.min(1, max / Math.max(w, h));
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

export async function prepareImage(file: Blob): Promise<ChatImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Dieses Bildformat lässt sich hier nicht öffnen. Bitte als PNG oder JPEG versuchen.");
  }
  const [width, height] = fitSize(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  // JPEG has no transparency: put see-through parts on white.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return { url: canvas.toDataURL("image/jpeg", 0.85), width, height };
}

/** "data:image/jpeg;base64,AAA" → its media type and base64 data. */
export function splitDataUrl(url: string): { media: string; data: string } {
  const m = /^data:([^;]+);base64,(.*)$/.exec(url);
  if (!m) throw new Error("Ungültiges Bild.");
  return { media: m[1], data: m[2] };
}

/** Only the newest pictures go to the model; older ones become a short note (saves tokens). */
export function limitImages(messages: Message[], keep = SENT_IMAGES): Message[] {
  let seen = 0;
  const out = [...messages];
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i];
    if (!m.content.some((b) => b.type === "image")) continue;
    const content = [...m.content];
    for (let k = content.length - 1; k >= 0; k--) {
      if (content[k].type !== "image") continue;
      if (++seen > keep) content[k] = { type: "text", text: "[Älteres Bild, nicht mehr mitgesendet]" };
    }
    out[i] = { ...m, content };
  }
  return out;
}

/** Size limit for pictures saved with a project (data URL characters). */
export const MAX_SAVED_IMAGE_CHARS = 12_000_000;

/** Keeps the newest pictures up to the limit; older messages keep their text. */
export function capEntryImages<T extends { images?: string[] }>(entries: T[], limit = MAX_SAVED_IMAGE_CHARS): T[] {
  let used = 0;
  const out = [...entries];
  for (let i = out.length - 1; i >= 0; i--) {
    const images = out[i].images;
    if (!images?.length) continue;
    const kept = images.filter((url) => (used + url.length <= limit ? ((used += url.length), true) : false));
    if (kept.length !== images.length) {
      const { images: _all, ...rest } = out[i];
      out[i] = (kept.length ? { ...rest, images: kept } : rest) as T;
    }
  }
  return out;
}

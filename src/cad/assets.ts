// Import data (STL/STEP) of the current document, sent to the CAD worker once per asset.
import { useApp } from "../core/store";
import type { Asset } from "../core/document";

const known = new Map<string, Asset>();

/** Keeps the registry in sync with the document (imports, undo, opening projects). */
useApp.subscribe((s) => {
  const assets = s.nodes[s.currentId]?.doc.assets;
  if (assets) for (const [id, a] of Object.entries(assets)) if (!known.has(id)) known.set(id, a);
});

export const assetById = (id: string) => known.get(id);
export const registerAsset = (id: string, a: Asset) => known.set(id, a);

export function base64ToBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export function bufferToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

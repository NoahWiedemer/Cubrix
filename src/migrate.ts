// One-time migration after the rename to Cubrix: copy persisted
// browser storage to the new keys. Imported first so stores
// hydrate afterwards. The WebKit data folder itself is copied by the Rust side.
const KEYS = ["layout", "settings", "ai", "lastValues", "lastPrinter"];
for (const key of KEYS) {
  try {
    if (localStorage.getItem(`cubrix.${key}`) !== null) continue;
    const old = localStorage.getItem(`albedo.${key}`);
    if (old !== null) localStorage.setItem(`cubrix.${key}`, old);
  } catch {
    /* storage unavailable */
  }
}

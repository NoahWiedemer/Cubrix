// One-time migration after the renames Modelonio → Albedo → Cubrix: copy persisted
// browser storage to the new keys (newest old name wins). Imported first so stores
// hydrate afterwards. The WebKit data folder itself is copied by the Rust side.
const KEYS = ["layout", "settings", "ai", "lastValues", "lastPrinter"];
for (const key of KEYS) {
  try {
    if (localStorage.getItem(`cubrix.${key}`) !== null) continue;
    const old = localStorage.getItem(`albedo.${key}`) ?? localStorage.getItem(`modelonio.${key}`);
    if (old !== null) localStorage.setItem(`cubrix.${key}`, old);
  } catch {
    /* storage unavailable */
  }
}

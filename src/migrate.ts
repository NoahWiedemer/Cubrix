// One-time migration after the rename Modelonio → Albedo: copy persisted
// browser storage to the new keys. Imported first so stores hydrate afterwards.
for (const key of ["layout", "settings", "ai"]) {
  try {
    const old = localStorage.getItem(`modelonio.${key}`);
    if (old !== null && localStorage.getItem(`albedo.${key}`) === null) localStorage.setItem(`albedo.${key}`, old);
  } catch {
    /* storage unavailable */
  }
}

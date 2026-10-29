# Albedo veröffentlichen

Releases entstehen automatisch auf GitHub, sobald ein Versions-Tag (`v…`) gepusht wird.
Der Workflow `.github/workflows/release.yml` baut dann:

- **macOS:** `Albedo_X.Y.Z_universal.dmg` (Apple Silicon + Intel)
- **Windows:** `Albedo_X.Y.Z_x64-setup.exe` und `Albedo_X.Y.Z_x64_en-US.msi`

und veröffentlicht sie als GitHub-Release „Albedo vX.Y.Z“ mit automatisch erzeugten Notizen.
Die Builds sind noch **nicht signiert** (macOS: beim ersten Start Rechtsklick → „Öffnen“;
Windows: SmartScreen „Trotzdem ausführen“).

## Neue Version

1. Alles committen, Tests und Build prüfen:
   ```bash
   npm test && npm run build
   ```
2. Version erhöhen, committen und taggen (hält `package.json`, `tauri.conf.json` und `Cargo.toml` synchron):
   ```bash
   npm run release:patch   # 0.1.0 → 0.1.1
   npm run release:minor   # 0.1.0 → 0.2.0
   ```
3. Hochladen – der Tag startet den Release-Build:
   ```bash
   git push && git push origin vX.Y.Z
   ```
4. Nach etwa 15–25 Minuten erscheint der Release unter
   https://github.com/NoahWiedemer/modelonio/releases

Der Workflow lässt sich auch manuell unter **Actions → Release → Run workflow** starten.
Für das Anlegen des Releases genügt das Standard-Token (`permissions: contents: write` im Workflow).

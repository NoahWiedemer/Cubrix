# Cubrix veröffentlichen

Releases entstehen automatisch auf GitHub, sobald ein Versions-Tag (`v…`) gepusht wird.
Der Workflow `.github/workflows/release.yml` baut dann:

- **macOS:** `Cubrix_X.Y.Z_universal.dmg` (Apple Silicon + Intel) und das Update-Paket `.app.tar.gz`
- **Windows:** `Cubrix_X.Y.Z_x64-setup.exe` und `Cubrix_X.Y.Z_x64_en-US.msi`

und veröffentlicht sie als GitHub-Release „Cubrix vX.Y.Z“ mit automatisch erzeugten Notizen.
Die Builds sind noch **nicht signiert** (macOS: beim ersten Start Rechtsklick → „Öffnen“;
Windows: SmartScreen „Trotzdem ausführen“).

## Updates in der App (einmalig einrichten)

Cubrix sucht über **Einstellungen → Updates** bzw. **Logo-Menü → Nach Updates suchen …**
(und automatisch einmal täglich beim Start) nach neuen Versionen. Es liest
`https://github.com/NoahWiedemer/Cubrix/releases/latest/download/latest.json`,
das der Release-Workflow hochlädt. Updates sind mit einem eigenen Schlüsselpaar signiert;
die App installiert nur Pakete, deren Signatur zum öffentlichen Schlüssel in
`src-tauri/tauri.conf.json` (`plugins.updater.pubkey`) passt.

- Privater Schlüssel: `~/.tauri/cubrix-updater.key` (ohne Passwort). **Nie committen**, sicher sichern
  (z. B. im Passwortmanager) – ohne ihn kann keine installierte Version mehr aktualisiert werden.
- Öffentlicher Schlüssel: `~/.tauri/cubrix-updater.key.pub` (steht bereits in `tauri.conf.json`).

GitHub-Secrets anlegen unter **Settings → Secrets and variables → Actions → New repository secret**:

| Name | Wert |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | kompletter Inhalt von `~/.tauri/cubrix-updater.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | leer lassen bzw. weglassen (der Schlüssel hat kein Passwort) |

Den Inhalt kopieren (macOS):
```bash
pbcopy < ~/.tauri/cubrix-updater.key
```

Ohne diese Secrets schlägt der Release-Build fehl (`createUpdaterArtifacts` ist aktiv).
Der normale CI-Build (`build.yml`) erzeugt keine Update-Pakete und braucht sie nicht.
Lokal signiert bauen:
```bash
TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/cubrix-updater.key)" npm run tauri build
```
Lokal ohne Update-Pakete: `npm run tauri build -- --config src-tauri/tauri.ci.conf.json`.

Jeder Release enthält zusätzlich `latest.json`, `Cubrix_universal.app.tar.gz` (+ `.sig`, macOS)
und die `-setup.exe.sig` (Windows). Eine installierte Version findet ein Update, sobald ein
neuerer Release als „latest“ veröffentlicht ist (kein Draft, kein Pre-Release).

## Neue Version

1. Alles committen, Tests und Build prüfen:
   ```bash
   npm test && npm run build
   ```
2. `RELEASE_NOTES.md` aktualisieren (Neuerungen auf Deutsch, kurz; die Liste erscheint im
   Release und im Update-Hinweis der App).
3. Version erhöhen, committen und taggen (hält `package.json`, `tauri.conf.json` und `Cargo.toml` synchron):
   ```bash
   npm run release:patch   # 0.1.0 → 0.1.1
   npm run release:minor   # 0.1.0 → 0.2.0
   ```
4. Hochladen – der Tag startet den Release-Build:
   ```bash
   git push && git push origin vX.Y.Z
   ```
5. Nach etwa 15–25 Minuten erscheint der Release unter
   https://github.com/NoahWiedemer/Cubrix/releases

Der Workflow lässt sich auch manuell unter **Actions → Release → Run workflow** (Tag auswählen) starten, falls er nach dem Tag-Push nicht von selbst losläuft.
Für das Anlegen des Releases genügt das Standard-Token (`permissions: contents: write` im Workflow).

//! Autosave for crash recovery: the latest unsaved project state in
//! <app data>/autosave/current.cubrix (written by the webview every ~30 s).
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("autosave");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("current.cubrix"))
}

#[tauri::command]
pub fn autosave_write(app: AppHandle, text: String) -> Result<(), String> {
    let p = path(&app)?;
    // Write to a temp file first so a crash mid-write never leaves a broken autosave.
    let tmp = p.with_extension("tmp");
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn autosave_read(app: AppHandle) -> Option<String> {
    fs::read_to_string(path(&app).ok()?).ok()
}

#[tauri::command]
pub fn autosave_clear(app: AppHandle) {
    if let Ok(p) = path(&app) {
        let _ = fs::remove_file(p);
    }
}

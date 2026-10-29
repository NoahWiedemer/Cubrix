mod ai;

use tauri::{Emitter, Manager};

/// Shows the main window and closes the splash (idempotent).
fn show_main(app: &tauri::AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        if !main.is_visible().unwrap_or(false) {
            let _ = main.show();
            let _ = main.set_focus();
        }
    }
    if let Some(splash) = app.get_webview_window("splashscreen") {
        let _ = splash.close();
    }
}

/// Startup steps from the main window ("ui", "kernel", "ready"), forwarded to the splash.
#[tauri::command]
fn boot_progress(app: tauri::AppHandle, step: String) {
    if app.get_webview_window("splashscreen").is_none() {
        if step == "ready" {
            show_main(&app);
        }
        return;
    }
    let _ = app.emit_to("splashscreen", "boot-progress", step.clone());
    if step == "ready" {
        // Safety net in case the splash never reports back.
        let handle = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(4));
            show_main(&handle);
        });
    }
}

/// The splash finished its animation after the app was ready.
#[tauri::command]
fn splash_finished(app: tauri::AppHandle) {
    show_main(&app);
}

/// Lets the frontend write short status lines to the terminal running the app.
#[tauri::command]
fn log_status(message: String) {
    println!("[albedo] {message}");
}

/// One-time copy of the webview storage (layout, settings) from the old app
/// identifier after the rename Modelonio → Albedo. Never overwrites new data.
fn migrate_webview_data() {
    let pairs = [("de.codana.modelonio", "de.codana.albedo"), ("modelonio", "albedo")];
    let bases: Vec<std::path::PathBuf> = if cfg!(target_os = "macos") {
        std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join("Library/WebKit")).into_iter().collect()
    } else if cfg!(target_os = "windows") {
        std::env::var_os("LOCALAPPDATA").map(std::path::PathBuf::from).into_iter().collect()
    } else {
        vec![]
    };
    for base in bases {
        for (old, new) in pairs {
            let (from, to) = (base.join(old), base.join(new));
            if from.is_dir() && !to.exists() {
                let _ = copy_dir(&from, &to);
            }
        }
    }
}

fn copy_dir(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    migrate_webview_data();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(ai::AiState::default())
        .invoke_handler(tauri::generate_handler![
            log_status,
            boot_progress,
            splash_finished,
            ai::ai_set_key,
            ai::ai_has_key,
            ai::ai_stream,
            ai::ai_cancel,
            ai::ai_test,
            ai::ai_models
        ])
        .run(tauri::generate_context!())
        .expect("error while running Albedo");
}

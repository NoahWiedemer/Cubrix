/// Lets the frontend write short status lines to the terminal running the app.
#[tauri::command]
fn log_status(message: String) {
    println!("[modelonio] {message}");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![log_status])
        .run(tauri::generate_context!())
        .expect("error while running Modelonio");
}

//! Persistent error log: the newest 100 entries as JSON lines in
//! <app data>/logs/errors.jsonl. Anything key-like is redacted before writing.
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime};

const KEEP: usize = 100;
static LOCK: Mutex<()> = Mutex::new(());

fn log_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("logs");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("errors.jsonl"))
}

/// Replaces API keys, bearer tokens and other long secret-looking tokens.
pub fn redact(text: &str) -> String {
    let is_tok = |c: char| c.is_ascii_alphanumeric() || c == '-' || c == '_';
    let mut out = String::with_capacity(text.len());
    let mut tok = String::new();
    let flush = |tok: &mut String, out: &mut String| {
        let secret = tok.starts_with("sk-")
            || tok.starts_with("sess-")
            || (tok.len() >= 32 && tok.chars().any(|c| c.is_ascii_digit()) && tok.chars().any(|c| c.is_ascii_alphabetic()));
        out.push_str(if secret { "[REDACTED]" } else { tok });
        tok.clear();
    };
    for c in text.chars() {
        if is_tok(c) {
            tok.push(c);
        } else {
            flush(&mut tok, &mut out);
            out.push(c);
        }
    }
    flush(&mut tok, &mut out);
    // Header-style leaks ("Authorization: Bearer xyz", "x-api-key: xyz").
    for marker in ["Bearer ", "bearer ", "x-api-key: ", "api_key=", "\"api_key\":\""] {
        while let Some(i) = out.find(marker) {
            let start = i + marker.len();
            if out[start..].starts_with("[REDACTED]") {
                break;
            }
            let end = out[start..].find(|c: char| c.is_whitespace() || c == '"' || c == ',').map_or(out.len(), |e| start + e);
            out.replace_range(start..end, "[REDACTED]");
        }
    }
    out
}

/// Appends one entry ({source, message, details?}) with timestamp and app version.
pub fn append<R: Runtime>(app: &AppHandle<R>, mut entry: serde_json::Value) -> Result<(), String> {
    let _guard = LOCK.lock().unwrap();
    let path = log_path(app)?;
    if let Some(obj) = entry.as_object_mut() {
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
        obj.insert("time".into(), serde_json::json!(now as u64));
        obj.insert("version".into(), serde_json::json!(app.package_info().version.to_string()));
    }
    let mut line = redact(&entry.to_string());
    line.truncate(8000);
    let mut lines: Vec<String> = std::fs::read_to_string(&path).unwrap_or_default().lines().map(String::from).collect();
    lines.push(line);
    let start = lines.len().saturating_sub(KEEP);
    let mut f = std::fs::File::create(&path).map_err(|e| e.to_string())?;
    for l in &lines[start..] {
        writeln!(f, "{l}").map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn log_error(app: AppHandle, entry: serde_json::Value) -> Result<(), String> {
    append(&app, entry)
}

#[tauri::command]
pub fn errors_read(app: AppHandle) -> Vec<serde_json::Value> {
    let Ok(path) = log_path(&app) else { return vec![] };
    std::fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect()
}

#[tauri::command]
pub fn errors_clear(app: AppHandle) -> Result<(), String> {
    let path = log_path(&app)?;
    std::fs::write(path, "").map_err(|e| e.to_string())
}

#[tauri::command]
pub fn errors_dir(app: AppHandle) -> Result<String, String> {
    Ok(log_path(&app)?.parent().unwrap().to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::redact;

    #[test]
    fn redacts_keys() {
        let s = redact(r#"{"error":"bad key sk-ant-api03-AbCdEf123456","h":"Authorization: Bearer abc.def","k":"x-api-key: 1234"}"#);
        assert!(!s.contains("AbCdEf123456"));
        assert!(!s.contains("abc.def"));
        assert!(!s.contains("1234"));
        assert!(redact("Quader 2 abrunden (2 mm)") == "Quader 2 abrunden (2 mm)");
    }
}

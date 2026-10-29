//! AI provider bridge. API keys are stored by Rust in the app data folder and never
//! reach the webview; requests are proxied here (no CORS) and streamed back via a channel.
use futures_util::StreamExt;
use std::collections::HashMap;
use std::sync::Mutex;
use std::fs;
use std::path::PathBuf;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use tokio::sync::oneshot;

#[derive(Default)]
pub struct AiState {
    cancels: Mutex<HashMap<String, oneshot::Sender<()>>>,
}

/// API keys live in `<app data>/secrets.json` (mode 0600), XOR-obfuscated with a random
/// per-install key in `secrets.key`. Only Rust reads or writes them; the webview only
/// learns whether a key is set. (No OS keychain: unsigned dev builds made it prompt.)
fn secrets_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn write_private(path: &PathBuf, data: &[u8]) -> Result<(), String> {
    fs::write(path, data).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn install_key(app: &AppHandle) -> Result<Vec<u8>, String> {
    let path = secrets_dir(app)?.join("secrets.key");
    if let Ok(k) = fs::read(&path) {
        if k.len() == 32 {
            return Ok(k);
        }
    }
    let mut k = vec![0u8; 32];
    getrandom::getrandom(&mut k).map_err(|e| e.to_string())?;
    write_private(&path, &k)?;
    Ok(k)
}

fn xor(data: &[u8], key: &[u8]) -> Vec<u8> {
    data.iter().enumerate().map(|(i, b)| b ^ key[i % key.len()]).collect()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn unhex(s: &str) -> Option<Vec<u8>> {
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(s.get(i..i + 2)?, 16).ok()).collect()
}

fn load_secrets(app: &AppHandle) -> HashMap<String, String> {
    let Ok(dir) = secrets_dir(app) else { return HashMap::new() };
    fs::read_to_string(dir.join("secrets.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn key(app: &AppHandle, provider: &str) -> Result<String, String> {
    let stored = load_secrets(app).remove(provider).ok_or("Kein API-Schlüssel hinterlegt")?;
    let bytes = unhex(&stored).ok_or("Gespeicherter Schlüssel ist beschädigt")?;
    String::from_utf8(xor(&bytes, &install_key(app)?)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ai_set_key(app: AppHandle, provider: String, key: String) -> Result<(), String> {
    let mut secrets = load_secrets(&app);
    let k = key.trim();
    if k.is_empty() {
        secrets.remove(&provider);
    } else {
        secrets.insert(provider, hex(&xor(k.as_bytes(), &install_key(&app)?)));
    }
    let json = serde_json::to_vec_pretty(&secrets).map_err(|e| e.to_string())?;
    write_private(&secrets_dir(&app)?.join("secrets.json"), &json)
}

#[tauri::command]
pub fn ai_has_key(app: AppHandle, provider: String) -> bool {
    key(&app, &provider).is_ok()
}

fn endpoint(provider: &str) -> Result<&'static str, String> {
    match provider {
        "anthropic" => Ok("https://api.anthropic.com/v1/messages"),
        "openai" => Ok("https://api.openai.com/v1/responses"),
        _ => Err(format!("Unbekannter Anbieter: {provider}")),
    }
}

fn request(app: &AppHandle, provider: &str, body: &serde_json::Value) -> Result<reqwest::RequestBuilder, String> {
    let key = key(app, provider)?;
    let client = reqwest::Client::new();
    let req = client.post(endpoint(provider)?).json(body);
    Ok(match provider {
        "anthropic" => req.header("x-api-key", key).header("anthropic-version", "2023-06-01"),
        _ => req.bearer_auth(key),
    })
}

/// Sends a streaming request; raw SSE text chunks are forwarded to `on_chunk`.
#[tauri::command]
pub async fn ai_stream(
    app: AppHandle,
    state: State<'_, AiState>,
    request_id: String,
    provider: String,
    body: serde_json::Value,
    on_chunk: Channel<String>,
) -> Result<(), String> {
    let (tx, mut rx) = oneshot::channel();
    state.cancels.lock().unwrap().insert(request_id.clone(), tx);
    let result = async {
        let res = request(&app, &provider, &body)?.send().await.map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            let status = res.status();
            let text = res.text().await.unwrap_or_default();
            return Err(format!("{status}: {text}"));
        }
        let mut stream = res.bytes_stream();
        loop {
            tokio::select! {
                _ = &mut rx => return Ok(()),
                chunk = stream.next() => match chunk {
                    Some(Ok(bytes)) => { let _ = on_chunk.send(String::from_utf8_lossy(&bytes).into_owned()); }
                    Some(Err(e)) => return Err(e.to_string()),
                    None => return Ok(()),
                }
            }
        }
    }
    .await;
    state.cancels.lock().unwrap().remove(&request_id);
    result
}

#[tauri::command]
pub fn ai_cancel(state: State<'_, AiState>, request_id: String) {
    if let Some(tx) = state.cancels.lock().unwrap().remove(&request_id) {
        let _ = tx.send(());
    }
}

/// Small non-streaming request to check key and model.
#[tauri::command]
pub async fn ai_test(app: AppHandle, provider: String, body: serde_json::Value) -> Result<(), String> {
    let res = request(&app, &provider, &body)?.send().await.map_err(|e| e.to_string())?;
    if res.status().is_success() {
        Ok(())
    } else {
        let status = res.status();
        Err(format!("{status}: {}", res.text().await.unwrap_or_default()))
    }
}

/// Lists the provider's models (GET /v1/models) with the stored key.
#[tauri::command]
pub async fn ai_models(app: AppHandle, provider: String) -> Result<serde_json::Value, String> {
    let url = match provider.as_str() {
        "anthropic" => "https://api.anthropic.com/v1/models?limit=100",
        "openai" => "https://api.openai.com/v1/models",
        _ => return Err(format!("Unbekannter Anbieter: {provider}")),
    };
    let key = key(&app, &provider)?;
    let client = reqwest::Client::new();
    let req = client.get(url);
    let req = match provider.as_str() {
        "anthropic" => req.header("x-api-key", key).header("anthropic-version", "2023-06-01"),
        _ => req.bearer_auth(key),
    };
    let res = req.send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("{}", res.status()));
    }
    res.json().await.map_err(|e| e.to_string())
}

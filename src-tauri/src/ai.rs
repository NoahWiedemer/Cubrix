//! AI provider bridge. API keys live in the OS keychain and never reach the
//! webview; requests are proxied here (no CORS) and streamed back via a channel.
use futures_util::StreamExt;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::ipc::Channel;
use tauri::State;
use tokio::sync::oneshot;

const SERVICE: &str = "de.codana.albedo";
/// Keychain service used before the rename to Albedo.
const OLD_SERVICE: &str = "de.codana.modelonio";

#[derive(Default)]
pub struct AiState {
    cancels: Mutex<HashMap<String, oneshot::Sender<()>>>,
}

fn entry(provider: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, &format!("api-key-{provider}")).map_err(|e| e.to_string())
}

fn key(provider: &str) -> Result<String, String> {
    let current = entry(provider)?;
    if let Ok(k) = current.get_password() {
        return Ok(k);
    }
    // One-time migration from the old keychain service.
    let old = keyring::Entry::new(OLD_SERVICE, &format!("api-key-{provider}")).map_err(|e| e.to_string())?;
    let k = old.get_password().map_err(|_| "Kein API-Schlüssel hinterlegt".to_string())?;
    if current.set_password(&k).is_ok() {
        let _ = old.delete_credential();
    }
    Ok(k)
}

#[tauri::command]
pub fn ai_set_key(provider: String, key: String) -> Result<(), String> {
    let e = entry(&provider)?;
    if key.trim().is_empty() {
        let _ = e.delete_credential();
        return Ok(());
    }
    e.set_password(key.trim()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ai_has_key(provider: String) -> bool {
    key(&provider).is_ok()
}

fn endpoint(provider: &str) -> Result<&'static str, String> {
    match provider {
        "anthropic" => Ok("https://api.anthropic.com/v1/messages"),
        "openai" => Ok("https://api.openai.com/v1/chat/completions"),
        _ => Err(format!("Unbekannter Anbieter: {provider}")),
    }
}

fn request(provider: &str, body: &serde_json::Value) -> Result<reqwest::RequestBuilder, String> {
    let key = key(provider)?;
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
    state: State<'_, AiState>,
    request_id: String,
    provider: String,
    body: serde_json::Value,
    on_chunk: Channel<String>,
) -> Result<(), String> {
    let (tx, mut rx) = oneshot::channel();
    state.cancels.lock().unwrap().insert(request_id.clone(), tx);
    let result = async {
        let res = request(&provider, &body)?.send().await.map_err(|e| e.to_string())?;
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
pub async fn ai_test(provider: String, body: serde_json::Value) -> Result<(), String> {
    let res = request(&provider, &body)?.send().await.map_err(|e| e.to_string())?;
    if res.status().is_success() {
        Ok(())
    } else {
        let status = res.status();
        Err(format!("{status}: {}", res.text().await.unwrap_or_default()))
    }
}

/// Lists the provider's models (GET /v1/models) with the stored key.
#[tauri::command]
pub async fn ai_models(provider: String) -> Result<serde_json::Value, String> {
    let url = match provider.as_str() {
        "anthropic" => "https://api.anthropic.com/v1/models?limit=100",
        "openai" => "https://api.openai.com/v1/models",
        _ => return Err(format!("Unbekannter Anbieter: {provider}")),
    };
    let key = key(&provider)?;
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

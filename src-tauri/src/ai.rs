//! AI provider bridge. API keys are stored by Rust in the app data folder and never
//! reach the webview; requests are proxied here (no CORS) and streamed back via a channel.
use futures_util::StreamExt;
use std::collections::HashMap;
use std::sync::Mutex;
use std::fs;
use std::path::PathBuf;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Runtime, State};
use tokio::sync::oneshot;

#[derive(Default)]
pub struct AiState {
    cancels: Mutex<HashMap<String, oneshot::Sender<()>>>,
}

/// API keys live in `<app data>/secrets.json` (mode 0600), XOR-obfuscated with a random
/// per-install key in `secrets.key`. Only Rust reads or writes them; the webview only
/// learns whether a key is set. (No OS keychain: unsigned dev builds made it prompt.)
pub(crate) fn secrets_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub(crate) fn write_private(path: &PathBuf, data: &[u8]) -> Result<(), String> {
    fs::write(path, data).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// After a rename (Albedo → Cubrix) the app data folder changes with the bundle id: copy the
/// API keys (secrets.json + secrets.key, mode 0600) and the error log over once, so
/// nothing has to be re-entered. Never overwrites data in the new folder.
pub fn migrate_app_data(app: &AppHandle) {
    let Ok(new_dir) = app.path().app_data_dir() else { return };
    let Some(parent) = new_dir.parent() else { return };
    for old_id in ["de.codana.albedo"] {
        let old = parent.join(old_id);
        if !old.is_dir() || new_dir.join("secrets.json").exists() {
            continue;
        }
        let _ = fs::create_dir_all(&new_dir);
        for name in ["secrets.json", "secrets.key"] {
            if let Ok(data) = fs::read(old.join(name)) {
                let _ = write_private(&new_dir.join(name), &data);
            }
        }
        let log = old.join("logs").join("errors.jsonl");
        if log.exists() && !new_dir.join("logs").join("errors.jsonl").exists() {
            let _ = fs::create_dir_all(new_dir.join("logs"));
            let _ = fs::copy(&log, new_dir.join("logs").join("errors.jsonl"));
        }
        println!("[cubrix] App-Daten aus {old_id} übernommen");
        break;
    }
}

fn install_key<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<u8>, String> {
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

/// Stored key (the secret itself stays obfuscated on disk and never leaves Rust).
#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct StoredKey {
    id: String,
    provider: String,
    name: String,
    /// Hex of the XOR-obfuscated key.
    key: String,
    #[serde(rename = "createdAt")]
    created_at: u64,
}

#[derive(serde::Serialize, serde::Deserialize, Default)]
struct Secrets {
    version: u32,
    keys: Vec<StoredKey>,
    /// Active key id per provider.
    active: HashMap<String, String>,
    /// Secrets of MCP servers: server id → name ("url", "header:…", "env:…") → obfuscated hex.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    mcp: HashMap<String, HashMap<String, String>>,
}

/// What the webview may see about a key.
#[derive(serde::Serialize)]
pub struct KeyInfo {
    id: String,
    provider: String,
    name: String,
    masked: String,
    #[serde(rename = "createdAt")]
    created_at: u64,
    active: bool,
}

pub(crate) fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn provider_label(p: &str) -> &'static str {
    if p == "anthropic" { "Anthropic" } else { "OpenAI" }
}

fn default_name(secrets: &Secrets, provider: &str) -> String {
    let base = format!("{}-Schlüssel", provider_label(provider));
    (1..).map(|i| format!("{base} {i}")).find(|n| !secrets.keys.iter().any(|k| &k.name == n)).unwrap()
}

/// Reads secrets.json; the old format (`{"openai": "<hex>", …}`) is migrated once.
fn load_secrets<R: Runtime>(app: &AppHandle<R>) -> Secrets {
    let Ok(dir) = secrets_dir(app) else { return Secrets::default() };
    let Ok(text) = fs::read_to_string(dir.join("secrets.json")) else { return Secrets { version: 2, ..Default::default() } };
    if let Ok(s) = serde_json::from_str::<Secrets>(&text) {
        if s.version >= 2 {
            return s;
        }
    }
    let s = migrate_v1(&text);
    let _ = save_secrets(app, &s);
    s
}

/// v1 stored one obfuscated key per provider: `{"openai": "<hex>", …}`. Each becomes a
/// named key ("OpenAI-Schlüssel 1") and the active one of its provider.
fn migrate_v1(text: &str) -> Secrets {
    let old: HashMap<String, String> = serde_json::from_str(text).unwrap_or_default();
    let mut s = Secrets { version: 2, ..Default::default() };
    for provider in ["openai", "anthropic"] {
        if let Some(hex_key) = old.get(provider) {
            let id = format!("k{}-{provider}", now_ms());
            let name = default_name(&s, provider);
            s.keys.push(StoredKey { id: id.clone(), provider: provider.into(), name, key: hex_key.clone(), created_at: now_ms() });
            s.active.insert(provider.into(), id);
        }
    }
    s
}

fn save_secrets<R: Runtime>(app: &AppHandle<R>, s: &Secrets) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(s).map_err(|e| e.to_string())?;
    write_private(&secrets_dir(app)?.join("secrets.json"), &json)
}

fn reveal(app: &AppHandle, k: &StoredKey) -> Result<String, String> {
    let bytes = unhex(&k.key).ok_or("Gespeicherter Schlüssel ist beschädigt")?;
    String::from_utf8(xor(&bytes, &install_key(app)?)).map_err(|e| e.to_string())
}

pub(crate) fn mask(key: &str) -> String {
    let chars: Vec<char> = key.chars().collect();
    if chars.len() < 10 {
        return "…".into();
    }
    let head: String = chars[..3].iter().collect();
    let tail: String = chars[chars.len() - 4..].iter().collect();
    format!("{head}…{tail}")
}

/// Clear-text secrets of one MCP server, for Rust only.
pub(crate) fn mcp_secrets<R: Runtime>(app: &AppHandle<R>, id: &str) -> Result<HashMap<String, String>, String> {
    let s = load_secrets(app);
    let key = install_key(app)?;
    let Some(entries) = s.mcp.get(id) else { return Ok(HashMap::new()) };
    entries
        .iter()
        .map(|(k, v)| {
            let bytes = unhex(v).ok_or("Gespeichertes Geheimnis ist beschädigt")?;
            Ok((k.clone(), String::from_utf8(xor(&bytes, &key)).map_err(|e| e.to_string())?))
        })
        .collect()
}

/// Replaces the secrets of an MCP server; an empty map removes them.
pub(crate) fn mcp_set_secrets<R: Runtime>(app: &AppHandle<R>, id: &str, values: &HashMap<String, String>) -> Result<(), String> {
    let mut s = load_secrets(app);
    let key = install_key(app)?;
    if values.is_empty() {
        s.mcp.remove(id);
    } else {
        s.mcp.insert(id.to_string(), values.iter().map(|(k, v)| (k.clone(), hex(&xor(v.as_bytes(), &key)))).collect());
    }
    if s.version < 2 {
        s.version = 2;
    }
    save_secrets(app, &s)
}

/// The active key of a provider.
fn key(app: &AppHandle, provider: &str) -> Result<String, String> {
    let s = load_secrets(app);
    let id = s.active.get(provider).ok_or("Kein API-Schlüssel hinterlegt")?;
    let k = s.keys.iter().find(|k| &k.id == id).ok_or("Kein API-Schlüssel hinterlegt")?;
    reveal(app, k)
}

fn info(app: &AppHandle, s: &Secrets, k: &StoredKey) -> KeyInfo {
    KeyInfo {
        id: k.id.clone(),
        provider: k.provider.clone(),
        name: k.name.clone(),
        masked: reveal(app, k).map(|v| mask(&v)).unwrap_or_else(|_| "…".into()),
        created_at: k.created_at,
        active: s.active.get(&k.provider) == Some(&k.id),
    }
}

#[tauri::command]
pub fn ai_keys_list(app: AppHandle) -> Vec<KeyInfo> {
    let s = load_secrets(&app);
    s.keys.iter().map(|k| info(&app, &s, k)).collect()
}

/// Checks a key against GET /v1/models before it is stored.
async fn validate(provider: &str, key: &str) -> Result<(), String> {
    let client = reqwest::Client::new();
    let req = match provider {
        "anthropic" => client.get("https://api.anthropic.com/v1/models?limit=1").header("x-api-key", key).header("anthropic-version", "2023-06-01"),
        "openai" => client.get("https://api.openai.com/v1/models").bearer_auth(key),
        _ => return Err(format!("Unbekannter Anbieter: {provider}")),
    };
    let res = req.send().await.map_err(|e| e.to_string())?;
    if res.status().is_success() {
        Ok(())
    } else {
        let status = res.status();
        Err(format!("{status}: {}", res.text().await.unwrap_or_default()))
    }
}

/// Adds a key (validated first); the first key of a provider becomes active.
#[tauri::command]
pub async fn ai_key_add(app: AppHandle, provider: String, key: String, name: Option<String>) -> Result<KeyInfo, String> {
    let k = key.trim().to_string();
    if k.is_empty() {
        return Err("Bitte einen Schlüssel einfügen.".into());
    }
    validate(&provider, &k).await?;
    let mut s = load_secrets(&app);
    let id = format!("k{}", now_ms());
    let name = name.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| default_name(&s, &provider));
    let stored = StoredKey { id: id.clone(), provider: provider.clone(), name, key: hex(&xor(k.as_bytes(), &install_key(&app)?)), created_at: now_ms() };
    s.keys.push(stored.clone());
    s.active.entry(provider).or_insert(id);
    save_secrets(&app, &s)?;
    Ok(info(&app, &s, &stored))
}

#[tauri::command]
pub fn ai_key_rename(app: AppHandle, id: String, name: String) -> Result<(), String> {
    let mut s = load_secrets(&app);
    let k = s.keys.iter_mut().find(|k| k.id == id).ok_or("Schlüssel nicht gefunden")?;
    let n = name.trim();
    if n.is_empty() {
        return Err("Der Name darf nicht leer sein.".into());
    }
    k.name = n.to_string();
    save_secrets(&app, &s)
}

/// Deletes a key; if it was active, the provider's newest remaining key takes over.
#[tauri::command]
pub fn ai_key_delete(app: AppHandle, id: String) -> Result<(), String> {
    let mut s = load_secrets(&app);
    let Some(pos) = s.keys.iter().position(|k| k.id == id) else { return Ok(()) };
    let removed = s.keys.remove(pos);
    if s.active.get(&removed.provider) == Some(&removed.id) {
        match s.keys.iter().filter(|k| k.provider == removed.provider).max_by_key(|k| k.created_at) {
            Some(next) => {
                let nid = next.id.clone();
                s.active.insert(removed.provider.clone(), nid);
            }
            None => {
                s.active.remove(&removed.provider);
            }
        }
    }
    save_secrets(&app, &s)
}

#[tauri::command]
pub fn ai_key_activate(app: AppHandle, id: String) -> Result<(), String> {
    let mut s = load_secrets(&app);
    let provider = s.keys.iter().find(|k| k.id == id).ok_or("Schlüssel nicht gefunden")?.provider.clone();
    s.active.insert(provider, id);
    save_secrets(&app, &s)
}

/// Kept for the dev E2E hook: stores a key without validation and makes it active.
#[tauri::command]
pub fn ai_set_key(app: AppHandle, provider: String, key: String) -> Result<(), String> {
    let k = key.trim();
    if k.is_empty() {
        return Ok(());
    }
    let mut s = load_secrets(&app);
    let id = format!("k{}", now_ms());
    let name = default_name(&s, &provider);
    s.keys.push(StoredKey { id: id.clone(), provider: provider.clone(), name, key: hex(&xor(k.as_bytes(), &install_key(&app)?)), created_at: now_ms() });
    s.active.insert(provider, id);
    save_secrets(&app, &s)
}

#[tauri::command]
pub fn ai_has_key(app: AppHandle, provider: String) -> bool {
    key(&app, &provider).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_keys() {
        assert_eq!(mask("sk-ant-api03-abcdefghijklmnop-a1b2"), "sk-…a1b2");
        assert_eq!(mask("short"), "…");
    }

    #[test]
    fn migrates_v1_single_keys() {
        let s = migrate_v1(r#"{"openai":"aa11","anthropic":"bb22"}"#);
        assert_eq!(s.version, 2);
        assert_eq!(s.keys.len(), 2);
        let openai = s.keys.iter().find(|k| k.provider == "openai").unwrap();
        assert_eq!(openai.name, "OpenAI-Schlüssel 1");
        assert_eq!(openai.key, "aa11"); // still obfuscated, untouched
        assert_eq!(s.active.get("openai"), Some(&openai.id));
        assert_eq!(s.keys.iter().find(|k| k.provider == "anthropic").unwrap().name, "Anthropic-Schlüssel 1");
        // A v2 file is not mistaken for v1.
        let v2 = serde_json::to_string(&s).unwrap();
        assert_eq!(serde_json::from_str::<Secrets>(&v2).unwrap().version, 2);
        assert!(migrate_v1("{}").keys.is_empty());
    }
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
            let model = body.get("model").and_then(|m| m.as_str()).unwrap_or("?");
            let mut trimmed = text.clone();
            trimmed.truncate(2000);
            let _ = crate::errorlog::append(
                &app,
                serde_json::json!({ "source": "ai", "message": format!("HTTP {status}"), "details": { "provider": provider, "model": model, "request": "stream", "body": trimmed } }),
            );
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

#[tauri::command]
pub async fn ai_transcribe(app: AppHandle, audio: String, mime: String) -> Result<String, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(audio).map_err(|e| e.to_string())?;
    let ext = if mime.contains("webm") { "webm" } else if mime.contains("wav") { "wav" } else { "m4a" };
    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name(format!("sprache.{ext}"))
        .mime_str(&mime)
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new()
        .text("model", "gpt-transcribe")
        .text("response_format", "text")
        .part("file", part);
    let res = reqwest::Client::new()
        .post("https://api.openai.com/v1/audio/transcriptions")
        .bearer_auth(key(&app, "openai")?)
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let text = res.text().await.map_err(|e| e.to_string())?;
    if status.is_success() {
        Ok(text.trim().to_string())
    } else {
        Err(format!("{status}: {text}"))
    }
}

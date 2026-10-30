//! Cubrix as an MCP server: external agents (Claude Code, Codex, …) drive the open project
//! over Streamable HTTP. Bound to 127.0.0.1, off by default; every request needs the bearer
//! token, and Host and Origin are checked against DNS rebinding. Tool calls are carried out
//! by the webview, so they run through the same commands as the built-in assistant.
use crate::ai;
use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, State as AxumState};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use futures_util::future::BoxFuture;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU16, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tokio::sync::oneshot;

pub const DEFAULT_PORT: u16 = 7331;
/// How many ports after the wanted one are tried when it is taken.
const PORT_TRIES: u16 = 20;
const VERSIONS: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];
const CALL_TIMEOUT: Duration = Duration::from_secs(180);
const APPROVAL_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_BODY: usize = 8 * 1024 * 1024;

const INSTRUCTIONS: &str = "Cubrix is a parametric CAD app for 3D printing; these tools change the project open in the app, live in its viewport, and every change is undoable.
Units are millimetres, angles degrees. Z points up, the print bed lies at Z = 0 centred on the origin; a primitive's position is the centre of its underside. Tool descriptions are in German.
How to work: call get_scene first (objects with ids, sizes, the printer). Plan the parts with real dimensions, then build as much as possible in one shapes__createMany (parts stack with `on`, rows via `repeat`/`grid`, colour, material, `edges`, `holes` and `groupName` right on the part). Use the batch tools, never loops of single calls: object__pattern, objects__transformMany, object__delete with ids, boolean__subtract/union/intersect with targetId and toolIds. Holes: object__hole; cut-outs and rims: object__pocket; specific edges: edges__fillet/edges__chamfer with a filter; vessels: object__shell; curves are real curves (sketch__ellipse, sketch__roundedRect, sketch__path with arcs), never polygons.
Leave objects the task does not concern alone and build next to them. The unchanged start cube (20 mm \"Quader 1\" as the only object) is a placeholder: delete it first when building something new.
Finish with check_model, fix what it reports, then look at get_screenshot. history__undo and history__redo step through the history, save_project and export_model write to an absolute path. For 3D printing keep walls at 1.2 mm or more and avoid overhangs beyond 45°.";

// ── Protocol ─────────────────────────────────────────────────────────────────

/// What the server needs from the app; a fake one drives the tests.
pub trait Host: Send + Sync + 'static {
    /// `{"kind":"list"}` or `{"kind":"call","name":…,"arguments":…,"client":…}`, answered by the webview.
    fn request(&self, message: Value) -> BoxFuture<'static, Result<Value, String>>;
    /// Sessions or pending approvals changed.
    fn changed(&self);
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    id: String,
    name: String,
    connected_at: u64,
}

pub struct Core {
    token: RwLock<String>,
    port: AtomicU16,
    sessions: Mutex<HashMap<String, Session>>,
    approved: Mutex<HashSet<String>>,
    waiting: Mutex<HashMap<String, Vec<oneshot::Sender<bool>>>>,
    host: Arc<dyn Host>,
}

/// Same time for every wrong token.
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |d, (x, y)| d | (x ^ y)) == 0
}

fn is_loopback_name(host: &str) -> bool {
    matches!(host, "127.0.0.1" | "localhost")
}

impl Core {
    pub fn new(token: String, approved: HashSet<String>, host: Arc<dyn Host>) -> Arc<Self> {
        Arc::new(Core { token: RwLock::new(token), port: AtomicU16::new(0), sessions: Default::default(), approved: Mutex::new(approved), waiting: Default::default(), host })
    }

    /// Host and Origin first: a web page must not even learn whether a token is right.
    fn guard(&self, headers: &HeaderMap) -> Result<(), StatusCode> {
        let port = self.port.load(Ordering::SeqCst);
        let host = headers.get(header::HOST).and_then(|v| v.to_str().ok()).unwrap_or("");
        let host_ok = host.rsplit_once(':').is_some_and(|(name, p)| is_loopback_name(name) && p.parse() == Ok(port));
        if !host_ok {
            return Err(StatusCode::FORBIDDEN);
        }
        if let Some(origin) = headers.get(header::ORIGIN) {
            let ok = origin.to_str().ok().and_then(|o| reqwest::Url::parse(o).ok()).is_some_and(|u| u.host_str().is_some_and(is_loopback_name));
            if !ok {
                return Err(StatusCode::FORBIDDEN);
            }
        }
        let given = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("Bearer ")).unwrap_or("");
        let token = self.token.read().unwrap();
        if token.is_empty() || !same(given, &token) {
            return Err(StatusCode::UNAUTHORIZED);
        }
        Ok(())
    }

    fn session(&self, headers: &HeaderMap) -> Result<Session, StatusCode> {
        let id = headers.get("mcp-session-id").and_then(|v| v.to_str().ok()).ok_or(StatusCode::BAD_REQUEST)?;
        self.sessions.lock().unwrap().get(id).cloned().ok_or(StatusCode::NOT_FOUND)
    }

    fn initialize(&self, params: &Value) -> (Value, String) {
        let raw = params.pointer("/clientInfo/name").and_then(|n| n.as_str()).unwrap_or("Unbekannt");
        let name: String = raw.chars().filter(|c| !c.is_control()).take(60).collect();
        let mut bytes = [0u8; 16];
        let _ = getrandom::getrandom(&mut bytes);
        let id: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
        self.sessions.lock().unwrap().insert(id.clone(), Session { id: id.clone(), name: name.clone(), connected_at: ai::now_ms() });
        if !self.approved.lock().unwrap().contains(&name) {
            self.waiting.lock().unwrap().entry(name).or_default();
        }
        self.host.changed();
        let asked = params.get("protocolVersion").and_then(|v| v.as_str()).unwrap_or("");
        let version = VERSIONS.iter().find(|v| **v == asked).copied().unwrap_or(VERSIONS[0]);
        let result = json!({
            "protocolVersion": version,
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "cubrix", "title": "Cubrix", "version": env!("CARGO_PKG_VERSION") },
            "instructions": INSTRUCTIONS,
        });
        (result, id)
    }

    /// Waits for the user's answer about a new client (the tool list is open to it, the project is not).
    async fn approved(&self, name: &str) -> Result<(), String> {
        if self.approved.lock().unwrap().contains(name) {
            return Ok(());
        }
        let (tx, rx) = oneshot::channel();
        self.waiting.lock().unwrap().entry(name.to_string()).or_default().push(tx);
        self.host.changed();
        match tokio::time::timeout(APPROVAL_TIMEOUT, rx).await {
            Ok(Ok(true)) => Ok(()),
            Ok(_) => Err("Der Nutzer hat diesen Client in Cubrix abgelehnt.".into()),
            Err(_) => Err("Keine Freigabe: Bitte die Anfrage in der Cubrix-App bestätigen und es erneut versuchen.".into()),
        }
    }

    pub fn decide(&self, name: &str, allow: bool) {
        if allow {
            self.approved.lock().unwrap().insert(name.to_string());
        } else {
            self.sessions.lock().unwrap().retain(|_, s| s.name != name);
        }
        for tx in self.waiting.lock().unwrap().remove(name).unwrap_or_default() {
            let _ = tx.send(allow);
        }
        self.host.changed();
    }

    /// Ends a client's sessions and withdraws its approval: it has to ask again.
    pub fn disconnect(&self, name: &str) {
        self.sessions.lock().unwrap().retain(|_, s| s.name != name);
        self.approved.lock().unwrap().remove(name);
        self.host.changed();
    }

    pub fn set_token(&self, token: String) {
        *self.token.write().unwrap() = token;
        self.sessions.lock().unwrap().clear();
        self.host.changed();
    }

    pub fn sessions(&self) -> Vec<Session> {
        self.sessions.lock().unwrap().values().cloned().collect()
    }

    pub fn pending(&self) -> Vec<String> {
        self.waiting.lock().unwrap().keys().cloned().collect()
    }

    pub fn approved_list(&self) -> Vec<String> {
        self.approved.lock().unwrap().iter().cloned().collect()
    }

    async fn call(&self, session: &Session, params: &Value) -> Value {
        let failed = |text: String| json!({ "content": [{ "type": "text", "text": text }], "isError": true });
        if let Err(e) = self.approved(&session.name).await {
            return failed(e);
        }
        let message = json!({ "kind": "call", "name": params.get("name"), "arguments": params.get("arguments").cloned().unwrap_or(json!({})), "client": session.name });
        match tokio::time::timeout(CALL_TIMEOUT, self.host.request(message)).await {
            Ok(Ok(result)) => result,
            Ok(Err(e)) => failed(e),
            Err(_) => failed(format!("Cubrix hat nach {} s nicht geantwortet.", CALL_TIMEOUT.as_secs())),
        }
    }
}

fn rpc_error(id: &Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

async fn post_mcp(AxumState(core): AxumState<Arc<Core>>, headers: HeaderMap, body: Bytes) -> Response {
    if let Err(status) = core.guard(&headers) {
        return unauthorized(status);
    }
    let Ok(msg) = serde_json::from_slice::<Value>(&body) else {
        return (StatusCode::BAD_REQUEST, axum::Json(rpc_error(&Value::Null, -32700, "Parse error"))).into_response();
    };
    let Some(method) = msg.get("method").and_then(|m| m.as_str()) else {
        // Single messages only; answers to server requests do not exist here.
        return StatusCode::ACCEPTED.into_response();
    };
    let Some(id) = msg.get("id").cloned() else { return StatusCode::ACCEPTED.into_response() };
    let params = msg.get("params").cloned().unwrap_or(json!({}));
    let ok = |result: Value| json!({ "jsonrpc": "2.0", "id": id, "result": result });
    if method == "initialize" {
        let (result, session) = core.initialize(&params);
        let mut res = axum::Json(ok(result)).into_response();
        res.headers_mut().insert("mcp-session-id", HeaderValue::from_str(&session).unwrap());
        return res;
    }
    if method == "ping" {
        return axum::Json(ok(json!({}))).into_response();
    }
    let session = match core.session(&headers) {
        Ok(s) => s,
        Err(status) => return status.into_response(),
    };
    let reply = match method {
        "tools/list" => match core.host.request(json!({ "kind": "list" })).await {
            Ok(tools) => ok(json!({ "tools": tools })),
            Err(e) => rpc_error(&id, -32603, &e),
        },
        "tools/call" => ok(core.call(&session, &params).await),
        _ => rpc_error(&id, -32601, "Method not found"),
    };
    axum::Json(reply).into_response()
}

fn unauthorized(status: StatusCode) -> Response {
    if status == StatusCode::UNAUTHORIZED {
        return (status, [(header::WWW_AUTHENTICATE, "Bearer")]).into_response();
    }
    status.into_response()
}

async fn delete_mcp(AxumState(core): AxumState<Arc<Core>>, headers: HeaderMap) -> Response {
    if let Err(status) = core.guard(&headers) {
        return unauthorized(status);
    }
    let session = headers.get("mcp-session-id").and_then(|v| v.to_str().ok()).unwrap_or("");
    core.sessions.lock().unwrap().remove(session);
    core.host.changed();
    StatusCode::NO_CONTENT.into_response()
}

async fn get_mcp(AxumState(core): AxumState<Arc<Core>>, headers: HeaderMap) -> Response {
    if let Err(status) = core.guard(&headers) {
        return unauthorized(status);
    }
    StatusCode::METHOD_NOT_ALLOWED.into_response() // no server-initiated messages
}

/// Binds to the wanted port or one of the next free ones.
pub async fn bind(port: u16) -> Result<tokio::net::TcpListener, String> {
    for p in port..=port.saturating_add(PORT_TRIES) {
        if let Ok(listener) = tokio::net::TcpListener::bind(("127.0.0.1", p)).await {
            return Ok(listener);
        }
    }
    Err(format!("Kein freier Port ab {port} gefunden."))
}

pub async fn serve(core: Arc<Core>, listener: tokio::net::TcpListener) -> Result<(), String> {
    core.port.store(listener.local_addr().map_err(|e| e.to_string())?.port(), Ordering::SeqCst);
    let app = axum::Router::new().route("/mcp", post(post_mcp).delete(delete_mcp).get(get_mcp)).layer(DefaultBodyLimit::max(MAX_BODY)).with_state(core);
    axum::serve(listener, app).await.map_err(|e| e.to_string())
}

// ── In the app ───────────────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
struct Config {
    enabled: bool,
    port: u16,
    approved: Vec<String>,
}

impl Default for Config {
    fn default() -> Self {
        Config { enabled: false, port: DEFAULT_PORT, approved: vec![] }
    }
}

fn config_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(ai::secrets_dir(app)?.join("connector.json"))
}

fn load_config<R: Runtime>(app: &AppHandle<R>) -> Config {
    config_path(app).ok().and_then(|p| fs::read_to_string(p).ok()).and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn save_config<R: Runtime>(app: &AppHandle<R>, c: &Config) -> Result<(), String> {
    ai::write_private(&config_path(app)?, &serde_json::to_vec_pretty(c).map_err(|e| e.to_string())?)
}

/// Bridges to the webview: a request goes out as an event, the answer comes via `connector_reply`.
struct AppHost<R: Runtime> {
    app: AppHandle<R>,
    replies: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>,
    next: AtomicU64,
}

impl<R: Runtime> Host for AppHost<R> {
    fn request(&self, message: Value) -> BoxFuture<'static, Result<Value, String>> {
        let id = self.next.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.replies.lock().unwrap().insert(id, tx);
        let sent = self.app.emit("connector-request", json!({ "id": id, "message": message }));
        Box::pin(async move {
            sent.map_err(|e| e.to_string())?;
            rx.await.map_err(|_| "Cubrix antwortet nicht.".to_string())?
        })
    }

    fn changed(&self) {
        let _ = self.app.emit("connector-changed", ());
        // The approved list survives restarts; a waiting client should be noticed.
        if let Some(core) = self.app.state::<ConnectorState>().core() {
            let mut c = load_config(&self.app);
            c.approved = core.approved_list();
            let _ = save_config(&self.app, &c);
            if !core.pending().is_empty() {
                if let Some(w) = self.app.get_webview_window("main") {
                    let _ = w.request_user_attention(Some(tauri::UserAttentionType::Informational));
                }
            }
        }
    }
}

struct Running {
    core: Arc<Core>,
    port: u16,
    task: tauri::async_runtime::JoinHandle<()>,
}

#[derive(Default)]
pub struct ConnectorState {
    running: Mutex<Option<Running>>,
    replies: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>,
    error: Mutex<Option<String>>,
}

impl ConnectorState {
    /// A handle without the lock: Core calls back into `changed`, which needs it too.
    fn core(&self) -> Option<Arc<Core>> {
        self.running.lock().unwrap().as_ref().map(|r| r.core.clone())
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    enabled: bool,
    port: u16,
    running: bool,
    running_port: Option<u16>,
    error: Option<String>,
    clients: Vec<Session>,
    pending: Vec<String>,
    approved: Vec<String>,
}

fn status<R: Runtime>(app: &AppHandle<R>, state: &ConnectorState) -> Status {
    let c = load_config(app);
    let core = state.core();
    let running_port = state.running.lock().unwrap().as_ref().map(|r| r.port);
    Status {
        enabled: c.enabled,
        port: c.port,
        running: core.is_some(),
        running_port,
        error: state.error.lock().unwrap().clone(),
        clients: core.as_ref().map(|r| r.sessions()).unwrap_or_default(),
        pending: core.as_ref().map(|r| r.pending()).unwrap_or_default(),
        approved: core.as_ref().map(|r| r.approved_list()).unwrap_or(c.approved),
    }
}

fn stop(state: &ConnectorState) {
    if let Some(r) = state.running.lock().unwrap().take() {
        r.task.abort();
    }
}

async fn start<R: Runtime>(app: &AppHandle<R>, state: &ConnectorState) -> Result<(), String> {
    stop(state);
    let c = load_config(app);
    let listener = bind(c.port).await?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let host = Arc::new(AppHost { app: app.clone(), replies: state.replies.clone(), next: AtomicU64::new(1) });
    let core = Core::new(ai::connector_token(app)?, c.approved.into_iter().collect(), host);
    let task = tauri::async_runtime::spawn({
        let core = core.clone();
        async move {
            let _ = serve(core, listener).await;
        }
    });
    *state.running.lock().unwrap() = Some(Running { core, port, task });
    Ok(())
}

/// Starts the server after launch if the user switched it on.
pub fn autostart<R: Runtime>(app: &AppHandle<R>) {
    if !load_config(app).enabled {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<ConnectorState>();
        let result = start(&app, &state).await;
        *state.error.lock().unwrap() = result.err();
        let _ = app.emit("connector-changed", ());
    });
}

#[tauri::command]
pub fn connector_status<R: Runtime>(app: AppHandle<R>, state: State<'_, ConnectorState>) -> Status {
    status(&app, &state)
}

#[tauri::command]
pub async fn connector_set<R: Runtime>(app: AppHandle<R>, state: State<'_, ConnectorState>, enabled: bool, port: Option<u16>) -> Result<Status, String> {
    let mut c = load_config(&app);
    c.enabled = enabled;
    if let Some(p) = port.filter(|p| *p >= 1024) {
        c.port = p;
    }
    save_config(&app, &c)?;
    *state.error.lock().unwrap() = None;
    if enabled {
        if let Err(e) = start(&app, &state).await {
            *state.error.lock().unwrap() = Some(e);
        }
    } else {
        stop(&state);
    }
    Ok(status(&app, &state))
}

/// Shown and copied on request in the settings: the user has to hand it to their client.
#[tauri::command]
pub fn connector_token<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    ai::connector_token(&app)
}

#[tauri::command]
pub fn connector_regenerate<R: Runtime>(app: AppHandle<R>, state: State<'_, ConnectorState>) -> Result<Status, String> {
    let token = ai::connector_new_token(&app)?;
    if let Some(core) = state.core() {
        core.set_token(token);
    }
    Ok(status(&app, &state))
}

#[tauri::command]
pub fn connector_decide<R: Runtime>(app: AppHandle<R>, state: State<'_, ConnectorState>, client: String, allow: bool) -> Status {
    if let Some(core) = state.core() {
        core.decide(&client, allow);
    }
    status(&app, &state)
}

#[tauri::command]
pub fn connector_disconnect<R: Runtime>(app: AppHandle<R>, state: State<'_, ConnectorState>, client: String) -> Status {
    if let Some(core) = state.core() {
        core.disconnect(&client);
    }
    status(&app, &state)
}

#[tauri::command]
pub fn connector_reply(state: State<'_, ConnectorState>, id: u64, result: Option<Value>, error: Option<String>) {
    if let Some(tx) = state.replies.lock().unwrap().remove(&id) {
        let _ = tx.send(error.map_or_else(|| Ok(result.unwrap_or(Value::Null)), Err));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fake;
    impl Host for Fake {
        fn request(&self, message: Value) -> BoxFuture<'static, Result<Value, String>> {
            Box::pin(async move {
                Ok(if message["kind"] == "list" {
                    json!([{ "name": "primitive__box", "description": "Quader", "inputSchema": { "type": "object", "properties": {} } }])
                } else {
                    json!({ "content": [{ "type": "text", "text": format!("{}:{}", message["client"].as_str().unwrap(), message["name"].as_str().unwrap()) }] })
                })
            })
        }
        fn changed(&self) {}
    }

    async fn server(approved: &[&str]) -> (Arc<Core>, String) {
        let core = Core::new("geheim".into(), approved.iter().map(|s| s.to_string()).collect(), Arc::new(Fake));
        let listener = bind(0).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(serve(core.clone(), listener));
        for _ in 0..50 {
            if core.port.load(Ordering::SeqCst) != 0 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        (core, format!("http://127.0.0.1:{port}/mcp"))
    }

    fn rpc(url: &str, token: &str, session: Option<&str>, method: &str, params: Value) -> reqwest::RequestBuilder {
        let mut r = reqwest::Client::new().post(url).bearer_auth(token).json(&json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params }));
        if let Some(s) = session {
            r = r.header("Mcp-Session-Id", s);
        }
        r
    }

    async fn init(url: &str, name: &str) -> String {
        let res = rpc(url, "geheim", None, "initialize", json!({ "protocolVersion": "2025-06-18", "clientInfo": { "name": name } })).send().await.unwrap();
        assert_eq!(res.status(), 200);
        let id = res.headers()["mcp-session-id"].to_str().unwrap().to_string();
        let body: Value = res.json().await.unwrap();
        assert_eq!(body["result"]["serverInfo"]["name"], "cubrix");
        assert_eq!(body["result"]["protocolVersion"], "2025-06-18");
        assert!(body["result"]["instructions"].as_str().unwrap().contains("millimetres"));
        id
    }

    #[tokio::test]
    async fn initialize_list_and_call() {
        let (_core, url) = server(&["claude-code"]).await;
        let s = init(&url, "claude-code").await;
        let list: Value = rpc(&url, "geheim", Some(&s), "tools/list", json!({})).send().await.unwrap().json().await.unwrap();
        assert_eq!(list["result"]["tools"][0]["name"], "primitive__box");
        let call: Value = rpc(&url, "geheim", Some(&s), "tools/call", json!({ "name": "primitive__box", "arguments": {} })).send().await.unwrap().json().await.unwrap();
        assert_eq!(call["result"]["content"][0]["text"], "claude-code:primitive__box");
        let other: Value = rpc(&url, "geheim", Some(&s), "resources/list", json!({})).send().await.unwrap().json().await.unwrap();
        assert_eq!(other["error"]["code"], -32601);
    }

    #[tokio::test]
    async fn refuses_missing_or_wrong_tokens() {
        let (_core, url) = server(&[]).await;
        let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {} });
        assert_eq!(reqwest::Client::new().post(&url).json(&body).send().await.unwrap().status(), 401);
        assert_eq!(rpc(&url, "falsch", None, "initialize", json!({})).send().await.unwrap().status(), 401);
        assert_eq!(rpc(&url, "geheimX", None, "initialize", json!({})).send().await.unwrap().status(), 401);
    }

    #[tokio::test]
    async fn refuses_foreign_origin_and_host() {
        let (core, url) = server(&[]).await;
        let port = core.port.load(Ordering::SeqCst);
        let res = rpc(&url, "geheim", None, "initialize", json!({})).header("Origin", "https://evil.example").send().await.unwrap();
        assert_eq!(res.status(), 403, "even with the right token");
        let res = rpc(&url, "geheim", None, "initialize", json!({})).header("Origin", format!("http://localhost:{port}")).send().await.unwrap();
        assert_eq!(res.status(), 200);
        // DNS rebinding: the browser sends the attacker's name as Host.
        let mut headers = HeaderMap::new();
        headers.insert(header::HOST, HeaderValue::from_static("evil.example:7331"));
        headers.insert(header::AUTHORIZATION, HeaderValue::from_static("Bearer geheim"));
        assert_eq!(core.guard(&headers), Err(StatusCode::FORBIDDEN));
    }

    #[tokio::test]
    async fn sessions_are_required_and_can_end() {
        let (_core, url) = server(&["x"]).await;
        assert_eq!(rpc(&url, "geheim", None, "tools/list", json!({})).send().await.unwrap().status(), 400);
        assert_eq!(rpc(&url, "geheim", Some("gibtsnicht"), "tools/list", json!({})).send().await.unwrap().status(), 404);
        let s = init(&url, "x").await;
        let c = reqwest::Client::new();
        assert_eq!(c.delete(&url).bearer_auth("geheim").header("Mcp-Session-Id", &s).send().await.unwrap().status(), 204);
        assert_eq!(rpc(&url, "geheim", Some(&s), "tools/list", json!({})).send().await.unwrap().status(), 404);
        assert_eq!(c.get(&url).bearer_auth("geheim").send().await.unwrap().status(), 405);
    }

    #[tokio::test]
    async fn notifications_are_accepted() {
        let (_core, url) = server(&[]).await;
        let res = reqwest::Client::new().post(&url).bearer_auth("geheim").json(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })).send().await.unwrap();
        assert_eq!(res.status(), 202);
    }

    #[tokio::test]
    async fn new_clients_wait_for_the_user() {
        let (core, url) = server(&[]).await;
        let s = init(&url, "Neu").await;
        assert_eq!(core.pending(), vec!["Neu".to_string()]);
        let list = rpc(&url, "geheim", Some(&s), "tools/list", json!({})).send().await.unwrap();
        assert_eq!(list.status(), 200, "the list is open");
        let waiting = tokio::spawn({
            let (url, s) = (url.clone(), s.clone());
            async move { rpc(&url, "geheim", Some(&s), "tools/call", json!({ "name": "a" })).send().await.unwrap().json::<Value>().await.unwrap() }
        });
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(!waiting.is_finished());
        core.decide("Neu", true);
        assert!(waiting.await.unwrap()["result"]["isError"].is_null());
        assert!(core.pending().is_empty());
    }

    #[tokio::test]
    async fn a_refused_client_gets_nothing_and_disconnect_withdraws() {
        let (core, url) = server(&["Alt"]).await;
        let s = init(&url, "Böse").await;
        let waiting = tokio::spawn({
            let (url, s) = (url.clone(), s.clone());
            async move { rpc(&url, "geheim", Some(&s), "tools/call", json!({ "name": "a" })).send().await.unwrap().json::<Value>().await.unwrap() }
        });
        tokio::time::sleep(Duration::from_millis(100)).await;
        core.decide("Böse", false);
        assert_eq!(waiting.await.unwrap()["result"]["isError"], true);
        assert_eq!(rpc(&url, "geheim", Some(&s), "tools/list", json!({})).send().await.unwrap().status(), 404);
        let s = init(&url, "Alt").await;
        core.disconnect("Alt");
        assert_eq!(rpc(&url, "geheim", Some(&s), "tools/call", json!({ "name": "a" })).send().await.unwrap().status(), 404);
        assert!(!core.approved_list().contains(&"Alt".to_string()));
    }

    #[tokio::test]
    async fn a_new_token_locks_out_the_old_one() {
        let (core, url) = server(&["x"]).await;
        init(&url, "x").await;
        core.set_token("neu".into());
        assert_eq!(rpc(&url, "geheim", None, "initialize", json!({})).send().await.unwrap().status(), 401);
        assert!(core.sessions().is_empty());
    }

    #[tokio::test]
    async fn taken_ports_move_on() {
        let first = bind(0).await.unwrap();
        let taken = first.local_addr().unwrap().port();
        let next = bind(taken).await.unwrap().local_addr().unwrap().port();
        assert!(next > taken && next <= taken + PORT_TRIES);
    }

    #[test]
    fn binds_to_loopback_only() {
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(async {
            assert!(bind(0).await.unwrap().local_addr().unwrap().ip().is_loopback());
        });
    }
}

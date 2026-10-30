//! MCP client: remote servers (Streamable HTTP, legacy SSE as fallback) and local stdio
//! processes. Configuration lives in `<app data>/mcp.json`; URLs, header and env values
//! live in secrets.json and never reach the webview, only masked. The AI has no way to
//! add or change servers: these commands are called by the settings UI only.
use crate::{ai, errorlog};
use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU16, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager, Runtime, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::oneshot;

const PROTOCOL: &str = "2025-06-18";
/// Starting a server may include `npx` downloading it.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(60);
const LIST_TIMEOUT: Duration = Duration::from_secs(20);
const CALL_TIMEOUT: Duration = Duration::from_secs(120);
/// Largest single message accepted from a server.
const MAX_MESSAGE: usize = 16 * 1024 * 1024;
const MAX_TOOLS: usize = 500;
const STDERR_LINES: usize = 12;

type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>;

// ── Connection ───────────────────────────────────────────────────────────────

#[derive(Clone)]
pub enum Spec {
    Stdio { command: String, args: Vec<String>, env: Vec<(String, String)> },
    Remote { url: String, headers: Vec<(String, String)> },
}

struct Process {
    stdin: tokio::sync::Mutex<Option<ChildStdin>>,
    child: tokio::sync::Mutex<Child>,
    stderr: Arc<Mutex<VecDeque<String>>>,
}

struct Http {
    client: reqwest::Client,
    headers: HeaderMap,
    /// Where messages go; after the SSE fallback, the endpoint the server named.
    post_url: Mutex<String>,
    session: Mutex<Option<String>>,
    legacy: AtomicBool,
    last_status: AtomicU16,
}

enum Link {
    Stdio(Process),
    Http(Http),
}

pub struct Conn {
    link: Link,
    pending: Pending,
    next_id: AtomicU64,
    alive: AtomicBool,
    protocol: Mutex<String>,
}

/// Only follows redirects on the same origin: custom auth headers must not travel elsewhere.
fn http_client() -> Result<reqwest::Client, String> {
    let same_origin = reqwest::redirect::Policy::custom(|a| {
        let keep = a.previous().first().is_some_and(|p| p.origin() == a.url().origin());
        if keep && a.previous().len() < 5 { a.follow() } else { a.stop() }
    });
    reqwest::Client::builder().redirect(same_origin).connect_timeout(Duration::from_secs(15)).build().map_err(|e| e.without_url().to_string())
}

fn header_map(headers: &[(String, String)]) -> Result<HeaderMap, String> {
    let mut map = HeaderMap::new();
    for (k, v) in headers {
        let name = HeaderName::try_from(k.as_str()).map_err(|_| format!("Ungültiger Header-Name: {k}"))?;
        // The value is a secret: the error names the header only.
        let value = HeaderValue::try_from(v.as_str()).map_err(|_| format!("Ungültiger Wert für Header {k}"))?;
        map.insert(name, value);
    }
    Ok(map)
}

/// Line-delimited or event-stream text reassembled into complete SSE events.
#[derive(Default)]
struct SseBuffer {
    text: Vec<u8>,
    event: String,
    data: String,
}

impl SseBuffer {
    fn feed(&mut self, bytes: &[u8]) -> Vec<(String, String)> {
        self.text.extend_from_slice(bytes);
        let mut out = vec![];
        while let Some(end) = self.text.iter().position(|b| *b == b'\n') {
            let raw: Vec<u8> = self.text.drain(..=end).collect();
            let line = String::from_utf8_lossy(&raw);
            let line = line.trim_end_matches(['\r', '\n']);
            if line.is_empty() {
                if !self.data.is_empty() {
                    let name = if self.event.is_empty() { "message".to_string() } else { std::mem::take(&mut self.event) };
                    out.push((name, std::mem::take(&mut self.data)));
                }
                self.event.clear();
            } else if let Some(v) = line.strip_prefix("event:") {
                self.event = v.trim().to_string();
            } else if let Some(v) = line.strip_prefix("data:") {
                if !self.data.is_empty() {
                    self.data.push('\n');
                }
                self.data.push_str(v.strip_prefix(' ').unwrap_or(v));
            }
        }
        out
    }
}

/// `endpoint` of the legacy transport resolved against the stream URL; must stay on its origin.
fn resolve_endpoint(base: &str, endpoint: &str) -> Result<String, String> {
    let base = reqwest::Url::parse(base).map_err(|_| "Ungültige Adresse".to_string())?;
    let url = base.join(endpoint.trim()).map_err(|_| "Ungültiger Endpunkt vom Server".to_string())?;
    if url.origin() != base.origin() {
        return Err("Der Server verweist auf einen anderen Host; aus Sicherheitsgründen abgelehnt.".into());
    }
    Ok(url.to_string())
}

impl Conn {
    fn new(link: Link) -> Arc<Self> {
        Arc::new(Conn { link, pending: Default::default(), next_id: AtomicU64::new(1), alive: AtomicBool::new(true), protocol: Mutex::new(PROTOCOL.into()) })
    }

    pub fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    fn close_pending(&self) {
        self.alive.store(false, Ordering::SeqCst);
        self.pending.lock().unwrap().clear(); // dropped senders end the waiting requests
    }

    /// A response goes to its request; a request from the server gets an answer.
    fn route(self: &Arc<Self>, msg: Value) {
        let id = msg.get("id").cloned();
        if let Some(method) = msg.get("method").and_then(|m| m.as_str()) {
            let Some(id) = id else { return }; // notification
            let reply = if method == "ping" {
                json!({ "jsonrpc": "2.0", "id": id, "result": {} })
            } else {
                json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": "Not supported" } })
            };
            let me = self.clone();
            tokio::spawn(async move {
                let _ = me.send(&reply).await;
            });
        } else if let Some(n) = id.and_then(|i| i.as_u64()) {
            if let Some(tx) = self.pending.lock().unwrap().remove(&n) {
                let _ = tx.send(msg);
            }
        }
    }

    async fn send(self: &Arc<Self>, msg: &Value) -> Result<(), String> {
        match &self.link {
            Link::Stdio(p) => {
                let mut guard = p.stdin.lock().await;
                let stdin = guard.as_mut().ok_or("Verbindung beendet")?;
                let mut line = serde_json::to_vec(msg).map_err(|e| e.to_string())?;
                line.push(b'\n');
                stdin.write_all(&line).await.map_err(|e| e.to_string())?;
                stdin.flush().await.map_err(|e| e.to_string())
            }
            Link::Http(_) => self.post(msg).await,
        }
    }

    async fn post(self: &Arc<Self>, msg: &Value) -> Result<(), String> {
        let Link::Http(h) = &self.link else { return Err("Keine HTTP-Verbindung".into()) };
        let url = h.post_url.lock().unwrap().clone();
        let mut req = h.client.post(url).headers(h.headers.clone()).header("Accept", "application/json, text/event-stream").json(msg);
        if let Some(s) = h.session.lock().unwrap().clone() {
            req = req.header("Mcp-Session-Id", s);
        }
        if msg.get("method").and_then(|m| m.as_str()) != Some("initialize") {
            req = req.header("MCP-Protocol-Version", self.protocol.lock().unwrap().clone());
        }
        // without_url: a URL can carry a token in its query.
        let res = req.send().await.map_err(|e| e.without_url().to_string())?;
        let status = res.status();
        h.last_status.store(status.as_u16(), Ordering::SeqCst);
        if let Some(s) = res.headers().get("mcp-session-id").and_then(|v| v.to_str().ok()) {
            *h.session.lock().unwrap() = Some(s.to_string());
        }
        if status.as_u16() == 404 && h.session.lock().unwrap().is_some() {
            self.close_pending();
            return Err("Die Sitzung beim Server ist abgelaufen.".into());
        }
        if !status.is_success() {
            return Err(match status.as_u16() {
                401 | 403 => format!("Anmeldung abgelehnt ({status}). Token oder Header prüfen; OAuth-Anmeldung wird nicht unterstützt."),
                _ => format!("Server antwortet mit {status}"),
            });
        }
        let kind = res.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_ascii_lowercase();
        if status.as_u16() == 202 || !msg.get("id").is_some() {
            return Ok(());
        }
        if kind.contains("text/event-stream") {
            let me = self.clone();
            tokio::spawn(async move { me.read_events(res, None).await });
            return Ok(());
        }
        let mut body = Vec::new();
        let mut stream = res.bytes_stream();
        while let Some(chunk) = stream.next().await {
            body.extend_from_slice(&chunk.map_err(|e| e.without_url().to_string())?);
            if body.len() > MAX_MESSAGE {
                return Err("Antwort des Servers ist zu groß.".into());
            }
        }
        if body.iter().all(|b| b.is_ascii_whitespace()) {
            return Ok(());
        }
        self.route(serde_json::from_slice(&body).map_err(|_| "Ungültige Antwort des Servers".to_string())?);
        Ok(())
    }

    /// Routes the JSON-RPC messages of an event stream; `endpoint` gets the legacy POST address.
    async fn read_events(self: Arc<Self>, res: reqwest::Response, mut endpoint: Option<oneshot::Sender<String>>) {
        let mut sse = SseBuffer::default();
        let mut stream = res.bytes_stream();
        let legacy = endpoint.is_some();
        while let Some(Ok(chunk)) = stream.next().await {
            if sse.text.len() + chunk.len() > MAX_MESSAGE {
                break;
            }
            for (event, data) in sse.feed(&chunk) {
                if event == "endpoint" {
                    if let Some(tx) = endpoint.take() {
                        let _ = tx.send(data);
                    }
                } else if let Ok(msg) = serde_json::from_str::<Value>(&data) {
                    self.route(msg);
                }
            }
        }
        if legacy {
            self.close_pending();
        }
    }

    pub async fn request(self: &Arc<Self>, method: &str, params: Value, limit: Duration) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, tx);
        if let Err(e) = self.send(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })).await {
            self.pending.lock().unwrap().remove(&id);
            return Err(e);
        }
        let reply = match tokio::time::timeout(limit, rx).await {
            Ok(Ok(v)) => v,
            Ok(Err(_)) => return Err("Die Verbindung zum Server wurde beendet.".into()),
            Err(_) => {
                self.pending.lock().unwrap().remove(&id);
                self.cancel(id);
                return Err(format!("Keine Antwort vom Server nach {} s.", limit.as_secs()));
            }
        };
        if let Some(e) = reply.get("error") {
            return Err(e.get("message").and_then(|m| m.as_str()).unwrap_or("Fehler des Servers").to_string());
        }
        Ok(reply.get("result").cloned().unwrap_or(Value::Null))
    }

    fn cancel(self: &Arc<Self>, id: u64) {
        let me = self.clone();
        tokio::spawn(async move {
            let _ = me.send(&json!({ "jsonrpc": "2.0", "method": "notifications/cancelled", "params": { "requestId": id, "reason": "timeout" } })).await;
        });
    }

    async fn initialize(self: &Arc<Self>) -> Result<(), String> {
        let init = json!({ "protocolVersion": PROTOCOL, "capabilities": {}, "clientInfo": { "name": "Cubrix", "version": env!("CARGO_PKG_VERSION") } });
        let res = self.request("initialize", init, CONNECT_TIMEOUT).await?;
        if let Some(v) = res.get("protocolVersion").and_then(|v| v.as_str()) {
            *self.protocol.lock().unwrap() = v.to_string();
        }
        self.send(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })).await
    }

    pub async fn list_tools(self: &Arc<Self>) -> Result<Vec<Value>, String> {
        let mut tools = vec![];
        let mut cursor: Option<String> = None;
        for _ in 0..20 {
            let params = cursor.as_ref().map_or(json!({}), |c| json!({ "cursor": c }));
            let page = self.request("tools/list", params, LIST_TIMEOUT).await?;
            tools.extend(page.get("tools").and_then(|t| t.as_array()).cloned().unwrap_or_default());
            cursor = page.get("nextCursor").and_then(|c| c.as_str()).map(String::from);
            if cursor.is_none() || tools.len() >= MAX_TOOLS {
                break;
            }
        }
        tools.truncate(MAX_TOOLS);
        Ok(tools)
    }

    /// Asks the server to end, then makes sure it does (a stdio server's whole process group).
    pub async fn stop(&self) {
        self.close_pending();
        match &self.link {
            Link::Http(h) => {
                let session = h.session.lock().unwrap().clone();
                if let (Some(s), false) = (session, h.legacy.load(Ordering::SeqCst)) {
                    let url = h.post_url.lock().unwrap().clone();
                    let del = h.client.delete(url).headers(h.headers.clone()).header("Mcp-Session-Id", s).send();
                    let _ = tokio::time::timeout(Duration::from_secs(2), del).await;
                }
            }
            Link::Stdio(p) => {
                p.stdin.lock().await.take(); // closing stdin is the protocol's shutdown signal
                let mut child = p.child.lock().await;
                let waited = tokio::time::timeout(Duration::from_millis(800), child.wait()).await;
                if waited.is_ok() {
                    return;
                }
                #[cfg(unix)]
                if let Some(pid) = child.id() {
                    unsafe { libc::kill(-(pid as i32), libc::SIGTERM) };
                    if tokio::time::timeout(Duration::from_millis(500), child.wait()).await.is_ok() {
                        return;
                    }
                    unsafe { libc::kill(-(pid as i32), libc::SIGKILL) };
                }
                let _ = child.kill().await;
            }
        }
    }

    fn stderr_tail(&self) -> String {
        match &self.link {
            Link::Stdio(p) => p.stderr.lock().unwrap().iter().cloned().collect::<Vec<_>>().join("\n"),
            Link::Http(_) => String::new(),
        }
    }
}

/// PATH of the user's login shell: apps started from the Finder get a minimal one, without
/// node, npx or uvx.
async fn login_path() -> Option<String> {
    static PATH: tokio::sync::OnceCell<Option<String>> = tokio::sync::OnceCell::const_new();
    PATH.get_or_init(|| async {
        if cfg!(windows) {
            return None;
        }
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        let run = Command::new(shell).args(["-ilc", "printf '\\n__CUBRIX_PATH__%s\\n' \"$PATH\""]).stdin(Stdio::null()).stderr(Stdio::null()).kill_on_drop(true).output();
        let out = tokio::time::timeout(Duration::from_secs(4), run).await.ok()?.ok()?;
        String::from_utf8_lossy(&out.stdout).lines().find_map(|l| l.strip_prefix("__CUBRIX_PATH__").map(String::from))
    })
    .await
    .clone()
}

async fn spawn_stdio(command: &str, args: &[String], env: &[(String, String)]) -> Result<Arc<Conn>, String> {
    #[cfg(windows)]
    let mut cmd = {
        // npx and friends are .cmd scripts there.
        let mut c = Command::new("cmd");
        c.arg("/C").arg(command).creation_flags(0x0800_0000);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = Command::new(command);
    cmd.args(args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    #[cfg(unix)]
    cmd.process_group(0);
    if let Some(path) = login_path().await {
        cmd.env("PATH", path);
    }
    cmd.envs(env.iter().map(|(k, v)| (k, v)));
    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            format!("Befehl „{command}“ wurde nicht gefunden.")
        } else {
            format!("Start fehlgeschlagen: {e}")
        }
    })?;
    let stdin = child.stdin.take().ok_or("Kein stdin")?;
    let stdout = child.stdout.take().ok_or("Kein stdout")?;
    let err_pipe = child.stderr.take().ok_or("Kein stderr")?;
    let stderr: Arc<Mutex<VecDeque<String>>> = Default::default();
    let tail = stderr.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(err_pipe).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let mut t = tail.lock().unwrap();
            if t.len() == STDERR_LINES {
                t.pop_front();
            }
            t.push_back(line.chars().take(300).collect());
        }
    });
    let conn = Conn::new(Link::Stdio(Process { stdin: tokio::sync::Mutex::new(Some(stdin)), child: tokio::sync::Mutex::new(child), stderr }));
    let me = conn.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout);
        let mut line = Vec::new();
        loop {
            line.clear();
            let mut limited = (&mut reader).take_limit(MAX_MESSAGE);
            match limited.read_until_newline(&mut line).await {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    if let Ok(msg) = serde_json::from_slice::<Value>(&line) {
                        me.route(msg);
                    }
                }
            }
        }
        me.close_pending();
    });
    Ok(conn)
}

/// `read_until` with a ceiling: a server must not fill the memory with one endless line.
trait TakeLimit: Sized {
    fn take_limit(self, limit: usize) -> Limited<Self>;
}
impl<R: AsyncBufReadExt + Unpin> TakeLimit for R {
    fn take_limit(self, limit: usize) -> Limited<Self> {
        Limited { inner: self, limit }
    }
}
struct Limited<R> {
    inner: R,
    limit: usize,
}
impl<R: AsyncBufReadExt + Unpin> Limited<R> {
    async fn read_until_newline(&mut self, out: &mut Vec<u8>) -> std::io::Result<usize> {
        loop {
            let buf = self.inner.fill_buf().await?;
            if buf.is_empty() {
                return Ok(out.len());
            }
            let found = buf.iter().position(|b| *b == b'\n');
            let n = found.map_or(buf.len(), |i| i + 1);
            out.extend_from_slice(&buf[..n]);
            self.inner.consume(n);
            if found.is_some() {
                return Ok(out.len());
            }
            if out.len() > self.limit {
                return Err(std::io::Error::other("message too large"));
            }
        }
    }
}

async fn connect_legacy(url: &str, headers: &HeaderMap) -> Result<Arc<Conn>, String> {
    let client = http_client()?;
    let res = client.get(url).headers(headers.clone()).header("Accept", "text/event-stream").send().await.map_err(|e| e.without_url().to_string())?;
    if !res.status().is_success() {
        return Err(format!("Server antwortet mit {}", res.status()));
    }
    let link = Http { client, headers: headers.clone(), post_url: Mutex::new(url.to_string()), session: Mutex::new(None), legacy: AtomicBool::new(true), last_status: AtomicU16::new(0) };
    let conn = Conn::new(Link::Http(link));
    let (tx, rx) = oneshot::channel();
    tokio::spawn(conn.clone().read_events(res, Some(tx)));
    let endpoint = tokio::time::timeout(Duration::from_secs(15), rx).await.map_err(|_| "Der Server nennt keinen Endpunkt.".to_string())?.map_err(|_| "Die Verbindung zum Server wurde beendet.".to_string())?;
    let target = resolve_endpoint(url, &endpoint)?;
    if let Link::Http(h) = &conn.link {
        *h.post_url.lock().unwrap() = target;
    }
    conn.initialize().await?;
    Ok(conn)
}

/// Opens a connection and finishes the MCP handshake.
pub async fn connect(spec: &Spec) -> Result<Arc<Conn>, String> {
    match spec {
        Spec::Stdio { command, args, env } => {
            let conn = spawn_stdio(command, args, env).await?;
            if let Err(e) = conn.initialize().await {
                let tail = conn.stderr_tail();
                conn.stop().await;
                return Err(if tail.is_empty() { e } else { format!("{e}\n{tail}") });
            }
            Ok(conn)
        }
        Spec::Remote { url, headers } => {
            let map = header_map(headers)?;
            let link = Http { client: http_client()?, headers: map.clone(), post_url: Mutex::new(url.clone()), session: Mutex::new(None), legacy: AtomicBool::new(false), last_status: AtomicU16::new(0) };
            let conn = Conn::new(Link::Http(link));
            match conn.initialize().await {
                Ok(()) => Ok(conn),
                Err(first) => {
                    let Link::Http(h) = &conn.link else { unreachable!() };
                    // Older servers only speak SSE and refuse the POST.
                    if matches!(h.last_status.load(Ordering::SeqCst), 400 | 404 | 405) {
                        connect_legacy(url, &map).await.map_err(|second| format!("{first}; SSE: {second}"))
                    } else {
                        Err(first)
                    }
                }
            }
        }
    }
}

// ── Configuration ────────────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Server {
    id: String,
    name: String,
    /// "remote" or "stdio".
    kind: String,
    enabled: bool,
    /// Remote address without query and credentials; the full one is a secret.
    url_display: String,
    command: String,
    args: Vec<String>,
    header_names: Vec<String>,
    env_names: Vec<String>,
    /// The user accepted that this command runs on the computer.
    confirmed: bool,
    always_allow: bool,
    disabled_tools: Vec<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewServer {
    name: String,
    kind: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    headers: Vec<(String, String)>,
    #[serde(default)]
    command: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    env: Vec<(String, String)>,
    #[serde(default)]
    confirmed: bool,
}

#[derive(serde::Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ServerPatch {
    enabled: Option<bool>,
    always_allow: Option<bool>,
    disabled_tools: Option<Vec<String>>,
}

#[derive(serde::Serialize)]
pub struct Masked {
    name: String,
    masked: String,
}

/// What the webview sees.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    #[serde(flatten)]
    server: Server,
    headers: Vec<Masked>,
    env: Vec<Masked>,
    status: String,
    error: Option<String>,
    tools: Vec<Value>,
}

struct Live {
    conn: Arc<Conn>,
    tools: Vec<Value>,
}

#[derive(Default)]
pub struct McpState {
    live: Mutex<HashMap<String, Arc<Live>>>,
    errors: Mutex<HashMap<String, String>>,
    connecting: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    cancels: Mutex<HashMap<String, oneshot::Sender<()>>>,
}

fn config_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(ai::secrets_dir(app)?.join("mcp.json"))
}

fn load_servers<R: Runtime>(app: &AppHandle<R>) -> Vec<Server> {
    config_path(app).ok().and_then(|p| fs::read_to_string(p).ok()).and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn save_servers<R: Runtime>(app: &AppHandle<R>, servers: &[Server]) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(servers).map_err(|e| e.to_string())?;
    ai::write_private(&config_path(app)?, &json)
}

/// Address for display: query and credentials are cut off, they may hold a token.
fn display_url(url: &reqwest::Url) -> String {
    let mut shown = url.clone();
    let _ = shown.set_username("");
    let _ = shown.set_password(None);
    let hidden = url.query().is_some();
    shown.set_query(None);
    shown.set_fragment(None);
    format!("{shown}{}", if hidden { "?…" } else { "" })
}

/// Checks a new server; secrets must not go over plain HTTP to another machine.
fn validate(s: &NewServer) -> Result<Option<reqwest::Url>, String> {
    if s.name.trim().is_empty() {
        return Err("Bitte einen Namen eingeben.".into());
    }
    if s.kind == "stdio" {
        if s.command.trim().is_empty() {
            return Err("Bitte einen Befehl eingeben.".into());
        }
        if !s.confirmed {
            return Err("Lokale Server brauchen deine Bestätigung.".into());
        }
        return Ok(None);
    }
    let url = reqwest::Url::parse(s.url.trim()).map_err(|_| "Das ist keine gültige Adresse.".to_string())?;
    if !["http", "https"].contains(&url.scheme()) {
        return Err("Nur http- und https-Adressen sind möglich.".into());
    }
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    let carries_secret = !s.headers.is_empty() || url.query().is_some() || !url.username().is_empty();
    if url.scheme() == "http" && !local && carries_secret {
        return Err("Token und Header werden nur über https gesendet.".into());
    }
    Ok(Some(url))
}

fn spec_of<R: Runtime>(app: &AppHandle<R>, s: &Server) -> Result<Spec, String> {
    let secrets = ai::mcp_secrets(app, &s.id)?;
    let get = |key: String| secrets.get(&key).cloned().unwrap_or_default();
    if s.kind == "stdio" {
        if !s.confirmed {
            return Err("Dieser lokale Server wurde nicht bestätigt.".into());
        }
        let env = s.env_names.iter().map(|n| (n.clone(), get(format!("env:{n}")))).collect();
        return Ok(Spec::Stdio { command: s.command.clone(), args: s.args.clone(), env });
    }
    let headers = s.header_names.iter().map(|n| (n.clone(), get(format!("header:{n}")))).collect();
    Ok(Spec::Remote { url: get("url".into()), headers })
}

/// Secret values cut out of any text that may end up in the UI, a log or the model.
fn scrub(text: &str, secrets: &HashMap<String, String>) -> String {
    let mut out = text.to_string();
    for v in secrets.values() {
        if v.chars().count() >= 4 {
            out = out.replace(v.as_str(), "•••");
        }
        if let Some(token) = v.strip_prefix("Bearer ").filter(|t| t.len() >= 4) {
            out = out.replace(token, "•••");
        }
    }
    errorlog::redact(&out)
}

fn info<R: Runtime>(app: &AppHandle<R>, state: &McpState, s: &Server) -> ServerInfo {
    let secrets = ai::mcp_secrets(app, &s.id).unwrap_or_default();
    let masked = |prefix: &str, name: &String| Masked { name: name.clone(), masked: secrets.get(&format!("{prefix}:{name}")).map(|v| ai::mask(v)).unwrap_or_else(|| "…".into()) };
    let live = state.live.lock().unwrap().get(&s.id).filter(|l| l.conn.is_alive()).cloned();
    let error = state.errors.lock().unwrap().get(&s.id).cloned();
    let status = match (&live, &error) {
        (Some(_), _) => "connected",
        (None, Some(_)) => "error",
        _ if !s.enabled => "off",
        _ => "idle",
    };
    ServerInfo {
        headers: s.header_names.iter().map(|n| masked("header", n)).collect(),
        env: s.env_names.iter().map(|n| masked("env", n)).collect(),
        status: status.into(),
        error,
        tools: live.map(|l| l.tools.clone()).unwrap_or_default(),
        server: s.clone(),
    }
}

async fn disconnect(state: &McpState, id: &str) {
    let live = state.live.lock().unwrap().remove(id);
    if let Some(l) = live {
        l.conn.stop().await;
    }
}

// ── Commands ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn mcp_list<R: Runtime>(app: AppHandle<R>, state: State<'_, McpState>) -> Vec<ServerInfo> {
    load_servers(&app).iter().map(|s| info(&app, &state, s)).collect()
}

#[tauri::command]
pub fn mcp_add<R: Runtime>(app: AppHandle<R>, state: State<'_, McpState>, server: NewServer) -> Result<ServerInfo, String> {
    let url = validate(&server)?;
    let mut servers = load_servers(&app);
    let name = server.name.trim().to_string();
    if servers.iter().any(|s| s.name.eq_ignore_ascii_case(&name)) {
        return Err(format!("„{name}“ gibt es schon."));
    }
    let id = format!("m{}", ai::now_ms());
    let mut secrets = HashMap::new();
    for (k, v) in &server.headers {
        secrets.insert(format!("header:{k}"), v.clone());
    }
    for (k, v) in &server.env {
        secrets.insert(format!("env:{k}"), v.clone());
    }
    if url.is_some() {
        secrets.insert("url".to_string(), server.url.trim().to_string());
    }
    let stdio = server.kind == "stdio";
    let entry = Server {
        id: id.clone(),
        name,
        kind: if stdio { "stdio".into() } else { "remote".into() },
        enabled: true,
        url_display: url.as_ref().map(display_url).unwrap_or_default(),
        command: if stdio { server.command.trim().to_string() } else { String::new() },
        args: if stdio { server.args } else { vec![] },
        header_names: server.headers.into_iter().map(|(k, _)| k).collect(),
        env_names: server.env.into_iter().map(|(k, _)| k).collect(),
        confirmed: stdio && server.confirmed,
        always_allow: false,
        disabled_tools: vec![],
    };
    ai::mcp_set_secrets(&app, &id, &secrets)?;
    servers.push(entry.clone());
    save_servers(&app, &servers)?;
    Ok(info(&app, &state, &entry))
}

#[tauri::command]
pub async fn mcp_update<R: Runtime>(app: AppHandle<R>, state: State<'_, McpState>, id: String, patch: ServerPatch) -> Result<ServerInfo, String> {
    let mut servers = load_servers(&app);
    let s = servers.iter_mut().find(|s| s.id == id).ok_or("Server nicht gefunden")?;
    if let Some(v) = patch.enabled {
        s.enabled = v;
    }
    if let Some(v) = patch.always_allow {
        s.always_allow = v;
    }
    if let Some(v) = patch.disabled_tools {
        s.disabled_tools = v;
    }
    let entry = s.clone();
    save_servers(&app, &servers)?;
    if !entry.enabled {
        disconnect(&state, &id).await;
        state.errors.lock().unwrap().remove(&id);
    }
    Ok(info(&app, &state, &entry))
}

#[tauri::command]
pub async fn mcp_remove<R: Runtime>(app: AppHandle<R>, state: State<'_, McpState>, id: String) -> Result<(), String> {
    disconnect(&state, &id).await;
    state.errors.lock().unwrap().remove(&id);
    let mut servers = load_servers(&app);
    servers.retain(|s| s.id != id);
    save_servers(&app, &servers)?;
    ai::mcp_set_secrets(&app, &id, &HashMap::new())
}

/// Connects a server (or keeps the live connection); `fresh` reconnects, for "Testen".
#[tauri::command]
pub async fn mcp_connect<R: Runtime>(app: AppHandle<R>, state: State<'_, McpState>, id: String, fresh: Option<bool>) -> Result<ServerInfo, String> {
    let lock = state.connecting.lock().unwrap().entry(id.clone()).or_default().clone();
    let _one_at_a_time = lock.lock().await;
    let s = load_servers(&app).into_iter().find(|s| s.id == id).ok_or("Server nicht gefunden")?;
    if fresh == Some(true) {
        disconnect(&state, &id).await;
    }
    let alive = state.live.lock().unwrap().get(&id).is_some_and(|l| l.conn.is_alive());
    if alive || !s.enabled {
        return Ok(info(&app, &state, &s));
    }
    disconnect(&state, &id).await; // whatever is left of a dead connection
    let secrets = ai::mcp_secrets(&app, &id).unwrap_or_default();
    let result = async {
        let conn = connect(&spec_of(&app, &s)?).await?;
        match conn.list_tools().await {
            Ok(tools) => Ok(Live { conn, tools }),
            Err(e) => {
                conn.stop().await;
                Err(e)
            }
        }
    }
    .await;
    match result {
        Ok(live) => {
            state.errors.lock().unwrap().remove(&id);
            state.live.lock().unwrap().insert(id, Arc::new(live));
        }
        Err(e) => {
            let clean = scrub(&e, &secrets);
            let _ = errorlog::append(&app, json!({ "source": "mcp", "message": clean, "details": { "server": s.name } }));
            state.errors.lock().unwrap().insert(id, clean);
        }
    }
    Ok(info(&app, &state, &s))
}

/// Calls a tool; only enabled tools of an enabled, connected server get through.
#[tauri::command]
pub async fn mcp_call<R: Runtime>(app: AppHandle<R>, state: State<'_, McpState>, call_id: String, id: String, tool: String, arguments: Value) -> Result<Value, String> {
    let s = load_servers(&app).into_iter().find(|s| s.id == id).ok_or("Server nicht gefunden")?;
    if !s.enabled || s.disabled_tools.contains(&tool) {
        return Err("Dieses Werkzeug ist deaktiviert.".into());
    }
    let live = state.live.lock().unwrap().get(&id).filter(|l| l.conn.is_alive()).cloned().ok_or("Der Server ist nicht verbunden.")?;
    if !live.tools.iter().any(|t| t.get("name").and_then(|n| n.as_str()) == Some(tool.as_str())) {
        return Err("Dieses Werkzeug gibt es auf dem Server nicht.".into());
    }
    let (tx, rx) = oneshot::channel();
    state.cancels.lock().unwrap().insert(call_id.clone(), tx);
    let call = live.conn.request("tools/call", json!({ "name": tool, "arguments": arguments }), CALL_TIMEOUT);
    let result = tokio::select! {
        r = call => r,
        _ = rx => Err("Abgebrochen".to_string()),
    };
    state.cancels.lock().unwrap().remove(&call_id);
    let secrets = ai::mcp_secrets(&app, &id).unwrap_or_default();
    result.map_err(|e| scrub(&e, &secrets))
}

#[tauri::command]
pub fn mcp_cancel(state: State<'_, McpState>, call_id: String) {
    if let Some(tx) = state.cancels.lock().unwrap().remove(&call_id) {
        let _ = tx.send(());
    }
}

/// Ends every server when the app quits.
pub fn shutdown<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<McpState>();
    let all: Vec<_> = state.live.lock().unwrap().drain().map(|(_, l)| l).collect();
    tauri::async_runtime::block_on(async {
        futures_util::future::join_all(all.iter().map(|l| l.conn.stop())).await;
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> String {
        format!("{}/tests/fixtures/mcp-echo.mjs", env!("CARGO_MANIFEST_DIR"))
    }

    fn secrets() -> HashMap<String, String> {
        HashMap::from([("header:Authorization".to_string(), "Bearer tok-1234567890".to_string()), ("env:KEY".to_string(), "abcd-secret".to_string()), ("env:X".to_string(), "ab".to_string())])
    }

    #[test]
    fn scrub_removes_secret_values() {
        let text = scrub("failed: Bearer tok-1234567890 and tok-1234567890 with abcd-secret ab", &secrets());
        assert!(!text.contains("tok-1234567890"));
        assert!(!text.contains("abcd-secret"));
        assert!(text.ends_with(" ab"), "too short to be a secret: {text}");
    }

    #[test]
    fn display_url_hides_tokens() {
        let url = reqwest::Url::parse("https://user:pw@example.com/mcp?token=abc#x").unwrap();
        assert_eq!(display_url(&url), "https://example.com/mcp?…");
    }

    #[test]
    fn sse_events_survive_chunk_boundaries() {
        let mut sse = SseBuffer::default();
        assert!(sse.feed(b"event: endpoint\nda").is_empty());
        assert_eq!(sse.feed(b"ta: /messages?s=1\n\n"), vec![("endpoint".to_string(), "/messages?s=1".to_string())]);
        assert_eq!(sse.feed(b"data: {\"a\":1}\r\n\r\n"), vec![("message".to_string(), "{\"a\":1}".to_string())]);
    }

    #[test]
    fn endpoint_must_stay_on_origin() {
        assert_eq!(resolve_endpoint("http://localhost:1/sse", "/m?s=1").unwrap(), "http://localhost:1/m?s=1");
        assert!(resolve_endpoint("http://localhost:1/sse", "https://evil.example/m").is_err());
    }

    fn new_server(kind: &str, url: &str, confirmed: bool) -> NewServer {
        NewServer { name: "x".into(), kind: kind.into(), url: url.into(), headers: vec![("A".into(), "b".into())], command: "node".into(), args: vec![], env: vec![], confirmed }
    }

    #[test]
    fn validation_guards_commands_and_secrets() {
        assert!(validate(&new_server("stdio", "", false)).is_err(), "stdio needs the confirmation");
        assert!(validate(&new_server("stdio", "", true)).is_ok());
        assert!(validate(&new_server("remote", "http://example.com/mcp", false)).is_err(), "header over plain http");
        assert!(validate(&new_server("remote", "http://localhost:3000/mcp", false)).is_ok());
        assert!(validate(&new_server("remote", "file:///etc/passwd", false)).is_err());
    }

    async fn exercise(conn: Arc<Conn>) {
        let tools = conn.list_tools().await.unwrap();
        assert_eq!(tools.len(), 2);
        let res = conn.request("tools/call", json!({ "name": "echo", "arguments": { "text": "hallo" } }), LIST_TIMEOUT).await.unwrap();
        assert_eq!(res["content"][0]["text"], "hallo");
        conn.stop().await;
        assert!(!conn.is_alive());
    }

    fn node(args: &[&str]) -> tokio::process::Child {
        Command::new("node").arg(fixture()).args(args).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true).spawn().unwrap()
    }

    /// Starts the fixture in HTTP mode and returns its port.
    async fn http_fixture(mode: &str) -> (tokio::process::Child, u16) {
        let mut child = node(&[mode]);
        let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
        let port = lines.next_line().await.unwrap().unwrap().trim().parse().unwrap();
        (child, port)
    }

    /// The real commands on a real (temporary) app data folder: what is on disk, what the
    /// webview gets, and that removing leaves nothing behind.
    #[test]
    fn commands_keep_secrets_out_of_config_and_webview() {
        let home = std::env::temp_dir().join(format!("cubrix-mcp-test-{}", ai::now_ms()));
        fs::create_dir_all(&home).unwrap();
        std::env::set_var("HOME", &home);
        std::env::set_var("XDG_DATA_HOME", home.join("data"));
        let app = tauri::test::mock_app();
        app.manage(McpState::default());
        let h = app.handle().clone();
        let secret = "s3cret-env-value-987";
        let new: NewServer = serde_json::from_value(json!({
            "name": "Echo", "kind": "stdio", "command": "node", "args": [fixture()], "env": [["ECHO_PREFIX", secret]], "confirmed": true,
        }))
        .unwrap();
        let added = mcp_add(h.clone(), h.state(), new).unwrap();
        let wire = serde_json::to_value(&added).unwrap();
        assert_eq!(wire["env"][0]["name"], "ECHO_PREFIX");
        assert_eq!(wire["urlDisplay"], "");
        assert!(!wire.to_string().contains(secret), "webview sees masked values only");
        let id = added.server.id.clone();
        let dir = ai::secrets_dir(&h).unwrap();
        assert!(dir.starts_with(&home), "test must not touch the real app data: {dir:?}");
        let on_disk = fs::read_to_string(dir.join("mcp.json")).unwrap() + &fs::read_to_string(dir.join("secrets.json")).unwrap();
        assert!(!on_disk.contains(secret), "never in clear text on disk");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(dir.join("secrets.json")).unwrap().permissions().mode() & 0o777, 0o600);
            assert_eq!(fs::metadata(dir.join("mcp.json")).unwrap().permissions().mode() & 0o777, 0o600);
        }
        tauri::async_runtime::block_on(async {
            let info = mcp_connect(h.clone(), h.state(), id.clone(), Some(true)).await.unwrap();
            assert_eq!(info.status, "connected", "{:?}", info.error);
            assert_eq!(info.tools.len(), 2);
            let wire = serde_json::to_value(&info).unwrap();
            assert_eq!(wire["tools"][0]["name"], "echo");
            let res = mcp_call(h.clone(), h.state(), "c1".into(), id.clone(), "echo".into(), json!({ "text": "!" })).await.unwrap();
            assert_eq!(res["content"][0]["text"], format!("{secret}!"), "env reached the process");
            let unknown = mcp_call(h.clone(), h.state(), "c2".into(), id.clone(), "gibtsnicht".into(), json!({})).await;
            assert!(unknown.is_err());
            let patch: ServerPatch = serde_json::from_value(json!({ "disabledTools": ["echo"], "alwaysAllow": true })).unwrap();
            let info = mcp_update(h.clone(), h.state(), id.clone(), patch).await.unwrap();
            assert!(info.server.always_allow);
            let off = mcp_call(h.clone(), h.state(), "c3".into(), id.clone(), "echo".into(), json!({})).await;
            assert!(off.is_err(), "a switched-off tool is refused in Rust too");
            mcp_remove(h.clone(), h.state(), id.clone()).await.unwrap();
        });
        assert!(mcp_list(h.clone(), h.state()).is_empty());
        assert!(ai::mcp_secrets(&h, &id).unwrap().is_empty());
        // An unconfirmed local server from a tampered file does not start.
        let forged = Server { id: "x".into(), kind: "stdio".into(), command: "node".into(), ..Default::default() };
        assert!(spec_of(&h, &forged).is_err());
        let _ = fs::remove_dir_all(&home);
    }

    #[tokio::test]
    async fn stdio_round_trip_and_clean_stop() {
        let spec = Spec::Stdio { command: "node".into(), args: vec![fixture()], env: vec![("ECHO_PREFIX".into(), "".into())] };
        exercise(connect(&spec).await.unwrap()).await;
    }

    #[tokio::test]
    async fn stdio_stop_kills_a_stubborn_server() {
        let spec = Spec::Stdio { command: "node".into(), args: vec![fixture(), "--ignore-stdin-close".into()], env: vec![] };
        let conn = connect(&spec).await.unwrap();
        let t = std::time::Instant::now();
        conn.stop().await;
        assert!(t.elapsed() < Duration::from_secs(3));
        let Link::Stdio(p) = &conn.link else { panic!() };
        assert!(p.child.lock().await.try_wait().unwrap().is_some(), "process must be gone");
    }

    #[tokio::test]
    async fn stdio_missing_command_is_a_clear_error() {
        let spec = Spec::Stdio { command: "cubrix-gibt-es-nicht".into(), args: vec![], env: vec![] };
        assert!(connect(&spec).await.err().unwrap().contains("nicht gefunden"));
    }

    #[tokio::test]
    async fn stdio_failure_reports_stderr() {
        let spec = Spec::Stdio { command: "node".into(), args: vec![fixture(), "--crash".into()], env: vec![] };
        assert!(connect(&spec).await.err().unwrap().contains("kaputt"));
    }

    #[tokio::test]
    async fn timeouts_end_a_silent_call() {
        let spec = Spec::Stdio { command: "node".into(), args: vec![fixture()], env: vec![] };
        let conn = connect(&spec).await.unwrap();
        let e = conn.request("tools/call", json!({ "name": "hang", "arguments": {} }), Duration::from_millis(300)).await.unwrap_err();
        assert!(e.contains("Keine Antwort"));
        conn.stop().await;
    }

    #[tokio::test]
    async fn streamable_http_with_bearer() {
        let (_child, port) = http_fixture("--http").await;
        let spec = Spec::Remote { url: format!("http://127.0.0.1:{port}/mcp"), headers: vec![("Authorization".into(), "Bearer geheim".into())] };
        exercise(connect(&spec).await.unwrap()).await;
    }

    #[tokio::test]
    async fn wrong_token_is_refused() {
        let (_child, port) = http_fixture("--http").await;
        let spec = Spec::Remote { url: format!("http://127.0.0.1:{port}/mcp"), headers: vec![("Authorization".into(), "Bearer falsch".into())] };
        assert!(connect(&spec).await.err().unwrap().contains("Anmeldung abgelehnt"));
    }

    #[tokio::test]
    async fn falls_back_to_legacy_sse() {
        let (_child, port) = http_fixture("--sse").await;
        let spec = Spec::Remote { url: format!("http://127.0.0.1:{port}/sse"), headers: vec![("Authorization".into(), "Bearer geheim".into())] };
        exercise(connect(&spec).await.unwrap()).await;
    }
}

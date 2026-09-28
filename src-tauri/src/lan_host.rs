//! Optional, process-local LAN frontend. SQLite and all writes stay at the existing boundary.
use crate::{
    database::Database, db, lan_bridge,
    lan_interfaces::{self, LanAddress},
};
use http_body_util::{BodyExt, Full, Limited};
use hyper::{
    body::{Bytes, Incoming},
    service::service_fn,
    Request, Response, StatusCode,
};
use hyper_util::rt::{TokioIo, TokioTimer};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    convert::Infallible,
    net::{Ipv4Addr, SocketAddr},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::{
    net::TcpListener,
    sync::{oneshot, Mutex, Semaphore},
    task::{JoinHandle, JoinSet},
};

mod embedded {
    include!(concat!(env!("OUT_DIR"), "/lan_assets.rs"));
}
const BASE: &str = "/studyplan-lan/";
const PORT: u16 = 4178;
const MAX_BODY: usize = 102 * 1024 * 1024;
const METHODS: &[&str] = &[
    "load_state",
    "revision",
    "commit_state",
    "export_backup",
    "validate_backup",
    "load_restore_point",
    "restore_backup",
    "undo_restore",
];
type Reply = Response<Full<Bytes>>;

#[derive(Serialize)]
pub struct Status {
    active: bool,
    addresses: Vec<LanAddress>,
    address: Option<String>,
    url: Option<String>,
    key: Option<String>,
}
struct Running {
    address: String,
    url: String,
    shared: Arc<Shared>,
    shutdown: oneshot::Sender<()>,
    task: JoinHandle<()>,
}
struct Shared {
    authority: String,
    origin: String,
    key: String,
    active: AtomicBool,
    database: Database,
    // The permit is owned by the blocking SQLite call, including after a dropped HTTP response.
    operations: Arc<Semaphore>,
    bodies: Semaphore,
}
#[derive(Default)]
pub struct LanHost(Mutex<Option<Running>>);

fn test_address() -> Option<String> {
    #[cfg(debug_assertions)]
    if std::env::var_os("STUDYPLAN_TEST_DATA_DIR").is_some()
        && std::env::var("STUDYPLAN_LAN_TEST_ADDRESS").as_deref() == Ok("127.0.0.1")
    {
        return Some("127.0.0.1".into());
    }
    None
}
fn configured_port() -> u16 {
    #[cfg(debug_assertions)]
    if test_address().is_some() {
        if let Ok(value) = std::env::var("STUDYPLAN_LAN_TEST_PORT") {
            if let Ok(port) = value.parse::<u16>() {
                if port > 0 {
                    return port;
                }
            }
        }
    }
    PORT
}
fn addresses() -> Result<Vec<LanAddress>, String> {
    if let Some(address) = test_address() {
        return Ok(vec![LanAddress {
            address,
            interface_alias: "Test LAN".into(),
        }]);
    }
    lan_interfaces::load()
}
impl LanHost {
    pub async fn status(&self) -> Result<Status, String> {
        let interfaces = addresses()?;
        let mut current = self.0.lock().await;
        clear_failed(&mut current).await;
        Ok(status_of(current.as_ref(), interfaces))
    }
    pub async fn start(&self, address: String, database: Database) -> Result<Status, String> {
        let interfaces = addresses()?;
        if !interfaces.iter().any(|candidate| candidate.address == address) {
            return Err("このPCのLANアドレスを選択してください。".into());
        }
        let mut current = self.0.lock().await;
        clear_failed(&mut current).await;
        if let Some(running) = current.as_ref() {
            if running.address != address {
                return Err("公開を停止してからアドレスを変更してください。".into());
            }
            return Ok(status_of(current.as_ref(), interfaces));
        }
        let check = database.clone();
        tokio::task::spawn_blocking(move || check.with(|conn| db::load(conn)))
            .await
            .map_err(|_| "保存状態を確認できません。")??;
        let ip: Ipv4Addr = address.parse().map_err(|_| "LANアドレスが不正です。")?;
        let running =
            start_listener(SocketAddr::new(ip.into(), configured_port()), database).await?;
        *current = Some(running);
        Ok(status_of(current.as_ref(), interfaces))
    }
    pub async fn stop(&self) -> Result<Status, String> {
        let mut current = self.0.lock().await;
        if let Some(running) = current.take() {
            stop_running(running).await;
        }
        Ok(status_of(None, addresses()?))
    }
}
async fn stop_running(running: Running) {
    running.shared.active.store(false, Ordering::SeqCst);
    let _ = running.shutdown.send(());
    let _ = running.task.await;
    // Do not abandon a request already executing a SQLite transaction.
    let _saved = running.shared.operations.acquire().await;
}
async fn clear_failed(current: &mut Option<Running>) {
    if current
        .as_ref()
        .is_some_and(|r| !r.shared.active.load(Ordering::SeqCst) || r.task.is_finished())
    {
        if let Some(running) = current.take() {
            stop_running(running).await;
        }
    }
}
fn status_of(running: Option<&Running>, interfaces: Vec<LanAddress>) -> Status {
    let running =
        running.filter(|r| r.shared.active.load(Ordering::SeqCst) && !r.task.is_finished());
    Status {
        active: running.is_some(),
        addresses: interfaces,
        address: running.map(|r| r.address.clone()),
        url: running.map(|r| r.url.clone()),
        key: running.map(|r| r.shared.key.clone()),
    }
}
async fn start_listener(socket: SocketAddr, database: Database) -> Result<Running, String> {
    let listener = TcpListener::bind(socket).await.map_err(|error| {
        if error.kind() == std::io::ErrorKind::AddrInUse {
            format!(
                "{}番ポートは別の配信で使用中です。先にその配信を停止してください。",
                socket.port()
            )
        } else {
            "LAN公開を開始できません。Wi-Fi接続とアドレスを確認してください。".into()
        }
    })?;
    let socket = listener
        .local_addr()
        .map_err(|_| "配信先を確認できません。")?;
    let mut random = [0u8; 32];
    getrandom::fill(&mut random).map_err(|_| "接続キーを生成できません。")?;
    let key = random
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    let origin = format!("http://{socket}");
    let shared = Arc::new(Shared {
        authority: socket.to_string(),
        origin: origin.clone(),
        key,
        active: AtomicBool::new(true),
        database,
        operations: Arc::new(Semaphore::new(1)),
        bodies: Semaphore::new(2),
    });
    let (shutdown, mut stop) = oneshot::channel();
    let context = shared.clone();
    let task = tokio::spawn(async move {
        let connections = Arc::new(Semaphore::new(32));
        let mut tasks = JoinSet::new();
        loop {
            tokio::select! {
                _ = &mut stop => break,
                result = listener.accept() => {
                    let Ok((stream, _)) = result else { break };
                    let Ok(permit) = connections.clone().try_acquire_owned() else { drop(stream); continue };
                    let context = context.clone();
                    tasks.spawn(async move {
                        let _permit = permit;
                        let service = service_fn(move |request| handle(request, context.clone()));
                        let mut builder = hyper::server::conn::http1::Builder::new();
                        builder.keep_alive(false).max_buf_size(32 * 1024).timer(TokioTimer::new()).header_read_timeout(Duration::from_secs(10));
                        let _ = tokio::time::timeout(Duration::from_secs(30), builder.serve_connection(TokioIo::new(stream), service)).await;
                    });
                }
                Some(_) = tasks.join_next(), if !tasks.is_empty() => {}
            }
        }
        context.active.store(false, Ordering::SeqCst);
        tasks.abort_all();
        while tasks.join_next().await.is_some() {}
    });
    Ok(Running {
        address: socket.ip().to_string(),
        url: format!("{origin}{BASE}"),
        shared,
        shutdown,
        task,
    })
}

fn response(status: StatusCode, content_type: &str, bytes: impl Into<Bytes>) -> Reply {
    Response::builder().status(status)
        .header("Content-Type", content_type).header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff").header("Referrer-Policy", "no-referrer")
        .header("X-Frame-Options", "DENY").header("Cross-Origin-Resource-Policy", "same-origin")
        .header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
        .body(Full::new(bytes.into())).unwrap()
}
fn json_reply(status: StatusCode, packet: Value) -> Reply {
    response(
        status,
        "application/json; charset=utf-8",
        packet.to_string(),
    )
}
fn error(status: StatusCode, message: &str) -> Reply {
    json_reply(status, json!({"ok":false,"error":message}))
}
fn header<'a>(request: &'a Request<Incoming>, name: &str) -> Option<&'a str> {
    let mut values = request.headers().get_all(name).iter();
    let value = values.next()?.to_str().ok()?;
    if values.next().is_some() {
        return None;
    }
    Some(value)
}
fn asset_type(name: &str) -> &'static str {
    match name.rsplit('.').next().unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "webmanifest" => "application/manifest+json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "webp" => "image/webp",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        _ => "application/octet-stream",
    }
}
async fn handle(request: Request<Incoming>, shared: Arc<Shared>) -> Result<Reply, Infallible> {
    Ok(handle_inner(request, shared).await)
}
async fn handle_inner(request: Request<Incoming>, shared: Arc<Shared>) -> Reply {
    if !shared.active.load(Ordering::SeqCst) {
        return error(StatusCode::SERVICE_UNAVAILABLE, "LAN公開は停止しました。");
    }
    if header(&request, "host") != Some(shared.authority.as_str()) {
        return error(StatusCode::FORBIDDEN, "接続先が一致しません。");
    }
    if request.headers().contains_key("origin")
        && header(&request, "origin") != Some(shared.origin.as_str())
    {
        return error(StatusCode::FORBIDDEN, "他のサイトからは接続できません。");
    }
    if header(&request, "sec-fetch-site") == Some("cross-site") {
        return error(StatusCode::FORBIDDEN, "他のサイトからは接続できません。");
    }
    let path = request.uri().path().to_owned();
    if path.len() > 512
        || path.contains('%')
        || path.contains('\\')
        || path.contains("..")
        || path.contains('\0')
        || request.uri().query().is_some()
    {
        return error(StatusCode::BAD_REQUEST, "URLが不正です。");
    }
    let Some(relative) = path.strip_prefix(BASE) else {
        return error(StatusCode::NOT_FOUND, "見つかりません。");
    };
    if let Some(method) = relative.strip_prefix("api/") {
        if header(&request, "origin") != Some(shared.origin.as_str()) {
            return error(StatusCode::FORBIDDEN, "接続元が一致しません。");
        }
        if request.method() != hyper::Method::POST {
            return error(StatusCode::METHOD_NOT_ALLOWED, "POSTを使用してください。");
        }
        if header(&request, "authorization") != Some(format!("Bearer {}", shared.key).as_str()) {
            return error(StatusCode::UNAUTHORIZED, "接続キーを確認してください。");
        }
        if !METHODS.contains(&method) {
            return error(StatusCode::NOT_FOUND, "対応していない保存操作です。");
        }
        if header(&request, "content-type")
            .and_then(|s| s.split(';').next())
            .map(str::trim)
            != Some("application/json")
            || request.headers().contains_key("content-encoding")
        {
            return error(
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "JSONで送信してください。",
            );
        }
        if header(&request, "content-length")
            .and_then(|s| s.parse::<u64>().ok())
            .is_some_and(|n| n > MAX_BODY as u64)
        {
            return error(StatusCode::PAYLOAD_TOO_LARGE, "要求が大きすぎます。");
        }
        let Ok(_body_permit) = shared.bodies.acquire().await else {
            return error(
                StatusCode::SERVICE_UNAVAILABLE,
                "保存要求が混み合っています。しばらくしてから再試行してください。",
            );
        };
        let method = method.to_owned();
        let bytes = match tokio::time::timeout(
            Duration::from_secs(10),
            Limited::new(request.into_body(), MAX_BODY).collect(),
        )
        .await
        {
            Ok(Ok(body)) => body.to_bytes(),
            Ok(Err(_)) => {
                return error(
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "要求のサイズまたは形式を確認してください。",
                )
            }
            Err(_) => return error(StatusCode::REQUEST_TIMEOUT, "送信が完了しませんでした。"),
        };
        let params: Value = match serde_json::from_slice(&bytes) {
            Ok(Value::Object(object)) => Value::Object(object),
            _ => return error(StatusCode::BAD_REQUEST, "要求のJSONが不正です。"),
        };
        let Ok(permit) = shared.operations.clone().acquire_owned().await else {
            return error(
                StatusCode::SERVICE_UNAVAILABLE,
                "保存処理を確認できません。",
            );
        };
        if !shared.active.load(Ordering::SeqCst) {
            return error(StatusCode::SERVICE_UNAVAILABLE, "LAN公開は停止しました。");
        }
        let database = shared.database.clone();
        let task = tokio::task::spawn_blocking(move || {
            let _permit = permit;
            lan_bridge::dispatch(&database, &method, &params)
        })
        .await;
        match task {
            Ok(Ok(value)) => json_reply(StatusCode::OK, json!({"ok":true,"value":value})),
            Ok(Err(message)) => {
                let message = message
                    .split("\n保存先：")
                    .next()
                    .unwrap_or("保存に失敗しました。");
                let status = if message.contains("別の操作でデータが更新") {
                    StatusCode::CONFLICT
                } else {
                    StatusCode::UNPROCESSABLE_ENTITY
                };
                error(status, message)
            }
            Err(_) => error(
                StatusCode::SERVICE_UNAVAILABLE,
                "保存処理を確認できません。再読み込みしてください。",
            ),
        }
    } else {
        if request.method() != hyper::Method::GET && request.method() != hyper::Method::HEAD {
            return error(StatusCode::METHOD_NOT_ALLOWED, "この操作は利用できません。");
        }
        let name = if relative.is_empty()
            || (!relative.contains('.')
                && !relative.starts_with("assets/")
                && !relative.starts_with("api"))
        {
            "index.html"
        } else {
            relative
        };
        let Some((_, bytes)) = embedded::ASSETS.iter().find(|(path, _)| *path == name) else {
            return error(StatusCode::NOT_FOUND, "見つかりません。");
        };
        response(
            StatusCode::OK,
            asset_type(name),
            if request.method() == hyper::Method::HEAD {
                Bytes::new()
            } else {
                Bytes::from_static(bytes)
            },
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn state() -> Value {
        serde_json::from_str(include_str!("../../src/domain/initialState.json")).unwrap()
    }
    fn database() -> (tempfile::TempDir, Database) {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::new(Ok(dir.path().join("studyplan.sqlite3")));
        (dir, db)
    }
    async fn launch(db: Database) -> Running {
        start_listener("127.0.0.1:0".parse().unwrap(), db)
            .await
            .unwrap()
    }
    #[tokio::test]
    async fn listener_binds_only_the_selected_ipv4() {
        let (_dir, db) = database();
        let running = launch(db).await;
        let bound: SocketAddr = running.shared.authority.parse().unwrap();
        assert_eq!(bound.ip(), Ipv4Addr::LOCALHOST);
        let other = SocketAddr::new(Ipv4Addr::new(127, 0, 0, 2).into(), bound.port());
        let result =
            tokio::time::timeout(Duration::from_secs(3), tokio::net::TcpStream::connect(other)).await;
        assert!(
            !matches!(result, Ok(Ok(_))),
            "listener must not bind all local addresses"
        );
        stop_running(running).await;
    }
    async fn raw(
        running: &Running,
        method: &str,
        path: &str,
        headers: &str,
        body: &str,
    ) -> (u16, String, String) {
        let mut socket = tokio::net::TcpStream::connect(&running.shared.authority)
            .await
            .unwrap();
        socket
            .write_all(format!("{method} {path} HTTP/1.1\r\n{headers}\r\n{body}").as_bytes())
            .await
            .unwrap();
        let mut bytes = Vec::new();
        tokio::time::timeout(Duration::from_secs(5), socket.read_to_end(&mut bytes))
            .await
            .unwrap()
            .unwrap();
        let text = String::from_utf8_lossy(&bytes);
        let (head, body) = text.split_once("\r\n\r\n").expect("HTTP response");
        (
            head.split_whitespace().nth(1).unwrap().parse().unwrap(),
            head.into(),
            body.into(),
        )
    }
    fn api_headers(running: &Running, key: &str, origin: Option<&str>, size: usize) -> String {
        format!("Host: {}\r\n{}Authorization: Bearer {key}\r\nContent-Type: application/json\r\nContent-Length: {size}\r\n", running.shared.authority, origin.map(|value| format!("Origin: {value}\r\n")).unwrap_or_default())
    }
    async fn api(running: &Running, method: &str, params: Value) -> (u16, Value) {
        let body = params.to_string();
        let headers = api_headers(
            running,
            &running.shared.key,
            Some(&running.shared.origin),
            body.len(),
        );
        let (code, _, body) = raw(
            running,
            "POST",
            &format!("{BASE}api/{method}"),
            &headers,
            &body,
        )
        .await;
        (code, serde_json::from_str(&body).unwrap())
    }

    #[tokio::test]
    async fn shared_sqlite_save_replay_conflict_backup_and_restore() {
        let (_dir, db) = database();
        let running = launch(db.clone()).await;
        let params = json!({"data":state(),"expected":0,"requestId":"native-lan-save"});
        let (code, first) = api(&running, "commit_state", params.clone()).await;
        assert_eq!(code, 200);
        assert_eq!(first["value"]["revision"], 1);
        assert_eq!(
            db.with(|conn| db::load(conn)).unwrap().unwrap().data,
            state()
        );
        let mut other = state();
        other["theme"] = json!("sky");
        db.with(|conn| db::commit(conn, 1, "desktop-save", other.clone()))
            .unwrap();
        assert_eq!(api(&running, "commit_state", params).await.1, first);
        assert_eq!(
            api(
                &running,
                "commit_state",
                json!({"data":state(),"expected":1,"requestId":"stale"})
            )
            .await
            .0,
            409
        );
        assert_eq!(
            api(&running, "load_state", json!({})).await.1["value"]["data"],
            other
        );
        let packet = api(&running, "export_backup", json!({})).await.1["value"].clone();
        assert_eq!(
            api(
                &running,
                "validate_backup",
                json!({"text":packet.to_string()})
            )
            .await
            .0,
            200
        );
        assert_eq!(
            api(
                &running,
                "restore_backup",
                json!({"text":packet.to_string(),"expected":2,"requestId":"restore"})
            )
            .await
            .1["value"]["revision"],
            3
        );
        assert_eq!(
            api(&running, "load_restore_point", json!({})).await.1["value"]["data"],
            other
        );
        assert_eq!(
            api(
                &running,
                "undo_restore",
                json!({"expected":3,"requestId":"undo"})
            )
            .await
            .1["value"]["revision"],
            4
        );
        stop_running(running).await;
    }

    #[tokio::test]
    async fn api_requires_exact_origin_host_and_key_without_cors() {
        let (_dir, db) = database();
        let running = launch(db).await;
        for (key, origin, expected) in [
            ("bad", Some(running.shared.origin.as_str()), 401),
            (
                running.shared.key.as_str(),
                Some("http://other.example"),
                403,
            ),
            (running.shared.key.as_str(), None, 403),
        ] {
            let headers = api_headers(&running, key, origin, 2);
            let (code, head, _) = raw(
                &running,
                "POST",
                &format!("{BASE}api/revision"),
                &headers,
                "{}",
            )
            .await;
            assert_eq!(code, expected);
            assert!(!head
                .to_ascii_lowercase()
                .contains("access-control-allow-origin"));
        }
        let headers = api_headers(
            &running,
            &running.shared.key,
            Some(&running.shared.origin),
            2,
        )
        .replace(
            &format!("Host: {}", running.shared.authority),
            "Host: other.example",
        );
        assert_eq!(
            raw(
                &running,
                "POST",
                &format!("{BASE}api/revision"),
                &headers,
                "{}"
            )
            .await
            .0,
            403
        );
        assert_eq!(
            raw(
                &running,
                "OPTIONS",
                &format!("{BASE}api/revision"),
                &api_headers(
                    &running,
                    &running.shared.key,
                    Some(&running.shared.origin),
                    0
                ),
                ""
            )
            .await
            .0,
            405
        );
        stop_running(running).await;
    }

    #[tokio::test]
    async fn payload_limits_json_and_schema_do_not_mutate_sqlite() {
        let (_dir, db) = database();
        let running = launch(db.clone()).await;
        let path = format!("{BASE}api/commit_state");
        for (body, size, code) in [("{", 1, 400), ("[]", 2, 400), ("", MAX_BODY + 1, 413)] {
            assert_eq!(
                raw(
                    &running,
                    "POST",
                    &path,
                    &api_headers(
                        &running,
                        &running.shared.key,
                        Some(&running.shared.origin),
                        size
                    ),
                    body
                )
                .await
                .0,
                code
            );
        }
        assert_eq!(
            api(
                &running,
                "commit_state",
                json!({"expected":0,"requestId":"invalid","data":{"records":[]}})
            )
            .await
            .0,
            422
        );
        assert_eq!(api(&running, "not-a-command", json!({})).await.0, 404);
        assert_eq!(db.with(|conn| db::revision(conn)).unwrap(), 0);
        stop_running(running).await;
    }

    #[tokio::test]
    async fn only_embedded_assets_and_safe_spa_routes_are_served() {
        let (_dir, db) = database();
        let running = launch(db).await;
        let headers = format!("Host: {}\r\n", running.shared.authority);
        let (code, head, body) = raw(
            &running,
            "GET",
            &format!("{BASE}calendar/2026-09-28"),
            &headers,
            "",
        )
        .await;
        assert_eq!(code, 200);
        assert!(body.contains("<html"));
        assert!(head
            .to_ascii_lowercase()
            .contains("cache-control: no-store"));
        for path in [
            "/src/domain/model.ts",
            "/studyplan-lan/../studyplan.sqlite3",
            "/studyplan-lan/%2e%2e/backup.studyplan.json",
            "/studyplan-lan/release-files.json",
            "/studyplan-lan/studyplan.sqlite3",
            "/studyplan-lan/.env",
            "/studyplan-lan/assets/missing.js",
        ] {
            assert!(
                raw(&running, "GET", path, &headers, "").await.0 >= 400,
                "{path}"
            );
        }
        for (name, _) in embedded::ASSETS {
            assert_eq!(
                raw(&running, "HEAD", &format!("{BASE}{name}"), &headers, "")
                    .await
                    .0,
                200
            );
        }
        stop_running(running).await;
    }

    #[tokio::test]
    async fn stop_releases_port_rotates_key_and_does_not_stop_another_owner() {
        let (_dir, db) = database();
        let running = launch(db.clone()).await;
        let address: SocketAddr = running.shared.authority.parse().unwrap();
        let old_key = running.shared.key.clone();
        let error = start_listener(address, db.clone()).await.err().unwrap();
        assert!(error.contains("使用中"));
        assert_eq!(api(&running, "revision", json!({})).await.0, 200);
        stop_running(running).await;
        assert!(tokio::net::TcpStream::connect(address).await.is_err());
        let restarted = start_listener(address, db).await.unwrap();
        assert_ne!(restarted.shared.key, old_key);
        assert_eq!(
            raw(
                &restarted,
                "POST",
                &format!("{BASE}api/revision"),
                &api_headers(&restarted, &old_key, Some(&restarted.shared.origin), 2),
                "{}"
            )
            .await
            .0,
            401
        );
        stop_running(restarted).await;
    }

    #[tokio::test]
    async fn stop_waits_for_an_already_started_sqlite_operation() {
        let (_dir, db) = database();
        let running = launch(db.clone()).await;
        let permit = running
            .shared
            .operations
            .clone()
            .acquire_owned()
            .await
            .unwrap();
        let (release, wait) = std::sync::mpsc::channel();
        let saved = db.clone();
        let writing = tokio::task::spawn_blocking(move || {
            let _permit = permit;
            wait.recv().unwrap();
            saved
                .with(|conn| db::commit(conn, 0, "in-flight", state()))
                .unwrap();
        });
        let stopping = tokio::spawn(stop_running(running));
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(!stopping.is_finished());
        release.send(()).unwrap();
        writing.await.unwrap();
        stopping.await.unwrap();
        assert_eq!(db.with(|conn| db::revision(conn)).unwrap(), 1);
    }

    #[tokio::test]
    async fn failed_listener_is_reported_stopped_and_can_be_restarted() {
        let (_dir, db) = database();
        let running = launch(db.clone()).await;
        let address: SocketAddr = running.shared.authority.parse().unwrap();
        running.task.abort();
        tokio::task::yield_now().await;
        let host = LanHost(Mutex::new(Some(running)));
        let status = host.status().await.unwrap();
        assert!(!status.active);
        assert!(status.key.is_none());
        assert!(status.url.is_none());
        let again = start_listener(address, db.clone()).await.unwrap();
        stop_running(again).await;
        for address in ["0.0.0.0", "8.8.8.8", "::"] {
            assert!(host.start(address.into(), db.clone()).await.is_err());
        }
    }
}

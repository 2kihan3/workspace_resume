//! Codex App Server 进程监管器（spec §10.2）。
//!
//! - 启动 `codex app-server`（stdio JSONL），请求分配单调递增 ID
//! - response 按 id 关联 pending map；通知转发为 Tauri event
//! - server request（审批）映射为待审批事件
//! - stderr 写入日志文件，不与协议流混合

use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio::time::{timeout, Duration};

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum AppServerState {
    NotInstalled,
    Stopped,
    Starting,
    Ready,
    Crashed,
}

struct PendingRequest {
    tx: oneshot::Sender<Result<Value, String>>,
}

struct OutgoingRequest {
    method: String,
    params: Value,
    reply: oneshot::Sender<Result<Value, String>>,
    timeout: Duration,
    /// true = JSON-RPC 通知（无 id，写入即完成）
    notification: bool,
}

#[derive(Clone)]
pub struct SupervisorHandle {
    request_tx: mpsc::UnboundedSender<OutgoingRequest>,
    pub codex_path: PathBuf,
    pub codex_version: Option<String>,
}

impl SupervisorHandle {

    /// 发送 JSON-RPC 通知（无 id，写入即完成，不等响应）。
    pub async fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        let (tx, rx) = oneshot::channel();
        self.request_tx
            .send(OutgoingRequest {
                method: method.to_string(),
                params,
                reply: tx,
                timeout: Duration::from_millis(1),
                notification: true,
            })
            .map_err(|_| "监管器已停止".to_string())?;
        rx.await
            .map_err(|_| "通知通道关闭".to_string())
            .and_then(|r| r.map(|_| ()))
    }

    pub async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        self.request_with_timeout(method, params, Duration::from_secs(180))
            .await
    }

    pub async fn request_with_timeout(
        &self,
        method: &str,
        params: Value,
        t: Duration,
    ) -> Result<Value, String> {
        let (tx, rx) = oneshot::channel();
        self.request_tx
            .send(OutgoingRequest { method: method.to_string(), params, reply: tx, timeout: t, notification: false })
            .map_err(|_| "监管器已停止".to_string())?;
        rx.await.map_err(|_| "请求通道关闭".to_string())?
    }
}

pub struct SupervisorConfig {
    pub codex_path: PathBuf,
    pub app_handle: tauri::AppHandle,
    pub state_tx: mpsc::UnboundedSender<AppServerState>,
}

/// 启动 App Server 子进程并接管其 IO。返回可发起请求的句柄。
pub async fn start_supervisor(config: SupervisorConfig) -> Result<SupervisorHandle, String> {
    let codex_version = {
        let out = std::process::Command::new(&config.codex_path)
            .arg("--version")
            .output()
            .map_err(|e| format!("执行 codex --version 失败: {e}"))?;
        String::from_utf8_lossy(&out.stdout)
            .split_whitespace()
            .last()
            .map(|s| s.to_string())
    };

    let (request_tx, mut request_rx) = mpsc::unbounded_channel::<OutgoingRequest>();
    let next_id = Arc::new(AtomicI64::new(1));
    let pending: Arc<Mutex<HashMap<i64, PendingRequest>>> = Arc::new(Mutex::new(HashMap::new()));
    let child_slot: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));

    let _ = config.state_tx.send(AppServerState::Starting);
    let mut child = Command::new(&config.codex_path)
        .args(["app-server"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("启动 codex app-server 失败: {e}"))?;

    let stdout = child.stdout.take().ok_or("stdout 不可用")?;
    let stderr = child.stderr.take().ok_or("stderr 不可用")?;
    {
        let mut slot = child_slot.lock().await;
        *slot = Some(child);
    }

    // stderr -> 日志文件（spec §10.2.4）
    let log_dir = std::env::temp_dir().join("jsw-logs");
    let _ = std::fs::create_dir_all(&log_dir);
    tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        let log_path = log_dir.join(format!(
            "app-server-{}.log",
            chrono::Utc::now().format("%Y%m%dT%H%M%S")
        ));
        let mut log = tokio::fs::File::create(&log_path).await.ok();
        while let Ok(Some(line)) = lines.next_line().await {
            if let Some(f) = log.as_mut() {
                let _ = f.write_all(line.as_bytes()).await;
                let _ = f.write_all(b"\n").await;
            }
        }
    });

    // stdout -> JSONL 协议循环
    let pending_reader = Arc::clone(&pending);
    let app_handle = config.app_handle.clone();
    let approval_tx = config.app_handle.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
            let id = msg.get("id").and_then(Value::as_i64);
            let method = msg.get("method").and_then(Value::as_str).map(String::from);
            match (id, method) {
                (Some(id), Some(method)) => {
                    // server request（审批等）-> Tauri 事件
                    let params = msg.get("params").cloned().unwrap_or(Value::Null);
                    let _ = tauri::Emitter::emit(
                        &approval_tx,
                        "ai-approval-requested",
                        serde_json::json!({ "serverRequestId": id, "method": method, "params": params }),
                    );
                }
                (Some(id), None) => {
                    let mut map = pending_reader.lock().await;
                    if let Some(p) = map.remove(&id) {
                        if let Some(err) = msg.get("error") {
                            let _ = p.tx.send(Err(err.to_string()));
                        } else {
                            let _ = p
                                .tx
                                .send(Ok(msg.get("result").cloned().unwrap_or(Value::Null)));
                        }
                    }
                }
                (None, Some(method)) => {
                    // 通知：直连 turn 生命周期桥（关键路径），同时转发 Tauri
                    // 事件供 UI 展示流式状态——不再依赖事件回环检测 turn 完成
                    let params = msg.get("params").cloned().unwrap_or(Value::Null);
                    crate::ai::bridge::record_notification(&method, &params);
                    let _ = tauri::Emitter::emit(
                        &app_handle,
                        "app-server-notification",
                        serde_json::json!({ "method": method, "params": params }),
                    );
                }
                (None, None) => {}
            }
        }
        // 进程退出：拒绝全部 pending
        let mut map = pending_reader.lock().await;
        for (_, p) in map.drain() {
            let _ = p.tx.send(Err("App Server 进程已退出".into()));
        }
    });

    // stdin 写循环
    let state_tx = config.state_tx.clone();
    let writer_slot = Arc::clone(&child_slot);
    tokio::spawn(async move {
        while let Some(req) = request_rx.recv().await {
            let (tx, rx) = oneshot::channel();
            let id = next_id.fetch_add(1, Ordering::SeqCst);
            pending.lock().await.insert(id, PendingRequest { tx });

            if req.notification {
                // 通知：无 id，写入即回复完成
                let note = json!({
                    "jsonrpc": "2.0",
                    "method": req.method,
                    "params": req.params,
                });
                let ok = {
                    let mut slot = writer_slot.lock().await;
                    match slot.as_mut().and_then(|c| c.stdin.as_mut()) {
                        Some(stdin) => {
                            let mut line = serde_json::to_string(&note).unwrap_or_default();
                            line.push('\n');
                            let write = stdin.write_all(line.as_bytes()).await;
                            match write {
                                Ok(_) => stdin.flush().await.map_err(|e| e.to_string()),
                                Err(e) => Err(e.to_string()),
                            }
                        }
                        None => Err("子进程未启动".into()),
                    }
                };
                let _ = req.reply.send(ok.map(|_| Value::Null));
                continue;
            }
            let msg = json!({
                "jsonrpc": "2.0",
                "id": id,
                "method": req.method,
                "params": req.params,
            });
            let write_result = {
                let mut slot = writer_slot.lock().await;
                if let Some(child) = slot.as_mut() {
                    if let Some(stdin) = child.stdin.as_mut() {
                        let mut line =
                            serde_json::to_string(&msg).unwrap_or_default();
                        line.push('\n');
                        let write = stdin.write_all(line.as_bytes()).await;
                        let flush = match write {
                            Ok(_) => stdin.flush().await,
                            Err(e) => Err(e),
                        };
                        flush.map_err(|e| e.to_string())
                    } else {
                        Err("stdin 不可用".into())
                    }
                } else {
                    Err("子进程未启动".into())
                }
            };
            if let Err(e) = write_result {
                pending.lock().await.remove(&id);
                let _ = req.reply.send(Err(e));
                continue;
            }
            let pending_map = Arc::clone(&pending);
            tokio::spawn(async move {
                match timeout(req.timeout, rx).await {
                    Ok(Ok(result)) => {
                        let _ = req.reply.send(result);
                    }
                    _ => {
                        pending_map.lock().await.remove(&id);
                        let _ = req.reply.send(Err("请求超时".into()));
                    }
                }
            });
        }
    });

    let _ = state_tx.send(AppServerState::Ready);
    Ok(SupervisorHandle { request_tx, codex_path: config.codex_path, codex_version })
}

/// 发现 codex 可执行文件（spec §10.2.1）。
pub fn discover_codex(extra_path: Option<String>) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = extra_path
        .map(PathBuf::from)
        .into_iter()
        .collect();
    for dir in std::env::var("PATH").unwrap_or_default().split(':').filter(|s| !s.is_empty()) {
        candidates.push(PathBuf::from(dir).join("codex"));
    }
    for p in [
        "/opt/homebrew/bin/codex",
        "/usr/local/bin/codex",
    ] {
        candidates.push(PathBuf::from(p));
    }
    if let Ok(home) = std::env::var("HOME") {
        candidates.push(PathBuf::from(home).join(".local/bin/codex"));
    }
    candidates.into_iter().find(|p| p.is_file())
}

/// 优雅退出：先终止活动 turn，再等 2 秒，最后结束子进程（spec §10.2.8）。
/// turn 终止由业务层在 Drop 前调用；这里只负责等待与结束进程。
pub async fn shutdown(child_slot: &Mutex<Option<Child>>) {
    let mut slot = child_slot.lock().await;
    if let Some(mut child) = slot.take() {
        let _ = child.kill().await;
    }
}

#[allow(dead_code)]
fn _unused(p: &Path) -> bool {
    p.exists()
}

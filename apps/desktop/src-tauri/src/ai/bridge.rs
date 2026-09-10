//! turn 生命周期桥：supervisor 把 server 通知转成 Tauri 事件，
//! 命令层收到 turn/completed 等通知时在这里登记，AI 服务轮询消费。

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum TurnStatus {
    Completed,
    Aborted,
}

#[derive(Debug, Clone)]
pub struct TurnResult {
    pub turn_id: Option<String>,
    pub status: TurnStatus,
}

static REGISTRY: OnceLock<Mutex<HashMap<String, TurnResult>>> = OnceLock::new();

fn registry() -> &'static Mutex<HashMap<String, TurnResult>> {
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 由命令层的事件监听调用。method 形如 "turn/completed"、"turn/aborted"。
pub fn record_notification(method: &str, params: &serde_json::Value) {
    let status = match method {
        "turn/completed" | "turn/idle" => TurnStatus::Completed,
        "turn/aborted" | "turn/failed" | "turn/cancelled" | "error" => TurnStatus::Aborted,
        _ => return,
    };
    let thread_id = params
        .get("threadId")
        .and_then(|v| v.as_str())
        .or_else(|| {
            params
                .get("thread")
                .and_then(|t| t.get("id"))
                .and_then(|v| v.as_str())
        })
        .or_else(|| params.get("id").and_then(|v| v.as_str()))
        .unwrap_or_default()
        .to_string();
    if thread_id.is_empty() {
        return;
    }
    let turn_id = params
        .get("turnId")
        .and_then(|v| v.as_str())
        .or_else(|| {
            params
                .get("turn")
                .and_then(|t| t.get("id"))
                .and_then(|v| v.as_str())
        })
        .map(String::from);
    registry()
        .lock()
        .unwrap()
        .insert(thread_id, TurnResult { turn_id, status });
}

/// 非阻塞检查：turn 是否已结束。
pub fn turn_finished(thread_id: &str) -> bool {
    registry().lock().unwrap().contains_key(thread_id)
}

/// 清理登记（Run 提交完成后）。
pub fn clear_thread(thread_id: &str) {
    registry().lock().unwrap().remove(thread_id);
}

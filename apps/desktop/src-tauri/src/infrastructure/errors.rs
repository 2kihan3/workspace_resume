//! 统一错误类型。所有 IPC 命令返回 `Result<T, SerializedError>`，
//! 前端按 `code` 分支处理（spec §14）。

use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("数据库错误: {0}")]
    Database(#[from] sqlx::Error),

    #[error("迁移错误: {0}")]
    Migration(#[from] sqlx::migrate::MigrateError),

    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON 错误: {0}")]
    Json(#[from] serde_json::Error),

    #[error("校验失败: {0}")]
    Validation(String),

    #[error("未找到: {0}")]
    NotFound(String),

    #[error("状态机拒绝: {0}")]
    InvalidTransition(String),

    #[error("Codex CLI 不可用: {0}")]
    CodexUnavailable(String),

    #[error("AI 运行错误: {0}")]
    AIRun(String),

    #[error("模板校验失败: {0}")]
    TemplateInvalid(String),

    #[error("备份错误: {0}")]
    Backup(String),

    #[error("内部错误: {0}")]
    Internal(String),
}

impl From<zip::result::ZipError> for AppError {
    fn from(e: zip::result::ZipError) -> Self {
        AppError::TemplateInvalid(format!("ZIP 错误: {e}"))
    }
}

impl From<anyhow::Error> for AppError {
    fn from(e: anyhow::Error) -> Self {
        AppError::Internal(e.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

/// 跨 IPC 的错误载体（Specta 可导出）。
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SerializedError {
    pub code: String,
    pub message: String,
}

impl SerializedError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self { code: code.to_string(), message: message.into() }
    }
}

impl From<AppError> for SerializedError {
    fn from(e: AppError) -> Self {
        let (code, message) = match &e {
            AppError::Database(err) => ("database", err.to_string()),
            AppError::Migration(err) => ("migration", err.to_string()),
            AppError::Io(err) => ("io", err.to_string()),
            AppError::Json(err) => ("json", err.to_string()),
            AppError::Validation(m) => ("validation", m.clone()),
            AppError::NotFound(m) => ("not_found", m.clone()),
            AppError::InvalidTransition(m) => ("invalid_transition", m.clone()),
            AppError::CodexUnavailable(m) => ("codex_unavailable", m.clone()),
            AppError::AIRun(m) => ("ai_run", m.clone()),
            AppError::TemplateInvalid(m) => ("template_invalid", m.clone()),
            AppError::Backup(m) => ("backup", m.clone()),
            AppError::Internal(m) => ("internal", m.clone()),
        };
        SerializedError { code: code.to_string(), message }
    }
}

impl From<std::io::Error> for SerializedError {
    fn from(e: std::io::Error) -> Self {
        SerializedError { code: "io".into(), message: e.to_string() }
    }
}

impl From<sqlx::Error> for SerializedError {
    fn from(e: sqlx::Error) -> Self {
        SerializedError { code: "database".into(), message: e.to_string() }
    }
}

impl From<String> for SerializedError {
    fn from(message: String) -> Self {
        SerializedError { code: "validation".into(), message }
    }
}

//! 共享应用状态。

use crate::ai::service::AIService;
use crate::infrastructure::db::Db;
use crate::infrastructure::paths::PathLayout;
use crate::infrastructure::pdf::{PdfExporter, WkWebViewExporter};
use std::sync::Arc;

pub struct AppState {
    pub db: Db,
    pub layout: PathLayout,
    pub ai_service: Arc<AIService>,
    pub pdf_exporter: Box<dyn PdfExporter>,
    pub codex_path_override: Option<String>,
}

impl AppState {
    pub fn new(
        db: Db,
        layout: PathLayout,
        ai_service: Arc<AIService>,
        codex_path_override: Option<String>,
    ) -> Self {
        Self {
            db,
            layout,
            ai_service,
            pdf_exporter: Box::new(WkWebViewExporter),
            codex_path_override,
        }
    }
}

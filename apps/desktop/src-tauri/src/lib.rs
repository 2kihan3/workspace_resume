mod ai;
mod application;
mod commands;
mod domain;
mod infrastructure;
mod state;

use ai::service::AIService;
use infrastructure::db::{init_db, Db};
use infrastructure::paths::PathLayout;
use state::AppState;
use tauri::{Listener, Manager, Wry};
use tauri_specta::{collect_commands, Builder};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = Builder::<Wry>::new().commands(collect_commands!(
        commands::list_jobs,
        commands::get_job,
        commands::create_job,
        commands::update_job,
        commands::transition_job,
        commands::delete_job,
        commands::read_jd,
        commands::update_jd,
        commands::list_job_events,
        commands::add_communication,
        commands::list_communications,
        commands::add_application,
        commands::list_applications,
        commands::upsert_interview,
        commands::list_interviews,
        commands::reorder_interview,
        commands::dashboard_metrics,
        commands::import_markdown,
        commands::create_base_resume,
        commands::read_resume,
        commands::save_resume,
        commands::create_resume_version,
        commands::duplicate_resume,
        commands::get_layout,
        commands::save_layout,
        commands::list_resumes,
        commands::delete_resume,
        commands::export_pdf_rendered,
        commands::list_templates,
        commands::set_template_enabled,
        commands::import_template_zip,
        commands::read_template_assets,
        commands::save_template_preview,
        commands::read_template_preview,
        commands::read_ai_status,
        commands::get_codex_path_override,
        commands::set_codex_path_override,
        commands::start_app_server,
        commands::start_login,
        commands::logout,
        commands::list_skills,
        commands::set_skill_enabled,
        commands::import_skill,
        commands::delete_skill,
        commands::enqueue_run,
        commands::cancel_run,
        commands::list_runs,
        commands::read_job_artifacts,
        commands::list_artifacts,
        commands::create_backup,
        commands::restore_backup,
        commands::app_info,
        commands::read_import_source,
        commands::run_recovery_scan,
    ));

    #[cfg(debug_assertions)]
    builder
        .export(
            specta_typescript::Typescript::default(),
            "../src/bindings.ts",
        )
        .expect("导出 TS 绑定失败");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);

            let app_data_dir = app.path().app_data_dir()?;
            let layout = PathLayout::new(app_data_dir);
            layout.ensure_dirs()?;

            // 初始化数据库
            let db_path = layout.db_path();
            let db = tauri::async_runtime::block_on(async { init_db(&db_path).await })
                .expect("初始化数据库失败");
            let db_shared = Db(std::sync::Arc::new(db.clone()));

            // 同步内置模板与 Skill（spec §10.4、§8）
            let resource_dir = app.path().resource_dir()?;
            let templates_src = resource_dir.join("resources/builtin-templates");
            let templates_svc =
                application::template_service::TemplateService::new(db_shared.clone(), layout.clone());
            if let Err(e) =
                tauri::async_runtime::block_on(templates_svc.install_builtin_templates(&templates_src))
            {
                tracing::warn!("内置模板安装失败: {e}");
            }
            let skills_src = resource_dir.join("resources/skills");
            ai::skills::sync_builtin_skills(&skills_src, &layout)?;

            let ai_service = AIService::new(db_shared.clone(), layout.clone());

            // 孤儿任务清理：上次退出时仍在 running/queued 的任务已随进程死亡，
            // 标记失败（spec §14 应用崩溃恢复），避免 UI 永远显示运行中
            tauri::async_runtime::block_on(async {
                let n = sqlx::query(
                    "UPDATE ai_runs SET status = 'failed', error_code = 'orphaned', \
                     error_message = '应用退出时任务被中断，请重新运行', finished_at = ? \
                     WHERE status IN ('running', 'queued', 'waiting_approval')",
                )
                .bind(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
                .execute(&db)
                .await
                .map(|r| r.rows_affected())
                .unwrap_or(0);
                if n > 0 {
                    tracing::info!("已标记 {n} 个孤儿 AI 任务为失败");
                }
            });

            // 崩溃恢复扫描（spec §10.6）
            let recovery = tauri::async_runtime::block_on(async {
                let runs_dir = layout.ai_runs_dir();
                let quarantine = layout.app_data_dir.join("quarantine");
                let rows = sqlx::query("SELECT relative_path FROM artifacts")
                    .fetch_all(&db)
                    .await
                    .unwrap_or_default();
                use sqlx::Row;
                let registered: std::collections::HashSet<String> = rows
                    .iter()
                    .filter_map(|r| r.try_get::<String, _>("relative_path").ok())
                    .collect();
                infrastructure::file_repo::recover_pending_files(&runs_dir, &quarantine, |stem| {
                    registered.iter().any(|rel| rel.ends_with(stem))
                })
                .unwrap_or((0, 0))
            });
            tracing::info!("恢复扫描完成: {recovery:?}");

            // codex 路径覆盖（设置页可配，文件持久化）
            let codex_override = std::fs::read_to_string(layout.app_data_dir.join("codex-path.txt"))
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            app.manage(AppState::new(db_shared, layout, ai_service, codex_override));

            // App Server 通知 -> turn 桥
            let handle = app.handle().clone();
            app.listen("app-server-notification", move |event| {
                if let Ok(payload) = serde_json::from_str::<serde_json::Value>(event.payload()) {
                    let method = payload
                        .get("method")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    if let Some(params) = payload.get("params") {
                        ai::bridge::record_notification(&method, params);
                    }
                    use tauri::Emitter;
                    let _ = handle.emit(
                        "ai-stream-item",
                        serde_json::json!({ "method": method }),
                    );
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

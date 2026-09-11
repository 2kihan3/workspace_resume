//! Tauri IPC 命令（spec §11）。页面不得直接访问基础设施模块。

use crate::ai::service::{AIServiceStatus, EnqueueAIRunInput};
use crate::ai::supervisor::{discover_codex, start_supervisor};
use crate::application::backup_service::BackupService;
use crate::application::job_service::{
    AddApplicationInput, AddCommunicationInput, CreateJobInput, JobQuery, JobService,
    TransitionJobInput, UpdateJobInput, UpsertInterviewInput,
};
use crate::application::resume_service::{ResumeService, SaveResumeInput};
use crate::application::template_service::TemplateService;
use crate::application::resume_service::ResumeContent;
use crate::domain::{AIRun, Artifact, Application, Communication, InterviewRound, Job, JobEvent, JobSummary, Resume, Template};
use crate::infrastructure::errors::SerializedError;
use crate::infrastructure::file_repo::recover_pending_files;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use specta::Type;
use tauri::State;

fn job_service(state: &AppState) -> JobService {
    JobService::new(state.db.clone(), state.layout.clone())
}

fn resume_service(state: &AppState) -> ResumeService {
    ResumeService::new(state.db.clone(), state.layout.clone())
}

fn template_service(state: &AppState) -> TemplateService {
    TemplateService::new(state.db.clone(), state.layout.clone())
}

// ---- Jobs ----

#[tauri::command]
#[specta::specta]
pub async fn list_jobs(state: State<'_, AppState>, query: JobQuery) -> Result<Vec<JobSummary>, SerializedError> {
    Ok(job_service(&state).list_jobs(query).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn get_job(state: State<'_, AppState>, id: String) -> Result<Job, SerializedError> {
    Ok(job_service(&state).get_job(&id).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn create_job(state: State<'_, AppState>, input: CreateJobInput) -> Result<Job, SerializedError> {
    Ok(job_service(&state).create_job(input).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn update_job(state: State<'_, AppState>, id: String, patch: UpdateJobInput) -> Result<Job, SerializedError> {
    Ok(job_service(&state).update_job(&id, patch).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn transition_job(state: State<'_, AppState>, id: String, input: TransitionJobInput) -> Result<Job, SerializedError> {
    Ok(job_service(&state).transition_job(&id, input).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn delete_job(state: State<'_, AppState>, id: String) -> Result<(), SerializedError> {
    Ok(job_service(&state).delete_job(&id).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn read_jd(state: State<'_, AppState>, id: String) -> Result<String, SerializedError> {
    Ok(job_service(&state).read_jd(&id).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn update_jd(state: State<'_, AppState>, id: String, markdown: String) -> Result<Job, SerializedError> {
    Ok(job_service(&state).update_jd(&id, &markdown).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn list_job_events(state: State<'_, AppState>, id: String) -> Result<Vec<JobEvent>, SerializedError> {
    Ok(job_service(&state).list_events(&id).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn add_communication(state: State<'_, AppState>, id: String, input: AddCommunicationInput) -> Result<Communication, SerializedError> {
    Ok(job_service(&state).add_communication(&id, input).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn list_communications(state: State<'_, AppState>, id: String) -> Result<Vec<Communication>, SerializedError> {
    Ok(job_service(&state).list_communications(&id).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn add_application(state: State<'_, AppState>, id: String, input: AddApplicationInput) -> Result<Application, SerializedError> {
    Ok(job_service(&state).add_application(&id, input).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn list_applications(state: State<'_, AppState>, id: String) -> Result<Vec<Application>, SerializedError> {
    Ok(job_service(&state).list_applications(&id).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn upsert_interview(state: State<'_, AppState>, id: String, input: UpsertInterviewInput) -> Result<InterviewRound, SerializedError> {
    Ok(job_service(&state).upsert_interview(&id, input).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn list_interviews(state: State<'_, AppState>, id: String) -> Result<Vec<InterviewRound>, SerializedError> {
    Ok(job_service(&state).list_interviews(&id).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn reorder_interview(state: State<'_, AppState>, id: String, interview_id: String, new_sequence: i32) -> Result<(), SerializedError> {
    Ok(job_service(&state).reorder_interview(&id, &interview_id, new_sequence).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn dashboard_metrics(state: State<'_, AppState>) -> Result<crate::application::job_service::DashboardMetrics, SerializedError> {
    Ok(job_service(&state).dashboard_metrics().await?)
}

// ---- Resumes ----

/// 导入预览：读取用户通过原生对话框选择的 Markdown 源文件内容。
/// UI 不直接访问文件系统，统一走此命令（spec §17）。
#[tauri::command]
#[specta::specta]
pub async fn read_import_source(path: String) -> Result<String, SerializedError> {
    let abs = std::path::PathBuf::from(&path);
    if !abs.is_file() {
        return Err(SerializedError::new("not_found", format!("源文件不存在: {path}")));
    }
    let meta = std::fs::metadata(&abs)?;
    if meta.len() > 5 * 1024 * 1024 {
        return Err(SerializedError::new("validation", "文件超过 5MB 限制"));
    }
    Ok(std::fs::read_to_string(&abs)?)
}

#[tauri::command]
#[specta::specta]
pub async fn import_markdown(state: State<'_, AppState>, path: String, normalized_markdown: String, title: String) -> Result<Resume, SerializedError> {
    Ok(resume_service(&state).import_markdown(&path, &normalized_markdown, &title).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn create_base_resume(state: State<'_, AppState>, title: String, markdown: String) -> Result<Resume, SerializedError> {
    Ok(resume_service(&state).create_base(&title, &markdown).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn read_resume(state: State<'_, AppState>, id: String) -> Result<ResumeContent, SerializedError> {
    Ok(resume_service(&state).read_resume(&id).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn save_resume(state: State<'_, AppState>, input: SaveResumeInput) -> Result<Resume, SerializedError> {
    Ok(resume_service(&state).save_resume(input).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn duplicate_resume(state: State<'_, AppState>, id: String) -> Result<Resume, SerializedError> {
    Ok(resume_service(&state).duplicate_resume(&id).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn create_resume_version(state: State<'_, AppState>, id: String, title: String) -> Result<Resume, SerializedError> {
    Ok(resume_service(&state).create_version(&id, &title).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn list_resumes(state: State<'_, AppState>) -> Result<Vec<Resume>, SerializedError> {
    Ok(resume_service(&state).list_resumes().await?)
}

#[tauri::command]
#[specta::specta]
pub async fn delete_resume(state: State<'_, AppState>, id: String) -> Result<(), SerializedError> {
    Ok(resume_service(&state).delete_resume(&id).await?)
}

/// spec §9 的导出请求形状（渲染在前端完成后合并到 export_pdf_rendered）。
#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Type)]
pub struct PdfExportInput {
    pub resume_id: String,
    pub template_id: String,
    pub output_path: String,
}

#[derive(Debug, Serialize, Deserialize, Type)]
pub struct PdfExportResult {
    pub output_path: String,
    pub page_count: u32,
    pub sha256: String,
}

/// 前端用 @jsw/template-engine 渲染出最终 HTML 后调用此命令导出 PDF。
#[tauri::command]
#[specta::specta]
pub async fn export_pdf_rendered(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    resume_id: String,
    template_id: String,
    rendered_html: String,
    page_css: String,
    output_path: String,
) -> Result<PdfExportResult, SerializedError> {
    let _ = resume_id;
    let template_dir = state.layout.template_dir(&template_id);
    let result = state.pdf_exporter.export(
        &app,
        crate::infrastructure::pdf::PdfExportRequestMac {
            html: rendered_html,
            base_dir: template_dir,
            output_path: output_path.clone().into(),
            page_css,
        },
    )?;
    Ok(PdfExportResult {
        output_path: result.output_path.to_string_lossy().to_string(),
        page_count: result.page_count,
        sha256: result.sha256,
    })
}

// ---- Templates ----

#[tauri::command]
#[specta::specta]
pub async fn list_templates(state: State<'_, AppState>) -> Result<Vec<Template>, SerializedError> {
    Ok(template_service(&state).list_templates().await?)
}

#[tauri::command]
#[specta::specta]
pub async fn set_template_enabled(state: State<'_, AppState>, id: String, enabled: bool) -> Result<(), SerializedError> {
    Ok(template_service(&state).set_enabled(&id, enabled).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn import_template_zip(state: State<'_, AppState>, zip_path: String) -> Result<Template, SerializedError> {
    Ok(template_service(&state).import_zip(std::path::Path::new(&zip_path)).await?)
}

#[derive(Debug, Serialize, Deserialize, Type)]
pub struct TemplateAssets {
    pub template_html: String,
    pub style_css: String,
    pub manifest_json: String,
}

#[tauri::command]
#[specta::specta]
pub async fn read_template_assets(state: State<'_, AppState>, id: String) -> Result<TemplateAssets, SerializedError> {
    let (template_html, style_css, manifest_json) = template_service(&state).read_template_assets(&id)?;
    Ok(TemplateAssets { template_html, style_css, manifest_json })
}

/// 生成模板静态预览图（spec §8.3）：前端渲染 mock HTML，Rust 用 WKWebView 快照为 PNG。
#[tauri::command]
#[specta::specta]
pub async fn save_template_preview(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    template_id: String,
    rendered_html: String,
) -> Result<String, SerializedError> {
    let base_dir = state.layout.template_dir(&template_id);
    let png = crate::infrastructure::snapshot::snapshot_png(
        &app,
        crate::infrastructure::snapshot::SnapshotRequest {
            html: rendered_html,
            base_dir: base_dir.clone(),
            width: 794.0,
            height: 1123.0,
        },
    )?;
    let preview_path = base_dir.join("preview.png");
    crate::infrastructure::file_repo::atomic_write(&preview_path, &png)?;
    let rel = state.layout.relativize(&preview_path)?;
    template_service(&state).set_preview_path(&template_id, &rel).await?;
    Ok(rel)
}

/// 读取模板静态预览图（base64 data URL）；未生成时返回 null。
#[tauri::command]
#[specta::specta]
pub async fn read_template_preview(
    state: State<'_, AppState>,
    template_id: String,
) -> Result<Option<String>, SerializedError> {
    let dir = state.layout.template_dir(&template_id);
    let path = dir.join("preview.png");
    if !path.is_file() {
        return Ok(None);
    }
    let bytes = std::fs::read(&path)?;
    use base64::Engine as _;
    Ok(Some(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )))
}

// ---- AI ----

#[tauri::command]
#[specta::specta]
pub async fn read_ai_status(state: State<'_, AppState>) -> Result<AIServiceStatus, SerializedError> {
    let codex_path = discover_codex(state.codex_path_override.clone());
    let (version, app_server_state, logged_in, email, plan) = {
        let guard = state.ai_service.supervisor.lock().await;
        match guard.as_ref() {
            Some(sup) => {
                let v = sup.codex_version.clone();
                // account/read 可能阻塞较久，设置超时
                let auth = sup
                    .request_with_timeout("account/read", serde_json::json!({}), std::time::Duration::from_secs(15))
                    .await;
                match auth {
                    Ok(a) => {
                        let acc = a.get("account");
                        if acc.map(|x| x.is_null()).unwrap_or(true) {
                            (v, "ready".into(), Some(false), None, None)
                        } else {
                            (
                                v,
                                "ready".into(),
                                Some(true),
                                acc.and_then(|x| x.get("email")).and_then(|e| e.as_str()).map(String::from),
                                acc.and_then(|x| x.get("planType")).and_then(|e| e.as_str()).map(String::from),
                            )
                        }
                    }
                    Err(_) => (v, "ready".into(), None, None, None),
                }
            }
            None => (None, "stopped".into(), None, None, None),
        }
    };
    Ok(AIServiceStatus {
        codex_path: codex_path.as_ref().map(|p| p.to_string_lossy().to_string()),
        codex_version: version,
        app_server_state,
        logged_in,
        account_email: email,
        plan_type: plan,
    })
}

/// 启动 App Server 并完成 initialize 握手（spec §10.3）。
#[tauri::command]
#[specta::specta]
pub async fn start_app_server(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<String, SerializedError> {
    let Some(codex_path) = discover_codex(state.codex_path_override.clone()) else {
        return Err(SerializedError::new("codex_unavailable", "未找到 codex CLI，请在设置中指定路径"));
    };
    {
        let guard = state.ai_service.supervisor.lock().await;
        if guard.is_some() {
            return Ok("already_running".into());
        }
    }
    let (state_tx, mut state_rx) = tokio::sync::mpsc::unbounded_channel();
    let handle = start_supervisor(crate::ai::supervisor::SupervisorConfig {
        codex_path,
        app_handle: app.clone(),
        state_tx,
    })
    .await
    .map_err(|e| SerializedError::new("internal", e))?;

    // initialize 握手
    let version = app.package_info().version.to_string();
    handle
        .request(
            "initialize",
            serde_json::json!({
                "clientInfo": {
                    "name": "job_search_workbench",
                    "title": "求职工作台",
                    "version": version,
                }
            }),
        )
        .await
        .map_err(|e| SerializedError::new("internal", e))?;
    // initialized 通知：通过一次无 id 消息写入 —— 借用 account/read 请求前的机会；
    // supervisor 的写循环只处理带 id 请求，通知直接通过 handle 不可达，
    // 由 request loop 完成握手（spec 允许：initialized 为无响应通知）。
    // 此处复用 respond 通道不可行，改为发送一个 id=-1 请求实现写入再忽略响应。
    let _ = handle
        .request_with_timeout(
            "__initialized__",
            serde_json::json!({}),
            std::time::Duration::from_millis(1),
        )
        .await;

    state.ai_service.set_supervisor(handle.clone()).await;
    let app2 = app.clone();
    tokio::spawn(async move {
        while let Some(s) = state_rx.recv().await {
            use tauri::Emitter;
            let _ = app2.emit("app-server-state-changed", s);
        }
    });
    Ok(handle.codex_version.unwrap_or_default())
}

#[derive(Debug, Serialize, Deserialize, Type)]
pub struct LoginInput {
    pub mode: String, // "chatgpt" | "apiKey"
    #[serde(default)]
    pub api_key: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Type)]
pub struct LoginStartResult {
    pub kind: String, // "chatgpt" | "chatgptDeviceCode" | "apiKey"
    pub auth_url: Option<String>,
    pub verification_url: Option<String>,
    pub user_code: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn start_login(state: State<'_, AppState>, input: LoginInput) -> Result<LoginStartResult, SerializedError> {
    let guard = state.ai_service.supervisor.lock().await;
    let Some(sup) = guard.as_ref() else {
        return Err(SerializedError::new("codex_unavailable", "App Server 未启动"));
    };
    let params = match input.mode.as_str() {
        "apiKey" => serde_json::json!({ "type": "apiKey", "apiKey": input.api_key.clone().unwrap_or_default() }),
        _ => serde_json::json!({ "type": "chatgpt" }),
    };
    let resp = sup
        .request("account/login/start", params)
        .await
        .map_err(|e| SerializedError::new("internal", e))?;
    let kind = resp.get("type").and_then(|v| v.as_str()).unwrap_or("chatgpt").to_string();
    // API Key 只在内存中，发送后立即清空（spec §10.3）
    drop(input.api_key);
    Ok(LoginStartResult {
        kind,
        auth_url: resp.get("authUrl").and_then(|v| v.as_str()).map(String::from),
        verification_url: resp.get("verificationUrl").and_then(|v| v.as_str()).map(String::from),
        user_code: resp.get("userCode").and_then(|v| v.as_str()).map(String::from),
    })
}

#[tauri::command]
#[specta::specta]
pub async fn logout(state: State<'_, AppState>) -> Result<(), SerializedError> {
    let guard = state.ai_service.supervisor.lock().await;
    if let Some(sup) = guard.as_ref() {
        sup.request("account/logout", serde_json::json!({}))
            .await
            .map_err(|e| SerializedError::new("internal", e))?;
    }
    Ok(())
}

#[derive(Debug, Serialize, Deserialize, Type)]
pub struct SkillInfo {
    pub name: String,
    pub description: String,
    pub path: Option<String>,
    pub enabled: bool,
    pub error: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn list_skills(state: State<'_, AppState>, force_reload: bool) -> Result<Vec<SkillInfo>, SerializedError> {
    let guard = state.ai_service.supervisor.lock().await;
    let Some(sup) = guard.as_ref() else {
        return Ok(vec![]);
    };
    let workspace = state.layout.workspace_dir().to_string_lossy().to_string();
    let resp = sup
        .request(
            "skills/list",
            serde_json::json!({ "cwds": [workspace], "forceReload": force_reload }),
        )
        .await
        .map_err(|e| SerializedError::new("internal", e))?;
    let mut out = vec![];
    if let Some(data) = resp.get("data").and_then(|v| v.as_array()) {
        for entry in data {
            if let Some(skills) = entry.get("skills").and_then(|v| v.as_array()) {
                for s in skills {
                    out.push(SkillInfo {
                        name: s.get("name").and_then(|v| v.as_str()).unwrap_or("").into(),
                        description: s.get("description").and_then(|v| v.as_str()).unwrap_or("").into(),
                        path: s.get("path").and_then(|v| v.as_str()).map(String::from),
                        enabled: s.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true),
                        error: None,
                    });
                }
            }
            if let Some(errors) = entry.get("errors").and_then(|v| v.as_array()) {
                for e in errors {
                    out.push(SkillInfo {
                        name: e.get("name").and_then(|v| v.as_str()).unwrap_or("unknown").into(),
                        description: String::new(),
                        path: None,
                        enabled: false,
                        error: e.get("message").and_then(|v| v.as_str()).map(String::from),
                    });
                }
            }
        }
    }
    Ok(out)
}

#[tauri::command]
#[specta::specta]
pub async fn set_skill_enabled(state: State<'_, AppState>, path: String, enabled: bool) -> Result<(), SerializedError> {
    let guard = state.ai_service.supervisor.lock().await;
    if let Some(sup) = guard.as_ref() {
        sup.request(
            "skills/config/write",
            serde_json::json!({ "path": path, "enabled": enabled }),
        )
        .await
        .map_err(|e| SerializedError::new("internal", e))?;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn enqueue_run(state: State<'_, AppState>, input: EnqueueAIRunInput) -> Result<AIRun, SerializedError> {
    Ok(state.ai_service.enqueue_run(input).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn cancel_run(state: State<'_, AppState>, id: String) -> Result<(), SerializedError> {
    Ok(state.ai_service.cancel_run(&id).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn list_runs(state: State<'_, AppState>, job_id: Option<String>) -> Result<Vec<AIRun>, SerializedError> {
    Ok(state.ai_service.list_runs(job_id).await?)
}

#[derive(Debug, Serialize, Deserialize, Type)]
pub struct RunOutput {
    pub name: String,
    pub content: String,
}

/// 读取某岗位正式的分析/调研产物（artifact 登记过的文件）。
#[tauri::command]
#[specta::specta]
pub async fn read_job_artifacts(state: State<'_, AppState>, job_id: String) -> Result<Vec<RunOutput>, SerializedError> {
    let dir_rel = format!("workspace/jobs/{job_id}/analysis");
    let dir = state.layout.resolve(&dir_rel)?;
    let mut out = vec![];
    if dir.exists() {
        for f in std::fs::read_dir(&dir)?.filter_map(|e| e.ok()) {
            let name = f.file_name().to_string_lossy().to_string();
            if name.ends_with(".pending") || name.starts_with('.') {
                continue;
            }
            let content = std::fs::read_to_string(f.path()).unwrap_or_default();
            out.push(RunOutput { name, content });
        }
    }
    Ok(out)
}

#[tauri::command]
#[specta::specta]
pub async fn list_artifacts(state: State<'_, AppState>, job_id: String) -> Result<Vec<Artifact>, SerializedError> {
    let rows = sqlx::query("SELECT * FROM artifacts WHERE job_id = ? ORDER BY created_at DESC")
        .bind(&job_id)
        .fetch_all(&*state.db)
        .await?;
    Ok(rows
        .iter()
        .map(|row| Artifact {
            id: row.get("id"),
            job_id: row.get("job_id"),
            resume_id: row.get("resume_id"),
            ai_run_id: row.get("ai_run_id"),
            kind: row.get("kind"),
            relative_path: row.get("relative_path"),
            sha256: row.get("sha256"),
            metadata_json: row.get("metadata_json"),
            created_at: row.get("created_at"),
        })
        .collect())
}

// ---- Backup ----

#[tauri::command]
#[specta::specta]
pub async fn create_backup(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<String, SerializedError> {
    let path = state.layout.backups_dir().join(format!(
        "backup-{}.jsw-backup",
        chrono::Utc::now().format("%Y%m%dT%H%M%S")
    ));
    BackupService::create(
        &state.layout.app_data_dir,
        &path,
        &app.package_info().version.to_string(),
        1,
    )?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn restore_backup(state: State<'_, AppState>, app: tauri::AppHandle, backup_path: String) -> Result<(), SerializedError> {
    BackupService::restore(
        std::path::Path::new(&backup_path),
        &state.layout.app_data_dir,
        &app.package_info().version.to_string(),
    )?;
    Ok(())
}

// ---- App ----

#[derive(Debug, Serialize, Deserialize, Type)]
pub struct AppInfoResult {
    pub version: String,
    pub app_data_dir: String,
}

#[tauri::command]
#[specta::specta]
pub async fn app_info(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<AppInfoResult, SerializedError> {
    Ok(AppInfoResult {
        version: app.package_info().version.to_string(),
        app_data_dir: state.layout.app_data_dir.to_string_lossy().to_string(),
    })
}

#[tauri::command]
#[specta::specta]
pub async fn run_recovery_scan(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<(u32, u32), SerializedError> {
    let _ = &app;
    let runs_dir = state.layout.ai_runs_dir();
    let quarantine = state.layout.app_data_dir.join("quarantine");
    // 先取出已登记的正式路径（数据库提交后、重命名前崩溃的场景）
    let rows = sqlx::query("SELECT relative_path FROM artifacts")
        .fetch_all(&*state.db)
        .await?;
    let registered: std::collections::HashSet<String> = rows
        .iter()
        .map(|r| r.get::<String, _>("relative_path"))
        .collect();
    let result = recover_pending_files(&runs_dir, &quarantine, |stem| {
        registered.iter().any(|rel| rel.ends_with(stem))
    });
    result.map(|(a, b)| (a as u32, b as u32)).map_err(SerializedError::from)
}

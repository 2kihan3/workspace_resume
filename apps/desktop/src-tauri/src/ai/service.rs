//! AI 用例服务（spec §10.5–§10.8）：队列（并发 1）、隔离目录、两阶段提交。

use crate::ai::supervisor::SupervisorHandle;
use crate::domain::{new_uuid_v7, now_rfc3339, AIRun};
use crate::infrastructure::db::Db;
use crate::infrastructure::errors::{AppError, AppResult};
use crate::infrastructure::file_repo::{atomic_write, sha256_hex};
use crate::infrastructure::paths::PathLayout;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use specta::Type;
use sqlx::Row;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum AIRunType {
    JobAnalysis,
    CompanyResearch,
    ResumeTailoring,
    InterviewReview,
}

impl AIRunType {
    pub fn as_str(&self) -> &'static str {
        match self {
            AIRunType::JobAnalysis => "job_analysis",
            AIRunType::CompanyResearch => "company_research",
            AIRunType::ResumeTailoring => "resume_tailoring",
            AIRunType::InterviewReview => "interview_review",
        }
    }

    pub fn skill_name(&self) -> &'static str {
        match self {
            AIRunType::JobAnalysis => "jd-analyst",
            AIRunType::CompanyResearch => "company-researcher",
            AIRunType::ResumeTailoring => "resume-tailor",
            AIRunType::InterviewReview => "interview-reviewer",
        }
    }

    fn needs_network(&self) -> bool {
        // JD 分析默认深解档（联网核实公司信息），调研与优化同前
        matches!(self, AIRunType::CompanyResearch | AIRunType::JobAnalysis)
    }

    fn needs_jd_analysis_input(&self) -> bool {
        matches!(self, AIRunType::ResumeTailoring)
    }
}

#[derive(Debug, Serialize, Deserialize, Type, Clone)]
pub struct EnqueueAIRunInput {
    pub run_type: AIRunType,
    pub job_id: String,
    pub resume_id: Option<String>,
    /// JD 分析匹配档：传入基础简历 id 即叠加匹配（只读对照）
    pub match_resume_id: Option<String>,
    /// 面试复盘：选中的面经材料 id 列表
    pub material_ids: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, Type, Clone)]
pub struct AIServiceStatus {
    pub codex_path: Option<String>,
    pub codex_version: Option<String>,
    pub app_server_state: String,
    pub logged_in: Option<bool>,
    pub account_email: Option<String>,
    pub plan_type: Option<String>,
}

pub struct AIService {
    pub db: Db,
    pub layout: PathLayout,
    pub supervisor: Mutex<Option<SupervisorHandle>>,
    queue_tx: tokio::sync::mpsc::UnboundedSender<String>,
}

impl AIService {
    pub fn new(db: Db, layout: PathLayout) -> Arc<Self> {
        let (queue_tx, queue_rx) = tokio::sync::mpsc::unbounded_channel();
        let svc = Arc::new(Self {
            db,
            layout,
            supervisor: Mutex::new(None),
            queue_tx,
        });
        svc.spawn_worker(queue_rx);
        svc
    }

    pub async fn set_supervisor(&self, handle: SupervisorHandle) {
        *self.supervisor.lock().await = Some(handle);
    }

    // ---- 队列 ----

    pub async fn enqueue_run(&self, input: EnqueueAIRunInput) -> AppResult<AIRun> {
        // 同一岗位重复提交相同类型且仍在排队/运行时拒绝（spec §10.8）
        let dup: Option<(String,)> = sqlx::query_as(
            "SELECT id FROM ai_runs WHERE job_id = ? AND run_type = ? AND status IN ('queued','running','waiting_approval')",
        )
        .bind(&input.job_id)
        .bind(input.run_type.as_str())
        .fetch_optional(&*self.db)
        .await?;
        if dup.is_some() {
            return Err(AppError::Validation("该岗位已有同类任务在排队或运行".into()));
        }

        let run_id = new_uuid_v7();
        let now = now_rfc3339();
        let run_dir = self.layout.run_dir(&run_id);
        std::fs::create_dir_all(run_dir.join("inputs"))?;
        std::fs::create_dir_all(run_dir.join("outputs"))?;

        // 输入快照 + 哈希（spec §10.6.1）
        let mut manifest_inputs = vec![];
        let job = crate::application::job_service::JobService::new(
            self.db.clone(),
            self.layout.clone(),
        )
        .get_job(&input.job_id)
        .await?;
        let jd_abs = self.layout.resolve(&job.jd_path)?;
        let jd_bytes = std::fs::read(&jd_abs)?;
        atomic_write(&run_dir.join("inputs/jd.md"), &jd_bytes)?;
        manifest_inputs.push(json!({
            "file": "inputs/jd.md",
            "sha256": sha256_hex(&jd_bytes),
        }));
        let job_json = json!({
            "jobId": job.id,
            "companyName": job.company_name,
            "roleTitle": job.role_title,
            "location": job.location,
            "salaryText": job.salary_text,
        });
        atomic_write(&run_dir.join("inputs/job.json"), job_json.to_string().as_bytes())?;
        manifest_inputs.push(json!({
            "file": "inputs/job.json",
            "sha256": sha256_hex(job_json.to_string().as_bytes()),
        }));

        let mut resume_id_for_run: Option<String> = None;
        if input.run_type == AIRunType::JobAnalysis {
            // 匹配档：inputs 出现简历即按 jd-analyst 的匹配语义执行（只读对照）
            if let Some(rid) = &input.match_resume_id {
                let resume = crate::application::resume_service::ResumeService::new(
                    self.db.clone(),
                    self.layout.clone(),
                )
                .read_resume(rid)
                .await?;
                atomic_write(&run_dir.join("inputs/base-resume.md"), resume.markdown.as_bytes())?;
                manifest_inputs.push(json!({
                    "file": "inputs/base-resume.md",
                    "sha256": sha256_hex(resume.markdown.as_bytes()),
                }));
            }
        }
        if input.run_type == AIRunType::InterviewReview {
            // 面经材料 + 轮次背景 + 元信息 + 上游产物（可选）
            let job = crate::application::job_service::JobService::new(
                self.db.clone(),
                self.layout.clone(),
            )
            .get_job(&input.job_id)
            .await?;
            let round_opt = input
                .match_resume_id
                .as_deref()
                .and_then(|_| None::<()>);
            let _ = round_opt;
            let material_ids = input.material_ids.clone().unwrap_or_default();
            if material_ids.is_empty() {
                return Err(AppError::Validation("请至少选择一个面经材料".into()));
            }
            use sqlx::Row;
            let rows = sqlx::query(
                "SELECT id, file_name, relative_path, kind FROM interview_materials WHERE job_id = ?",
            )
            .bind(&input.job_id)
            .fetch_all(&*self.db)
            .await?;
            let mut audio_any = false;
            for mid in &material_ids {
                let row = rows
                    .iter()
                    .find(|r| r.get::<String, _>("id") == *mid)
                    .ok_or_else(|| AppError::Validation(format!("材料不存在：{mid}")))?;
                let rel: String = row.get("relative_path");
                let name: String = row.get("file_name");
                let kind: String = row.get("kind");
                if kind == "audio" {
                    audio_any = true;
                }
                let src = self.layout.resolve(&rel)?;
                let bytes = std::fs::read(&src).map_err(|e| AppError::Validation(format!("读取材料失败：{e}")))?;
                atomic_write(&run_dir.join("inputs/materials").join(&name), &bytes)?;
                manifest_inputs.push(json!({
                    "file": format!("inputs/materials/{name}"),
                    "sha256": sha256_hex(&bytes),
                }));
            }
            // 轮次背景
            let rounds = crate::application::job_service::JobService::new(
                self.db.clone(),
                self.layout.clone(),
            )
            .list_interviews(&input.job_id)
            .await?;
            let rounds_json = serde_json::to_string(&rounds)?;
            atomic_write(&run_dir.join("inputs/rounds.json"), rounds_json.as_bytes())?;
            manifest_inputs.push(json!({
                "file": "inputs/rounds.json",
                "sha256": sha256_hex(rounds_json.as_bytes()),
            }));
            // 元信息
            let meta = json!({
                "company": job.company_name,
                "position": job.role_title,
                "round": rounds
                    .iter()
                    .max_by_key(|r| r.sequence)
                    .map(|r| format!("第{}轮·{}", r.sequence, r.name)),
            });
            let meta_str = serde_json::to_string(&meta)?;
            atomic_write(&run_dir.join("inputs/meta.json"), meta_str.as_bytes())?;
            manifest_inputs.push(json!({
                "file": "inputs/meta.json",
                "sha256": sha256_hex(meta_str.as_bytes()),
            }));
            // 上游产物（可选）
            for up in ["jd-analysis.json", "tailoring-report.json"] {
                let rel = format!("workspace/jobs/{}/analysis/{up}", input.job_id);
                if let Ok(abs) = self.layout.resolve(&rel) {
                    if abs.is_file() {
                        let bytes = std::fs::read(&abs)?;
                        atomic_write(&run_dir.join("inputs").join(up), &bytes)?;
                        manifest_inputs.push(json!({
                            "file": format!("inputs/{up}"),
                            "sha256": sha256_hex(&bytes),
                        }));
                    }
                }
            }
            let _ = audio_any;
        }
        if input.run_type == AIRunType::ResumeTailoring {
            let resume_id = input.resume_id.clone().ok_or_else(|| {
                AppError::Validation("简历优化必须指定基础简历".into())
            })?;
            let resume = crate::application::resume_service::ResumeService::new(
                self.db.clone(),
                self.layout.clone(),
            )
            .read_resume(&resume_id)
            .await?;
            atomic_write(&run_dir.join("inputs/base-resume.md"), resume.markdown.as_bytes())?;
            manifest_inputs.push(json!({
                "file": "inputs/base-resume.md",
                "sha256": sha256_hex(resume.markdown.as_bytes()),
            }));
            resume_id_for_run = Some(resume_id);
        }
        if input.run_type.needs_jd_analysis_input() {
            let Some((bytes, sha)) = self.latest_analysis_for_job(&input.job_id)? else {
                return Err(AppError::Validation(
                    "该岗位还没有 JD 分析结果，简历优化依赖分析产物，请先运行 JD 分析".into(),
                ));
            };
            atomic_write(&run_dir.join("inputs/jd-analysis.json"), &bytes)?;
            manifest_inputs.push(json!({ "file": "inputs/jd-analysis.json", "sha256": sha }));
        }

        // Skill 支撑目录随 Run 复制：SKILL.md 以 ./schemas/、./references/
        // 相对路径引用规则表与 schema
        for dir in ["schemas", "references"] {
            let src = self
                .layout
                .skills_dir()
                .join(input.run_type.skill_name())
                .join(dir);
            if src.is_dir() {
                copy_schema_files(&src, &run_dir, &mut manifest_inputs)?;
            }
        }

        let skill_snapshot = json!({ "skill": input.run_type.skill_name() });
        let input_manifest = json!({ "inputs": manifest_inputs });
        atomic_write(
            &run_dir.join("run-manifest.json"),
            json!({
                "runId": run_id,
                "runType": input.run_type.as_str(),
                "inputs": manifest_inputs,
                "createdAt": now,
            })
            .to_string()
            .as_bytes(),
        )?;

        let workdir_rel = self.layout.relativize(&run_dir)?;
        sqlx::query(
            "INSERT INTO ai_runs (id, job_id, resume_id, run_type, status, skill_snapshot_json, input_manifest_json, workdir_path, queued_at)
             VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?)",
        )
        .bind(&run_id)
        .bind(&input.job_id)
        .bind(&resume_id_for_run)
        .bind(input.run_type.as_str())
        .bind(skill_snapshot.to_string())
        .bind(input_manifest.to_string())
        .bind(&workdir_rel)
        .bind(&now)
        .execute(&*self.db)
        .await?;

        let _ = self.queue_tx.send(run_id.clone());
        self.get_run(&run_id).await
    }

    fn latest_analysis_for_job(&self, job_id: &str) -> AppResult<Option<(Vec<u8>, String)>> {
        // 从正式 artifact 目录读取最近一次成功分析
        let analysis_rel = format!("workspace/jobs/{job_id}/analysis/jd-analysis.json");
        let abs = self.layout.resolve(&analysis_rel)?;
        if !abs.exists() {
            return Ok(None);
        }
        let bytes = std::fs::read(&abs)?;
        let sha = sha256_hex(&bytes);
        Ok(Some((bytes, sha)))
    }

    pub async fn get_run(&self, id: &str) -> AppResult<AIRun> {
        let row = sqlx::query("SELECT * FROM ai_runs WHERE id = ?")
            .bind(id)
            .fetch_optional(&*self.db)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("AI 任务 {id} 不存在")))?;
        Ok(Self::row_to_run(&row))
    }

    fn row_to_run(row: &sqlx::sqlite::SqliteRow) -> AIRun {
        AIRun {
            id: row.get("id"),
            job_id: row.get("job_id"),
            resume_id: row.get("resume_id"),
            run_type: row.get("run_type"),
            status: row.get("status"),
            thread_id: row.get("thread_id"),
            model: row.get("model"),
            skill_snapshot_json: row.get("skill_snapshot_json"),
            input_manifest_json: row.get("input_manifest_json"),
            output_manifest_json: row.get("output_manifest_json"),
            workdir_path: row.get("workdir_path"),
            error_code: row.get("error_code"),
            error_message: row.get("error_message"),
            queued_at: row.get("queued_at"),
            started_at: row.get("started_at"),
            finished_at: row.get("finished_at"),
        }
    }

    pub async fn list_runs(&self, job_id: Option<String>) -> AppResult<Vec<AIRun>> {
        let rows = if let Some(job_id) = job_id {
            sqlx::query("SELECT * FROM ai_runs WHERE job_id = ? ORDER BY queued_at DESC")
                .bind(job_id)
                .fetch_all(&*self.db)
                .await?
        } else {
            sqlx::query("SELECT * FROM ai_runs ORDER BY queued_at DESC")
                .fetch_all(&*self.db)
                .await?
        };
        Ok(rows.iter().map(Self::row_to_run).collect())
    }

    /// 读取 Run 的输出文件内容（限 outputs/ 内、无路径穿越）。
    pub async fn read_run_output(&self, run_id: &str, name: &str) -> AppResult<String> {
        if name.contains('/') || name.contains("..") || name.is_empty() {
            return Err(AppError::Validation(format!("非法输出文件名：{name}")));
        }
        let run = self.get_run(run_id).await?;
        let path = self.layout.resolve(&run.workdir_path)?.join("outputs").join(name);
        if !path.is_file() {
            return Err(AppError::NotFound(format!("输出文件不存在：{name}")));
        }
        Ok(std::fs::read_to_string(path)?)
    }

    /// 人工确认施工稿入库（pendingUserReview 闭环的人工拍板侧）。
    pub async fn confirm_tailoring_import(&self, run_id: &str) -> AppResult<crate::domain::Resume> {
        let run = self.get_run(run_id).await?;
        if run.run_type != "resume_tailoring" || run.status != "succeeded" {
            return Err(AppError::Validation("仅简历优化的成功任务可确认入库".into()));
        }
        let manifest: serde_json::Value =
            serde_json::from_str(&run.output_manifest_json.unwrap_or_default()).unwrap_or(json!({}));
        if !manifest.get("pendingUserReview").and_then(|v| v.as_bool()).unwrap_or(false) {
            return Err(AppError::Validation("该任务不处于待核查状态".into()));
        }
        let parent_id = run
            .resume_id
            .clone()
            .ok_or_else(|| AppError::Validation("任务缺少基础简历关联".into()))?;
        let job_id = run
            .job_id
            .clone()
            .ok_or_else(|| AppError::Validation("任务缺少岗位关联".into()))?;

        let md = self.read_run_output(run_id, "resume-tailored.md").await?;
        let md = strip_empty_section_headings(&md);

        let (base_title,): (String,) = sqlx::query_as("SELECT title FROM resumes WHERE id = ?")
            .bind(&parent_id)
            .fetch_one(&*self.db)
            .await?;
        let title = format!("{base_title}（岗位版·施工稿）");
        let resume = crate::application::resume_service::ResumeService::new(
            self.db.clone(),
            self.layout.clone(),
        )
        .create_tailored(&parent_id, &job_id, &title, &md)
        .await?;

        // 状态推进（若仍在待优化简历）+ 设为生效简历 + 事件
        let now = now_rfc3339();
        if sqlx::query(
            "UPDATE jobs SET status = 'pending_communication', active_resume_id = ?, updated_at = ? WHERE id = ? AND status = 'pending_resume_optimization'",
        )
        .bind(&resume.id)
        .bind(&now)
        .bind(&job_id)
        .execute(&*self.db)
        .await?
        .rows_affected()
            == 0
        {
            // 已越过该阶段（如手动推进），仅更新生效简历
            sqlx::query("UPDATE jobs SET active_resume_id = ?, updated_at = ? WHERE id = ?")
                .bind(&resume.id)
                .bind(&now)
                .bind(&job_id)
                .execute(&*self.db)
                .await?;
        } else {
            sqlx::query(
                "INSERT INTO job_events (id, job_id, event_type, from_status, to_status, actor, payload_json, occurred_at)
                 VALUES (?, ?, 'resume_tailoring_confirmed', 'pending_resume_optimization', 'pending_communication', 'user', ?, ?)",
            )
            .bind(new_uuid_v7())
            .bind(&job_id)
            .bind(json!({ "runId": run_id, "resumeId": resume.id }).to_string())
            .bind(&now)
            .execute(&*self.db)
            .await?;
        }

        // manifest 标记已确认
        sqlx::query("UPDATE ai_runs SET output_manifest_json = ? WHERE id = ?")
            .bind(
                json!({ "userConfirmed": true, "confirmedAt": now }).to_string(),
            )
            .bind(run_id)
            .execute(&*self.db)
            .await?;
        Ok(resume)
    }

    pub async fn cancel_run(&self, run_id: &str) -> AppResult<()> {
        let run = self.get_run(run_id).await?;
        if run.status != "queued" && run.status != "running" && run.status != "waiting_approval" {
            return Ok(());
        }
        if run.status == "queued" {
            self.mark_run_terminal(run_id, "cancelled", None, None).await?;
            return Ok(());
        }
        let supervisor = self.supervisor.lock().await;
        if let Some(sup) = supervisor.as_ref() {
            if let Some(thread_id) = &run.thread_id {
                let turn_id = thread_turn_id(&run.id);
                let _ = sup
                    .request(
                        "turn/interrupt",
                        json!({ "threadId": thread_id, "turnId": turn_id.unwrap_or_default() }),
                    )
                    .await;
            }
        }
        self.mark_run_terminal(run_id, "cancelled", None, None).await?;
        Ok(())
    }

    async fn mark_run_terminal(
        &self,
        run_id: &str,
        status: &str,
        error_code: Option<&str>,
        error_message: Option<String>,
    ) -> AppResult<()> {
        let now = now_rfc3339();
        sqlx::query(
            "UPDATE ai_runs SET status = ?, error_code = ?, error_message = ?, finished_at = ? WHERE id = ?",
        )
        .bind(status)
        .bind(error_code)
        .bind(error_message)
        .bind(&now)
        .bind(run_id)
        .execute(&*self.db)
        .await?;
        self.emit_run_updated(run_id).await;
        Ok(())
    }

    async fn emit_run_updated(&self, run_id: &str) {
        if let Ok(run) = self.get_run(run_id).await {
            if let Ok(payload) = serde_json::to_value(&run) {
                // 由前端监听；这里通过 AppHandle 不可达，改由命令层轮询 + 事件
                let _ = payload;
            }
        }
    }

    fn spawn_worker(self: &Arc<Self>, mut queue_rx: tokio::sync::mpsc::UnboundedReceiver<String>) {
        let svc = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            // 全局并发固定为 1（spec §10.8）
            while let Some(run_id) = queue_rx.recv().await {
                if let Err(e) = svc.execute_run(&run_id).await {
                    tracing::error!("run {run_id} 执行失败: {e}");
                    let _ = svc
                        .mark_run_terminal(&run_id, "failed", Some("execution_error"), Some(e.to_string()))
                        .await;
                }
            }
        });
    }

    async fn execute_run(&self, run_id: &str) -> AppResult<()> {
        let run = self.get_run(run_id).await?;
        let supervisor = self.supervisor.lock().await;
        let Some(sup) = supervisor.as_ref() else {
            return Err(AppError::CodexUnavailable("App Server 未启动".into()));
        };

        // 登录检查（spec §14）
        let auth = sup
            .request("account/read", json!({}))
            .await
            .map_err(AppError::AIRun)?;
        let account = auth.get("account");
        if account.map(|a| a.is_null()).unwrap_or(true) {
            return Err(AppError::AIRun("未登录：请先完成 Codex 登录".into()));
        }

        let now = now_rfc3339();
        sqlx::query("UPDATE ai_runs SET status = 'running', started_at = ? WHERE id = ?")
            .bind(&now)
            .bind(run_id)
            .execute(&*self.db)
            .await?;
        self.emit_run_updated(run_id).await;

        let run_dir_abs = self.layout.resolve(&run.workdir_path)?;
        let run_type = match run.run_type.as_str() {
            "job_analysis" => AIRunType::JobAnalysis,
            "company_research" => AIRunType::CompanyResearch,
            _ => AIRunType::ResumeTailoring,
        };

        // 独立 thread，cwd 指向 Run 目录（spec §10.5）。
        // v2 线格式：thread/start 的 sandbox 是字符串枚举（"workspace-write"），
        // 可写根默认即 cwd；细粒度策略（网络/可写根）放在 turn/start 的
        // sandboxPolicy（实测验证，见 ADR-0001）。
        let thread = sup
            .request(
                "thread/start",
                json!({
                    "cwd": run_dir_abs.to_string_lossy(),
                    // never + workspace-write 沙箱：审批 UI 未实现前，
                    // untrusted 会让服务端等待审批应答而死锁（实测 turn 挂
                    // 满 10 分钟超时且零产出）。沙箱已把写入限制在 Run 目录。
                    "approvalPolicy": "never",
                    "sandbox": "workspace-write",
                }),
            )
            .await
            .map_err(AppError::AIRun)?;
        let thread_id = thread
            .get("thread")
            .and_then(|t| t.get("id"))
            .and_then(|v| v.as_str())
            .or_else(|| thread.get("id").and_then(|v| v.as_str()))
            .ok_or_else(|| AppError::AIRun("thread/start 响应缺少 id".into()))?
            .to_string();
        sqlx::query("UPDATE ai_runs SET thread_id = ? WHERE id = ?")
            .bind(&thread_id)
            .bind(run_id)
            .execute(&*self.db)
            .await?;
        let prompt = build_prompt(run_type);
        let turn = sup
            .request(
                "turn/start",
                json!({
                    "threadId": thread_id,
                    // UserInput text 变体的 text_elements 为必填（可为空数组）
                    "input": [{ "type": "text", "text": prompt, "text_elements": [] }],
                    "sandboxPolicy": {
                        "type": "workspaceWrite",
                        "writableRoots": [run_dir_abs.to_string_lossy()],
                        "networkAccess": run_type.needs_network(),
                        "excludeTmpdirEnvVar": false,
                        "excludeSlashTmp": false,
                    }
                }),
            )
            .await
            .map_err(AppError::AIRun)?;
        let turn_id = turn
            .get("turn")
            .and_then(|t| t.get("id"))
            .and_then(|v| v.as_str())
            .or_else(|| turn.get("id").and_then(|v| v.as_str()))
            .map(String::from);
        if let Some(tid) = &turn_id {
            register_thread_turn(run_id, &thread_id, tid);
        }

        // 等待 turn/completed（经 Tauri 事件桥）
        let completed = wait_for_turn_completion(run_id, &thread_id, turn_id.as_deref()).await;
        if let Err(e) = completed {
            return Err(AppError::AIRun(e));
        }

        // 两阶段提交（spec §10.6.5-8）
        self.commit_run_outputs(run_id, run_type, &run).await.map(|_| ())
    }

    async fn commit_run_outputs(
        &self,
        run_id: &str,
        run_type: AIRunType,
        run: &AIRun,
    ) -> AppResult<AIRun> {
        let run_dir = self.layout.resolve(&run.workdir_path)?;
        let outputs = run_dir.join("outputs");

        let required: Vec<(&str, fn(&[u8]) -> bool)> = match run_type {
            AIRunType::JobAnalysis => vec![
                ("jd-analysis.json", |b| serde_json::from_slice::<serde_json::Value>(b).is_ok()),
                ("jd-report.md", |b| !b.is_empty()),
            ],
            AIRunType::CompanyResearch => vec![
                ("company-research.md", |b| !b.is_empty()),
                ("company-sources.json", |b| serde_json::from_slice::<serde_json::Value>(b).is_ok()),
            ],
            AIRunType::ResumeTailoring => vec![
                ("resume-tailored.md", |b| !b.is_empty()),
                ("tailoring-report.json", |b| serde_json::from_slice::<serde_json::Value>(b).is_ok()),
            ],
            AIRunType::InterviewReview => vec![
                ("interview-review.json", |b| serde_json::from_slice::<serde_json::Value>(b).is_ok()),
                ("interview-review.md", |b| !b.is_empty()),
                ("follow-up-email.md", |b| !b.is_empty()),
            ],
        };

        let mut staged: Vec<(String, PathBuf, String)> = vec![];
        let mut tailored_md: Option<Vec<u8>> = None;
        for (name, validator) in &required {
            let path = outputs.join(name);
            let bytes = std::fs::read(&path).map_err(|_| {
                AppError::AIRun(format!("AI 输出缺少必需文件 {name}"))
            })?;
            if *name == "resume-tailored.md" {
                tailored_md = Some(bytes.clone());
            }
            if !validator(&bytes) {
                return Err(AppError::AIRun(format!("AI 输出 {name} 校验失败")));
            }
            // 复制到正式目录的 .pending 路径（先不暴露）
            let pending_path = self.pending_output_path(run_type, run, name)?;
            if let Some(parent) = pending_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            atomic_write(&pending_path, &bytes)?;
            staged.push((name.to_string(), pending_path, sha256_hex(&bytes)));
        }

        // 可选产物：音频逐字稿（存在即入库）
        let optional_files = match run_type {
            AIRunType::InterviewReview => vec![
                ("interview-transcript.md", "interview-transcript"),
            ],
            _ => vec![],
        };
        for (name, kind) in &optional_files {
            let path = outputs.join(name);
            if path.is_file() {
                if let Ok(bytes) = std::fs::read(&path) {
                    let pending = self.pending_output_path(run_type, run, name)?;
                    if let Some(parent) = pending.parent() {
                        std::fs::create_dir_all(parent)?;
                    }
                    atomic_write(&pending, &bytes)?;
                    staged.push((name.to_string(), pending, sha256_hex(&bytes)));
                    let _ = kind;
                }
            }
        }

        // 数据库事务
        let mut extra_manifest = serde_json::json!({});
        let commit_result: AppResult<()> = async {
            let mut tx = self.db.begin().await?;
            let now = now_rfc3339();
            for (name, _, sha) in &staged {
                let (kind, rel) = self.artifact_kind_and_rel(run_type, run, name)?;
                sqlx::query(
                    "INSERT INTO artifacts (id, job_id, resume_id, ai_run_id, kind, relative_path, sha256, metadata_json, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?)
                     ON CONFLICT(relative_path) DO UPDATE SET
                       sha256 = excluded.sha256,
                       ai_run_id = excluded.ai_run_id,
                       job_id = excluded.job_id,
                       resume_id = excluded.resume_id,
                       kind = excluded.kind,
                       created_at = excluded.created_at",
                )
                .bind(new_uuid_v7())
                .bind(&run.job_id)
                .bind(&run.resume_id)
                .bind(run_id)
                .bind(&kind)
                .bind(&rel)
                .bind(sha)
                .bind(&now)
                .execute(&mut *tx)
                .await?;
            }
            // 按运行类型推进业务
            match run_type {
                AIRunType::JobAnalysis | AIRunType::CompanyResearch => {
                    if let Some(job_id) = &run.job_id {
                        sqlx::query(
                            "UPDATE jobs SET status = 'pending_resume_optimization', updated_at = ? WHERE id = ? AND status = 'pending_analysis'",
                        )
                        .bind(&now)
                        .bind(job_id)
                        .execute(&mut *tx)
                        .await?;
                        sqlx::query(
                            "INSERT INTO job_events (id, job_id, event_type, from_status, to_status, actor, payload_json, occurred_at)
                             VALUES (?, ?, 'ai_run_succeeded', 'pending_analysis', 'pending_resume_optimization', 'ai', ?, ?)",
                        )
                        .bind(new_uuid_v7())
                        .bind(job_id)
                        .bind(json!({ "runId": run_id, "runType": run_type.as_str() }).to_string())
                        .bind(&now)
                        .execute(&mut *tx)
                        .await?;
                    }
                }
                AIRunType::InterviewReview => {
                    // 复盘是信息型产物：只登记 artifact，不推进岗位状态
                }
                AIRunType::ResumeTailoring => {
                    // spec §10.7：unsupportedClaims 非空不得自动入库；为空则创建
                    // 岗位版简历（父版本=基础简历）并推进待沟通（§6.1）
                    let report = std::fs::read(&outputs.join("tailoring-report.json"))
                        .ok()
                        .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
                        .unwrap_or(json!({}));
                    // 新版报告用 claim 状态表：待确认/缺失阻塞 阻止自动入库
                    let unsupported: Vec<String> = report
                        .get("claims")
                        .and_then(|c| c.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter(|x| {
                                    matches!(
                                        x.get("status").and_then(|s| s.as_str()),
                                        Some("待确认") | Some("缺失阻塞")
                                    )
                                })
                                .map(|x| {
                                    format!(
                                        "{}：{}",
                                        x.get("status").and_then(|s| s.as_str()).unwrap_or("?"),
                                        x.get("statement").and_then(|s| s.as_str()).unwrap_or("")
                                    )
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    if unsupported.is_empty() {
                        if let (Some(md), Some(parent_id), Some(job_id)) =
                            (&tailored_md, &run.resume_id, &run.job_id)
                        {
                            let md = String::from_utf8_lossy(md).to_string();
                            let base_title: Option<String> =
                                sqlx::query("SELECT title FROM resumes WHERE id = ?")
                                    .bind(parent_id)
                                    .fetch_optional(&mut *tx)
                                    .await?
                                    .map(|r| r.get::<String, _>("title"));
                            let title = format!(
                                "{}（岗位版）",
                                base_title.unwrap_or_else(|| "简历".into())
                            );
                            let new_resume =
                                crate::application::resume_service::ResumeService::new(
                                    self.db.clone(),
                                    self.layout.clone(),
                                )
                                .create_tailored(parent_id, job_id, &title, &md)
                                .await?;
                            sqlx::query(
                                "UPDATE jobs SET status = 'pending_communication', active_resume_id = ?, updated_at = ? WHERE id = ? AND status = 'pending_resume_optimization'",
                            )
                            .bind(&new_resume.id)
                            .bind(&now)
                            .bind(job_id)
                            .execute(&mut *tx)
                            .await?;
                            sqlx::query(
                                "INSERT INTO job_events (id, job_id, event_type, from_status, to_status, actor, payload_json, occurred_at)
                                 VALUES (?, ?, 'ai_run_succeeded', 'pending_resume_optimization', 'pending_communication', 'ai', ?, ?)",
                            )
                            .bind(new_uuid_v7())
                            .bind(job_id)
                            .bind(json!({ "runId": run_id, "resumeId": new_resume.id }).to_string())
                            .bind(&now)
                            .execute(&mut *tx)
                            .await?;
                        }
                    } else {
                        // 不自动入库：run 成功但标记待人工核查（spec §10.7）
                        extra_manifest = json!({
                            "pendingUserReview": true,
                            "unsupportedClaims": unsupported,
                        });
                    }
                }
            }
            sqlx::query(
                "UPDATE ai_runs SET status = 'succeeded', finished_at = ?, output_manifest_json = ? WHERE id = ?",
            )
            .bind(&now)
            .bind(extra_manifest.to_string())
            .bind(run_id)
            .execute(&mut *tx)
            .await?;
            tx.commit().await?;
            Ok(())
        }
        .await;

        match commit_result {
            Ok(()) => {
                // DB 提交成功后原子重命名 .pending -> 正式名
                for (_, pending_path, _) in &staged {
                    let final_path = pending_path.with_extension(
                        pending_path
                            .extension()
                            .and_then(|e| e.to_str())
                            .map(|e| e.trim_end_matches(".pending").to_string())
                            .unwrap_or_default(),
                    );
                    // extension 处理不可靠，直接字符串替换
                    let s = pending_path.to_string_lossy().to_string();
                    let final_path = if let Some(stripped) = s.strip_suffix(".pending") {
                        PathBuf::from(stripped)
                    } else {
                        final_path
                    };
                    std::fs::rename(pending_path, &final_path)?;
                }
            }
            Err(e) => {
                // 隔离 .pending，标记失败（spec §10.6.8）
                for (_, pending_path, _) in &staged {
                    let _ = std::fs::rename(
                        pending_path,
                        pending_path.with_file_name(format!(
                            ".quarantine-{}",
                            pending_path.file_name().unwrap_or_default().to_string_lossy()
                        )),
                    );
                }
                self.mark_run_terminal(run_id, "failed", Some("commit_failed"), Some(e.to_string()))
                    .await?;
                return Err(e);
            }
        }

        self.get_run(run_id).await
    }

    fn pending_output_path(
        &self,
        run_type: AIRunType,
        run: &AIRun,
        name: &str,
    ) -> AppResult<PathBuf> {
        match run_type {
            AIRunType::JobAnalysis => {
                let job_id = run.job_id.clone().unwrap_or_default();
                Ok(self
                    .layout
                    .resolve(&format!("workspace/jobs/{job_id}/analysis/{name}.pending"))?)
            }
            AIRunType::CompanyResearch => {
                let job_id = run.job_id.clone().unwrap_or_default();
                Ok(self
                    .layout
                    .resolve(&format!("workspace/jobs/{job_id}/analysis/{name}.pending"))?)
            }
            AIRunType::ResumeTailoring => {
                // 输出暂存在 Run 目录旁的 staging，简历创建由命令层完成
                Ok(self.layout.resolve(&format!(
                    "workspace/jobs/{}/analysis/{name}.pending",
                    run.job_id.clone().unwrap_or_default()
                ))?)
            }
            AIRunType::InterviewReview => Ok(self.layout.resolve(&format!(
                "workspace/jobs/{}/interviews/reviews/{name}.pending",
                run.job_id.clone().unwrap_or_default()
            ))?),
            AIRunType::InterviewReview => Ok(self.layout.resolve(&format!(
                "workspace/jobs/{}/interviews/reviews/{name}.pending",
                run.job_id.clone().unwrap_or_default()
            ))?),
        }
    }

    fn artifact_kind_and_rel(
        &self,
        run_type: AIRunType,
        run: &AIRun,
        name: &str,
    ) -> AppResult<(String, String)> {
        let job_id = run.job_id.clone().unwrap_or_default();
        let kind = match run_type {
            AIRunType::JobAnalysis => "jd-analysis",
            AIRunType::CompanyResearch => "company-research",
            AIRunType::ResumeTailoring => "tailoring-output",
            AIRunType::InterviewReview => "interview-review",
        };
        let dir = match run_type {
            AIRunType::InterviewReview => "interviews/reviews",
            _ => "analysis",
        };
        let rel = format!("workspace/jobs/{job_id}/{dir}/{name}");
        Ok((kind.to_string(), rel))
    }
}

/// 等待 turn/completed / turn/aborted 通知（通过临时全局监听桥接）。
async fn wait_for_turn_completion(
    run_id: &str,
    thread_id: &str,
    turn_id: Option<&str>,
) -> Result<(), String> {
    // run_id 与 thread 的映射由外层登记；此处简化：由轮询 ai_runs 状态的桥接任务
    // 直接监听 app-server-notification。为避免复杂的事件闭环，这里采用轮询输出文件 +
    // 通知检查的混合策略：最长时间 10 分钟，每 2 秒检查一次。
    let deadline = tokio::time::Instant::now() + Duration::from_secs(600);
    loop {
        tokio::time::sleep(Duration::from_secs(2)).await;
        // turn 完成的信号是输出文件出现（两阶段提交的前置校验已按文件判断）
        // 以及数据库中 thread 结束标记；最终以 turn/completed 事件为准，
        // 该事件由 run 桥接（见 commands::ai_commands）。
        let done = crate::ai::bridge::turn_finished(thread_id);
        if done {
            return Ok(());
        }
        let _ = run_id;
        if tokio::time::Instant::now() > deadline {
            return Err("turn 等待超时（10 分钟）".into());
        }
    }
}

/// 清洗空壳章节：section 内只剩一个标题行时去掉标题（避免模板渲染空标题）。
pub fn strip_empty_section_headings(md: &str) -> String {
    let marker = regex::Regex::new(r#"<!-- resume-section id="[a-z0-9-]+" -->"#).unwrap();
    let heading = regex::Regex::new(r"^#{1,6}\s").unwrap();
    let mut out = String::with_capacity(md.len());
    let mut rest = md;
    while let Some(m) = marker.find(rest) {
        out.push_str(&rest[..m.end()]);
        rest = &rest[m.end()..];
        let next = marker.find(rest);
        let seg = &rest[..next.map(|n| n.start()).unwrap_or(rest.len())];
        let lines: Vec<&str> = seg.lines().filter(|l| !l.trim().is_empty()).collect();
        if lines.len() == 1 && heading.is_match(lines[0]) {
            out.push('\n');
        } else {
            out.push_str(seg);
        }
        rest = &rest[next.map(|n| n.start()).unwrap_or(rest.len())..];
        if next.is_none() {
            break;
        }
    }
    out
}

/// 递归复制 Skill schemas 到 Run 根（保持相对路径），并登记 manifest。
fn copy_schema_files(
    src: &std::path::Path,
    run_dir: &std::path::Path,
    manifest: &mut Vec<serde_json::Value>,
) -> AppResult<()> {
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let rel = path.strip_prefix(src).unwrap_or(&path);
        if path.is_dir() {
            copy_schema_files(&path, run_dir, manifest)?;
        } else {
            let dest = run_dir.join("schemas").join(rel);
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let bytes = std::fs::read(&path)?;
            crate::infrastructure::file_repo::atomic_write(&dest, &bytes)?;
            manifest.push(json!({
                "file": format!("schemas/{}", rel.display()),
                "sha256": sha256_hex(&bytes),
            }));
        }
    }
    Ok(())
}

fn build_prompt(run_type: AIRunType) -> String {
    let skill = run_type.skill_name();
    match run_type {
        AIRunType::JobAnalysis => format!(
            "使用 ${skill}，默认执行深解档（联网核实公司信息与口碑，直接用内置 web_search 工具，禁浏览器自动化与 web-access 流程，不等待人工确认）。\n读取 ./inputs/jd.md、./inputs/job.json 和 ./references/ 下的规则表。\n若 ./inputs/base-resume.md 存在则叠加匹配档（对照该基础简历，只读分析，不改写简历）。\n按 ./references/output-schema.md 写入 ./outputs/jd-analysis.json，并写一份人读报告 ./outputs/jd-report.md（按 Skill 报告骨架）。\n不要修改 inputs，不要写入其他目录。"
        ),
        AIRunType::CompanyResearch => format!(
            "使用 ${skill}。\n读取 ./inputs/job.json 和 ./inputs/jd.md。\n联网调研一律直接使用内置 web_search 工具完成；不要使用浏览器自动化、不要走 web-access 前置检查流程、不要等待任何人工确认或用户回复。\n撰写公司调研报告写入 ./outputs/company-research.md，来源清单写入 ./outputs/company-sources.json。\n不要修改 inputs，不要写入其他目录。"
        ),
        AIRunType::InterviewReview => format!(
            "使用 ${skill}，执行面试复盘。\n无人值守一次性直出：不向用户提问、不等待回复；输入不足按降级规则产出并标注警示。\n读取 ./inputs/meta.json（公司/岗位/轮次）、./inputs/rounds.json（轮次背景）、./inputs/materials/ 下全部面试材料（音频先就地转写）；若 ./inputs/jd-analysis.json 与 ./inputs/tailoring-report.json 存在则执行上游对账；规则库在 ./references/。\n产出 ./outputs/interview-review.json、./outputs/interview-review.md、./outputs/follow-up-email.md；输入含音频且转写成功时另落 ./outputs/interview-transcript.md。\n不要修改 inputs，不要写入其他目录。"
        ),
        AIRunType::ResumeTailoring => format!(
            "使用 ${skill}，执行简历定制施工。\n读取 ./inputs/base-resume.md（施工基准）、./inputs/jd.md 和 ./inputs/jd-analysis.json（jd-analyst 产物），规则库在 ./references/。\n按 Skill 契约产出 ./outputs/resume-tailored.md（结构继承基础简历）与 ./outputs/tailoring-report.json（施工清单/Before-After/claim 状态表/自检/投递锦囊）。\n无人值守：不向用户提问；素材缺口用占位符并登记 claim，绝不编造。\n不要修改 inputs，不要写入其他目录。"
        ),
    }
}

// ---- run -> (threadId, turnId) 登记表（进程内，用于 turn/interrupt） ----
use std::sync::OnceLock;

static THREAD_TURNS: OnceLock<std::sync::Mutex<HashMap<String, (String, String)>>> = OnceLock::new();

fn thread_turns() -> &'static std::sync::Mutex<HashMap<String, (String, String)>> {
    THREAD_TURNS.get_or_init(|| std::sync::Mutex::new(HashMap::new()))
}

fn register_thread_turn(run_id: &str, thread_id: &str, turn_id: &str) {
    thread_turns()
        .lock()
        .unwrap()
        .insert(run_id.to_string(), (thread_id.to_string(), turn_id.to_string()));
}

fn thread_turn_id(run_id: &str) -> Option<String> {
    thread_turns().lock().unwrap().get(run_id).map(|(_, t)| t.clone())
}

use tokio::time::Duration;

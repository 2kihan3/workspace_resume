//! 岗位用例服务（spec §6）。状态变化与事件写入必须在同一事务。

use crate::domain::status::{classify_transition, Actor, JobStatus, TransitionKind};
use crate::domain::{new_uuid_v7, now_rfc3339, Application, Communication, InterviewMaterial, InterviewRound, Job, JobEvent, JobSummary};
use crate::infrastructure::db::Db;
use crate::infrastructure::errors::{AppError, AppResult};
use crate::infrastructure::file_repo::atomic_write;
use crate::infrastructure::paths::PathLayout;
use serde::{Deserialize, Serialize};
use specta::Type;
use sqlx::SqlitePool;

pub struct JobService {
    pub db: Db,
    pub layout: PathLayout,
}

#[derive(Debug, Serialize, Deserialize, Type, Clone)]
pub struct CreateJobInput {
    pub company_name: String,
    pub role_title: String,
    pub jd_markdown: String,
    pub source_url: Option<String>,
    pub location: Option<String>,
    pub salary_text: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Type, Clone)]
pub struct UpdateJobInput {
    pub company_name: Option<String>,
    pub role_title: Option<String>,
    pub source_url: Option<String>,
    pub location: Option<String>,
    pub salary_text: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Type, Clone)]
pub struct TransitionJobInput {
    pub to_status: JobStatus,
    pub reason: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Type, Clone)]
pub struct JobQuery {
    pub status: Option<JobStatus>,
    pub search: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Type, Clone)]
pub struct AddCommunicationInput {
    pub occurred_at: String,
    pub contact_name: Option<String>,
    pub channel: String,
    pub notes: String,
    pub advance_to_pending_application: bool,
}

#[derive(Debug, Serialize, Deserialize, Type, Clone)]
pub struct AddApplicationInput {
    pub applied_at: String,
    pub channel: String,
    pub notes: String,
}

#[derive(Debug, Serialize, Deserialize, Type, Clone)]
pub struct UpsertInterviewInput {
    pub id: Option<String>,
    pub sequence: Option<i32>,
    pub name: String,
    pub status: String,
    pub scheduled_at: Option<String>,
    pub format: Option<String>,
    pub interviewer: Option<String>,
    pub notes: String,
    pub result: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Type, Clone)]
pub struct DashboardMetrics {
    pub total_active: i32,
    pub pending: i32,
    pub interviewing: i32,
    pub passed: i32,
    pub rejected: i32,
}

impl JobService {
    pub fn new(db: Db, layout: PathLayout) -> Self {
        Self { db, layout }
    }

    fn row_to_job(row: &sqlx::sqlite::SqliteRow) -> Job {
        use sqlx::Row;
        Job {
            id: row.get("id"),
            company_name: row.get("company_name"),
            role_title: row.get("role_title"),
            status: JobStatus::parse(&row.get::<String, _>("status")).unwrap(),
            jd_path: row.get("jd_path"),
            source_url: row.get("source_url"),
            location: row.get("location"),
            salary_text: row.get("salary_text"),
            active_resume_id: row.get("active_resume_id"),
            terminal_reason: row.get("terminal_reason"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        }
    }

    async fn fetch_job(pool: &SqlitePool, id: &str) -> AppResult<Job> {
        let row = sqlx::query("SELECT * FROM jobs WHERE id = ?")
            .bind(id)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("岗位 {id} 不存在")))?;
        Ok(Self::row_to_job(&row))
    }

    pub async fn create_job(&self, input: CreateJobInput) -> AppResult<Job> {
        if input.company_name.trim().is_empty() {
            return Err(AppError::Validation("公司名称不能为空".into()));
        }
        if input.jd_markdown.trim().is_empty() {
            return Err(AppError::Validation("JD 内容不能为空".into()));
        }
        let id = new_uuid_v7();
        let now = now_rfc3339();

        // 写 JD 文件
        let jd_rel = format!("workspace/jobs/{id}/jd.md");
        let jd_abs = self.layout.resolve(&jd_rel)?;
        atomic_write(&jd_abs, input.jd_markdown.as_bytes())?;

        let mut tx = self.db.begin().await?;
        sqlx::query(
            "INSERT INTO jobs (id, company_name, role_title, status, jd_path, source_url, location, salary_text, created_at, updated_at)
             VALUES (?, ?, ?, 'pending_analysis', ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(input.company_name.trim())
        .bind(&input.role_title)
        .bind(&jd_rel)
        .bind(&input.source_url)
        .bind(&input.location)
        .bind(&input.salary_text)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await?;

        self.append_event_tx(
            &mut tx,
            &id,
            "job_created",
            None,
            Some(JobStatus::PendingAnalysis),
            Actor::User,
            serde_json::json!({}),
            &now,
        )
        .await?;
        tx.commit().await?;
        Self::fetch_job(&self.db, &id).await
    }

    #[allow(clippy::too_many_arguments)]
    async fn append_event_tx(
        &self,
        tx: &mut sqlx::SqliteConnection,
        job_id: &str,
        event_type: &str,
        from: Option<JobStatus>,
        to: Option<JobStatus>,
        actor: Actor,
        payload: serde_json::Value,
        occurred_at: &str,
    ) -> AppResult<()> {
        sqlx::query(
            "INSERT INTO job_events (id, job_id, event_type, from_status, to_status, actor, payload_json, occurred_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(new_uuid_v7())
        .bind(job_id)
        .bind(event_type)
        .bind(from.map(|s| s.as_str()))
        .bind(to.map(|s| s.as_str()))
        .bind(actor.as_str())
        .bind(payload.to_string())
        .bind(occurred_at)
        .execute(tx)
        .await?;
        Ok(())
    }

    /// 追加事件（自动时间戳），用于沟通/投递等非状态事件。
    pub async fn append_event(
        &self,
        job_id: &str,
        event_type: &str,
        actor: Actor,
        payload: serde_json::Value,
    ) -> AppResult<()> {
        let now = now_rfc3339();
        let mut tx = self.db.begin().await?;
        self.append_event_tx(&mut tx, job_id, event_type, None, None, actor, payload, &now)
            .await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn transition_job(&self, job_id: &str, input: TransitionJobInput) -> AppResult<Job> {
        let job = Self::fetch_job(&self.db, job_id).await?;
        let to = input.to_status;
        if job.status == to {
            return Err(AppError::InvalidTransition("状态未变化".into()));
        }
        let kind = classify_transition(job.status, to);
        if kind == TransitionKind::SkipForward || kind == TransitionKind::Backward || kind == TransitionKind::Restore {
            // 跨阶段/回退/终态恢复：UI 已确认；此处仅记录事件
        }
        let now = now_rfc3339();
        let mut tx = self.db.begin().await?;
        if to.is_terminal() {
            sqlx::query("UPDATE jobs SET status = ?, updated_at = ?, terminal_reason = ? WHERE id = ?")
                .bind(to.as_str())
                .bind(&now)
                .bind(input.reason.clone())
                .execute(&mut *tx)
                .await?;
        } else {
            sqlx::query("UPDATE jobs SET status = ?, updated_at = ?, terminal_reason = NULL WHERE id = ?")
                .bind(to.as_str())
                .bind(&now)
                .execute(&mut *tx)
                .await?;
        }
        self.append_event_tx(
            &mut tx,
            job_id,
            "status_changed",
            Some(job.status),
            Some(to),
            Actor::User,
            serde_json::json!({ "kind": format!("{kind:?}"), "reason": input.reason }),
            &now,
        )
        .await?;
        tx.commit().await?;
        Self::fetch_job(&self.db, job_id).await
    }

    /// 由业务动作成功触发的自动流转（spec §6.1），actor = system。
    pub async fn advance_canonical(&self, job_id: &str) -> AppResult<Option<Job>> {
        let job = Self::fetch_job(&self.db, job_id).await?;
        let Some(to) = job.status.canonical_next() else {
            return Ok(None);
        };
        let now = now_rfc3339();
        let mut tx = self.db.begin().await?;
        sqlx::query("UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?")
            .bind(to.as_str())
            .bind(&now)
            .bind(job_id)
            .execute(&mut *tx)
            .await?;
        self.append_event_tx(
            &mut tx,
            job_id,
            "status_changed",
            Some(job.status),
            Some(to),
            Actor::System,
            serde_json::json!({ "kind": "system" }),
            &now,
        )
        .await?;
        tx.commit().await?;
        Ok(Some(Self::fetch_job(&self.db, job_id).await?))
    }

    pub async fn update_job(&self, job_id: &str, patch: UpdateJobInput) -> AppResult<Job> {
        let job = Self::fetch_job(&self.db, job_id).await?;
        let company = patch.company_name.unwrap_or(job.company_name);
        if company.trim().is_empty() {
            return Err(AppError::Validation("公司名称不能为空".into()));
        }
        let now = now_rfc3339();
        sqlx::query(
            "UPDATE jobs SET company_name = ?, role_title = ?, source_url = ?, location = ?, salary_text = ?, updated_at = ? WHERE id = ?",
        )
        .bind(company.trim())
        .bind(patch.role_title.unwrap_or(job.role_title))
        .bind(patch.source_url.or(job.source_url))
        .bind(patch.location.or(job.location))
        .bind(patch.salary_text.or(job.salary_text))
        .bind(&now)
        .bind(job_id)
        .execute(&*self.db)
        .await?;
        Self::fetch_job(&self.db, job_id).await
    }

    pub async fn update_jd(&self, job_id: &str, markdown: &str) -> AppResult<Job> {
        let job = Self::fetch_job(&self.db, job_id).await?;
        if markdown.trim().is_empty() {
            return Err(AppError::Validation("JD 内容不能为空".into()));
        }
        let abs = self.layout.resolve(&job.jd_path)?;
        atomic_write(&abs, markdown.as_bytes())?;
        self.append_event(
            job_id,
            "jd_updated",
            Actor::User,
            serde_json::json!({}),
        )
        .await?;
        Ok(job)
    }

    pub async fn read_jd(&self, job_id: &str) -> AppResult<String> {
        let job = Self::fetch_job(&self.db, job_id).await?;
        let abs = self.layout.resolve(&job.jd_path)?;
        Ok(std::fs::read_to_string(abs)?)
    }

    /// 删除岗位（spec §13.2）：删除岗位专属文件与事件；岗位版简历默认保留并解除关联。
    pub async fn delete_job(&self, job_id: &str) -> AppResult<()> {
        let job = Self::fetch_job(&self.db, job_id).await?;
        let mut tx = self.db.begin().await?;
        sqlx::query("DELETE FROM jobs WHERE id = ?").bind(job_id).execute(&mut *tx).await?;
        tx.commit().await?;
        // 解除岗位版简历关联（FK 为 SET NULL，但显式处理更清晰）
        sqlx::query("UPDATE resumes SET job_id = NULL WHERE job_id = ?")
            .bind(job_id)
            .execute(&*self.db)
            .await?;
        // 删除岗位目录
        let dir = self.layout.job_dir(job_id);
        if dir.exists() {
            std::fs::remove_dir_all(dir)?;
        }
        let _ = job;
        Ok(())
    }

    pub async fn get_job(&self, job_id: &str) -> AppResult<Job> {
        Self::fetch_job(&self.db, job_id).await
    }

    pub async fn list_jobs(&self, query: JobQuery) -> AppResult<Vec<JobSummary>> {
        let rows = if let Some(status) = query.status {
            sqlx::query(
                "SELECT id, company_name, role_title, status, location, salary_text, updated_at
                 FROM jobs WHERE status = ? ORDER BY updated_at DESC",
            )
            .bind(status.as_str())
            .fetch_all(&*self.db)
            .await?
        } else {
            sqlx::query(
                "SELECT id, company_name, role_title, status, location, salary_text, updated_at
                 FROM jobs ORDER BY updated_at DESC",
            )
            .fetch_all(&*self.db)
            .await?
        };
        use sqlx::Row;
        let mut out = vec![];
        for row in rows {
            let company: String = row.get("company_name");
            let role: String = row.get("role_title");
            if let Some(search) = &query.search {
                let s = search.to_lowercase();
                let hit = company.to_lowercase().contains(&s) || role.to_lowercase().contains(&s);
                if !hit {
                    continue;
                }
            }
            out.push(JobSummary {
                id: row.get("id"),
                company_name: company,
                role_title: role,
                status: JobStatus::parse(&row.get::<String, _>("status")).unwrap(),
                location: row.get("location"),
                salary_text: row.get("salary_text"),
                updated_at: row.get("updated_at"),
            });
        }
        Ok(out)
    }

    pub async fn list_events(&self, job_id: &str) -> AppResult<Vec<JobEvent>> {
        use sqlx::Row;
        let rows = sqlx::query(
            "SELECT * FROM job_events WHERE job_id = ? ORDER BY occurred_at DESC, rowid DESC",
        )
        .bind(job_id)
        .fetch_all(&*self.db)
        .await?;
        Ok(rows
            .iter()
            .map(|row| JobEvent {
                id: row.get("id"),
                job_id: row.get("job_id"),
                event_type: row.get("event_type"),
                from_status: row
                    .get::<Option<String>, _>("from_status")
                    .and_then(|s| JobStatus::parse(&s)),
                to_status: row
                    .get::<Option<String>, _>("to_status")
                    .and_then(|s| JobStatus::parse(&s)),
                actor: match row.get::<String, _>("actor").as_str() {
                    "system" => Actor::System,
                    "ai" => Actor::Ai,
                    _ => Actor::User,
                },
                payload_json: row.get("payload_json"),
                occurred_at: row.get("occurred_at"),
            })
            .collect())
    }

    // ---- 沟通 ----

    pub async fn add_communication(
        &self,
        job_id: &str,
        input: AddCommunicationInput,
    ) -> AppResult<Communication> {
        Self::fetch_job(&self.db, job_id).await?;
        let id = new_uuid_v7();
        let now = now_rfc3339();
        let mut tx = self.db.begin().await?;
        sqlx::query(
            "INSERT INTO communications (id, job_id, occurred_at, contact_name, channel, notes, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(job_id)
        .bind(&input.occurred_at)
        .bind(&input.contact_name)
        .bind(&input.channel)
        .bind(&input.notes)
        .bind(&now)
        .execute(&mut *tx)
        .await?;
        self.append_event_tx(
            &mut tx,
            job_id,
            "communication_added",
            None,
            None,
            Actor::User,
            serde_json::json!({ "channel": input.channel }),
            &now,
        )
        .await?;
        tx.commit().await?;

        if input.advance_to_pending_application {
            let job = Self::fetch_job(&self.db, job_id).await?;
            if job.status.canonical_next() == Some(JobStatus::PendingApplication)
                || job.status == JobStatus::PendingCommunication
            {
                self.advance_canonical(job_id).await?;
            }
        }
        self.get_communication(&id).await
    }

    async fn get_communication(&self, id: &str) -> AppResult<Communication> {
        use sqlx::Row;
        let row = sqlx::query("SELECT * FROM communications WHERE id = ?")
            .bind(id)
            .fetch_optional(&*self.db)
            .await?
            .ok_or_else(|| AppError::NotFound("沟通记录不存在".into()))?;
        Ok(Communication {
            id: row.get("id"),
            job_id: row.get("job_id"),
            occurred_at: row.get("occurred_at"),
            contact_name: row.get("contact_name"),
            channel: row.get("channel"),
            notes: row.get("notes"),
            created_at: row.get("created_at"),
        })
    }

    pub async fn list_communications(&self, job_id: &str) -> AppResult<Vec<Communication>> {
        use sqlx::Row;
        let rows = sqlx::query("SELECT * FROM communications WHERE job_id = ? ORDER BY occurred_at DESC")
            .bind(job_id)
            .fetch_all(&*self.db)
            .await?;
        Ok(rows
            .iter()
            .map(|row| Communication {
                id: row.get("id"),
                job_id: row.get("job_id"),
                occurred_at: row.get("occurred_at"),
                contact_name: row.get("contact_name"),
                channel: row.get("channel"),
                notes: row.get("notes"),
                created_at: row.get("created_at"),
            })
            .collect())
    }

    // ---- 投递 ----

    /// 记录投递动作并把岗位推进到 interviewing（spec §6.1）。
    pub async fn add_application(
        &self,
        job_id: &str,
        input: AddApplicationInput,
    ) -> AppResult<Application> {
        Self::fetch_job(&self.db, job_id).await?;
        let id = new_uuid_v7();
        let now = now_rfc3339();
        let mut tx = self.db.begin().await?;
        sqlx::query(
            "INSERT INTO applications (id, job_id, applied_at, channel, notes, created_at)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(job_id)
        .bind(&input.applied_at)
        .bind(&input.channel)
        .bind(&input.notes)
        .bind(&now)
        .execute(&mut *tx)
        .await?;
        self.append_event_tx(
            &mut tx,
            job_id,
            "application_recorded",
            None,
            None,
            Actor::User,
            serde_json::json!({ "channel": input.channel }),
            &now,
        )
        .await?;
        // 同一事务内推进状态（spec §6.1：记录投递 -> interviewing）
        sqlx::query("UPDATE jobs SET status = 'interviewing', updated_at = ? WHERE id = ? AND status = 'pending_application'")
            .bind(&now)
            .bind(job_id)
            .execute(&mut *tx)
            .await?;
        self.append_event_tx(
            &mut tx,
            job_id,
            "status_changed",
            Some(JobStatus::PendingApplication),
            Some(JobStatus::Interviewing),
            Actor::System,
            serde_json::json!({ "kind": "system" }),
            &now,
        )
        .await?;
        tx.commit().await?;
        self.get_application(&id).await
    }

    async fn get_application(&self, id: &str) -> AppResult<Application> {
        use sqlx::Row;
        let row = sqlx::query("SELECT * FROM applications WHERE id = ?")
            .bind(id)
            .fetch_optional(&*self.db)
            .await?
            .ok_or_else(|| AppError::NotFound("投递记录不存在".into()))?;
        Ok(Application {
            id: row.get("id"),
            job_id: row.get("job_id"),
            applied_at: row.get("applied_at"),
            channel: row.get("channel"),
            notes: row.get("notes"),
            created_at: row.get("created_at"),
        })
    }

    pub async fn list_applications(&self, job_id: &str) -> AppResult<Vec<Application>> {
        use sqlx::Row;
        let rows = sqlx::query("SELECT * FROM applications WHERE job_id = ? ORDER BY applied_at DESC")
            .bind(job_id)
            .fetch_all(&*self.db)
            .await?;
        Ok(rows
            .iter()
            .map(|row| Application {
                id: row.get("id"),
                job_id: row.get("job_id"),
                applied_at: row.get("applied_at"),
                channel: row.get("channel"),
                notes: row.get("notes"),
                created_at: row.get("created_at"),
            })
            .collect())
    }

    // ---- 面试轮次 ----

    pub async fn upsert_interview(
        &self,
        job_id: &str,
        input: UpsertInterviewInput,
    ) -> AppResult<InterviewRound> {
        Self::fetch_job(&self.db, job_id).await?;
        let now = now_rfc3339();
        if let Some(id) = &input.id {
            sqlx::query(
                "UPDATE interview_rounds SET name = ?, status = ?, scheduled_at = ?, format = ?, interviewer = ?, notes = ?, result = ?, updated_at = ? WHERE id = ? AND job_id = ?",
            )
            .bind(&input.name)
            .bind(&input.status)
            .bind(&input.scheduled_at)
            .bind(&input.format)
            .bind(&input.interviewer)
            .bind(&input.notes)
            .bind(&input.result)
            .bind(&now)
            .bind(id)
            .bind(job_id)
            .execute(&*self.db)
            .await?;
            return self.get_interview(id).await;
        }
        let seq = match input.sequence {
            Some(s) => s,
            None => {
                let (max,): (Option<i32>,) =
                    sqlx::query_as("SELECT MAX(sequence) FROM interview_rounds WHERE job_id = ?")
                        .bind(job_id)
                        .fetch_one(&*self.db)
                        .await?;
                max.unwrap_or(0) + 1
            }
        };
        let id = new_uuid_v7();
        sqlx::query(
            "INSERT INTO interview_rounds (id, job_id, sequence, name, status, scheduled_at, format, interviewer, notes, result, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(job_id)
        .bind(seq)
        .bind(&input.name)
        .bind(&input.status)
        .bind(&input.scheduled_at)
        .bind(&input.format)
        .bind(&input.interviewer)
        .bind(&input.notes)
        .bind(&input.result)
        .bind(&now)
        .bind(&now)
        .execute(&*self.db)
        .await?;
        self.append_event(
            job_id,
            "interview_upserted",
            Actor::User,
            serde_json::json!({ "sequence": seq, "name": input.name }),
        )
        .await?;
        self.get_interview(&id).await
    }

    async fn get_interview(&self, id: &str) -> AppResult<InterviewRound> {
        use sqlx::Row;
        let row = sqlx::query("SELECT * FROM interview_rounds WHERE id = ?")
            .bind(id)
            .fetch_optional(&*self.db)
            .await?
            .ok_or_else(|| AppError::NotFound("面试轮次不存在".into()))?;
        Ok(InterviewRound {
            id: row.get("id"),
            job_id: row.get("job_id"),
            sequence: row.get("sequence"),
            name: row.get("name"),
            status: row.get("status"),
            scheduled_at: row.get("scheduled_at"),
            format: row.get("format"),
            interviewer: row.get("interviewer"),
            notes: row.get("notes"),
            result: row.get("result"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        })
    }

    pub async fn list_interviews(&self, job_id: &str) -> AppResult<Vec<InterviewRound>> {
        use sqlx::Row;
        let rows = sqlx::query(
            "SELECT * FROM interview_rounds WHERE job_id = ? ORDER BY sequence ASC",
        )
        .bind(job_id)
        .fetch_all(&*self.db)
        .await?;
        Ok(rows
            .iter()
            .map(|row| InterviewRound {
                id: row.get("id"),
                job_id: row.get("job_id"),
                sequence: row.get("sequence"),
                name: row.get("name"),
                status: row.get("status"),
                scheduled_at: row.get("scheduled_at"),
                format: row.get("format"),
                interviewer: row.get("interviewer"),
                notes: row.get("notes"),
                result: row.get("result"),
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
            })
            .collect())
    }

    pub async fn reorder_interview(&self, job_id: &str, id: &str, new_sequence: i32) -> AppResult<()> {
        let mut tx = self.db.begin().await?;
        let (old,): (i32,) = sqlx::query_as("SELECT sequence FROM interview_rounds WHERE id = ? AND job_id = ?")
            .bind(id)
            .bind(job_id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::NotFound("面试轮次不存在".into()))?;
        if old != new_sequence {
            // 先挪开占用者
            if old < new_sequence {
                sqlx::query("UPDATE interview_rounds SET sequence = sequence - 1 WHERE job_id = ? AND sequence > ? AND sequence <= ?")
                    .bind(job_id).bind(old).bind(new_sequence)
                    .execute(&mut *tx).await?;
            } else {
                sqlx::query("UPDATE interview_rounds SET sequence = sequence + 1 WHERE job_id = ? AND sequence >= ? AND sequence < ?")
                    .bind(job_id).bind(new_sequence).bind(old)
                    .execute(&mut *tx).await?;
            }
            sqlx::query("UPDATE interview_rounds SET sequence = ? WHERE id = ?")
                .bind(new_sequence)
                .bind(id)
                .execute(&mut *tx).await?;
        }
        tx.commit().await?;
        Ok(())
    }

    // ---- 面经材料 ----

    fn material_kind(file_name: &str) -> &'static str {
        const AUDIO_EXT: [&str; 6] = ["mp3", "wav", "m4a", "aac", "flac", "ogg"];
        const DOC_EXT: [&str; 6] = ["md", "markdown", "txt", "docx", "pdf", "rtf"];
        let ext = file_name.rsplit('.').next().unwrap_or("").to_lowercase();
        if AUDIO_EXT.contains(&ext.as_str()) {
            "audio"
        } else if DOC_EXT.contains(&ext.as_str()) {
            "doc"
        } else {
            "other"
        }
    }

    /// 上传材料：复制进 workspace/jobs/<id>/interviews/materials/。
    pub async fn add_interview_material(
        &self,
        job_id: &str,
        round_id: Option<String>,
        source_path: &str,
    ) -> AppResult<InterviewMaterial> {
        Self::fetch_job(&self.db, job_id).await?;
        if let Some(rid) = &round_id {
            let ok: Option<(i64,)> =
                sqlx::query_as("SELECT 1 FROM interview_rounds WHERE id = ? AND job_id = ?")
                    .bind(rid)
                    .bind(job_id)
                    .fetch_optional(&*self.db)
                    .await?;
            if ok.is_none() {
                return Err(AppError::Validation("面试轮次不存在或不属于该岗位".into()));
            }
        }
        let src = std::path::Path::new(source_path);
        if !src.is_file() {
            return Err(AppError::NotFound(format!("文件不存在：{source_path}")));
        }
        let meta = std::fs::metadata(src)?;
        if meta.len() > 500 * 1024 * 1024 {
            return Err(AppError::Validation("文件超过 500MB 限制".into()));
        }
        let raw_name = src
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("material")
            .to_string();
        let safe: String = raw_name
            .chars()
            .map(|c| if c.is_alphanumeric() || matches!(c, '-' | '_' | '.') { c } else { '_' })
            .collect();
        let kind = Self::material_kind(&raw_name);
        let id = new_uuid_v7();
        let rel = format!("workspace/jobs/{job_id}/interviews/materials/{id}__{safe}");
        let dest = self.layout.resolve(&rel)?;
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::copy(src, &dest)?;
        let now = now_rfc3339();
        sqlx::query(
            "INSERT INTO interview_materials (id, job_id, round_id, kind, file_name, relative_path, size_bytes, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(job_id)
        .bind(&round_id)
        .bind(kind)
        .bind(&raw_name)
        .bind(&rel)
        .bind(meta.len() as i32)
        .bind(&now)
        .execute(&*self.db)
        .await?;
        self.get_interview_material(&id).await
    }

    async fn get_interview_material(&self, id: &str) -> AppResult<InterviewMaterial> {
        use sqlx::Row;
        let row = sqlx::query("SELECT * FROM interview_materials WHERE id = ?")
            .bind(id)
            .fetch_optional(&*self.db)
            .await?
            .ok_or_else(|| AppError::NotFound("材料不存在".into()))?;
        Ok(Self::row_to_material(&row))
    }

    fn row_to_material(row: &sqlx::sqlite::SqliteRow) -> InterviewMaterial {
        use sqlx::Row;
        InterviewMaterial {
            id: row.get("id"),
            job_id: row.get("job_id"),
            round_id: row.get("round_id"),
            kind: row.get("kind"),
            file_name: row.get("file_name"),
            relative_path: row.get("relative_path"),
            size_bytes: row.get("size_bytes"),
            created_at: row.get("created_at"),
        }
    }

    pub async fn list_interview_materials(&self, job_id: &str) -> AppResult<Vec<InterviewMaterial>> {
        let rows = sqlx::query(
            "SELECT * FROM interview_materials WHERE job_id = ? ORDER BY created_at DESC",
        )
        .bind(job_id)
        .fetch_all(&*self.db)
        .await?;
        Ok(rows.iter().map(Self::row_to_material).collect())
    }

    pub async fn delete_interview_material(&self, id: &str) -> AppResult<()> {
        let m = self.get_interview_material(id).await?;
        sqlx::query("DELETE FROM interview_materials WHERE id = ?")
            .bind(id)
            .execute(&*self.db)
            .await?;
        if let Ok(abs) = self.layout.resolve(&m.relative_path) {
            let _ = std::fs::remove_file(abs);
        }
        Ok(())
    }

    /// 文本材料预览（仅 md/txt，≤2MB）。
    pub async fn read_material_text(&self, id: &str) -> AppResult<String> {
        use sqlx::Row;
        let row = sqlx::query("SELECT relative_path, kind, size_bytes FROM interview_materials WHERE id = ?")
            .bind(id)
            .fetch_optional(&*self.db)
            .await?
            .ok_or_else(|| AppError::NotFound("材料不存在".into()))?;
        let rel: String = row.get("relative_path");
        let kind: String = row.get("kind");
        let size: i64 = row.get("size_bytes");
        if kind != "doc" {
            return Err(AppError::Validation("仅文档类材料支持文本预览".into()));
        }
        if size > 2 * 1024 * 1024 {
            return Err(AppError::Validation("文件超过 2MB，不支持在线预览".into()));
        }
        let abs = self.layout.resolve(&rel)?;
        Ok(std::fs::read_to_string(abs)?)
    }

    // ---- 看板指标 ----

    pub async fn dashboard_metrics(&self) -> AppResult<DashboardMetrics> {
        use sqlx::Row;
        let row = sqlx::query(
            "SELECT
                COUNT(*) FILTER (WHERE status NOT IN ('passed','rejected')) AS total_active,
                COUNT(*) FILTER (WHERE status NOT IN ('interviewing','passed','rejected')) AS pending,
                COUNT(*) FILTER (WHERE status = 'interviewing') AS interviewing,
                COUNT(*) FILTER (WHERE status = 'passed') AS passed,
                COUNT(*) FILTER (WHERE status = 'rejected') AS rejected
             FROM jobs",
        )
        .fetch_one(&*self.db)
        .await?;
        Ok(DashboardMetrics {
            total_active: row.get("total_active"),
            pending: row.get("pending"),
            interviewing: row.get("interviewing"),
            passed: row.get("passed"),
            rejected: row.get("rejected"),
        })
    }
}

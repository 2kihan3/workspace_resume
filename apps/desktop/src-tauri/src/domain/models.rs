//! 领域模型（数据库行的强类型映射）。

use crate::domain::status::{Actor, JobStatus};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use specta::Type;

pub fn now_rfc3339() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

pub fn new_uuid_v7() -> String {
    uuid::Uuid::now_v7().to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct Job {
    pub id: String,
    pub company_name: String,
    pub role_title: String,
    pub status: JobStatus,
    /// 相对 app_data_dir 的 POSIX 相对路径（spec §4.3），如 `workspace/jobs/<id>/jd.md`
    pub jd_path: String,
    pub source_url: Option<String>,
    pub location: Option<String>,
    pub salary_text: Option<String>,
    pub active_resume_id: Option<String>,
    pub terminal_reason: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct JobSummary {
    pub id: String,
    pub company_name: String,
    pub role_title: String,
    pub status: JobStatus,
    pub location: Option<String>,
    pub salary_text: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct JobEvent {
    pub id: String,
    pub job_id: String,
    pub event_type: String,
    pub from_status: Option<JobStatus>,
    pub to_status: Option<JobStatus>,
    pub actor: Actor,
    pub payload_json: String,
    pub occurred_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct Resume {
    pub id: String,
    pub title: String,
    pub kind: ResumeKind,
    pub markdown_path: String,
    pub parent_resume_id: Option<String>,
    pub job_id: Option<String>,
    pub template_id: String,
    pub content_sha256: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ResumeKind {
    Base,
    Tailored,
}

impl ResumeKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            ResumeKind::Base => "base",
            ResumeKind::Tailored => "tailored",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct Communication {
    pub id: String,
    pub job_id: String,
    pub occurred_at: String,
    pub contact_name: Option<String>,
    pub channel: String,
    pub notes: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct Application {
    pub id: String,
    pub job_id: String,
    pub applied_at: String,
    pub channel: String,
    pub notes: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct InterviewRound {
    pub id: String,
    pub job_id: String,
    pub sequence: i32,
    pub name: String,
    pub status: String,
    pub scheduled_at: Option<String>,
    pub format: Option<String>,
    pub interviewer: Option<String>,
    pub notes: String,
    pub result: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct Template {
    pub id: String,
    pub name: String,
    pub origin: String,
    pub version: String,
    pub manifest_path: String,
    pub preview_path: Option<String>,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct AIRun {
    pub id: String,
    pub job_id: Option<String>,
    pub resume_id: Option<String>,
    pub run_type: String,
    pub status: String,
    pub thread_id: Option<String>,
    pub model: Option<String>,
    pub skill_snapshot_json: String,
    pub input_manifest_json: String,
    pub output_manifest_json: Option<String>,
    pub workdir_path: String,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub queued_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct Artifact {
    pub id: String,
    pub job_id: Option<String>,
    pub resume_id: Option<String>,
    pub ai_run_id: Option<String>,
    pub kind: String,
    pub relative_path: String,
    pub sha256: String,
    pub metadata_json: String,
    pub created_at: String,
}

pub fn parse_rfc3339(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s).ok().map(|d| d.with_timezone(&Utc))
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct InterviewMaterial {
    pub id: String,
    pub job_id: String,
    pub round_id: Option<String>,
    pub kind: String,
    pub file_name: String,
    pub relative_path: String,
    pub size_bytes: i64,
    pub created_at: String,
}

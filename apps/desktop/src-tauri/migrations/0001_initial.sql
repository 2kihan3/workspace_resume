-- 0001_initial.sql —— 首版 schema（技术实现方案 §5.2）
-- 时间统一保存为 UTC RFC3339 字符串，ID 统一使用 UUID v7。

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  company_name TEXT NOT NULL CHECK(length(trim(company_name)) > 0),
  role_title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN (
    'pending_analysis',
    'pending_resume_optimization',
    'pending_communication',
    'pending_application',
    'interviewing',
    'passed',
    'rejected'
  )),
  jd_path TEXT NOT NULL,
  source_url TEXT,
  location TEXT,
  salary_text TEXT,
  active_resume_id TEXT,
  terminal_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(active_resume_id) REFERENCES resumes(id) ON DELETE SET NULL
);

CREATE TABLE resumes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('base', 'tailored')),
  markdown_path TEXT NOT NULL UNIQUE,
  parent_resume_id TEXT,
  job_id TEXT,
  template_id TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(parent_resume_id) REFERENCES resumes(id) ON DELETE SET NULL,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE SET NULL
);

CREATE TABLE job_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  actor TEXT NOT NULL CHECK(actor IN ('user', 'system', 'ai')),
  payload_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE TABLE communications (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  contact_name TEXT,
  channel TEXT NOT NULL CHECK(channel IN (
    'phone', 'email', 'wechat', 'linkedin', 'meeting', 'other'
  )),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE TABLE applications (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'other',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE TABLE interview_rounds (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN (
    'planned', 'scheduled', 'completed', 'cancelled'
  )),
  scheduled_at TEXT,
  format TEXT,
  interviewer TEXT,
  notes TEXT NOT NULL DEFAULT '',
  result TEXT CHECK(result IN ('passed', 'failed', 'pending') OR result IS NULL),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(job_id, sequence),
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  origin TEXT NOT NULL CHECK(origin IN ('builtin', 'uploaded')),
  version TEXT NOT NULL,
  manifest_path TEXT NOT NULL UNIQUE,
  preview_path TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE ai_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT,
  resume_id TEXT,
  run_type TEXT NOT NULL CHECK(run_type IN (
    'job_analysis', 'company_research', 'resume_tailoring'
  )),
  status TEXT NOT NULL CHECK(status IN (
    'queued', 'running', 'waiting_approval',
    'succeeded', 'failed', 'cancelled'
  )),
  thread_id TEXT,
  model TEXT,
  skill_snapshot_json TEXT NOT NULL,
  input_manifest_json TEXT NOT NULL,
  output_manifest_json TEXT,
  workdir_path TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  queued_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE SET NULL,
  FOREIGN KEY(resume_id) REFERENCES resumes(id) ON DELETE SET NULL
);

CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  job_id TEXT,
  resume_id TEXT,
  ai_run_id TEXT,
  kind TEXT NOT NULL,
  relative_path TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE SET NULL,
  FOREIGN KEY(resume_id) REFERENCES resumes(id) ON DELETE CASCADE,
  FOREIGN KEY(ai_run_id) REFERENCES ai_runs(id) ON DELETE SET NULL
);

CREATE INDEX idx_jobs_status_updated ON jobs(status, updated_at DESC);
CREATE INDEX idx_job_events_job_time ON job_events(job_id, occurred_at DESC);
CREATE INDEX idx_interviews_job_sequence ON interview_rounds(job_id, sequence);
CREATE INDEX idx_ai_runs_status_queue ON ai_runs(status, queued_at);

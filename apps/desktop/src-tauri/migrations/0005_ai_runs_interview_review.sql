-- 0005_ai_runs_interview_review.sql —— ai_runs.run_type 增加 interview_review
-- CHECK 约束需重建表；FK 依赖（artifacts.ai_run_id → ai_runs）要求事务外执行。

-- no-transaction
PRAGMA foreign_keys=OFF;

CREATE TABLE ai_runs_new (
  id TEXT PRIMARY KEY,
  job_id TEXT,
  resume_id TEXT,
  run_type TEXT NOT NULL CHECK(run_type IN (
    'job_analysis', 'company_research', 'resume_tailoring', 'interview_review'
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

INSERT INTO ai_runs_new SELECT * FROM ai_runs;
DROP TABLE ai_runs;
ALTER TABLE ai_runs_new RENAME TO ai_runs;
CREATE INDEX idx_ai_runs_status_queue ON ai_runs(status, queued_at);

PRAGMA foreign_keys=ON;

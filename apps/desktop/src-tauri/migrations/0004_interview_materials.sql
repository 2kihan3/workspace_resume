-- 0004_interview_materials.sql —— 面经材料（录音/文档），供后续 AI 面试复盘 Skill 消费

CREATE TABLE interview_materials (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  round_id TEXT,
  -- audio = 录音；doc = 文档（md/txt/docx/pdf）；other = 其他
  kind TEXT NOT NULL CHECK(kind IN ('audio', 'doc', 'other')),
  file_name TEXT NOT NULL,
  relative_path TEXT NOT NULL UNIQUE,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  FOREIGN KEY(round_id) REFERENCES interview_rounds(id) ON DELETE CASCADE
);

CREATE INDEX idx_interview_materials_job ON interview_materials(job_id, created_at DESC);

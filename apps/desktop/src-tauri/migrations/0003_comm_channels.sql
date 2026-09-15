-- 0003_comm_channels.sql —— 扩展沟通渠道：中国主流招聘平台与社区
-- SQLite 不能直接修改 CHECK，按标准流程重建表（保留数据）。

CREATE TABLE communications_new (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  contact_name TEXT,
  channel TEXT NOT NULL CHECK(channel IN (
    'boss', 'liepin', 'zhilian', '51job', 'xiaohongshu',
    'phone', 'email', 'wechat', 'linkedin', 'meeting', 'other'
  )),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

INSERT INTO communications_new (id, job_id, occurred_at, contact_name, channel, notes, created_at)
SELECT id, job_id, occurred_at, contact_name, channel, notes, created_at FROM communications;

DROP TABLE communications;
ALTER TABLE communications_new RENAME TO communications;
CREATE INDEX idx_communications_job_time ON communications(job_id, occurred_at DESC);

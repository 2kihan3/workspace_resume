//! 简历用例服务（spec §7）。Markdown 是唯一可信源。

use crate::domain::{new_uuid_v7, now_rfc3339, Resume, ResumeKind};
use crate::infrastructure::db::Db;
use crate::infrastructure::errors::{AppError, AppResult};
use crate::infrastructure::file_repo::{atomic_write, save_snapshot, sha256_hex};
use crate::infrastructure::paths::PathLayout;
use crate::infrastructure::resume_markdown::validate_resume_markdown;
use serde::{Deserialize, Serialize};
use specta::Type;
use sqlx::Row;

pub struct ResumeService {
    pub db: Db,
    pub layout: PathLayout,
}

#[derive(Debug, Serialize, Deserialize, Type, Clone)]
pub struct ResumeContent {
    pub resume: Resume,
    pub markdown: String,
}

#[derive(Debug, Serialize, Deserialize, Type, Clone)]
pub struct SaveResumeInput {
    pub id: String,
    pub title: Option<String>,
    pub markdown: String,
    pub template_id: Option<String>,
}

impl ResumeService {
    pub fn new(db: Db, layout: PathLayout) -> Self {
        Self { db, layout }
    }

    fn row_to_resume(row: &sqlx::sqlite::SqliteRow) -> Resume {
        Resume {
            id: row.get("id"),
            title: row.get("title"),
            kind: match row.get::<String, _>("kind").as_str() {
                "tailored" => ResumeKind::Tailored,
                _ => ResumeKind::Base,
            },
            markdown_path: row.get("markdown_path"),
            parent_resume_id: row.get("parent_resume_id"),
            job_id: row.get("job_id"),
            template_id: row.get("template_id"),
            content_sha256: row.get("content_sha256"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        }
    }

    async fn fetch(pool: &Db, id: &str) -> AppResult<Resume> {
        let row = sqlx::query("SELECT * FROM resumes WHERE id = ?")
            .bind(id)
            .fetch_optional(&**pool)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("简历 {id} 不存在")))?;
        Ok(Self::row_to_resume(&row))
    }

    /// 导入普通 .md（spec §7.4）：归一化预览由前端 TS 包完成；
    /// 这里接收用户确认后的归一化 Markdown，复制并落库。不得改动源文件。
    pub async fn import_markdown(
        &self,
        source_path: &str,
        normalized_markdown: &str,
        title: &str,
    ) -> AppResult<Resume> {
        let source_abs = std::path::PathBuf::from(source_path);
        if !source_abs.exists() {
            return Err(AppError::NotFound(format!("源文件不存在: {source_path}")));
        }
        let issues = validate_resume_markdown(normalized_markdown);
        if !issues.is_valid() {
            return Err(AppError::Validation(issues.errors.join("；")));
        }
        let id = new_uuid_v7();
        let now = now_rfc3339();
        let rel = format!("workspace/resumes/{id}/resume.md");
        let abs = self.layout.resolve(&rel)?;
        atomic_write(&abs, normalized_markdown.as_bytes())?;
        let sha = sha256_hex(normalized_markdown.as_bytes());

        sqlx::query(
            "INSERT INTO resumes (id, title, kind, markdown_path, template_id, content_sha256, schema_version, created_at, updated_at)
             VALUES (?, ?, 'base', ?, 'builtin.classic', ?, 1, ?, ?)",
        )
        .bind(&id)
        .bind(title)
        .bind(&rel)
        .bind(&sha)
        .bind(&now)
        .bind(&now)
        .execute(&*self.db)
        .await?;

        // 保存原始文件 SHA-256 与归一化警告（spec §7.4）
        let source_sha = sha256_file_or_empty(&source_abs);
        std::fs::create_dir_all(self.layout.resume_dir(&id).join("meta"))?;
        atomic_write(
            &self.layout.resume_dir(&id).join("meta/import.json"),
            serde_json::json!({
                "sourcePath": source_path,
                "sourceSha256": source_sha,
            })
            .to_string()
            .as_bytes(),
        )?;

        Self::fetch(&self.db, &id).await
    }

    /// 创建基础简历（新建文档，不上传文件）。
    pub async fn create_base(&self, title: &str, markdown: &str) -> AppResult<Resume> {
        let issues = validate_resume_markdown(markdown);
        if !issues.is_valid() {
            return Err(AppError::Validation(issues.errors.join("；")));
        }
        let id = new_uuid_v7();
        let now = now_rfc3339();
        let rel = format!("workspace/resumes/{id}/resume.md");
        let abs = self.layout.resolve(&rel)?;
        atomic_write(&abs, markdown.as_bytes())?;
        let sha = sha256_hex(markdown.as_bytes());
        sqlx::query(
            "INSERT INTO resumes (id, title, kind, markdown_path, template_id, content_sha256, schema_version, created_at, updated_at)
             VALUES (?, ?, 'base', ?, 'builtin.classic', ?, 1, ?, ?)",
        )
        .bind(&id)
        .bind(title)
        .bind(&rel)
        .bind(&sha)
        .bind(&now)
        .bind(&now)
        .execute(&*self.db)
        .await?;
        Self::fetch(&self.db, &id).await
    }

    pub async fn read_resume(&self, id: &str) -> AppResult<ResumeContent> {
        let resume = Self::fetch(&self.db, id).await?;
        let abs = self.layout.resolve(&resume.markdown_path)?;
        let markdown = std::fs::read_to_string(abs)?;
        Ok(ResumeContent { resume, markdown })
    }

    /// 保存（spec §7.2/§7.3）：校验失败不覆盖最后有效版本；成功后快照 + 更新哈希。
    pub async fn save_resume(&self, input: SaveResumeInput) -> AppResult<Resume> {
        let resume = Self::fetch(&self.db, &input.id).await?;
        let issues = validate_resume_markdown(&input.markdown);
        if !issues.is_valid() {
            return Err(AppError::Validation(issues.errors.join("；")));
        }
        let abs = self.layout.resolve(&resume.markdown_path)?;
        // 保存前保留快照（保留当前磁盘版本）
        if let Ok(prev) = std::fs::read_to_string(&abs) {
            save_snapshot(&self.layout.resume_dir(&resume.id), &prev)?;
        }
        atomic_write(&abs, input.markdown.as_bytes())?;
        let sha = sha256_hex(input.markdown.as_bytes());
        let now = now_rfc3339();
        let title = input.title.unwrap_or(resume.title.clone());
        let template_id = input.template_id.unwrap_or(resume.template_id.clone());
        sqlx::query(
            "UPDATE resumes SET title = ?, template_id = ?, content_sha256 = ?, updated_at = ? WHERE id = ?",
        )
        .bind(title)
        .bind(template_id)
        .bind(&sha)
        .bind(&now)
        .bind(&resume.id)
        .execute(&*self.db)
        .await?;
        Self::fetch(&self.db, &resume.id).await
    }

    /// 另存为版本（spec §7.3）：新 ResumeDocument，parent 指向当前简历。
    pub async fn create_version(&self, id: &str, title: &str) -> AppResult<Resume> {
        let source = Self::fetch(&self.db, id).await?;
        let source_abs = self.layout.resolve(&source.markdown_path)?;
        let content = std::fs::read_to_string(&source_abs)?;
        let new_id = new_uuid_v7();
        let now = now_rfc3339();
        let rel = format!("workspace/resumes/{new_id}/resume.md");
        let abs = self.layout.resolve(&rel)?;
        atomic_write(&abs, content.as_bytes())?;
        sqlx::query(
            "INSERT INTO resumes (id, title, kind, markdown_path, parent_resume_id, job_id, template_id, content_sha256, schema_version, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
        )
        .bind(&new_id)
        .bind(title)
        .bind(source.kind.as_str())
        .bind(&rel)
        .bind(&source.id)
        .bind(&source.job_id)
        .bind(&source.template_id)
        .bind(&source.content_sha256)
        .bind(&now)
        .bind(&now)
        .execute(&*self.db)
        .await?;
        Self::fetch(&self.db, &new_id).await
    }

    /// AI 输出入库：创建 tailored 简历（spec §7.3），由 AI Run 校验后调用。
    pub async fn create_tailored(
        &self,
        parent_resume_id: &str,
        job_id: &str,
        title: &str,
        markdown: &str,
    ) -> AppResult<Resume> {
        let issues = validate_resume_markdown(markdown);
        if !issues.is_valid() {
            return Err(AppError::Validation(issues.errors.join("；")));
        }
        let parent = Self::fetch(&self.db, parent_resume_id).await?;
        let id = new_uuid_v7();
        let now = now_rfc3339();
        let rel = format!("workspace/resumes/{id}/resume.md");
        let abs = self.layout.resolve(&rel)?;
        atomic_write(&abs, markdown.as_bytes())?;
        let sha = sha256_hex(markdown.as_bytes());
        sqlx::query(
            "INSERT INTO resumes (id, title, kind, markdown_path, parent_resume_id, job_id, template_id, content_sha256, schema_version, created_at, updated_at)
             VALUES (?, ?, 'tailored', ?, ?, ?, ?, ?, 1, ?, ?)",
        )
        .bind(&id)
        .bind(title)
        .bind(&rel)
        .bind(&parent.id)
        .bind(job_id)
        .bind(&parent.template_id)
        .bind(&sha)
        .bind(&now)
        .bind(&now)
        .execute(&*self.db)
        .await?;
        Self::fetch(&self.db, &id).await
    }

    pub async fn list_resumes(&self) -> AppResult<Vec<Resume>> {
        let rows = sqlx::query("SELECT * FROM resumes ORDER BY updated_at DESC")
            .fetch_all(&*self.db)
            .await?;
        Ok(rows.iter().map(Self::row_to_resume).collect())
    }

    /// 删除基础简历不级联删除岗位版（FK SET NULL，spec §7.3）。
    pub async fn delete_resume(&self, id: &str) -> AppResult<()> {
        let resume = Self::fetch(&self.db, id).await?;
        sqlx::query("DELETE FROM resumes WHERE id = ?")
            .bind(id)
            .execute(&*self.db)
            .await?;
        let dir = self.layout.resume_dir(id);
        if dir.exists() {
            std::fs::remove_dir_all(dir)?;
        }
        let _ = resume;
        Ok(())
    }
}

fn sha256_file_or_empty(path: &std::path::Path) -> String {
    std::fs::read(path)
        .map(|b| sha256_hex(&b))
        .unwrap_or_default()
}

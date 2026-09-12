//! 模板服务（spec §8）：内置模板首次启动同步、ZIP 上传安全校验。

use crate::domain::{now_rfc3339, Template};
use crate::infrastructure::db::Db;
use crate::infrastructure::errors::{AppError, AppResult};
use crate::infrastructure::paths::PathLayout;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::io::Read;
use std::path::Path;
use zip::ZipArchive;

pub const MAX_ZIP_BYTES: u64 = 10 * 1024 * 1024;
pub const MAX_FILES: usize = 100;
pub const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;
const ALLOWED_ASSET_EXT: [&str; 6] = ["png", "jpeg", "jpg", "webp", "woff", "woff2"];

pub struct TemplateService {
    pub db: Db,
    pub layout: PathLayout,
}

#[derive(Debug, Serialize, Deserialize, Type, Clone)]
pub struct TemplateManifest {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub author: String,
    pub version: String,
    pub entry: String,
    pub style: String,
    #[serde(rename = "supportedLocales")]
    pub supported_locales: Vec<String>,
    pub page: PageSpec,
}

#[derive(Debug, Serialize, Deserialize, Type, Clone)]
pub struct PageSpec {
    pub size: String,
    #[serde(rename = "marginMm")]
    pub margin_mm: [f64; 4],
}

impl TemplateService {
    pub fn new(db: Db, layout: PathLayout) -> Self {
        Self { db, layout }
    }

    /// 首次启动及版本升级时安装三套内置模板（spec §8、§10.4 同思路）。
    pub async fn install_builtin_templates(&self, packaged_dir: &Path) -> AppResult<()> {
        if !packaged_dir.exists() {
            return Ok(());
        }
        let mut installed_ids: Vec<String> = vec![];
        for entry in std::fs::read_dir(packaged_dir)?.filter_map(|e| e.ok()) {
            let manifest_path = entry.path().join("manifest.json");
            if !manifest_path.exists() {
                continue;
            }
            let manifest: TemplateManifest = serde_json::from_str(&std::fs::read_to_string(&manifest_path)?)?;
            let dest = self.layout.template_dir(&manifest.id);
            copy_dir_overwrite_app_managed(&entry.path(), &dest)?;
            let rel = self.layout.relativize(&dest.join("manifest.json"))?;
            self.upsert_template_row(&manifest, "builtin", &rel).await?;
            installed_ids.push(manifest.id.clone());
        }
        // 清理不再随包提供的内置模板：删除目录与记录，
        // 引用它们的简历回退到编辑器默认模板 builtin.classic
        let rows = sqlx::query("SELECT id FROM templates WHERE origin = 'builtin'")
            .fetch_all(&*self.db)
            .await?;
        use sqlx::Row;
        for row in rows {
            let id: String = row.get("id");
            if installed_ids.contains(&id) {
                continue;
            }
            sqlx::query("DELETE FROM templates WHERE id = ?")
                .bind(&id)
                .execute(&*self.db)
                .await?;
            sqlx::query("UPDATE resumes SET template_id = 'builtin.classic' WHERE template_id = ?")
                .bind(&id)
                .execute(&*self.db)
                .await?;
            let dir = self.layout.template_dir(&id);
            if dir.exists() {
                std::fs::remove_dir_all(dir)?;
            }
            tracing::info!("已移除停用内置模板: {id}");
        }
        Ok(())
    }

    async fn upsert_template_row(
        &self,
        manifest: &TemplateManifest,
        origin: &str,
        manifest_rel: &str,
    ) -> AppResult<()> {
        let now = now_rfc3339();
        sqlx::query(
            "INSERT INTO templates (id, name, origin, version, manifest_path, enabled, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 1, ?, ?)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, version = excluded.version, updated_at = excluded.updated_at",
        )
        .bind(&manifest.id)
        .bind(&manifest.name)
        .bind(origin)
        .bind(&manifest.version)
        .bind(manifest_rel)
        .bind(&now)
        .bind(&now)
        .execute(&*self.db)
        .await?;
        Ok(())
    }

    /// 导入 ZIP 模板包（spec §8.3）。校验失败不产生任何记录。
    pub async fn import_zip(&self, zip_path: &Path) -> AppResult<Template> {
        let meta = std::fs::metadata(zip_path)?;
        if meta.len() > MAX_ZIP_BYTES {
            return Err(AppError::TemplateInvalid(format!(
                "ZIP 总大小超过 {MAX_ZIP_BYTES} 字节"
            )));
        }
        let file = std::fs::File::open(zip_path)?;
        let mut archive = ZipArchive::new(file)
            .map_err(|e| AppError::TemplateInvalid(format!("ZIP 无法解析: {e}")))?;
        if archive.len() > MAX_FILES {
            return Err(AppError::TemplateInvalid(format!("文件数超过 {MAX_FILES}")));
        }

        let mut manifest_raw: Option<String> = None;
        let mut entry_html: Option<String> = None;
        let mut entry_css: Option<String> = None;
        let mut seen_names = std::collections::HashSet::new();

        for i in 0..archive.len() {
            let mut entry = archive.by_index(i)?;
            let name = entry.name().to_string();
            if name.ends_with('/') {
                continue;
            }
            // 路径穿越 / 绝对路径 / 重复规范化路径
            if name.starts_with('/') || name.contains("..") || name.contains('\\') {
                return Err(AppError::TemplateInvalid(format!("非法路径: {name}")));
            }
            if !seen_names.insert(normalize_path(&name)) {
                return Err(AppError::TemplateInvalid(format!("重复路径: {name}")));
            }
            if entry.size() > MAX_FILE_BYTES {
                return Err(AppError::TemplateInvalid(format!("单文件过大: {name}")));
            }
            let ext = name.rsplit('.').next().unwrap_or("").to_lowercase();
            if name.starts_with("assets/") && !ALLOWED_ASSET_EXT.contains(&ext.as_str()) {
                return Err(AppError::TemplateInvalid(format!(
                    "assets 只允许 PNG/JPEG/WebP/WOFF/WOFF2，拒绝: {name}"
                )));
            }
            let mut buf = Vec::with_capacity(entry.size() as usize);
            entry.read_to_end(&mut buf)?;
            match name.as_str() {
                "manifest.json" => manifest_raw = Some(String::from_utf8_lossy(&buf).to_string()),
                "template.html" => entry_html = Some(String::from_utf8_lossy(&buf).to_string()),
                "style.css" => entry_css = Some(String::from_utf8_lossy(&buf).to_string()),
                _ if name.starts_with("assets/") => {}
                _ => {
                    return Err(AppError::TemplateInvalid(format!(
                        "ZIP 内出现未声明的文件: {name}"
                    )))
                }
            }
        }

        let manifest: TemplateManifest = serde_json::from_str(
            manifest_raw
                .as_deref()
                .ok_or_else(|| AppError::TemplateInvalid("缺少 manifest.json".into()))?,
        )
        .map_err(|e| AppError::TemplateInvalid(format!("manifest.json 非法: {e}")))?;
        if manifest.schema_version != 1 {
            return Err(AppError::TemplateInvalid("manifest schemaVersion 只支持 1".into()));
        }
        let html = entry_html
            .ok_or_else(|| AppError::TemplateInvalid("缺少 template.html".into()))?;
        let css = entry_css
            .ok_or_else(|| AppError::TemplateInvalid("缺少 style.css".into()))?;
        validate_html(&html)?;
        validate_css(&css)?;

        // 解压到模板目录
        let dir = self.layout.template_dir(&manifest.id);
        std::fs::create_dir_all(&dir)?;
        for i in 0..archive.len() {
            let mut entry = archive.by_index(i)?;
            let name = entry.name().to_string();
            if name.ends_with('/') {
                continue;
            }
            let dest = dir.join(&name);
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut buf = Vec::new();
            entry.read_to_end(&mut buf)?;
            crate::infrastructure::file_repo::atomic_write(&dest, &buf)?;
        }
        let rel = self.layout.relativize(&dir.join("manifest.json"))?;
        self.upsert_template_row(&manifest, "uploaded", &rel).await?;
        let now = now_rfc3339();
        Ok(Template {
            id: manifest.id,
            name: manifest.name,
            origin: "uploaded".into(),
            version: manifest.version,
            manifest_path: rel,
            preview_path: None,
            enabled: true,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub async fn get_template(&self, id: &str) -> AppResult<Template> {
        let row = sqlx::query("SELECT * FROM templates WHERE id = ?")
            .bind(id)
            .fetch_optional(&*self.db)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("模板 {id} 不存在")))?;
        Ok(self.row_to_template(&row))
    }

    fn row_to_template(&self, row: &sqlx::sqlite::SqliteRow) -> Template {
        use sqlx::Row;
        Template {
            id: row.get("id"),
            name: row.get("name"),
            origin: row.get("origin"),
            version: row.get("version"),
            manifest_path: row.get("manifest_path"),
            preview_path: row.get("preview_path"),
            enabled: row.get::<i64, _>("enabled") != 0,
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        }
    }

    pub async fn list_templates(&self) -> AppResult<Vec<Template>> {
        let rows = sqlx::query("SELECT * FROM templates ORDER BY created_at ASC")
            .fetch_all(&*self.db)
            .await?;
        Ok(rows.iter().map(|r| self.row_to_template(r)).collect())
    }

    pub async fn set_enabled(&self, id: &str, enabled: bool) -> AppResult<()> {
        sqlx::query("UPDATE templates SET enabled = ?, updated_at = ? WHERE id = ?")
            .bind(if enabled { 1 } else { 0 })
            .bind(now_rfc3339())
            .bind(id)
            .execute(&*self.db)
            .await?;
        Ok(())
    }

    pub async fn set_preview_path(&self, id: &str, rel: &str) -> AppResult<()> {
        sqlx::query("UPDATE templates SET preview_path = ?, updated_at = ? WHERE id = ?")
            .bind(rel)
            .bind(now_rfc3339())
            .bind(id)
            .execute(&*self.db)
            .await?;
        Ok(())
    }

    /// 读取模板的 entry HTML、CSS 与 manifest（渲染与详情展示用）。
    pub fn read_template_assets(&self, id: &str) -> AppResult<(String, String, String)> {
        let dir = self.layout.template_dir(id);
        let html = std::fs::read_to_string(dir.join("template.html"))?;
        let css = std::fs::read_to_string(dir.join("style.css"))?;
        let manifest = std::fs::read_to_string(dir.join("manifest.json"))?;
        Ok((html, css, manifest))
    }
}

fn normalize_path(name: &str) -> String {
    name.split('/').filter(|s| !s.is_empty() && *s != ".").collect::<Vec<_>>().join("/")
}

fn validate_html(html: &str) -> AppResult<()> {
    let lower = html.to_lowercase();
    for tag in ["<script", "<iframe", "<object", "<embed", "<form", "<input", "<meta http-equiv=\"refresh"] {
        if lower.contains(tag) {
            return Err(AppError::TemplateInvalid(format!("HTML 包含被禁止的元素: {tag}")));
        }
    }
    if regex::Regex::new(r"\son[a-z]+\s*=").unwrap().is_match(&lower) {
        return Err(AppError::TemplateInvalid("HTML 包含事件处理属性".into()));
    }
    if lower.contains("http://") || lower.contains("https://") {
        return Err(AppError::TemplateInvalid("HTML 不允许远程 URL".into()));
    }
    Ok(())
}

fn validate_css(css: &str) -> AppResult<()> {
    let lower = css.to_lowercase();
    for bad in ["@import", "javascript:", "expression(", "url(http", "url(https", "url('//", "url(\"//"] {
        if lower.contains(bad) {
            return Err(AppError::TemplateInvalid(format!("CSS 包含被禁止的规则: {bad}")));
        }
    }
    // url() 只允许 assets/ 相对路径
    for cap in regex::Regex::new(r"url\(([^)]*)\)").unwrap().captures_iter(&lower) {
        let val = cap[1].trim().trim_matches(['\'', '"']);
        if !val.starts_with("assets/") && !val.starts_with("data:") {
            return Err(AppError::TemplateInvalid(format!(
                "CSS url() 只允许 assets/ 路径: {val}"
            )));
        }
    }
    Ok(())
}

/// 应用管理的目录按版本整体覆盖（不触碰用户导入的其他目录，spec §10.4）。
fn copy_dir_overwrite_app_managed(src: &Path, dest: &Path) -> AppResult<()> {
    if dest.exists() {
        std::fs::remove_dir_all(dest)?;
    }
    std::fs::create_dir_all(dest)?;
    copy_tree(src, dest)
}

fn copy_tree(src: &Path, dest: &Path) -> AppResult<()> {
    for entry in std::fs::read_dir(src)?.filter_map(|e| e.ok()) {
        let path = entry.path();
        let target = dest.join(entry.file_name());
        if path.is_dir() {
            std::fs::create_dir_all(&target)?;
            copy_tree(&path, &target)?;
        } else {
            std::fs::copy(&path, &target)?;
        }
    }
    Ok(())
}

//! 备份与恢复（spec §13）：`.jsw-backup`（ZIP），含 manifest、数据库与工作区。

use crate::infrastructure::errors::{AppError, AppResult};
use crate::infrastructure::file_repo::sha256_hex;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::path::Path;

#[derive(Debug, Serialize, Deserialize)]
pub struct BackupManifest {
    pub app_version: String,
    pub schema_version: i64,
    pub created_at: String,
    pub files: Vec<BackupFileEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BackupFileEntry {
    pub path: String,
    pub size: u64,
    pub sha256: String,
}

pub struct BackupService;

impl BackupService {
    /// 创建备份。不包含 Codex auth、API Key、运行日志和临时 AI Run（spec §13.1）。
    pub fn create(
        app_data_dir: &Path,
        output_path: &Path,
        app_version: &str,
        schema_version: i64,
    ) -> AppResult<()> {
        let mut entries: Vec<BackupFileEntry> = vec![];
        let mut buf: Vec<u8> = vec![];
        let writer = std::io::Cursor::new(&mut buf);
        let mut zip = zip::ZipWriter::new(writer);
        let options: zip::write::FileOptions<'_, ()> =
            zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

        let db_path = app_data_dir.join("app.db");
        let mut files: Vec<(String, std::path::PathBuf)> = vec![("app.db".into(), db_path)];

        // workspace（排除 ai-runs 临时目录与日志）
        collect_dir(&app_data_dir.join("workspace"), "workspace", &mut files)?;
        collect_dir(&app_data_dir.join("templates"), "templates", &mut files)?;

        for (rel, abs) in &files {
            let bytes = std::fs::read(abs)?;
            entries.push(BackupFileEntry {
                path: rel.clone(),
                size: bytes.len() as u64,
                sha256: sha256_hex(&bytes),
            });
            zip.start_file(rel.as_str(), options.clone())
                .map_err(|e| AppError::Backup(e.to_string()))?;
            zip.write_all(&bytes)
                .map_err(|e| AppError::Backup(e.to_string()))?;
        }

        let manifest = BackupManifest {
            app_version: app_version.to_string(),
            schema_version,
            created_at: crate::domain::now_rfc3339(),
            files: entries,
        };
        zip.start_file("manifest.json", options.clone())
            .map_err(|e| AppError::Backup(e.to_string()))?;
        zip.write_all(serde_json::to_vec_pretty(&manifest)?.as_slice())
            .map_err(|e| AppError::Backup(e.to_string()))?;
        let cursor = zip.finish().map_err(|e| AppError::Backup(e.to_string()))?;
        drop(cursor);

        crate::infrastructure::file_repo::atomic_write(output_path, &buf)?;
        Ok(())
    }

    /// 恢复：先校验全部哈希（完成前不动现有数据），再自动备份现有数据，
    /// 最后经 staging 目录替换（spec §13.1）。
    pub fn restore(backup_path: &Path, app_data_dir: &Path, app_handle_version: &str) -> AppResult<()> {
        let bytes = std::fs::read(backup_path)?;
        let reader = std::io::Cursor::new(&bytes);
        let mut archive =
            zip::ZipArchive::new(reader).map_err(|e| AppError::Backup(format!("备份文件无法解析: {e}")))?;

        let mut manifest_raw = String::new();
        archive
            .by_name("manifest.json")
            .map_err(|_| AppError::Backup("备份缺少 manifest.json".into()))?
            .read_to_string(&mut manifest_raw)
            .map_err(|e| AppError::Backup(e.to_string()))?;
        let manifest: BackupManifest = serde_json::from_str(&manifest_raw)?;

        // 校验
        for entry in &manifest.files {
            let mut f = archive
                .by_name(&entry.path)
                .map_err(|_| AppError::Backup(format!("备份缺少文件: {}", entry.path)))?;
            let mut data = vec![0u8; f.size() as usize];
            f.read_exact(&mut data).map_err(|e| AppError::Backup(e.to_string()))?;
            if data.len() as u64 != entry.size {
                return Err(AppError::Backup(format!("文件大小不符: {}", entry.path)));
            }
            if sha256_hex(&data) != entry.sha256 {
                return Err(AppError::Backup(format!("哈希不符: {}", entry.path)));
            }
        }
        if manifest.app_version != app_handle_version {
            tracing::warn!(
                "备份来自版本 {}，当前为 {}",
                manifest.app_version,
                app_handle_version
            );
        }

        // 恢复前自动备份现有数据
        let pre_restore = app_data_dir.join("backups");
        std::fs::create_dir_all(&pre_restore)?;
        let auto_path = pre_restore.join(format!(
            "pre-restore-{}.jsw-backup",
            chrono::Utc::now().format("%Y%m%dT%H%M%S")
        ));
        if app_data_dir.join("app.db").exists() {
            Self::create(app_data_dir, &auto_path, app_handle_version, manifest.schema_version)?;
        }

        // staging 替换
        let staging = app_data_dir.join(".restore-staging");
        if staging.exists() {
            std::fs::remove_dir_all(&staging)?;
        }
        std::fs::create_dir_all(&staging)?;
        for entry in &manifest.files {
            let mut f = archive.by_name(&entry.path)?;
            let mut data = vec![0u8; f.size() as usize];
            f.read_exact(&mut data)?;
            let dest = staging.join(&entry.path);
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::write(&dest, &data)?;
        }
        // 替换 app.db 与 workspace/templates
        std::fs::rename(staging.join("app.db"), app_data_dir.join("app.db"))
            .map_err(|e| AppError::Backup(format!("替换数据库失败: {e}")))?;
        for dir in ["workspace", "templates"] {
            let src = staging.join(dir);
            let dest = app_data_dir.join(dir);
            if src.exists() {
                if dest.exists() {
                    std::fs::remove_dir_all(&dest)?;
                }
                std::fs::rename(&src, &dest)?;
            }
        }
        std::fs::remove_dir_all(&staging).ok();
        Ok(())
    }
}

fn collect_dir(
    dir: &Path,
    prefix: &str,
    out: &mut Vec<(String, std::path::PathBuf)>,
) -> AppResult<()> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in std::fs::read_dir(dir)?.filter_map(|e| e.ok()) {
        let path = entry.path();
        let rel = format!("{prefix}/{}", entry.file_name().to_string_lossy());
        if path.is_dir() {
            // 排除 AI 临时 Run（spec §13.1）
            if rel == "workspace/ai-runs" {
                continue;
            }
            collect_dir(&path, &rel, out)?;
        } else {
            out.push((rel, path));
        }
    }
    Ok(())
}

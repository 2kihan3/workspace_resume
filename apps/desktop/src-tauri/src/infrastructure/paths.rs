//! 路径管理：app_data_dir 布局（spec §4.3）。
//! 数据库只存相对路径；绝对路径仅在运行时由此模块解析。

use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct PathLayout {
    pub app_data_dir: PathBuf,
}

impl PathLayout {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self { app_data_dir }
    }

    pub fn db_path(&self) -> PathBuf {
        self.app_data_dir.join("app.db")
    }

    pub fn workspace_dir(&self) -> PathBuf {
        self.app_data_dir.join("workspace")
    }

    pub fn jobs_dir(&self) -> PathBuf {
        self.workspace_dir().join("jobs")
    }

    pub fn job_dir(&self, job_id: &str) -> PathBuf {
        self.jobs_dir().join(job_id)
    }

    pub fn resumes_dir(&self) -> PathBuf {
        self.workspace_dir().join("resumes")
    }

    pub fn resume_dir(&self, resume_id: &str) -> PathBuf {
        self.resumes_dir().join(resume_id)
    }

    pub fn templates_dir(&self) -> PathBuf {
        self.app_data_dir.join("templates")
    }

    pub fn template_dir(&self, template_id: &str) -> PathBuf {
        self.templates_dir().join(template_id)
    }

    pub fn skills_dir(&self) -> PathBuf {
        self.workspace_dir().join(".agents").join("skills")
    }

    pub fn ai_runs_dir(&self) -> PathBuf {
        self.workspace_dir().join("ai-runs")
    }

    pub fn run_dir(&self, run_id: &str) -> PathBuf {
        self.ai_runs_dir().join(run_id)
    }

    pub fn backups_dir(&self) -> PathBuf {
        self.app_data_dir.join("backups")
    }

    pub fn logs_dir(&self) -> PathBuf {
        self.app_data_dir.join("logs")
    }

    /// 相对路径 -> 绝对路径。拒绝 `..` 逃逸。
    pub fn resolve(&self, relative: &str) -> std::io::Result<PathBuf> {
        let rel = Path::new(relative);
        if rel.is_absolute() || relative.contains("..") {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!("非法相对路径: {relative}"),
            ));
        }
        Ok(self.app_data_dir.join(rel))
    }

    /// 绝对路径 -> 相对 app_data_dir 的 POSIX 相对路径。
    pub fn relativize(&self, abs: &Path) -> std::io::Result<String> {
        let stripped = abs
            .strip_prefix(&self.app_data_dir)
            .map_err(|_| {
                std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "路径不在 app_data_dir 内",
                )
            })?;
        Ok(stripped
            .components()
            .map(|c| c.as_os_str().to_string_lossy().to_string())
            .collect::<Vec<_>>()
            .join("/"))
    }

    pub fn ensure_dirs(&self) -> std::io::Result<()> {
        for dir in [
            self.workspace_dir(),
            self.jobs_dir(),
            self.resumes_dir(),
            self.templates_dir(),
            self.ai_runs_dir(),
            self.backups_dir(),
            self.logs_dir(),
        ] {
            std::fs::create_dir_all(dir)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relativize_and_resolve() {
        let tmp = tempfile::tempdir().unwrap();
        let layout = PathLayout::new(tmp.path().to_path_buf());
        let abs = tmp.path().join("workspace/jobs/abc/jd.md");
        let rel = layout.relativize(&abs).unwrap();
        assert_eq!(rel, "workspace/jobs/abc/jd.md");
        assert_eq!(layout.resolve(&rel).unwrap(), abs);
    }

    #[test]
    fn reject_escape() {
        let tmp = tempfile::tempdir().unwrap();
        let layout = PathLayout::new(tmp.path().to_path_buf());
        assert!(layout.resolve("../etc/passwd").is_err());
        assert!(layout.resolve("/etc/passwd").is_err());
    }
}

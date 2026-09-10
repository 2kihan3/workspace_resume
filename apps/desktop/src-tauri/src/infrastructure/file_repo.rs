//! 文件仓库：原子写入、SHA-256、快照、崩溃恢复（spec §7.2、§7.3）。

use crate::infrastructure::errors::{AppError, AppResult};
use sha2::{Digest, Sha256};
use std::path::Path;

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

pub fn sha256_file(path: &Path) -> AppResult<String> {
    let bytes = std::fs::read(path)?;
    Ok(sha256_hex(&bytes))
}

/// 原子写入（spec §7.2）：同目录临时文件 -> fsync -> rename。
pub fn atomic_write(path: &Path, contents: &[u8]) -> AppResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Internal("路径缺少父目录".into()))?;
    std::fs::create_dir_all(parent)?;
    let tmp = tempfile::NamedTempFile::new_in(parent)?;
    std::fs::write(tmp.path(), contents)?;
    sync_file(tmp.path())?;
    // persist 内部执行 rename，落在同一文件系统上保证原子性
    tmp.persist(path)
        .map_err(|e| AppError::Io(e.error))?;
    sync_dir(parent)?;
    Ok(())
}

fn sync_file(path: &Path) -> std::io::Result<()> {
    use std::os::unix::io::AsRawFd;
    // SAFETY: fd 来自刚打开的标准文件，仅用于 fsync
    let f = std::fs::File::open(path)?;
    let rc = unsafe { libc::fsync(f.as_raw_fd()) };
    if rc != 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

fn sync_dir(path: &Path) -> std::io::Result<()> {
    use std::os::unix::io::AsRawFd;
    let d = std::fs::File::open(path)?;
    let rc = unsafe { libc::fsync(d.as_raw_fd()) };
    if rc != 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

pub const MAX_SNAPSHOTS: usize = 30;

/// 保存编辑快照（spec §7.3：每次保存前保留最近 30 个本地快照）。
pub fn save_snapshot(resume_dir: &Path, content: &str) -> AppResult<()> {
    let snap_dir = resume_dir.join("snapshots");
    std::fs::create_dir_all(&snap_dir)?;
    let ts = chrono::Utc::now().format("%Y%m%dT%H%M%S%3fZ");
    std::fs::write(snap_dir.join(format!("{ts}.md")), content)?;
    prune_snapshots(&snap_dir, MAX_SNAPSHOTS)
}

pub fn prune_snapshots(snap_dir: &Path, keep: usize) -> AppResult<()> {
    let mut snaps: Vec<_> = std::fs::read_dir(snap_dir)?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().is_some_and(|x| x == "md"))
        .collect();
    if snaps.len() <= keep {
        return Ok(());
    }
    snaps.sort_by_key(|e| e.file_name());
    let to_remove = snaps.len() - keep;
    for entry in snaps.into_iter().take(to_remove) {
        std::fs::remove_file(entry.path())?;
    }
    Ok(())
}

/// 崩溃恢复扫描（spec §10.6）：`.pending` 文件按数据库登记情况处理。
/// 返回 (已恢复重命名数, 隔离数)。
pub fn recover_pending_files(
    ai_runs_dir: &Path,
    quarantine_dir: &Path,
    is_pending_registered: impl Fn(&str) -> bool,
) -> AppResult<(usize, usize)> {
    let mut renamed = 0;
    let mut quarantined = 0;
    if !ai_runs_dir.exists() {
        return Ok((0, 0));
    }
    for run_entry in std::fs::read_dir(ai_runs_dir)?.filter_map(|e| e.ok()) {
        let outputs = run_entry.path().join("outputs");
        if !outputs.exists() {
            continue;
        }
        for file in std::fs::read_dir(&outputs)?.filter_map(|e| e.ok()) {
            let path = file.path();
            let name = file.file_name().to_string_lossy().to_string();
            let Some(stem) = name.strip_suffix(".pending") else {
                continue;
            };
            if is_pending_registered(stem) {
                let target = outputs.join(stem);
                std::fs::rename(&path, target)?;
                renamed += 1;
            } else {
                std::fs::create_dir_all(quarantine_dir)?;
                let dest = quarantine_dir.join(format!(
                    "{}-{}",
                    run_entry.file_name().to_string_lossy(),
                    name
                ));
                std::fs::rename(&path, dest)?;
                quarantined += 1;
            }
        }
    }
    Ok((renamed, quarantined))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_creates_file() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("a/b/file.md");
        atomic_write(&path, b"hello").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"hello");
        // 覆盖写
        atomic_write(&path, b"world").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"world");
    }

    #[test]
    fn snapshot_pruning_keeps_latest() {
        let tmp = tempfile::tempdir().unwrap();
        let snap = tmp.path().join("snapshots");
        std::fs::create_dir_all(&snap).unwrap();
        for i in 0..35 {
            std::fs::write(snap.join(format!("20260101T00000{i:03}Z.md")), "x").unwrap();
        }
        save_snapshot(tmp.path(), "new").unwrap();
        let count = std::fs::read_dir(&snap).unwrap().count();
        assert_eq!(count, MAX_SNAPSHOTS);
    }

    #[test]
    fn pending_recovery() {
        let tmp = tempfile::tempdir().unwrap();
        let runs = tmp.path().join("ai-runs");
        let out1 = runs.join("run-1/outputs");
        let out2 = runs.join("run-2/outputs");
        std::fs::create_dir_all(&out1).unwrap();
        std::fs::create_dir_all(&out2).unwrap();
        std::fs::write(out1.join("jd-analysis.json.pending"), b"a").unwrap();
        std::fs::write(out2.join("orphan.json.pending"), b"b").unwrap();

        let (renamed, quarantined) = recover_pending_files(
            &runs,
            &tmp.path().join("quarantine"),
            |stem| stem == "jd-analysis.json",
        )
        .unwrap();

        assert_eq!(renamed, 1);
        assert_eq!(quarantined, 1);
        assert!(out1.join("jd-analysis.json").exists());
        assert!(tmp.path().join("quarantine/run-2-orphan.json.pending").exists());
    }

    #[test]
    fn sha256_matches_known_vector() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}

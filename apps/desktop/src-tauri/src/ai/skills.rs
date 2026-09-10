//! 内置 Skill 同步（spec §10.4）：首次启动及版本升级时同步到
//! `<app_data_dir>/workspace/.agents/skills`，不覆盖用户导入的目录。

use crate::infrastructure::paths::PathLayout;
use std::path::Path;

pub fn sync_builtin_skills(packaged_dir: &Path, layout: &PathLayout) -> Result<(), std::io::Error> {
    if !packaged_dir.exists() {
        return Ok(());
    }
    let skills_dir = layout.skills_dir();
    std::fs::create_dir_all(&skills_dir)?;
    for entry in std::fs::read_dir(packaged_dir)?.filter_map(|e| e.ok()) {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let dest = skills_dir.join(&name);
        // 应用管理的 Skill 按版本整体覆盖（目录内含 skill-lock 或 SKILL.json）
        if dest.exists() {
            std::fs::remove_dir_all(&dest)?;
        }
        copy_tree(&entry.path(), &dest)?;
    }
    Ok(())
}

fn copy_tree(src: &Path, dest: &Path) -> Result<(), std::io::Error> {
    std::fs::create_dir_all(dest)?;
    for entry in std::fs::read_dir(src)?.filter_map(|e| e.ok()) {
        let path = entry.path();
        let target = dest.join(entry.file_name());
        if path.is_dir() {
            copy_tree(&path, &target)?;
        } else {
            std::fs::copy(&path, &target)?;
        }
    }
    Ok(())
}

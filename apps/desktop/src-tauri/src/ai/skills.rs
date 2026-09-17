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

/// 应用内置 Skill 名称（禁止覆盖删除）。
pub const BUILTIN_SKILL_NAMES: [&str; 3] = [
    "jd-analyst",
    "company-researcher",
    "resume-tailor",
];

const MAX_SKILL_FILES: usize = 200;
const MAX_SKILL_BYTES: u64 = 20 * 1024 * 1024;

/// 从本地源目录导入 Skill：复制到 workspace/.agents/skills/<name>/。
/// 返回目标名。spec §10.4：同名需 replace 才覆盖；内置名一律拒绝。
pub fn import_skill_from_dir(
    source: &Path,
    skills_dir: &Path,
    replace: bool,
) -> Result<String, String> {
    if !source.is_dir() {
        return Err(format!("源目录不存在：{}", source.display()));
    }
    if !source.join("SKILL.md").is_file() {
        return Err("目录里缺少 SKILL.md（Skill 必须包含 SKILL.md）".into());
    }
    let name = source
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("目录名无效")?
        .trim()
        .to_string();
    if name.is_empty()
        || name.starts_with('.')
        || name.contains('/')
        || name.contains("..")
        || !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return Err(format!("Skill 名只能含字母/数字/-/_/.：{name}"));
    }
    if BUILTIN_SKILL_NAMES.contains(&name.as_str()) {
        return Err(format!("「{name}」是内置 Skill，不能覆盖"));
    }
    // 规模限制
    let mut files = 0usize;
    let mut total = 0u64;
    visit_files(source, &mut |p| {
        files += 1;
        total += p.metadata().map(|m| m.len()).unwrap_or(0);
        files <= MAX_SKILL_FILES && total <= MAX_SKILL_BYTES
    })
    .map_err(|e| e.to_string())?;
    if files > MAX_SKILL_FILES || total > MAX_SKILL_BYTES {
        return Err(format!("Skill 过大（{files} 个文件 / {total} 字节，上限 {MAX_SKILL_FILES} 个 / 20MB）"));
    }

    let dest = skills_dir.join(&name);
    if dest.exists() {
        if !replace {
            return Err(format!("同名 Skill 已存在：{name}（可选择替换）"));
        }
        std::fs::remove_dir_all(&dest).map_err(|e| e.to_string())?;
    }
    std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    copy_tree(source, &dest).map_err(|e| e.to_string())?;
    Ok(name)
}

/// 删除已导入的 Skill（内置名拒绝）。
pub fn delete_skill(skills_dir: &Path, name: &str) -> Result<(), String> {
    if BUILTIN_SKILL_NAMES.contains(&name) {
        return Err(format!("「{name}」是内置 Skill，不能删除"));
    }
    if name.is_empty() || name.contains('/') || name.contains("..") {
        return Err("非法 Skill 名".into());
    }
    let dest = skills_dir.join(name);
    if !dest.is_dir() {
        return Err(format!("Skill 不存在：{name}"));
    }
    std::fs::remove_dir_all(&dest).map_err(|e| e.to_string())?;
    Ok(())
}

fn visit_files(
    dir: &Path,
    f: &mut dyn FnMut(&Path) -> bool,
) -> std::io::Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            visit_files(&path, f)?;
        } else if !f(&path) {
            return Ok(()); // 超限即停止遍历
        }
    }
    Ok(())
}

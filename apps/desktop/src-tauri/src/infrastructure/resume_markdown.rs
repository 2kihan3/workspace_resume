//! Rust 侧简历 Markdown 校验（spec §7.2）。
//! 前端用 TS 版做完整 AST 校验与渲染，这里做保存前的服务端强校验。

use regex::Regex;

pub const RESUME_SCHEMA_VERSION: i64 = 1;
pub const SYSTEM_SECTION_IDS: [&str; 5] = ["basic", "experience", "projects", "education", "skills"];

const FORBIDDEN_TAGS: [&str; 11] = [
    "script", "iframe", "object", "embed", "form", "input", "button", "select", "textarea",
    "link", "meta",
];

#[derive(Debug, Default)]
pub struct ResumeMarkdownIssues {
    pub errors: Vec<String>,
}

impl ResumeMarkdownIssues {
    pub fn is_valid(&self) -> bool {
        self.errors.is_empty()
    }
}

/// 校验简历 Markdown。校验失败时不允许覆盖磁盘上的最后有效版本。
pub fn validate_resume_markdown(markdown: &str) -> ResumeMarkdownIssues {
    let mut issues = ResumeMarkdownIssues::default();
    let trimmed_start = markdown.trim_start();
    if !trimmed_start.starts_with("---") {
        issues.errors.push("缺少 frontmatter".into());
        return issues;
    }
    let rest = &trimmed_start[3..];
    let Some(end) = rest.find("\n---") else {
        issues.errors.push("frontmatter 未闭合".into());
        return issues;
    };
    let fm = rest[..end].trim();
    if !fm.contains("schemaVersion: 1") {
        issues.errors.push(format!("schemaVersion 只支持 {}", RESUME_SCHEMA_VERSION));
    }
    if !fm.contains("title:") || fm.contains("title: \"\"") || fm.contains("title: ''") {
        issues.errors.push("frontmatter 缺少 title".into());
    }

    let body = &rest[end + 4..];
    let section_re = Regex::new(r#"<!--\s*resume-section\s+id="([a-z][a-z0-9-]*)"\s*-->"#).unwrap();
    let mut ids: Vec<String> = vec![];
    for cap in section_re.captures_iter(body) {
        ids.push(cap[1].to_string());
    }
    if ids.is_empty() {
        issues.errors.push("未找到任何 resume-section 注释".into());
    }
    let mut sorted = ids.clone();
    sorted.sort();
    sorted.dedup();
    if sorted.len() != ids.len() {
        issues.errors.push("存在重复的 section id".into());
    }
    for required in SYSTEM_SECTION_IDS {
        if !ids.iter().any(|id| id == required) {
            issues.errors.push(format!("缺少系统 section：{required}"));
        }
    }
    for id in &ids {
        if !SYSTEM_SECTION_IDS.contains(&id.as_str()) {
            // 未知 id 作为自定义章节保留（spec §7.2），不报错
            let _ = id;
        }
    }

    let lower = body.to_lowercase();
    for tag in FORBIDDEN_TAGS {
        if lower.contains(&format!("<{tag}")) {
            issues.errors.push(format!("正文包含被禁止的 HTML 标签：<{tag}>"));
        }
    }
    if Regex::new(r"\son[a-z]+\s*=").unwrap().is_match(&lower) {
        issues.errors.push("正文包含事件处理属性".into());
    }
    issues
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::file_repo::sha256_hex;

    const VALID: &str = r#"---
schemaVersion: 1
title: 测试简历
locale: zh-CN
templateId: builtin.classic
---

<!-- resume-section id="basic" -->
## 基本信息

# 张三

<!-- resume-section id="experience" -->
## 工作经历

### 示例科技｜高级产品经理

2022.03 - 至今

- 负责具体业务。

<!-- resume-section id="projects" -->
## 项目经历

<!-- resume-section id="education" -->
## 教育经历

<!-- resume-section id="skills" -->
## 技能
"#;

    #[test]
    fn valid_document_passes() {
        let issues = validate_resume_markdown(VALID);
        assert!(issues.is_valid(), "{:?}", issues.errors);
    }

    #[test]
    fn missing_frontmatter_fails() {
        let issues = validate_resume_markdown("# 简历\n\n无 frontmatter");
        assert!(!issues.is_valid());
        assert!(issues.errors.iter().any(|e| e.contains("frontmatter")));
    }

    #[test]
    fn duplicate_section_fails() {
        let doc = VALID.replace(
            "<!-- resume-section id=\"education\" -->",
            "<!-- resume-section id=\"experience\" -->\n\n<!-- resume-section id=\"education\" -->",
        );
        let issues = validate_resume_markdown(&doc);
        assert!(issues.errors.iter().any(|e| e.contains("重复")));
    }

    #[test]
    fn missing_required_section_fails() {
        let doc = VALID.replace(
            "<!-- resume-section id=\"skills\" -->\n## 技能\n",
            "",
        );
        let issues = validate_resume_markdown(&doc);
        assert!(issues.errors.iter().any(|e| e.contains("skills")));
    }

    #[test]
    fn forbidden_html_fails() {
        let doc = VALID.replace("负责具体业务。", "<script>alert(1)</script>");
        let issues = validate_resume_markdown(&doc);
        assert!(issues.errors.iter().any(|e| e.contains("script")));
        assert_eq!(sha256_hex(VALID.as_bytes()).len(), 64);
    }

    #[test]
    fn event_handler_attr_fails() {
        let doc = VALID.replace("负责具体业务。", "<img src=x onerror=alert(1)>");
        let issues = validate_resume_markdown(&doc);
        assert!(issues.errors.iter().any(|e| e.contains("事件处理")));
    }
}

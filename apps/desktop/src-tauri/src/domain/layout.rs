//! 排版配置（CMS 容器模型）：页面设置 + 容器序列 + 主题。
//! 内容与排版解耦——section 容器只引用章节 ID，不复制内容。

use serde::{Deserialize, Serialize};
use specta::Type;

fn default_margin() -> f64 {
    14.0
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct PageSetup {
    /// 四边距（mm），容器区在剩余空间水平居中
    pub margin_top: f64,
    pub margin_right: f64,
    pub margin_bottom: f64,
    pub margin_left: f64,
    pub header_enabled: bool,
    pub header_height_mm: f64,
    /// 页眉文案（Markdown，单行段落即可）
    pub header_markdown: Option<String>,
    pub footer_enabled: bool,
    pub footer_height_mm: f64,
    pub footer_page_numbers: bool,
    pub footer_markdown: Option<String>,
}

impl Default for PageSetup {
    fn default() -> Self {
        Self {
            margin_top: default_margin(),
            margin_right: default_margin(),
            margin_bottom: default_margin(),
            margin_left: default_margin(),
            header_enabled: false,
            header_height_mm: 10.0,
            header_markdown: None,
            footer_enabled: false,
            footer_height_mm: 8.0,
            footer_page_numbers: false,
            footer_markdown: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct LayoutBlock {
    pub id: String,
    /// "section"（绑定 md 章节）| "text"（自由文案，内容在 markdown 字段）
    #[serde(rename = "type")]
    pub block_type: String,
    pub section_id: Option<String>,
    /// text 容器的 Markdown 内容
    pub markdown: Option<String>,
    /// 12 栅格宽度：12 | 8 | 6 | 4
    pub width: i32,
    pub hidden: bool,
    /// 卡片化（圆角浅底）
    pub card: bool,
    /// 浅色着色（rose/blue/indigo/…，None 为透明）
    pub tint: Option<String>,
    /// 自定义标题：None 用章节原文；Some("") 隐藏标题；其他为替换文本
    pub title_override: Option<String>,
    /// 字号档位："small" | "normal" | "large"（None 为 normal）
    pub size: Option<String>,
}

impl Default for LayoutBlock {
    fn default() -> Self {
        Self {
            id: String::new(),
            block_type: "section".into(),
            section_id: None,
            markdown: None,
            width: 12,
            hidden: false,
            card: false,
            tint: None,
            title_override: None,
            size: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct LayoutTheme {
    pub primary: String,
    /// "sans" | "serif"
    pub font: String,
    /// "compact" | "normal" | "airy"
    pub density: String,
}

impl Default for LayoutTheme {
    fn default() -> Self {
        Self {
            primary: "#0f766e".into(),
            font: "sans".into(),
            density: "normal".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct LayoutConfig {
    pub page: PageSetup,
    pub blocks: Vec<LayoutBlock>,
    pub theme: LayoutTheme,
}

impl LayoutConfig {
    /// 结构校验：block id 唯一、宽度合法、section 容器必须绑章节。
    pub fn validate(&self) -> Result<(), String> {
        let mut ids = std::collections::HashSet::new();
        for b in &self.blocks {
            if b.id.trim().is_empty() {
                return Err("容器 id 不能为空".into());
            }
            if !ids.insert(b.id.clone()) {
                return Err(format!("容器 id 重复：{}", b.id));
            }
            if ![12, 8, 6, 4].contains(&b.width) {
                return Err(format!("容器 {} 宽度非法：{}", b.id, b.width));
            }
            if b.block_type == "section" && b.section_id.as_deref().unwrap_or("").is_empty() {
                return Err(format!("section 容器 {} 缺少章节绑定", b.id));
            }
            if b.block_type == "text" && b.markdown.is_none() {
                return Err(format!("text 容器 {} 缺少内容", b.id));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_accepts_minimal_config() {
        let cfg = LayoutConfig {
            blocks: vec![LayoutBlock {
                id: "b1".into(),
                block_type: "section".into(),
                section_id: Some("basic".into()),
                ..Default::default()
            }],
            ..Default::default()
        };
        assert!(cfg.validate().is_ok());
    }

    #[test]
    fn validate_rejects_duplicates_and_missing_binding() {
        let mk = || LayoutBlock {
            id: "b1".into(),
            block_type: "section".into(),
            section_id: Some("basic".into()),
            ..Default::default()
        };
        let dup = LayoutConfig {
            blocks: vec![mk(), mk()],
            ..Default::default()
        };
        assert!(dup.validate().is_err());

        let unbound = LayoutConfig {
            blocks: vec![LayoutBlock {
                id: "b2".into(),
                block_type: "section".into(),
                ..Default::default()
            }],
            ..Default::default()
        };
        assert!(unbound.validate().is_err());
    }

    #[test]
    fn serde_camel_case_roundtrip() {
        let cfg = LayoutConfig::default();
        let json = serde_json::to_string(&cfg).unwrap();
        assert!(json.contains("marginTop"));
        let back: LayoutConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(back.page.margin_top, cfg.page.margin_top);
    }
}

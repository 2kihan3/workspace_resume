-- 0002_layout_config.sql —— 排版配置（CMS 容器模型）
-- 内容仍在 Markdown（唯一可信源），本列只存呈现层：容器顺序/宽度/主题/页面设置。

ALTER TABLE resumes ADD COLUMN layout_config TEXT;

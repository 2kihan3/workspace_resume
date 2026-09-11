/**
 * 模板缩略图/预览用的示例简历数据（参考 magic-resume 的产品行为）。
 * 走完整协议解析管线，保证缩略图与真实渲染一致。
 */
import { renderResumeForTemplate } from "@jsw/markdown-resume";
import type { TemplateContextV1 } from "@jsw/domain";

export const MOCK_RESUME_MARKDOWN = `---
schemaVersion: 1
title: 张三 · 产品经理
locale: zh-CN
templateId: mock
---

<!-- resume-section id="basic" -->
## 基本信息

# 张三

产品经理 · 5 年经验

- 邮箱：zhangsan@example.com
- 电话：138 0000 0000
- 城市：上海

<!-- resume-section id="experience" -->
## 工作经历

### 示例科技｜高级产品经理

2022.03 - 至今

- 负责核心业务线产品规划，年度营收增长 40%
- 主导跨部门协作流程优化，需求交付周期缩短 30%

### 星海网络｜产品经理

2019.07 - 2022.02

- 从 0 到 1 搭建会员增长体系，注册转化率提升 25%
- 建立数据看板体系，支撑每周运营决策

<!-- resume-section id="projects" -->
## 项目经历

### 智能简历助手

2023.05 - 2024.02

- 负责 AI 功能的产品定义与落地，周活跃用户 10 万+
- 设计结构化解析方案，简历解析准确率达 95%

<!-- resume-section id="education" -->
## 教育经历

### 复旦大学｜软件工程 本科

2015.09 - 2019.06

- 主修课程：数据结构、人机交互、软件工程

<!-- resume-section id="skills" -->
## 技能

- **产品设计**：需求分析、原型设计、数据分析
- **工具**：Figma、SQL、Python、Notion
- **语言**：中文（母语）、英语（流利）
`;

let cachedContext: TemplateContextV1 | null = null;

/** 示例简历的模板上下文（模块级缓存，避免重复解析）。 */
export function mockTemplateContext(): TemplateContextV1 {
  if (!cachedContext) {
    const rendered = renderResumeForTemplate(MOCK_RESUME_MARKDOWN);
    cachedContext = {
      document: {
        title: rendered.frontmatter?.title ?? "简历预览",
        locale: rendered.frontmatter?.locale ?? "zh-CN",
      },
      resume: { bodyHtml: rendered.bodyHtml },
      sections: rendered.sectionsHtml,
    };
  }
  return cachedContext;
}

/**
 * 把模板 HTML 里的 <link rel="stylesheet" href="style.css"> 内联为 <style>，
 * 使其在 iframe srcdoc（无 baseURL）中可用。带 assets 的导入模板会缺失图片，
 * 属可接受降级（静态预览图在第三批补齐）。
 */
export function inlineTemplateCss(html: string, css: string): string {
  const styleTag = `<style>\n${css}\n</style>`;
  const linkRe = /<link[^>]*href=["']style\.css["'][^>]*>/;
  if (linkRe.test(html)) {
    return html.replace(linkRe, styleTag);
  }
  // 没有 link 标签时注入到 </head> 前，或文档开头
  if (html.includes("</head>")) {
    return html.replace("</head>", `${styleTag}\n</head>`);
  }
  return styleTag + html;
}

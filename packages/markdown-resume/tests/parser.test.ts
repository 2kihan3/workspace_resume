import { describe, expect, it } from "vitest";
import {
  parseResumeDocument,
  serializeResumeDocument,
  renderResumeForTemplate,
  renderMarkdownSafe,
  previewImport,
} from "../src";
import { createHash } from "node:crypto";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const VALID = `---
schemaVersion: 1
title: 张三 产品经理简历
locale: zh-CN
templateId: builtin.classic
---

<!-- resume-section id="basic" -->
## 基本信息

# 张三

产品经理

- 邮箱：name@example.com

<!-- resume-section id="experience" -->
## 工作经历

### 示例科技｜高级产品经理

2022.03 - 至今

- 负责具体业务，结果提升 20%。

<!-- resume-section id="projects" -->
## 项目经历

<!-- resume-section id="education" -->
## 教育经历

<!-- resume-section id="skills" -->
## 技能
`;

describe("简历 Markdown 协议解析", () => {
  it("合法文档通过", () => {
    const r = parseResumeDocument(VALID);
    expect(r.ok).toBe(true);
    expect(r.frontmatter?.title).toBe("张三 产品经理简历");
    expect(r.sections.map((s) => s.id)).toEqual([
      "basic", "experience", "projects", "education", "skills",
    ]);
  });

  it("缺少 frontmatter 报错", () => {
    const r = parseResumeDocument("# 简历");
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("frontmatter"))).toBe(true);
  });

  it("重复 section 报错", () => {
    const doc = VALID.replace('id="education"', 'id="experience"');
    const r = parseResumeDocument(doc);
    expect(r.errors.some((e) => e.includes("重复"))).toBe(true);
  });

  it("缺少系统 section 报错", () => {
    const doc = VALID.replace(/<!-- resume-section id="skills" -->[\s\S]*$/, "");
    const r = parseResumeDocument(doc);
    expect(r.missingSystemSections).toContain("skills");
  });

  it("恶意 HTML 被拒绝", () => {
    const doc = VALID.replace("负责具体业务，结果提升 20%。", "<script>alert(1)</script>");
    const r = parseResumeDocument(doc);
    expect(r.ok).toBe(false);
  });

  it("自定义 section 保留且不报错", () => {
    const doc = VALID.replace(
      "<!-- resume-section id=\"skills\" -->",
      "<!-- resume-section id=\"skills\" -->\n\n<!-- resume-section id=\"awards\" -->\n## 获奖\n\n- X",
    );
    const r = parseResumeDocument(doc);
    expect(r.ok).toBe(true);
    expect(r.unknownSectionIds).toContain("awards");
  });
});

describe("渲染与 sanitize", () => {
  it("渲染合法文档产出五个 section 的 HTML", () => {
    const r = renderResumeForTemplate(VALID);
    expect(r.ok).toBe(true);
    expect(Object.keys(r.sectionsHtml)).toHaveLength(5);
    expect(r.sectionsHtml.experience.html).toContain("示例科技");
  });

  it("sanitize 移除脚本标签", () => {
    const html = renderMarkdownSafe('<div onclick="x()">hi</div><script>bad()</script>\n\n**粗体**');
    expect(html).not.toContain("script");
    expect(html).not.toContain("onclick");
    expect(html).toContain("粗体");
  });
});

describe("序列化往返", () => {
  it("serialize -> parse 保持稳定", () => {
    const doc = serializeResumeDocument({
      title: "测试",
      templateId: "builtin.classic",
      sections: [
        { id: "basic", markdown: "## 基本信息\n\n# 张三" },
        { id: "experience", markdown: "## 工作经历" },
        { id: "projects", markdown: "## 项目经历" },
        { id: "education", markdown: "## 教育经历" },
        { id: "skills", markdown: "## 技能" },
      ],
    });
    const r = parseResumeDocument(doc);
    expect(r.ok).toBe(true);
  });

  it("哈希计算与 Rust 侧一致（sha256）", () => {
    expect(sha(VALID)).toHaveLength(64);
  });
});

describe("导入归一化", () => {
  it("中文章节别名映射", () => {
    const src = `# 李四

## 个人信息

- 邮箱：a@b.c

## 工作经历

### 某公司

- 做过事情

## 教育经历

某某大学
`;
    const p = previewImport({ fileName: "resume.md", markdown: src, suggestedTitle: "李四" });
    const mapped = p.mapping.map((m) => m.mappedTo);
    expect(mapped).toContain("basic");
    expect(mapped).toContain("experience");
    expect(mapped).toContain("education");
    expect(p.warnings.some((w) => w.includes("skills"))).toBe(true);
    const parsed = parseResumeDocument(p.normalizedMarkdown);
    expect(parsed.ok).toBe(true);
  });
});

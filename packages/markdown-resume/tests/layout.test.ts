import { describe, expect, it } from "vitest";
import {
  renderLayoutDocument,
  defaultLayoutFor,
  layoutPageCss,
  defaultPageSetup,
} from "../src/layout";

const MD = `---
schemaVersion: 1
title: 张三
locale: zh-CN
templateId: builtin.classic
---

<!-- resume-section id="basic" -->
## 基本信息

# 张三

- 邮箱：z@x.com

<!-- resume-section id="experience" -->
## 工作经历

### 某公司

- 做事

<!-- resume-section id="projects" -->
## 项目经历

<!-- resume-section id="education" -->
## 教育经历

<!-- resume-section id="skills" -->
## 技能
`;

describe("布局渲染器", () => {
  it("默认布局渲染五个章节", () => {
    const layout = defaultLayoutFor(MD);
    const r = renderLayoutDocument(MD, layout);
    expect(r.ok).toBe(true);
    expect(r.html).toContain("data-block-id=\"blk-basic\"");
    expect(r.html).toContain("张三");
    expect(r.missingSectionIds).toHaveLength(0);
  });

  it("隐藏容器不渲染且计入未摆放", () => {
    const layout = defaultLayoutFor(MD);
    layout.blocks = layout.blocks.map((b) =>
      b.id === "blk-projects" ? { ...b, hidden: true } : b,
    );
    const r = renderLayoutDocument(MD, layout);
    expect(r.ok).toBe(true);
    expect(r.html).not.toContain('data-block-id="blk-projects"');
    expect(r.missingSectionIds).toContain("projects");
  });

  it("宽度/卡片/tint 类名正确", () => {
    const layout = defaultLayoutFor(MD);
    layout.blocks = layout.blocks.map((b, i) => ({
      ...b,
      width: (i % 2 === 0 ? 8 : 4) as 8 | 4,
      card: i === 0,
      tint: i === 0 ? "rose" : null,
    }));
    const r = renderLayoutDocument(MD, layout);
    expect(r.html).toContain("w-8");
    expect(r.html).toContain("w-4");
    expect(r.html).toContain("card tint-rose");
  });

  it("主题色/密度注入 CSS 变量", () => {
    const layout = defaultLayoutFor(MD);
    layout.theme = { primary: "#e11d48", font: "serif", density: "compact" };
    const r = renderLayoutDocument(MD, layout);
    expect(r.html).toContain("--jsw-primary: #e11d48");
    expect(r.html).toContain("Georgia");
  });

  it("页眉页脚与边距", () => {
    const layout = defaultLayoutFor(MD);
    layout.page = {
      ...defaultPageSetup(),
      marginTop: 20,
      headerEnabled: true,
      headerMarkdown: "张三 · 产品经理",
      footerEnabled: true,
      footerPageNumbers: true,
    };
    const r = renderLayoutDocument(MD, layout);
    expect(r.html).toContain("jsw-header");
    expect(r.html).toContain("张三 · 产品经理");
    expect(r.html).toContain("jsw-footer");
    expect(layoutPageCss(layout)).toContain("margin: 20mm");
  });

  it("无效文档返回错误不产出 HTML", () => {
    const r = renderLayoutDocument("# 坏文档", defaultLayoutFor(MD));
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

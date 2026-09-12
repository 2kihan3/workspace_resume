import { describe, expect, it } from "vitest";
import { renderLayoutDocument, defaultLayoutFor } from "../src/layout";

const MD = `---
schemaVersion: 1
title: t
locale: zh-CN
templateId: builtin.timeline
---

<!-- resume-section id="basic" -->
## 基本信息

# 张三

- a@b.c

<!-- resume-section id="experience" -->
## 工作经历

- x

<!-- resume-section id="projects" -->
## 项目经历

- y

<!-- resume-section id="education" -->
## 教育经历

- z

<!-- resume-section id="skills" -->
## 技能

- s
`;

describe("时间轴 hang 线段", () => {
  it("dot 单栏：非页头 section 挂轴并首末收口，页头块不挂轴", () => {
    const layout = defaultLayoutFor(MD);
    layout.theme.heading = "dot";
    const r = renderLayoutDocument(MD, layout);
    expect(r.html).toMatch(/class="[^"]*hang-first"/);
    expect(r.html).toMatch(/class="[^"]*hang-last"/);
    expect(r.html).toContain('class="jsw-b w-12 hero"');
    expect(r.html).not.toMatch(/class="[^"]*hero[^"]*hang[^"]*"/);
  });

  it("bar 版式不挂轴", () => {
    const layout = defaultLayoutFor(MD);
    layout.theme.heading = "bar";
    const r = renderLayoutDocument(MD, layout);
    expect(r.html).not.toMatch(/class="[^"]*hang/);
  });
});

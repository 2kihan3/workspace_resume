import { describe, expect, it } from "vitest";
import {
  renderTemplate,
  TemplateManifestSchema,
  pageCss,
} from "../src/render";
import type { TemplateContextV1 } from "@jsw/domain";

const manifest = TemplateManifestSchema.parse({
  schemaVersion: 1,
  id: "author.demo",
  name: "演示",
  author: "作者",
  version: "1.0.0",
  entry: "template.html",
  style: "style.css",
  supportedLocales: ["zh-CN"],
  page: { size: "A4", marginMm: [12, 12, 12, 12] },
});

const ctx: TemplateContextV1 = {
  document: { title: "张三", locale: "zh-CN" },
  resume: { bodyHtml: "<p>正文</p>" },
  sections: { experience: { title: "工作经历", html: "<h2>工作经历</h2>" } },
};

describe("Handlebars strict 模板渲染", () => {
  it("合法上下文渲染成功", () => {
    const r = renderTemplate({
      manifest,
      templateHtml: "<h1>{{document.title}}</h1>{{resume.bodyHtml}}",
      context: ctx,
    });
    expect(r.ok).toBe(true);
    expect(r.html).toContain("张三");
    expect(r.html).toContain("正文");
  });

  it("HTML 插值不被转义（bodyHtml/sections 原样输出排版标签）", () => {
    const r = renderTemplate({
      manifest,
      templateHtml: "<main>{{resume.bodyHtml}}{{sections.experience.html}}</main>",
      context: ctx,
    });
    expect(r.ok).toBe(true);
    // 核心回归：模板协议 §8.2 的双花括号写法必须输出未转义的 HTML
    expect(r.html).toContain("<p>正文</p>");
    expect(r.html).toContain("<h2>工作经历</h2>");
    expect(r.html).not.toContain("&lt;p&gt;");
  });

  it("document.title 中的 HTML 被转义（防注入）", () => {
    const r = renderTemplate({
      manifest,
      templateHtml: "<h1>{{document.title}}</h1>",
      context: { ...ctx, document: { ...ctx.document, title: '<script>x</script>' } },
    });
    expect(r.ok).toBe(true);
    expect(r.html).toContain("&lt;script&gt;");
    expect(r.html).not.toContain("<script>");
  });

  it("缺失变量报错（strict mode）", () => {
    const r = renderTemplate({
      manifest,
      templateHtml: "{{sections.education.html}}",
      context: ctx,
    });
    expect(r.ok).toBe(false);
  });

  it("manifest 校验拒绝非法 id 与 entry", () => {
    expect(
      TemplateManifestSchema.safeParse({ ...manifest, id: "bad" }).success,
    ).toBe(false);
    expect(
      TemplateManifestSchema.safeParse({ ...manifest, entry: "evil.html" }).success,
    ).toBe(false);
  });

  it("pageCss 生成 @page 规则", () => {
    expect(pageCss(manifest)).toContain("@page { size: A4; margin: 12mm 12mm 12mm 12mm; }");
  });
});

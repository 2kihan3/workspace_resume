import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/constants";
import { inlineTemplateCss } from "../lib/mock-resume";
import { renderTemplate, TemplateManifestSchema } from "@jsw/template-engine";
import { renderResumeForTemplate, renderLayoutCanvas } from "@jsw/markdown-resume";
import { A4Preview } from "./A4Preview";

/**
 * 简历卡片缩略图：按简历自身 template_id 套模板渲染（A4 等比缩放）。
 * 文档无效或模板缺失时降级为纯 Markdown 渲染（不套模板）。
 */
export function ResumeThumb({ markdown, templateId, title, resumeId }: {
  markdown: string;
  templateId: string;
  title: string;
  resumeId?: string;
}) {
  const layout = useQuery({
    queryKey: ["layout", resumeId],
    queryFn: () => api.getLayout(resumeId!),
    enabled: !!resumeId,
    staleTime: Infinity,
    retry: false,
  });
  const assets = useQuery({
    queryKey: ["template-assets", templateId],
    queryFn: () => api.readTemplateAssets(templateId),
    staleTime: Infinity,
    retry: false,
  });

  const layoutRender = useMemo(() => {
    if (!layout.data || !markdown) return null;
    const r = renderLayoutCanvas(markdown, layout.data);
    return r.ok && r.content && r.css ? r : null;
  }, [layout.data, markdown]);

  const html = useMemo(() => {
    const rendered = renderResumeForTemplate(markdown);
    if (!rendered.ok) {
      // 无效文档：不产出预览（编辑器才是修复入口）
      return null;
    }
    const context = {
      document: {
        title: rendered.frontmatter?.title ?? title,
        locale: rendered.frontmatter?.locale ?? "zh-CN",
      },
      resume: { bodyHtml: rendered.bodyHtml },
      sections: rendered.sectionsHtml,
    };
    if (assets.data) {
      try {
        const manifest = TemplateManifestSchema.parse(
          JSON.parse(assets.data.manifest_json),
        );
        const result = renderTemplate({
          manifest,
          templateHtml: inlineTemplateCss(
            assets.data.template_html,
            assets.data.style_css,
          ),
          context,
        });
        if (result.ok && result.html) return result.html;
      } catch {
        // 落入降级路径
      }
    }
    // 降级：无模板的裸文档预览
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      body{margin:0;font-family:-apple-system,"PingFang SC",sans-serif;color:#222;
      font-size:10.5pt;line-height:1.55;padding:40px 44px;}
      h1{font-size:19pt;margin:0 0 8pt}h2{font-size:12pt;margin:12pt 0 4pt;
      border-bottom:1pt solid #333;padding-bottom:2pt}h3{font-size:10.5pt;margin:8pt 0 2pt}
      ul{margin:2pt 0;padding-left:14pt}a{color:#1d4ed8}
    </style></head><body>${rendered.bodyHtml}</body></html>`;
  }, [markdown, assets.data, title]);

  if (layoutRender) {
    return (
      <div className="relative w-full overflow-hidden bg-white" style={{ aspectRatio: "210 / 297" }}>
        <div style={{ width: 794, transformOrigin: "top left", transform: "scale(var(--thumb-scale, 0.3))" }}>
          <div className="jsw-canvas" style={{ width: 794 }}>
            <style>{layoutRender.css}</style>
            <div
              ref={(el) => {
                if (el?.parentElement?.parentElement) {
                  const w = el.parentElement.parentElement.clientWidth;
                  el.parentElement.parentElement.style.setProperty("--thumb-scale", String(w / 794));
                }
              }}
              dangerouslySetInnerHTML={{ __html: layoutRender.content || "" }}
            />
          </div>
        </div>
      </div>
    );
  }
  if (!html) {
    return (
      <div
        className="flex w-full items-center justify-center bg-zinc-100 text-sm text-zinc-400 dark:bg-zinc-800/60"
        style={{ aspectRatio: "210 / 297" }}
      >
        文档无效，进入编辑器修复
      </div>
    );
  }
  return <A4Preview html={html} title={`${title} 预览`} />;
}

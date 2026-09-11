import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/constants";
import { mockTemplateContext, inlineTemplateCss } from "../lib/mock-resume";
import { renderTemplate, TemplateManifestSchema } from "@jsw/template-engine";
import { A4Preview } from "./A4Preview";

/**
 * 模板缩略图：示例简历数据 + 模板引擎渲染，A4 等比缩放。
 * 模板资产缺失/渲染失败时降级为占位样式。
 */
export function TemplateThumb({ templateId }: { templateId: string }) {
  const assets = useQuery({
    queryKey: ["template-assets", templateId],
    queryFn: () => api.readTemplateAssets(templateId),
    staleTime: Infinity,
  });

  const html = useMemo(() => {
    if (!assets.data) return null;
    try {
      const manifest = TemplateManifestSchema.parse(
        JSON.parse(assets.data.manifest_json),
      );
      const result = renderTemplate({
        manifest,
        templateHtml: inlineTemplateCss(assets.data.template_html, assets.data.style_css),
        context: mockTemplateContext(),
      });
      return result.ok ? result.html : null;
    } catch {
      return null;
    }
  }, [assets.data]);

  if (assets.isLoading) {
    return (
      <div className="w-full animate-pulse bg-zinc-200 dark:bg-zinc-800" style={{ aspectRatio: "210 / 297" }} />
    );
  }
  if (!html) {
    return (
      <div
        className="flex w-full items-center justify-center bg-zinc-100 text-sm text-zinc-400 dark:bg-zinc-800/60"
        style={{ aspectRatio: "210 / 297" }}
      >
        预览不可用
      </div>
    );
  }
  return <A4Preview html={html} title={`模板 ${templateId} 预览`} />;
}

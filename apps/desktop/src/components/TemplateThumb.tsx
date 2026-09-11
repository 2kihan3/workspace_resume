import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/constants";
import { mockTemplateContext, inlineTemplateCss } from "../lib/mock-resume";
import { renderTemplate, TemplateManifestSchema } from "@jsw/template-engine";
import { A4Preview } from "./A4Preview";

/**
 * 模板缩略图：优先使用静态预览图（spec §8.3，由快照生成），
 * 未生成时降级为示例数据实时渲染（iframe srcdoc，CSS 内联）。
 */
export function TemplateThumb({ templateId }: { templateId: string }) {
  const preview = useQuery({
    queryKey: ["template-preview", templateId],
    queryFn: () => api.readTemplatePreview(templateId),
    staleTime: Infinity,
    retry: false,
  });
  const assets = useQuery({
    queryKey: ["template-assets", templateId],
    queryFn: () => api.readTemplateAssets(templateId),
    staleTime: Infinity,
    retry: false,
  });

  const html = useMemo(() => {
    if (!assets.data || preview.data) return null;
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
  }, [assets.data, preview.data]);

  if (preview.data) {
    return (
      <img
        src={preview.data}
        alt={`模板 ${templateId} 预览`}
        className="w-full bg-white object-cover"
        style={{ aspectRatio: "210 / 297" }}
      />
    );
  }
  if (assets.isLoading || (preview.isLoading && !assets.data)) {
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

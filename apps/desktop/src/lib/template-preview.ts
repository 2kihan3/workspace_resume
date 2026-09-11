/**
 * 模板静态预览图生成（spec §8.3）：
 * 前端用示例数据渲染模板 HTML（保留 <link> 标签，WKWebView 以模板目录为
 * baseURL 解析相对路径），Rust 快照为 PNG 写入 preview_path。
 */
import { useQueryClient } from "@tanstack/react-query";
import { api } from "./ipc";
import { mockTemplateContext } from "./mock-resume";
import { renderTemplate, TemplateManifestSchema } from "@jsw/template-engine";

/** 本次会话已尝试过的模板（失败不重试，避免循环） */
const attempted = new Set<string>();

export function previewAttempted(templateId: string): boolean {
  return attempted.has(templateId);
}

/** 渲染并生成某模板的静态预览图。force 跳过会话内去重（手动重新生成用）。 */
export async function generateTemplatePreview(
  templateId: string,
  force = false,
): Promise<void> {
  if (!force && attempted.has(templateId)) return;
  attempted.add(templateId);
  const assets = await api.readTemplateAssets(templateId);
  const manifest = TemplateManifestSchema.parse(JSON.parse(assets.manifest_json));
  const result = renderTemplate({
    manifest,
    // 不内联 CSS：快照走 WKWebView baseURL
    templateHtml: assets.template_html,
    context: mockTemplateContext(),
  });
  if (!result.ok || !result.html) {
    throw new Error(result.errors.join("；"));
  }
  await api.saveTemplatePreview(templateId, result.html);
}

/** React hook 版本：生成后自动刷新列表与预览缓存。 */
export function useGenerateTemplatePreview() {
  const qc = useQueryClient();
  return async (templateId: string, force = true) => {
    await generateTemplatePreview(templateId, force);
    await qc.invalidateQueries({ queryKey: ["templates"] });
    await qc.invalidateQueries({ queryKey: ["template-preview", templateId] });
  };
}

import Handlebars from "handlebars";
import { z } from "zod";
import type { TemplateContextV1 } from "@jsw/domain";

/** manifest.json schema（spec §8.1）。 */
export const TemplateManifestSchema = z.object({
  schemaVersion: z.literal(1),
  id: z
    .string()
    .regex(/^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/, "模板 id 必须形如 author.template-name"),
  name: z.string().min(1),
  description: z.string().optional(),
  author: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  entry: z.string().refine((s) => s === "template.html", "entry 必须是 template.html"),
  style: z.string().refine((s) => s === "style.css", "style 必须是 style.css"),
  supportedLocales: z.array(z.string()).min(1),
  page: z.object({
    size: z.enum(["A4"]),
    marginMm: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  }),
});
export type TemplateManifest = z.infer<typeof TemplateManifestSchema>;

export interface TemplateRenderInput {
  manifest: TemplateManifest;
  templateHtml: string;
  context: TemplateContextV1;
}

export interface TemplateRenderResult {
  ok: boolean;
  html: string | null;
  errors: string[];
}

/**
 * 使用 Handlebars strict mode 渲染模板（spec §8.2）。
 * 不注册任何自定义 helper；缺失字段即失败。
 */
export function renderTemplate(input: TemplateRenderInput): TemplateRenderResult {
  const errors: string[] = [];
  let template: HandlebarsTemplateDelegate;
  try {
    template = Handlebars.compile(input.templateHtml, {
      strict: true,
      noEscape: false,
      preventIndent: true,
    });
  } catch (e) {
    return { ok: false, html: null, errors: [`模板编译失败：${(e as Error).message}`] };
  }
  try {
    const html = template(input.context);
    return { ok: true, html, errors };
  } catch (e) {
    errors.push(`模板渲染失败：${(e as Error).message}`);
    return { ok: false, html: null, errors };
  }
}

/** 生成 @page CSS（PDF 导出时注入，spec §9）。 */
export function pageCss(manifest: TemplateManifest): string {
  const [top, right, bottom, left] = manifest.page.marginMm;
  return `@page { size: ${manifest.page.size}; margin: ${top}mm ${right}mm ${bottom}mm ${left}mm; }`;
}

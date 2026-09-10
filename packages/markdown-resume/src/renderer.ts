import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import { parseResumeDocument, splitSections } from "./parser";

const allowlist = {
  ...defaultSchema,
  tagNames: (defaultSchema.tagNames ?? []).filter(
    (t) => !["script", "iframe", "object", "embed", "form", "input", "button", "select", "textarea", "style", "link", "meta", "base"].includes(t),
  ),
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "mailto", "tel"],
    src: ["data", "http", "https"],
  },
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "className"],
  },
};

/** 逐段渲染 section markdown -> sanitized HTML。 */
export function renderSectionHtml(markdown: string): string {
  const pipeline = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
       .use(rehypeSanitize, allowlist)
    .use(rehypeStringify);
  const file = pipeline.processSync(markdown);
  return String(file);
}

export interface RenderedResume {
  frontmatter: { title: string; locale: string; templateId: string } | null;
  sectionsHtml: Record<string, { title: string; html: string }>;
  bodyHtml: string;
  parseErrors: string[];
  ok: boolean;
}

/**
 * 将整份简历渲染为模板上下文（spec §8.2 TemplateContextV1）。
 * 解析失败时返回 ok=false 与 errors，不产出部分 HTML 供正式导出。
 */
export function renderResumeForTemplate(markdown: string): RenderedResume {
  const parsed = parseResumeDocument(markdown);
  const sectionsHtml: Record<string, { title: string; html: string }> = {};
  if (parsed.ok) {
    const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
    const { sections } = splitSections(body);
    for (const s of sections) {
      const meta = parsed.sections.find((p) => p.id === s.id);
      sectionsHtml[s.id] = {
        title: meta?.title ?? s.id,
        html: renderSectionHtml(s.markdown),
      };
    }
  }
  return {
    frontmatter: parsed.frontmatter
      ? {
          title: parsed.frontmatter.title,
          locale: parsed.frontmatter.locale,
          templateId: parsed.frontmatter.templateId,
        }
      : null,
    sectionsHtml,
    bodyHtml: parsed.ok
      ? Object.values(sectionsHtml)
          .map((s) => s.html)
          .join("\n")
      : "",
    parseErrors: parsed.errors,
    ok: parsed.ok,
  };
}

/** 纯 GFM 渲染（供预览组件使用，输出已 sanitize）。 */
export function renderMarkdownSafe(markdown: string): string {
  const pipeline = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
       .use(rehypeSanitize, allowlist)
    .use(rehypeStringify);
  return String(pipeline.processSync(markdown));
}

import YAML from "yaml";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root, Heading, Html } from "mdast";
import { visit } from "unist-util-visit";
import {
  RESUME_SCHEMA_VERSION,
  SECTION_ID_PATTERN,
  SYSTEM_SECTION_IDS,
  type ParsedResumeSection,
  type ResumeFrontmatter,
  type ResumeParseResult,
  type SystemSectionId,
} from "@jsw/domain";

const SECTION_COMMENT = /<!--\s*resume-section\s+id="([a-z][a-z0-9-]*)"\s*-->/;

const FORBIDDEN_HTML_TAGS = [
  "script",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "link",
  "meta",
  "base",
];

const parser = unified().use(remarkParse).use(remarkGfm);

/** 解析 YAML frontmatter；缺失或非法返回 null 并记录错误。 */
export function parseFrontmatter(
  markdown: string,
  errors: string[],
): ResumeFrontmatter | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(markdown);
  if (!match) {
    errors.push("缺少 frontmatter（文件必须以 --- 开头）");
    return null;
  }
  let data: Record<string, unknown>;
  try {
    const doc = YAML.parse(match[1]);
    if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
      throw new Error("frontmatter 不是对象");
    }
    data = doc as Record<string, unknown>;
  } catch (e) {
    errors.push(`frontmatter 解析失败：${(e as Error).message}`);
    return null;
  }
  const fm: ResumeFrontmatter = {
    schemaVersion: data.schemaVersion as number,
    title: typeof data.title === "string" ? data.title : "",
    locale: typeof data.locale === "string" ? data.locale : "zh-CN",
    templateId: typeof data.templateId === "string" ? data.templateId : "",
  };
  if (fm.schemaVersion !== RESUME_SCHEMA_VERSION) {
    errors.push(`schemaVersion 只支持 ${RESUME_SCHEMA_VERSION}`);
  }
  if (!fm.title.trim()) {
    errors.push("frontmatter 缺少 title");
  }
  return fm;
}

/** 按 resume-section 注释切分正文；无注释的内容进入 preamble。 */
export function splitSections(
  body: string,
): { preamble: string; sections: Array<{ id: string; markdown: string }> } {
  const lines = body.split(/\r?\n/);
  const sections: Array<{ id: string; markdown: string }> = [];
  const preambleLines: string[] = [];
  let current: { id: string; lines: string[] } | null = null;
  for (const line of lines) {
    const m = SECTION_COMMENT.exec(line);
    if (m) {
      if (current) sections.push({ id: current.id, markdown: current.lines.join("\n") });
      current = { id: m[1], lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
    else preambleLines.push(line);
  }
  if (current) sections.push({ id: current.id, markdown: current.lines.join("\n") });
  return { preamble: preambleLines.join("\n"), sections };
}

function extractHeadingText(node: Heading): string {
  let text = "";
  const walk = (n: unknown) => {
    if (typeof n !== "object" || n === null || !("type" in n)) return;
    const typed = n as { type: string; value?: string; children?: unknown[] };
    if (typed.type === "text") text += typed.value ?? "";
    for (const child of typed.children ?? []) walk(child);
  };
  for (const child of node.children) walk(child);
  return text.trim();
}

/**
 * 校验并解析符合协议（spec §7）的简历 Markdown。
 * 纯函数，不访问文件系统。
 */
export function parseResumeDocument(markdown: string): ResumeParseResult {
  const errors: string[] = [];
  const fm = parseFrontmatter(markdown, errors);
  const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  const { preamble, sections: rawSections } = splitSections(body);

  const seen = new Set<string>();
  const duplicateSectionIds: string[] = [];
  const unknownSectionIds: string[] = [];
  const sections: ParsedResumeSection[] = [];

  if (preamble.trim()) {
    errors.push("frontmatter 之后、第一个 section 注释之前存在游离内容");
  }

  for (const raw of rawSections) {
    if (!SECTION_ID_PATTERN.test(raw.id)) {
      errors.push(`非法 section id：${raw.id}`);
      continue;
    }
    if (seen.has(raw.id)) {
      duplicateSectionIds.push(raw.id);
      errors.push(`section id 重复：${raw.id}`);
      continue;
    }
    seen.add(raw.id);
    if (!SYSTEM_SECTION_IDS.includes(raw.id as SystemSectionId)) {
      unknownSectionIds.push(raw.id);
    }
    // 提取该 section 的第一个标题作为显示标题
    const tree = parser.parse(raw.markdown) as Root;
    let title = raw.id;
    for (const node of tree.children) {
      if (node.type === "heading") {
        title = extractHeadingText(node) || raw.id;
        break;
      }
    }
    sections.push({
      id: raw.id,
      title,
      markdown: raw.markdown.trim(),
      isSystem: SYSTEM_SECTION_IDS.includes(raw.id as SystemSectionId),
    });
  }

  const missingSystemSections = SYSTEM_SECTION_IDS.filter(
    (id) => !seen.has(id),
  ) as SystemSectionId[];
  if (missingSystemSections.length > 0) {
    errors.push(`缺少系统 section：${missingSystemSections.join(", ")}`);
  }

  // 恶意 HTML 检查（遍历所有节点，含列表项内的行内 HTML）
  const htmlTree = parser.parse(body);
  visit(htmlTree, (node) => {
    if (node.type === "html") {
      const lower = (node as Html).value.toLowerCase();
      for (const tag of FORBIDDEN_HTML_TAGS) {
        if (lower.includes(`<${tag}`)) {
          errors.push(`正文包含被禁止的 HTML 标签：<${tag}>`);
          break;
        }
      }
      if (/on[a-z]+\s*=/i.test(lower)) {
        errors.push("正文包含事件处理属性（on* =）");
      }
    }
  });

  return {
    ok: errors.length === 0,
    frontmatter: fm,
    sections,
    missingSystemSections,
    duplicateSectionIds,
    unknownSectionIds,
    errors,
  };
}

/** 依据协议重新序列化一份简历文档（保存时使用，保证结构稳定）。 */
export function serializeResumeDocument(input: {
  title: string;
  locale?: string;
  templateId: string;
  sections: Array<{ id: string; title?: string; markdown: string }>;
}): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push(`schemaVersion: ${RESUME_SCHEMA_VERSION}`);
  lines.push(`title: ${YAML.stringify(input.title).trim()}`);
  lines.push(`locale: ${input.locale ?? "zh-CN"}`);
  lines.push(`templateId: ${input.templateId}`);
  lines.push("---");
  lines.push("");
  for (const section of input.sections) {
    lines.push(`<!-- resume-section id="${section.id}" -->`);
    lines.push("");
    lines.push(section.markdown.trim());
    lines.push("");
  }
  return lines.join("\n");
}

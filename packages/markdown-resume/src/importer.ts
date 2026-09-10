import { SYSTEM_SECTION_IDS } from "@jsw/domain";
import { serializeResumeDocument } from "./parser";

/** 中英文别名映射（spec §7.4）。 */
const SECTION_ALIASES: Record<string, string> = {
  "基本信息": "basic",
  "个人信息": "basic",
  "联系方式": "basic",
  "basic information": "basic",
  "personal information": "basic",
  "about me": "basic",
  "工作经历": "experience",
  "工作经验": "experience",
  "职业经历": "experience",
  "work experience": "experience",
  "professional experience": "experience",
  "employment": "experience",
  "项目经历": "projects",
  "项目经验": "projects",
  "projects": "projects",
  "project experience": "projects",
  "教育经历": "education",
  "教育背景": "education",
  "education": "education",
  "技能": "skills",
  "专业技能": "skills",
  "技术栈": "skills",
  "skills": "skills",
  "technical skills": "skills",
};

function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/[\s:：]+$/, "");
}

export interface ImportMappingEntry {
  sourceTitle: string;
  /** null = 自定义章节 */
  mappedTo: string | null;
  warning?: string;
}

export interface ImportPreview {
  mapping: ImportMappingEntry[];
  normalizedMarkdown: string;
  warnings: string[];
  missingSystemSections: string[];
}

export interface ImportSource {
  fileName: string;
  markdown: string;
  suggestedTitle: string;
}

/** 把普通 Markdown 按 ## 级标题切分为 (标题, 内容块)。 */
function splitByHeadings(markdown: string): Array<{ title: string; body: string }> {
  const lines = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").split(/\r?\n/);
  const blocks: Array<{ title: string; body: string }> = [];
  let current: { title: string; body: string[] } | null = null;
  let preamble: string[] = [];
  for (const line of lines) {
    const m = /^#{1,3}\s+(.+)$/.exec(line);
    if (m && (!current || !current.body.join("\n").trim())) {
      if (current) blocks.push({ title: current.title, body: current.body.join("\n") });
      current = { title: m[1].trim(), body: [] };
    } else if (m) {
      // 更深一级标题属于当前块内容
      blocks.push({ title: current!.title, body: current!.body.join("\n") });
      current = { title: m[1].trim(), body: [] };
    } else if (current) {
      current.body.push(line);
    } else {
      preamble.push(line);
    }
  }
  if (current) blocks.push({ title: current.title, body: current.body.join("\n") });
  if (preamble.join("\n").trim() && blocks.length === 0) {
    blocks.push({ title: "正文", body: preamble.join("\n") });
  }
  return blocks;
}

/**
 * 导入归一化预览（spec §7.4）：
 * 不修改源文件，只生成预览与归一化后的 Markdown；用户确认后由
 * Rust 侧复制落库（import_markdown）。
 */
export function previewImport(source: ImportSource): ImportPreview {
  const blocks = splitByHeadings(source.markdown);
  const mapping: ImportMappingEntry[] = [];
  const warnings: string[] = [];
  const usedTargets = new Set<string>();
  const normalized: Array<{ id: string; title: string; markdown: string }> = [];

  for (const block of blocks) {
    let target: string | null = SECTION_ALIASES[normalizeKey(block.title)] ?? null;
    if (target && usedTargets.has(target)) {
      warnings.push(`检测到多个可映射为「${target}」的章节，仅保留第一个：${block.title}`);
      target = null;
    }
    if (target) usedTargets.add(target);
    mapping.push({
      sourceTitle: block.title,
      mappedTo: target,
      warning: target ? undefined : "未识别为系统章节，将作为自定义章节保留",
    });
    const id = target ?? `custom-${normalized.length}`;
    normalized.push({
      id,
      title: block.title,
      markdown: `## ${block.title}\n${block.body.trim()}`,
    });
  }

  const missingSystemSections = SYSTEM_SECTION_IDS.filter((id) => !usedTargets.has(id));
  for (const missing of missingSystemSections) {
    warnings.push(`缺少系统章节「${missing}」，将以空内容补齐`);
    normalized.push({ id: missing, title: missing, markdown: `## ${missing}` });
  }

  const normalizedMarkdown = serializeResumeDocument({
    title: source.suggestedTitle || source.fileName.replace(/\.md$/i, ""),
    templateId: "builtin.classic",
    sections: normalized,
  });

  return { mapping, normalizedMarkdown, warnings, missingSystemSections };
}

export { serializeResumeDocument };

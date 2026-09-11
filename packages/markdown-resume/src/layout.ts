/**
 * CMS 容器模型渲染器：LayoutConfig + 简历 Markdown → 自包含 HTML。
 * 页面盒子居中、四边距、页眉页脚、12 栅格容器、主题 CSS 变量。
 */
import { parseResumeDocument, splitSections } from "./parser";
import { renderMarkdownSafe, renderSectionHtml } from "./renderer";

export interface PageSetup {
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  headerEnabled: boolean;
  headerHeightMm: number;
  headerMarkdown: string | null;
  footerEnabled: boolean;
  footerHeightMm: number;
  footerPageNumbers: boolean;
  footerMarkdown: string | null;
}

export interface LayoutBlock {
  id: string;
  type: "section" | "text";
  sectionId: string | null;
  markdown: string | null;
  width: 12 | 8 | 6 | 4;
  hidden: boolean;
  card: boolean;
  tint: string | null;
}

export interface LayoutTheme {
  primary: string;
  font: "sans" | "serif";
  density: "compact" | "normal" | "airy";
}

export interface LayoutConfig {
  page: PageSetup;
  blocks: LayoutBlock[];
  theme: LayoutTheme;
}

const MM_PX = 96 / 25.4;

export function defaultPageSetup(): PageSetup {
  return {
    marginTop: 14, marginRight: 14, marginBottom: 14, marginLeft: 14,
    headerEnabled: false, headerHeightMm: 10, headerMarkdown: null,
    footerEnabled: false, footerHeightMm: 8, footerPageNumbers: false, footerMarkdown: null,
  };
}

export function defaultTheme(): LayoutTheme {
  return { primary: "#0f766e", font: "sans", density: "normal" };
}

/** 从简历章节生成默认布局（单栏全宽、无卡片）。 */
export function defaultLayoutFor(markdown: string): LayoutConfig {
  const parsed = parseResumeDocument(markdown);
  return {
    page: defaultPageSetup(),
    blocks: parsed.sections.map((s) => ({
      id: `blk-${s.id}`,
      type: "section" as const,
      sectionId: s.id,
      markdown: null,
      width: 12 as const,
      hidden: false,
      card: false,
      tint: null,
    })),
    theme: defaultTheme(),
  };
}

const TINTS: Record<string, string> = {
  rose: "#fff1f2",
  blue: "#eff6ff",
  indigo: "#eef2ff",
  teal: "#f0fdfa",
  amber: "#fffbeb",
};

const DENSITY: Record<string, { font: string; lh: string; gap: string; block: string }> = {
  compact: { font: "13px", lh: "1.45", gap: "10px", block: "12px" },
  normal: { font: "14px", lh: "1.55", gap: "14px", block: "16px" },
  airy: { font: "15px", lh: "1.7", gap: "18px", block: "22px" },
};

function layoutCss(layout: LayoutConfig, forPrint: boolean, canvas = false): string {
  const d = DENSITY[layout.theme.density] ?? DENSITY.normal;
  const serif = layout.theme.font === "serif";
  const p = layout.page;
  const topPx = p.marginTop * MM_PX + (p.headerEnabled ? p.headerHeightMm * MM_PX + 8 : 0);
  const bottomPx = p.marginBottom * MM_PX + (p.footerEnabled ? p.footerHeightMm * MM_PX + 8 : 0);
  return `
${canvas ? ".jsw-canvas" : ":root"} {
  --jsw-primary: ${layout.theme.primary};
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { margin: 0; padding: 0; }
${canvas ? ".jsw-canvas" : "body"} {
  font-family: ${serif
    ? `Georgia, "Times New Roman", "Songti SC", "Noto Serif SC", serif`
    : `-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif`};
  color: #1f2937;
}
.jsw-page {
  width: 794px;
  min-height: 1123px;
  ${canvas ? "" : "margin: 0 auto;"}
  background: #fff;
  box-shadow: ${forPrint || canvas ? "none" : "0 1px 8px rgba(0,0,0,.12)"};
  padding: ${topPx}px ${p.marginRight * MM_PX}px ${bottomPx}px ${p.marginLeft * MM_PX}px;
  position: relative;
}
.jsw-header {
  position: ${forPrint ? "fixed" : "absolute"};
  top: ${p.marginTop * MM_PX}px;
  left: ${p.marginLeft * MM_PX}px;
  right: ${p.marginRight * MM_PX}px;
  height: ${p.headerHeightMm * MM_PX}px;
  display: flex;
  align-items: center;
  border-bottom: 1px solid color-mix(in srgb, var(--jsw-primary) 35%, #fff);
  color: color-mix(in srgb, var(--jsw-primary) 70%, #374151);
  font-size: 12px;
  letter-spacing: 1px;
}
.jsw-footer {
  position: ${forPrint ? "fixed" : "absolute"};
  bottom: ${p.marginBottom * MM_PX}px;
  left: ${p.marginLeft * MM_PX}px;
  right: ${p.marginRight * MM_PX}px;
  height: ${p.footerHeightMm * MM_PX}px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid #e5e7eb;
  color: #9ca3af;
  font-size: 11px;
}
.jsw-grid {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: ${d.gap} ${d.gap};
  align-items: start;
}
.jsw-b { grid-column: span 12; font-size: ${d.font}; line-height: ${d.lh}; }
.jsw-b.w-8 { grid-column: span 8; }
.jsw-b.w-6 { grid-column: span 6; }
.jsw-b.w-4 { grid-column: span 4; }
.jsw-b.card {
  border-radius: 10px;
  padding: 12px 14px;
  background: #fafaf9;
}
.jsw-b.card.tint-rose   { background: ${TINTS.rose}; }
.jsw-b.card.tint-blue   { background: ${TINTS.blue}; }
.jsw-b.card.tint-indigo { background: ${TINTS.indigo}; }
.jsw-b.card.tint-teal   { background: ${TINTS.teal}; }
.jsw-b.card.tint-amber  { background: ${TINTS.amber}; }
.jsw-b h1 { font-size: 1.55em; margin: 0 0 .2em; color: #111827; }
.jsw-b h2 {
  display: flex; align-items: center; gap: 8px;
  font-size: 1.05em; color: var(--jsw-primary);
  margin: 0 0 .6em; letter-spacing: .5px;
}
.jsw-b h2::before {
  content: ""; width: 14px; height: 4px; border-radius: 2px;
  background: var(--jsw-primary); flex: none;
}
.jsw-b h3 { font-size: 1em; margin: .7em 0 .1em; font-weight: 600; }
.jsw-b p { margin: .25em 0; }
.jsw-b ul { margin: .25em 0; padding-left: 1.2em; }
.jsw-b li { margin: .15em 0; }
.jsw-b li::marker { color: var(--jsw-primary); }
.jsw-b a { color: var(--jsw-primary); text-decoration: none; }
.jsw-b strong { font-weight: 600; }
.jsw-b table { border-collapse: collapse; width: 100%; }
.jsw-b th, .jsw-b td { border: 1px solid #e5e7eb; padding: 3px 6px; text-align: left; }
.jsw-b hr { border: none; border-top: 1px solid #e5e7eb; margin: .6em 0; }
.jsw-b code { font-family: ui-monospace, Menlo, monospace; font-size: .9em; background: #f3f4f6; padding: 0 3px; border-radius: 2px; }
.jsw-b img { max-width: 100%; }
.jsw-b blockquote { margin: .3em 0; padding-left: 8px; border-left: 2px solid var(--jsw-primary); color: #6b7280; }
.jsw-hidden { display: none !important; }
`;
}

export interface LayoutRenderResult {
  ok: boolean;
  html: string;
  /** 画布模式：页内 HTML 与样式 */
  content?: string;
  css?: string;
  /** 未在画布上出现的章节（被隐藏或未摆放） */
  missingSectionIds: string[];
  errors: string[];
}

/**
 * 渲染排版文档。编辑器预览用 div 版（forPrint=false，含阴影）；
 * PDF 导出用 forPrint=true（fixed 页眉页脚每页重复 + 透明背景）。
 */
export function renderLayoutDocument(
  markdown: string,
  layout: LayoutConfig,
  forPrint = false,
): LayoutRenderResult {
  const errors: string[] = [];
  const parsed = parseResumeDocument(markdown);
  if (!parsed.ok) {
    return {
      ok: false,
      html: "",
      missingSectionIds: [],
      errors: parsed.errors,
    };
  }

  // 章节 markdown 映射
  const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  const { sections } = splitSections(body);
  const sectionMd = new Map<string, string>();
  parsed.sections.forEach((meta) => {
    const raw = sections.find((s) => s.id === meta.id);
    if (raw) sectionMd.set(meta.id, raw.markdown);
  });

  const placed = new Set<string>();
  const blockHtml = layout.blocks
    .filter((b) => !b.hidden)
    .map((b) => {
      let inner = "";
      if (b.type === "section") {
        const sid = b.sectionId ?? "";
        placed.add(sid);
        const md = sectionMd.get(sid);
        inner = md !== undefined ? renderSectionHtml(md) : `<p style="color:#9ca3af">（章节 ${sid} 不存在）</p>`;
      } else {
        inner = renderMarkdownSafe(b.markdown ?? "");
      }
      const w = [12, 8, 6, 4].includes(b.width) ? b.width : 12;
      const cls = [
        "jsw-b",
        `w-${w}`,
        b.card ? "card" : "",
        b.card && b.tint && TINTS[b.tint] ? `tint-${b.tint}` : "",
      ].filter(Boolean).join(" ");
      return `<section class="${cls}" data-block-id="${b.id}">${inner}</section>`;
    })
    .join("\n");

  const missingSectionIds = [...sectionMd.keys()].filter((id) => !placed.has(id));

  const p = layout.page;
  const headerHtml = p.headerEnabled
    ? `<header class="jsw-header">${renderMarkdownSafe(p.headerMarkdown ?? "")}</header>`
    : "";
  const footerInner = [
    p.footerMarkdown ? renderMarkdownSafe(p.footerMarkdown) : "<span></span>",
    p.footerPageNumbers ? `<span class="jsw-pn"></span>` : "",
  ].join("");
  const footerHtml = p.footerEnabled ? `<footer class="jsw-footer">${footerInner}</footer>` : "";

  const html = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>简历</title>
<style>${layoutCss(layout, forPrint)}</style>
</head>
<body>
<div class="jsw-page">
${headerHtml}
<div class="jsw-grid">
${blockHtml}
</div>
${footerHtml}
</div>
</body>
</html>`;

  if (missingSectionIds.length > 0) {
    errors.push(`未摆放的章节：${missingSectionIds.join("、")}`);
  }
  return { ok: true, html, missingSectionIds, errors };
}

/** 编辑器画布版：返回 css + 页内 HTML，宿主用 div 渲染（可绑定事件）。 */
export function renderLayoutCanvas(
  markdown: string,
  layout: LayoutConfig,
): LayoutRenderResult {
  const doc = renderLayoutDocument(markdown, layout, false);
  if (!doc.ok) return doc;
  const css = layoutCss(layout, false, true);
  const m = doc.html.match(/<div class="jsw-page">([\s\S]*)<\/div>\s*<\/body>/);
  const content = m ? m[1] : "";
  return { ...doc, html: "", css, content };
}

/** 替换某章节的 Markdown 内容（编辑器就地编辑保存用）。 */
export function replaceSectionMarkdown(
  markdown: string,
  sectionId: string,
  newBody: string,
): string {
  const marker = `<!-- resume-section id="${sectionId}" -->`;
  const idx = markdown.indexOf(marker);
  if (idx === -1) return markdown;
  const after = idx + marker.length;
  const next = markdown.indexOf("<!-- resume-section ", after);
  const end = next === -1 ? markdown.length : next;
  return markdown.slice(0, after) + "\n" + newBody.trim() + "\n\n" + markdown.slice(end);
}

/** 打印版 @page 规则（PDF 导出注入，spec §9）。 */
export function layoutPageCss(layout: LayoutConfig): string {
  const p = layout.page;
  return `@page { size: A4; margin: ${p.marginTop}mm ${p.marginRight}mm ${p.marginBottom}mm ${p.marginLeft}mm; }`;
}

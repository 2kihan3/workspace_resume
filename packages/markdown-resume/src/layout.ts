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
  type: "section" | "text" | "heading";
  sectionId: string | null;
  markdown: string | null;
  width: 12 | 8 | 6 | 4;
  hidden: boolean;
  card: boolean;
  tint: string | null;
  /** None=用章节原标题；""=隐藏标题；其余=替换标题文本 */
  titleOverride: string | null;
  size: "small" | "normal" | "large" | null;
  /** 与版式绑定：template（默认）| free（通用组件，独立基础排版） */
  binding: "template" | "free" | null;
  /** 对齐：left | center | right（free/heading/hero 组件生效） */
  align: "left" | "center" | "right" | null;
  /** 页头模式：隐藏章节标题、首行大字、首个列表横排 */
  hero: boolean | null;
}

export interface LayoutTheme {
  primary: string;
  font: "sans" | "serif";
  density: "compact" | "normal" | "airy";
  /** 标题样式：bar=现代简洁短条；dot=时间线节点；plain=无装饰 */
  heading: "bar" | "dot" | "plain" | null;
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
  return { primary: "#0f766e", font: "sans", density: "normal", heading: "bar" };
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
      titleOverride: null,
      size: null,
      binding: null,
      align: null,
      hero: s.id === "basic" ? true : null,
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
${canvas ? ".jsw-canvas" : "body"} {
  --jsw-primary: ${layout.theme.primary};
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
${canvas ? "" : `body.heading-${layout.theme.heading ?? "bar"} { --jsw-heading: 1; }`}
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
/* 标题样式变体：bar（默认）/ dot（时间线）/ plain */
.jsw-b h2 {
  display: flex; align-items: center; gap: 8px;
  font-size: 1.05em; color: var(--jsw-primary);
  margin: 0 0 .6em; letter-spacing: .5px;
}
.heading-bar .jsw-b h2::before {
  content: ""; width: 14px; height: 4px; border-radius: 2px;
  background: var(--jsw-primary); flex: none;
}
.heading-dot .jsw-b {
  border-left: 2px solid color-mix(in srgb, var(--jsw-primary) 30%, #fff);
  padding-left: 16px;
}
.heading-dot .jsw-b h2::before {
  content: ""; width: 9px; height: 9px; border-radius: 50%;
  background: var(--jsw-primary); flex: none;
  box-shadow: 0 0 0 2.5px color-mix(in srgb, var(--jsw-primary) 25%, #fff);
  margin-left: -21.5px;
}
.heading-dot .jsw-b.card { padding-left: 16px; }
.heading-plain .jsw-b h2 { font-weight: 700; }

/* free（通用组件）：脱离版式装饰，保留基础排版 */
.heading-bar .jsw-b.free h2::before { content: none; }
.heading-dot .jsw-b.free { border-left: none; padding-left: 0; }
.heading-dot .jsw-b.free h2::before { content: none; box-shadow: none; margin-left: 0; width: 0; }
.jsw-b.ta-left { text-align: left; }
.jsw-b.ta-center { text-align: center; }
.jsw-b.ta-right { text-align: right; }
.jsw-b.ta-center ul { list-style: none; padding-left: 0; }
.jsw-b.ta-center li { display: inline; margin: 0 .6em; }

/* hero（页头模式）：隐藏章节标题，首行大字，首个列表横排 */
.jsw-b.hero h2 { display: none; }
.jsw-b.hero h1 { font-size: 1.9em; margin: 0 0 .15em; }
.jsw-b.hero ul { list-style: none; padding-left: 0; margin: .2em 0; }
.jsw-b.hero li { display: inline; margin: 0 .9em; font-size: .92em; color: #4b5563; }

/* heading（纯标题组件） */
.jsw-b.jsw-heading h1,
.jsw-b.jsw-heading h2,
.jsw-b.jsw-heading p { margin: 0; font-size: 1.5em; font-weight: 700; color: #111827; }
.jsw-b.jsw-heading.s-sm > * { font-size: 1.2em; }
.jsw-b.jsw-heading.s-lg > * { font-size: 1.9em; }

/* 时间线连续轴线：单栏版式下贯穿整页 */
.jsw-grid.axis { position: relative; }
.jsw-grid.axis::before {
  content: ""; position: absolute; left: 4px; top: 6px; bottom: 6px;
  width: 2px; border-radius: 1px;
  background: color-mix(in srgb, var(--jsw-primary) 30%, #fff);
}
.jsw-grid.axis .jsw-b { border-left: none; padding-left: 22px; }
.jsw-grid.axis .jsw-b.hero,
.jsw-grid.axis .jsw-b.free,
.jsw-grid.axis .jsw-b.jsw-heading { padding-left: 0; }
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
.jsw-b.s-sm { font-size: .92em; }
.jsw-b.s-lg { font-size: 1.08em; }
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
  const visible = layout.blocks.filter((b) => !b.hidden);
  // 时间线版式且全部可见块都是整行时，启用贯穿轴线（连线连续）
  const axis =
    (layout.theme.heading ?? "bar") === "dot" &&
    visible.length > 0 &&
    visible.every((b) => b.width === 12);
  const blockHtml = visible
    .map((b) => {
      let inner = "";
      if (b.type === "section") {
        const sid = b.sectionId ?? "";
        placed.add(sid);
        const md = sectionMd.get(sid);
        inner = md !== undefined ? renderSectionHtml(md) : `<p style="color:#9ca3af">（章节 ${sid} 不存在）</p>`;
      } else if (b.type === "heading") {
        inner = `<h2>${escapeHtmlText(b.markdown ?? "")}</h2>`;
      } else {
        inner = renderMarkdownSafe(b.markdown ?? "");
      }
      const w = [12, 8, 6, 4].includes(b.width) ? b.width : 12;
      const cls = [
        "jsw-b",
        `w-${w}`,
        b.size === "small" ? "s-sm" : b.size === "large" ? "s-lg" : "",
        b.card ? "card" : "",
        b.card && b.tint && TINTS[b.tint] ? `tint-${b.tint}` : "",
        b.binding === "free" ? "free" : "",
        b.type === "heading" ? "jsw-heading" : "",
        b.hero ? "hero" : "",
        b.align === "center" ? "ta-center" : b.align === "right" ? "ta-right" : "",
      ].filter(Boolean).join(" ");
      let blockInner = inner;
      if (b.type !== "heading" && b.titleOverride !== null && b.titleOverride !== undefined) {
        if (b.titleOverride.trim() === "") {
          blockInner = blockInner.replace(/<h2[\s\S]*?<\/h2>/, "");
        } else {
          blockInner = blockInner.replace(
            /<h2([\s\S]*?)>([\s\S]*?)<\/h2>/,
            `<h2$1>${escapeHtmlText(b.titleOverride)}</h2>`,
          );
        }
      }
      return `<section class="${cls}" data-block-id="${b.id}">${blockInner}</section>`;
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
<body class="heading-${layout.theme.heading ?? "bar"}">
<div class="jsw-page">
${headerHtml}
<div class="jsw-grid${axis ? " axis" : ""}">
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

function escapeHtmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 分离章节的标题行与正文（编辑卡分开编辑用）。 */
export function splitSectionHead(md: string): { title: string; body: string } {
  const m = /^(#{1,6} .*)\n([\s\S]*)$/.exec(md.trimStart());
  if (!m) return { title: "", body: md };
  return { title: m[1].replace(/^#+\s+/, "").trim(), body: m[2] };
}

/** 只替换章节正文，标题行保持原样。 */
export function replaceSectionBody(markdown: string, sectionId: string, body: string): string {
  const marker = `<!-- resume-section id="${sectionId}" -->`;
  const idx = markdown.indexOf(marker);
  if (idx === -1) return markdown;
  const after = idx + marker.length;
  const next = markdown.indexOf("<!-- resume-section ", after);
  const end = next === -1 ? markdown.length : next;
  const seg = markdown.slice(after, end);
  const m = /^(\s*)(#{1,6} .*\n)/.exec(seg);
  const headLine = m ? m[2] : "";
  return (
    markdown.slice(0, after) +
    "\n" +
    (headLine ? headLine : "") +
    body.trim() +
    "\n\n" +
    markdown.slice(end)
  );
}

/** 打印版 @page 规则（PDF 导出注入，spec §9）。 */
export function layoutPageCss(layout: LayoutConfig): string {
  const p = layout.page;
  return `@page { size: A4; margin: ${p.marginTop}mm ${p.marginRight}mm ${p.marginBottom}mm ${p.marginLeft}mm; }`;
}

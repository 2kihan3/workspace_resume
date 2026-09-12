import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useBlocker } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { markdown as markdownLanguage } from "@codemirror/lang-markdown";
import { indentWithTab } from "@codemirror/commands";
import { Bold, Heading2, Italic, Link2, List } from "lucide-react";
import { api } from "../lib/constants";
import { parseResumeDocument, renderSectionHtml, splitSections } from "@jsw/markdown-resume";
import { renderTemplate, pageCss, TemplateManifestSchema } from "@jsw/template-engine";
import { inlineTemplateCss } from "../lib/mock-resume";
import { A4Preview } from "../components/A4Preview";
import { renderResumeForTemplate } from "@jsw/markdown-resume";

export const Route = createFileRoute("/resumes/$resumeId/edit")({ component: ResumeEditor });

function ResumeEditor() {
  const { resumeId } = Route.useParams();
  const qc = useQueryClient();
  const content = useQuery({ queryKey: ["resume", resumeId], queryFn: () => api.readResume(resumeId) });
  const [templateId, setTemplateId] = useState<string | null>(null);
  const assets = useQuery({
    queryKey: ["template-assets", templateId ?? content.data?.resume.template_id],
    queryFn: () => api.readTemplateAssets(templateId ?? content.data!.resume.template_id),
    enabled: !!content.data,
  });

  const [markdown, setMarkdown] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [lastValid, setLastValid] = useState("");
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  const parsed = useMemo(
    () => (markdown === null ? null : parseResumeDocument(markdown)),
    [markdown],
  );

  useEffect(() => {
    if (content.data && markdown === null) {
      setMarkdown(content.data.markdown);
      setLastValid(content.data.markdown);
      setTemplateId(content.data.resume.template_id);
    }
  }, [content.data, markdown]);

  useEffect(() => {
    if (!editorRef.current || markdown === null || viewRef.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: markdown,
        extensions: [
          markdownLanguage(),
          keymap.of([
            indentWithTab,
            { key: "Mod-b", run: (v) => wrapSelection(v, "**") },
            { key: "Mod-i", run: (v) => wrapSelection(v, "*") },
            { key: "Mod-k", run: insertLink },
          ]),
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              setMarkdown(u.state.doc.toString());
              setDirty(true);
            }
          }),
        ],
      }),
      parent: editorRef.current,
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [markdown === null]);

  const templates = useQuery({ queryKey: ["templates"], queryFn: api.listTemplates });

  useBlocker({
    shouldBlockFn: () => {
      if (!dirty) return false;
      return !window.confirm("存在未保存的修改，确定离开吗？");
    },
  });

  const save = useMutation({
    mutationFn: () =>
      api.saveResume({ id: resumeId, markdown: markdown!, template_id: templateId ?? content.data?.resume.template_id }),
    onSuccess: () => {
      toast.success("已保存");
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["resume", resumeId] });
      qc.invalidateQueries({ queryKey: ["resumes"] });
    },
    onError: (e) => toast.error(`保存失败（磁盘保留最后有效版本）：${(e as Error).message}`),
  });

  const saveVersion = useMutation({
    mutationFn: () => api.createResumeVersion(resumeId, `${content.data?.resume.title} - 副本`),
    onSuccess: () => {
      toast.success("已另存为版本");
      qc.invalidateQueries({ queryKey: ["resumes"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const exportPdf = useMutation({
    mutationFn: async () => {
      if (!parsed?.ok || !assets.data || !content.data) throw new Error("当前内容无效或模板未加载");
      const rendered = renderResumeForTemplate(markdown!);
      const manifest = TemplateManifestSchema.parse(
        JSON.parse(assets.data.manifest_json),
      );
      const result = renderTemplate({
        manifest,
        templateHtml: assets.data.template_html,
        context: {
          document: { title: rendered.frontmatter?.title ?? "", locale: rendered.frontmatter?.locale ?? "zh-CN" },
          resume: { bodyHtml: rendered.bodyHtml },
          sections: rendered.sectionsHtml,
        },
      });
      if (!result.ok || !result.html) throw new Error(result.errors.join("；"));
      // 输出到 app data 外不可写，导出到简历目录（相对 app_data_dir）
      const outPath = `${content.data.resume.markdown_path.replace(/resume\.md$/, "resume.pdf")}`;
      return api.exportPdfRendered({
        resumeId,
        templateId: templateId ?? content.data.resume.template_id,
        renderedHtml: result.html,
        pageCss: pageCss(manifest),
        outputPath: outPath,
      });
    },
    onSuccess: (r) => toast.success(`PDF 已导出（${r.page_count} 页）`),
    onError: (e) => toast.error(`导出失败：${(e as Error).message}`),
  });

  // 预览 HTML：最后一次有效 AST
  // 预览跟随所选模板实时渲染；模板缺失或文档无效时回退裸 Markdown（最后一次有效内容）
  const previewHtml = useMemo(() => {
    if (!markdown) return "";
    const source = parseResumeDocument(markdown).ok ? markdown : lastValid;
    if (!source) return "";

    if (assets.data) {
      try {
        const manifest = TemplateManifestSchema.parse(JSON.parse(assets.data.manifest_json));
        const rendered = renderResumeForTemplate(source);
        if (rendered.ok) {
          const result = renderTemplate({
            manifest,
            templateHtml: inlineTemplateCss(assets.data.template_html, assets.data.style_css),
            context: {
              document: {
                title: rendered.frontmatter?.title ?? content.data?.resume.title ?? "",
                locale: rendered.frontmatter?.locale ?? "zh-CN",
              },
              resume: { bodyHtml: rendered.bodyHtml },
              sections: rendered.sectionsHtml,
            },
          });
          if (result.ok && result.html) return result.html;
        }
      } catch {
        // 落入降级路径
      }
    }
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      body{margin:0;font-family:-apple-system,"PingFang SC",sans-serif;color:#1f2937;font-size:14px;line-height:1.55;padding:40px 44px;}
      h1{font-size:19pt;margin:0 0 8pt}h2{font-size:12pt;margin:12pt 0 4pt;border-bottom:1pt solid #333;padding-bottom:2pt}
      h3{font-size:10.5pt;margin:8pt 0 2pt}ul{margin:2pt 0;padding-left:14pt}a{color:#1d4ed8}
    </style></head><body>${renderSectionsToHtml(source)}</body></html>`;
  }, [markdown, lastValid, assets.data, content.data]);

  useEffect(() => {
    if (parsed?.ok) setLastValid(markdown!);
  }, [parsed?.ok, markdown]);

  if (content.isLoading || markdown === null) {
    return <div className="text-zinc-500">加载中…</div>;
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-3">
        <h1 className="flex-1 truncate text-xl font-semibold">{content.data?.resume.title}</h1>
        <span className={`text-sm ${dirty ? "text-amber-600" : "text-muted-foreground"}`}>
          {dirty ? "未保存" : "已保存"}
        </span>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          模板
          <select
            value={templateId ?? content.data?.resume.template_id ?? ""}
            onChange={(e) => {
              setTemplateId(e.target.value);
              setDirty(true);
            }}
            className="h-11 max-w-40 rounded-md border border-input bg-card px-3 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            {(templates.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </label>
        <Link
          to="/resumes/$resumeId/layout"
          params={{ resumeId }}
          className="flex h-11 items-center rounded-md border border-input bg-card px-4 text-sm font-medium transition-colors hover:bg-muted"
        >
          排版
        </Link>
        <button onClick={() => save.mutate()} disabled={save.isPending || !(parsed?.ok)}
          className="h-11 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-50">
          保存
        </button>
        <button onClick={() => saveVersion.mutate()}
          className="h-11 rounded-md border border-input bg-card px-4 text-sm font-medium transition-colors hover:bg-muted">
          另存为版本
        </button>
        <button onClick={() => exportPdf.mutate()} disabled={exportPdf.isPending || !parsed?.ok}
          className="h-11 rounded-md border border-input bg-card px-4 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50">
          导出 PDF
        </button>
      </div>

      {parsed && !parsed.ok && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {parsed.errors.map((e, i) => <div key={i}>· {e}</div>)}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-4">
        <div className="flex min-h-0 flex-col gap-1">
          <div role="toolbar" aria-label="格式" className="flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-card px-1 py-0.5">
            <FormatBtn label="加粗（⌘B）" onClick={() => viewRef.current && wrapSelection(viewRef.current, "**")}>
              <Bold className="size-4" aria-hidden />
            </FormatBtn>
            <FormatBtn label="斜体（⌘I）" onClick={() => viewRef.current && wrapSelection(viewRef.current, "*")}>
              <Italic className="size-4" aria-hidden />
            </FormatBtn>
            <FormatBtn label="二级标题" onClick={() => viewRef.current && prefixLine(viewRef.current, "## ")}>
              <Heading2 className="size-4" aria-hidden />
            </FormatBtn>
            <FormatBtn label="列表项" onClick={() => viewRef.current && prefixLine(viewRef.current, "- ")}>
              <List className="size-4" aria-hidden />
            </FormatBtn>
            <FormatBtn label="链接（⌘K）" onClick={() => viewRef.current && insertLink(viewRef.current)}>
              <Link2 className="size-4" aria-hidden />
            </FormatBtn>
            <span className="ml-auto pr-1.5 text-xs text-muted-foreground">⌘B 加粗 · ⌘K 链接</span>
          </div>
          <div ref={editorRef} className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-card p-2 [&_.cm-editor]:h-full [&_.cm-scroller]:font-mono" style={{ fontSize: 15 }} />
        </div>
        <div className="min-h-0 overflow-auto rounded-lg border border-border bg-card p-4">
          <A4Preview html={previewHtml} title="简历预览" className="mx-auto max-w-full rounded shadow-sm" />
        </div>
      </div>
    </div>
  );
}

/** 选区包裹/取消包裹标记（加粗、斜体等）；空选区时插入标记并把光标放中间。 */
function wrapSelection(view: EditorView, mark: string): boolean {
  const { state } = view;
  const changes = state.selection.ranges.map((r) => {
    const text = state.sliceDoc(r.from, r.to);
    if (
      text.length >= mark.length * 2 &&
      text.startsWith(mark) &&
      text.endsWith(mark)
    ) {
      return { from: r.from, to: r.to, insert: text.slice(mark.length, -mark.length) };
    }
    return { from: r.from, to: r.to, insert: mark + text + mark };
  });
  view.dispatch(
    state.changeByRange((r) => {
      const change = changes.find((c) => c.from === r.from && c.to === r.to);
      const insert = change ? change.insert : "";
      const inner = insert.slice(mark.length, insert.length - mark.length);
      // 保持选区覆盖内部文本；空选区时光标放标记中间
      const anchor =
        r.empty
          ? r.from + mark.length
          : r.from + mark.length + inner.length;
      const head = r.empty ? anchor : r.from + mark.length;
      return {
        changes: { from: r.from, to: r.to, insert },
        range: EditorSelection.range(head, anchor),
      };
    }),
  );
  view.focus();
  return true;
}

/** 行首加前缀（标题/列表），已是该前缀则移除（toggle）。 */
function prefixLine(view: EditorView, prefix: string): boolean {
  const { state } = view;
  const changes: Array<{ from: number; to?: number; insert: string }> = [];
  for (const line of state.selection.ranges.map((r) => state.doc.lineAt(r.head))) {
    const has = line.text.startsWith(prefix);
    const oldPrefix = has
      ? prefix
      : /^(#{1,6} |- |\* |\d+\. )/.exec(line.text)?.[0] ?? "";
    const insert = has ? "" : prefix;
    if (oldPrefix !== insert) {
      changes.push({ from: line.from, to: line.from + oldPrefix.length, insert });
    }
  }
  if (changes.length > 0) view.dispatch({ changes });
  view.focus();
  return true;
}

/** 插入链接：选区作为链接文字，光标落在括号内。 */
function insertLink(view: EditorView): boolean {
  const { state } = view;
  view.dispatch(
    state.changeByRange((r) => {
      const text = state.sliceDoc(r.from, r.to) || "链接文字";
      const insert = `[${text}](url)`;
      const urlStart = r.from + text.length + 3;
      return {
        changes: { from: r.from, to: r.to, insert },
        range: EditorSelection.range(urlStart, urlStart + 3),
      };
    }),
  );
  view.focus();
  return true;
}

function FormatBtn({ label, onClick, children }: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}

function renderSectionsToHtml(markdown: string): string {
  const { sections } = splitSections(markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ""));
  return sections.map((s) => renderSectionHtml(s.markdown)).join("\n");
}

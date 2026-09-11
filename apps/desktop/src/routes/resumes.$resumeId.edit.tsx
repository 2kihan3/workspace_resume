import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useBlocker } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { markdown as markdownLanguage } from "@codemirror/lang-markdown";
import { indentWithTab } from "@codemirror/commands";
import { api } from "../lib/constants";
import { parseResumeDocument, renderSectionHtml, splitSections } from "@jsw/markdown-resume";
import { renderTemplate, pageCss, TemplateManifestSchema } from "@jsw/template-engine";
import { renderResumeForTemplate } from "@jsw/markdown-resume";

export const Route = createFileRoute("/resumes/$resumeId/edit")({ component: ResumeEditor });

function ResumeEditor() {
  const { resumeId } = Route.useParams();
  const qc = useQueryClient();
  const content = useQuery({ queryKey: ["resume", resumeId], queryFn: () => api.readResume(resumeId) });
  const assets = useQuery({
    queryKey: ["template-assets", content.data?.resume.template_id],
    queryFn: () => api.readTemplateAssets(content.data!.resume.template_id),
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
    }
  }, [content.data, markdown]);

  useEffect(() => {
    if (!editorRef.current || markdown === null || viewRef.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: markdown,
        extensions: [
          markdownLanguage(),
          keymap.of([indentWithTab]),
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

  useBlocker({
    shouldBlockFn: () => {
      if (!dirty) return false;
      return !window.confirm("存在未保存的修改，确定离开吗？");
    },
  });

  const save = useMutation({
    mutationFn: () =>
      api.saveResume({ id: resumeId, markdown: markdown!, template_id: content.data?.resume.template_id }),
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
        templateId: content.data.resume.template_id,
        renderedHtml: result.html,
        pageCss: pageCss(manifest),
        outputPath: outPath,
      });
    },
    onSuccess: (r) => toast.success(`PDF 已导出（${r.page_count} 页）`),
    onError: (e) => toast.error(`导出失败：${(e as Error).message}`),
  });

  // 预览 HTML：最后一次有效 AST
  const previewHtml = useMemo(() => {
    if (!markdown) return "";
    const p = parseResumeDocument(markdown);
    if (!p.ok) {
      // 用最后一次有效内容渲染
      return renderSectionsToHtml(lastValid);
    }
    return renderSectionsToHtml(markdown);
  }, [markdown, lastValid]);

  useEffect(() => {
    if (parsed?.ok) setLastValid(markdown!);
  }, [parsed?.ok, markdown]);

  if (content.isLoading || markdown === null) {
    return <div className="text-zinc-500">加载中…</div>;
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-3">
        <h1 className="flex-1 text-xl font-semibold">{content.data?.resume.title}</h1>
        <span className={`text-sm ${dirty ? "text-amber-600" : "text-zinc-400"}`}>
          {dirty ? "未保存" : "已保存"}
        </span>
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
        <div ref={editorRef} className="min-h-0 overflow-auto rounded-lg border border-border bg-card p-2 [&_.cm-editor]:h-full [&_.cm-scroller]:font-mono" style={{ fontSize: 15 }} />
        <div className="min-h-0 overflow-auto rounded-lg border border-border bg-card p-6">
          <div className="resume-preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />
        </div>
      </div>
    </div>
  );
}

function renderSectionsToHtml(markdown: string): string {
  const { sections } = splitSections(markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ""));
  return sections.map((s) => renderSectionHtml(s.markdown)).join("\n");
}

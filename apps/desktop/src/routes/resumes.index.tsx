import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { open } from "@tauri-apps/plugin-dialog";
import { Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "../lib/constants";
import { previewImport } from "@jsw/markdown-resume";
import { ResumeThumb } from "../components/ResumeThumb";
import type { Resume } from "../lib/types";

export const Route = createFileRoute("/resumes/")({ component: ResumesPage });

export interface ImportPreviewState {
  path: string;
  fileName: string;
  normalizedMarkdown: string;
  suggestedTitle: string;
  mapping: Array<{ sourceTitle: string; mappedTo: string | null }>;
  warnings: string[];
}

const timeFmt = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : timeFmt.format(d);
}

type Filter = "all" | "base" | "tailored";

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "base", label: "基础简历" },
  { key: "tailored", label: "岗位版" },
];

function ResumesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const resumes = useQuery({ queryKey: ["resumes"], queryFn: api.listResumes });
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: () => api.listJobs({}) });
  const [filter, setFilter] = useState<Filter>("all");
  const [preview, setPreview] = useState<ImportPreviewState | null>(null);
  const [deleting, setDeleting] = useState<Resume | null>(null);

  const jobMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const j of jobs.data ?? []) {
      m.set(j.id, `${j.company_name}${j.role_title ? ` · ${j.role_title}` : ""}`);
    }
    return m;
  }, [jobs.data]);

  const filtered = (resumes.data ?? []).filter((r) =>
    filter === "all" ? true : r.kind === filter,
  );

  // 批量拉取每份简历的内容用于缩略图渲染
  const contents = useQueries({
    queries: filtered.map((r) => ({
      queryKey: ["resume", r.id],
      queryFn: () => api.readResume(r.id),
      staleTime: 30_000,
    })),
  });

  const importFile = useMutation({
    mutationFn: (p: ImportPreviewState) =>
      api.importMarkdown(p.path, p.normalizedMarkdown, p.suggestedTitle),
    onSuccess: () => {
      toast.success("简历已导入");
      setPreview(null);
      qc.invalidateQueries({ queryKey: ["resumes"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const duplicate = useMutation({
    mutationFn: (id: string) => api.duplicateResume(id),
    onSuccess: () => {
      toast.success("已复制");
      qc.invalidateQueries({ queryKey: ["resumes"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteResume(id),
    onSuccess: () => {
      toast.success("已删除");
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ["resumes"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const pickAndPreview = async () => {
    const path = await open({
      multiple: false,
      directory: false,
      title: "选择 Markdown 简历",
      filters: [{ name: "Markdown 简历", extensions: ["md", "markdown", "txt"] }],
    });
    if (!path || typeof path !== "string") return;
    try {
      const markdown = await api.readImportSource(path);
      const fileName = path.split("/").pop() ?? "resume.md";
      const suggestedTitle = fileName.replace(/\.(md|markdown|txt)$/i, "");
      const result = previewImport({ fileName, markdown, suggestedTitle });
      setPreview({
        path,
        fileName,
        normalizedMarkdown: result.normalizedMarkdown,
        suggestedTitle,
        mapping: result.mapping,
        warnings: result.warnings,
      });
    } catch (e) {
      toast.error(`读取文件失败：${(e as Error).message}`);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">简历库</h1>
        <button
          onClick={pickAndPreview}
          className="flex min-h-[44px] items-center gap-2 rounded-md bg-zinc-900 px-4 text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          <Plus size={16} aria-hidden /> 导入 Markdown 简历
        </button>
      </div>

      <div role="tablist" aria-label="简历类型过滤" className="flex gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`min-h-[36px] rounded-md px-3 text-sm ${
              filter === f.key
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            {f.label}
            <span className="ml-1 text-xs opacity-70">
              {f.key === "all"
                ? resumes.data?.length ?? 0
                : (resumes.data ?? []).filter((r) => r.kind === f.key).length}
            </span>
          </button>
        ))}
      </div>

      {preview && (
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-2 font-medium">导入预览：{preview.fileName}</h2>
          <table className="mb-3 w-full text-sm">
            <thead>
              <tr className="text-left text-zinc-500"><th className="py-1">原章节</th><th>映射到</th></tr>
            </thead>
            <tbody>
              {preview.mapping.map((m, i) => (
                <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-1">{m.sourceTitle}</td>
                  <td>{m.mappedTo ?? <span className="text-amber-600">自定义章节</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {preview.warnings.length > 0 && (
            <ul className="mb-3 list-disc pl-5 text-sm text-amber-600">
              {preview.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
          <div className="flex justify-end gap-2">
            <button onClick={() => setPreview(null)}
              className="min-h-[44px] rounded-md border border-zinc-300 px-4 dark:border-zinc-700">取消</button>
            <button onClick={() => importFile.mutate(preview)}
              className="min-h-[44px] rounded-md bg-zinc-900 px-4 text-white dark:bg-zinc-100 dark:text-zinc-900">
              确认导入（源文件不会被修改）
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-3 2xl:grid-cols-4">
        {filtered.map((r, i) => {
          const content = contents[i].data;
          return (
            <div
              key={r.id}
              className="group overflow-hidden rounded-lg border border-zinc-200 bg-white transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
            >
              <Link
                to="/resumes/$resumeId/edit"
                params={{ resumeId: r.id }}
                aria-label={`编辑 ${r.title}`}
                className="relative block"
              >
                {content ? (
                  <ResumeThumb markdown={content.markdown} templateId={r.template_id} title={r.title} />
                ) : (
                  <div className="w-full animate-pulse bg-zinc-200 dark:bg-zinc-800" style={{ aspectRatio: "210 / 297" }} />
                )}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-white via-white/80 to-transparent p-3 pt-10 dark:from-zinc-900 dark:via-zinc-900/80">
                  <div className="font-medium">{r.title || "未命名简历"}</div>
                  <div className="text-xs text-zinc-500">
                    {r.kind === "base" ? "基础简历" : "岗位版"}
                    {r.job_id && jobMap.get(r.job_id) ? ` · ${jobMap.get(r.job_id)}` : ""}
                    {" · "}
                    {formatTime(r.updated_at)}
                  </div>
                </div>
              </Link>
              <div className="grid grid-cols-3 border-t border-zinc-100 dark:border-zinc-800">
                <CardAction label="编辑" onClick={() => navigate({ to: "/resumes/$resumeId/edit", params: { resumeId: r.id } })}>
                  <Pencil size={14} aria-hidden />
                </CardAction>
                <CardAction label="复制" onClick={() => duplicate.mutate(r.id)}>
                  <Copy size={14} aria-hidden />
                </CardAction>
                <CardAction label="删除" danger onClick={() => setDeleting(r)}>
                  <Trash2 size={14} aria-hidden />
                </CardAction>
              </div>
            </div>
          );
        })}
      </div>

      {(resumes.data?.length ?? 0) === 0 && (
        <div className="py-16 text-center text-zinc-500">
          暂无简历。导入一个 Markdown 文件开始（原始文件不会被修改）。
        </div>
      )}
      {(resumes.data?.length ?? 0) > 0 && filtered.length === 0 && (
        <div className="py-12 text-center text-zinc-500">该分类下暂无简历。</div>
      )}

      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="确认删除简历"
            className="w-96 rounded-lg bg-white p-6 shadow-xl dark:bg-zinc-900"
          >
            <h2 className="mb-2 text-lg font-semibold text-rose-600">删除简历</h2>
            <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-300">
              将删除「{deleting.title || "未命名简历"}」及其所有本地快照，此操作不可撤销。
              {deleting.kind === "base" && " 由它派生的岗位版简历不会被删除，仅解除关联。"}
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="min-h-[44px] rounded-md px-4 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                onClick={() => setDeleting(null)}
              >
                取消
              </button>
              <button
                className="min-h-[44px] rounded-md bg-rose-600 px-4 text-white"
                onClick={() => remove.mutate(deleting.id)}
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CardAction({
  label,
  danger,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      aria-label={label}
      className={`flex min-h-[40px] items-center justify-center gap-1.5 text-sm transition-colors ${
        danger
          ? "text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      }`}
    >
      {children}
      {label}
    </button>
  );
}

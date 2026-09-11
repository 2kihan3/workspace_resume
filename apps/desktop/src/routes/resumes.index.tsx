import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { open } from "@tauri-apps/plugin-dialog";
import { Copy, FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "../lib/constants";
import { previewImport } from "@jsw/markdown-resume";
import { ResumeThumb } from "../components/ResumeThumb";
import { CreateResumeModal } from "../components/CreateResumeModal";
import {
  Button,
  Card,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Empty,
} from "@jsw/ui";
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
  const templates = useQuery({ queryKey: ["templates"], queryFn: api.listTemplates });
  const [filter, setFilter] = useState<Filter>("all");
  const [preview, setPreview] = useState<ImportPreviewState | null>(null);
  const [importTemplate, setImportTemplate] = useState("builtin.classic");
  const [deleting, setDeleting] = useState<Resume | null>(null);
  const [creating, setCreating] = useState(false);

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

  const contents = useQueries({
    queries: filtered.map((r) => ({
      queryKey: ["resume", r.id],
      queryFn: () => api.readResume(r.id),
      staleTime: 30_000,
    })),
  });

  const importFile = useMutation({
    mutationFn: (p: ImportPreviewState) => {
      // 归一化产物的 frontmatter 里 templateId 固定为 classic，按用户选择重写
      const markdown = p.normalizedMarkdown.replace(
        /^templateId: .+$/m,
        `templateId: ${importTemplate}`,
      );
      return api.importMarkdown(p.path, markdown, p.suggestedTitle, importTemplate);
    },
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
      toast.success("已复制一份");
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
        <div className="flex gap-2">
          <Button onClick={() => setCreating(true)}>
            <Plus data-icon="inline-start" />
            新建简历
          </Button>
          <Button variant="outline" onClick={pickAndPreview}>
            <FileText data-icon="inline-start" />
            导入 Markdown
          </Button>
        </div>
      </div>

      <div role="tablist" aria-label="简历类型过滤" className="flex gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`h-9 rounded-lg px-3 text-sm transition-colors duration-150 ${
              filter === f.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {f.label}
            <span className="ml-1 tabular-nums opacity-70">
              {f.key === "all"
                ? resumes.data?.length ?? 0
                : (resumes.data ?? []).filter((r) => r.kind === f.key).length}
            </span>
          </button>
        ))}
      </div>

      {preview && (
        <Card className="p-5">
          <h2 className="mb-3 font-medium">导入预览：{preview.fileName}</h2>
          <table className="mb-4 w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 font-normal">原章节</th>
                <th className="font-normal">映射到</th>
              </tr>
            </thead>
            <tbody>
              {preview.mapping.map((m, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="py-1.5">{m.sourceTitle}</td>
                  <td>{m.mappedTo ?? <span className="text-amber-600">自定义章节</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {preview.warnings.length > 0 && (
            <ul className="mb-4 list-disc pl-5 text-sm text-amber-600">
              {preview.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
          <label className="mb-4 flex w-64 flex-col gap-1.5 text-sm font-medium">
            使用模板
            <select
              value={importTemplate}
              onChange={(e) => setImportTemplate(e.target.value)}
              className="h-11 rounded-md border border-input bg-card px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring"
            >
              {(templates.data ?? []).filter((t) => t.enabled).map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPreview(null)}>取消</Button>
            <Button onClick={() => importFile.mutate(preview)}>确认导入</Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">源文件不会被改动，应用里存的是归一化后的副本。模板之后也能在编辑器里换。</p>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-3 2xl:grid-cols-4">
        {filtered.map((r, i) => {
          const content = contents[i].data;
          return (
            <div
              key={r.id}
              className="group overflow-hidden rounded-xl border border-border bg-card transition-shadow duration-150 hover:shadow-md"
            >
              <Link
                to="/resumes/$resumeId/edit"
                params={{ resumeId: r.id }}
                aria-label={`编辑 ${r.title}`}
                className="relative block"
              >
                {content ? (
                  <ResumeThumb markdown={content.markdown} templateId={r.template_id} title={r.title} resumeId={r.id} />
                ) : (
                  <div className="w-full animate-pulse bg-muted" style={{ aspectRatio: "210 / 297" }} />
                )}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-card via-card/85 to-transparent p-3 pt-10">
                  <div className="font-medium">{r.title || "未命名简历"}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.kind === "base" ? "基础简历" : "岗位版"}
                    {r.job_id && jobMap.get(r.job_id) ? ` · ${jobMap.get(r.job_id)}` : ""}
                    {" · "}
                    {formatTime(r.updated_at)}
                  </div>
                </div>
              </Link>
              <div className="grid grid-cols-3 border-t border-border">
                <CardAction label="编辑" onClick={() => navigate({ to: "/resumes/$resumeId/edit", params: { resumeId: r.id } })}>
                  <Pencil aria-hidden />
                </CardAction>
                <CardAction label="复制" onClick={() => duplicate.mutate(r.id)}>
                  <Copy aria-hidden />
                </CardAction>
                <CardAction label="删除" danger onClick={() => setDeleting(r)}>
                  <Trash2 aria-hidden />
                </CardAction>
              </div>
            </div>
          );
        })}
      </div>

      {(resumes.data?.length ?? 0) === 0 && (
        <Empty
          icon={<FileText aria-hidden />}
          title="还没有简历"
          description="从空白建一份，或导入现成的 Markdown 文件（导入不会改动原文件）。"
          action={
            <div className="flex gap-2">
              <Button onClick={() => setCreating(true)}>新建简历</Button>
              <Button variant="outline" onClick={pickAndPreview}>导入 Markdown</Button>
            </div>
          }
        />
      )}
      {(resumes.data?.length ?? 0) > 0 && filtered.length === 0 && (
        <Empty title="这个分类下还没有简历" description="切换上方的分类看看。" />
      )}

      <CreateResumeModal open={creating} onClose={() => setCreating(false)} />

      <Dialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        ariaLabel="确认删除简历"
      >
        <DialogHeader>
          <DialogTitle className="text-destructive">删除简历</DialogTitle>
          <DialogDescription>
            将删除「{deleting?.title || "未命名简历"}」和它的本地快照，无法恢复。
            {deleting?.kind === "base" && " 由它派生的岗位版会保留，只是解除关联。"}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDeleting(null)}>取消</Button>
          <Button variant="destructive" onClick={() => deleting && remove.mutate(deleting.id)}>
            删除
          </Button>
        </DialogFooter>
      </Dialog>
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
      className={`flex min-h-11 items-center justify-center gap-1.5 text-sm transition-colors duration-150 [&_svg]:size-4 ${
        danger
          ? "text-destructive hover:bg-destructive/10"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {children}
      {label}
    </button>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../lib/constants";
import { previewImport } from "@jsw/markdown-resume";

export const Route = createFileRoute("/resumes/")({ component: ResumesPage });

export interface ImportPreviewState {
  path: string;
  fileName: string;
  normalizedMarkdown: string;
  suggestedTitle: string;
  mapping: Array<{ sourceTitle: string; mappedTo: string | null }>;
  warnings: string[];
}

function ResumesPage() {
  const qc = useQueryClient();
  const resumes = useQuery({ queryKey: ["resumes"], queryFn: api.listResumes });
  const [preview, setPreview] = useState<ImportPreviewState | null>(null);

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

  const pickAndPreview = async () => {
    // 原生对话框返回绝对路径；HTML input 在 Tauri 中拿不到完整路径
    const path = await open({
      multiple: false,
      directory: false,
      title: "选择 Markdown 简历",
      filters: [{ name: "Markdown 简历", extensions: ["md", "markdown", "txt"] }],
    });
    if (!path || typeof path !== "string") return;
    try {
      const markdown = await api.readImportSource(path);
      const result = previewImport({
        fileName: path.split("/").pop() ?? "resume.md",
        markdown,
        suggestedTitle: (path.split("/").pop() ?? "resume.md").replace(/\.(md|markdown|txt)$/i, ""),
      });
      setPreview({
        path,
        fileName: path.split("/").pop() ?? "resume.md",
        normalizedMarkdown: result.normalizedMarkdown,
        suggestedTitle: (path.split("/").pop() ?? "resume.md").replace(/\.(md|markdown|txt)$/i, ""),
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
          className="min-h-[44px] rounded-md bg-zinc-900 px-4 text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          导入 Markdown 简历
        </button>
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

      <div className="flex flex-col gap-2">
        {(resumes.data ?? []).map((r) => (
          <Link
            key={r.id}
            to="/resumes/$resumeId/edit"
            params={{ resumeId: r.id }}
            className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white p-4 hover:shadow dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div>
              <div className="font-medium">{r.title}</div>
              <div className="text-sm text-zinc-500">
                {r.kind === "base" ? "基础简历" : "岗位版简历"} · 更新于 {r.updated_at}
              </div>
            </div>
            <span className="text-sm text-zinc-400">编辑 →</span>
          </Link>
        ))}
        {resumes.data?.length === 0 && (
          <div className="py-16 text-center text-zinc-500">
            暂无简历。导入一个 Markdown 文件开始（原始文件不会被修改）。
          </div>
        )}
      </div>
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../lib/constants";
import { buildBlankResumeMarkdown, BLANK_TEMPLATE_ID } from "../lib/blank-resume";
import { TemplateThumb } from "./TemplateThumb";
import { TemplateManifestSchema } from "@jsw/template-engine";
import { useQueries } from "@tanstack/react-query";

/**
 * 新建简历弹窗（参考 magic-resume 交互）：
 * 模板网格（含空白模板）→ 点击模板进入大图预览（示例数据）→ 使用此模板创建。
 * 空白模板点击直接创建。创建后跳转编辑器。
 */
export function CreateResumeModal({
  open,
  onClose,
  initialTemplateId,
}: {
  open: boolean;
  onClose: () => void;
  /** 从模板详情页打开时预选模板（直接进预览步骤） */
  initialTemplateId?: string;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const templates = useQuery({
    queryKey: ["templates"],
    queryFn: api.listTemplates,
    enabled: open,
  });
  const [previewId, setPreviewId] = useState<string | null>(initialTemplateId ?? null);
  const [title, setTitle] = useState("我的简历");

  const assetsList = useQueries({
    queries: (templates.data ?? [])
      .filter((t) => t.enabled)
      .map((t) => ({
        queryKey: ["template-assets", t.id],
        queryFn: () => api.readTemplateAssets(t.id),
        staleTime: Infinity,
        retry: false,
      })),
  });

  const enabledTemplates = (templates.data ?? []).filter((t) => t.enabled);
  const manifestOf = (id: string) => {
    const idx = enabledTemplates.findIndex((t) => t.id === id);
    const raw = idx >= 0 ? assetsList[idx].data?.manifest_json : undefined;
    if (!raw) return null;
    try {
      return TemplateManifestSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  };

  const create = useMutation({
    mutationFn: (templateId: string) => {
      const safeTitle = title.trim() || "我的简历";
      return api.createBaseResume(
        safeTitle,
        buildBlankResumeMarkdown(safeTitle, templateId),
      );
    },
    onSuccess: (resume) => {
      toast.success("简历已创建");
      onClose();
      setPreviewId(null);
      qc.invalidateQueries({ queryKey: ["resumes"] });
      navigate({ to: "/resumes/$resumeId/edit", params: { resumeId: resume.id } });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (!open) return null;

  const previewTemplate = enabledTemplates.find((t) => t.id === previewId);
  const previewManifest = previewId ? manifestOf(previewId) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="新建简历"
        className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-zinc-900"
      >
        <div className="flex items-center justify-between border-b border-zinc-100 p-4 dark:border-zinc-800">
          <h2 className="text-lg font-semibold">
            {previewTemplate ? `预览：${previewTemplate.name}` : "新建简历"}
          </h2>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="min-h-[44px] min-w-[44px] rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            ✕
          </button>
        </div>

        {previewTemplate ? (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1">
                <div className="font-medium">{previewTemplate.name}</div>
                <div className="text-sm text-zinc-500">
                  {previewManifest?.description ?? previewTemplate.id}
                  {" · "}
                  {previewManifest?.author ?? "未知作者"} · v{previewTemplate.version}
                </div>
              </div>
              <label className="flex flex-col gap-1 text-sm">
                简历名称
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="min-h-[44px] w-56 rounded-md border border-zinc-300 px-3 dark:border-zinc-700 dark:bg-zinc-800"
                />
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setPreviewId(null)}
                  className="min-h-[44px] rounded-md border border-zinc-300 px-4 dark:border-zinc-700"
                >
                  返回
                </button>
                <button
                  onClick={() => create.mutate(previewTemplate.id)}
                  disabled={create.isPending}
                  className="min-h-[44px] rounded-md bg-zinc-900 px-4 text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  使用此模板创建
                </button>
              </div>
            </div>
            <div className="mx-auto w-full max-w-[560px] overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
              <TemplateThumb templateId={previewTemplate.id} />
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
            <label className="flex items-center gap-3 self-start text-sm">
              简历名称
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="min-h-[44px] w-56 rounded-md border border-zinc-300 px-3 dark:border-zinc-700 dark:bg-zinc-800"
              />
            </label>
            <div className="grid grid-cols-3 gap-4">
              <button
                onClick={() => create.mutate(BLANK_TEMPLATE_ID)}
                disabled={create.isPending}
                className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-300 p-4 text-zinc-500 hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800/60"
              >
                <span className="text-3xl">＋</span>
                <span className="text-sm">空白简历</span>
                <span className="text-xs">点击直接创建</span>
              </button>
              {enabledTemplates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setPreviewId(t.id)}
                  className="overflow-hidden rounded-lg border border-zinc-200 text-left transition-shadow hover:shadow-md dark:border-zinc-800"
                >
                  <TemplateThumb templateId={t.id} />
                  <div className="border-t border-zinc-100 p-2 dark:border-zinc-800">
                    <div className="text-sm font-medium">{t.name}</div>
                    <div className="line-clamp-1 text-xs text-zinc-500">
                      {manifestOf(t.id)?.description ?? t.id}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <p className="text-xs text-zinc-400">
              缩略图使用示例数据渲染；创建后可随时在编辑器中切换模板。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

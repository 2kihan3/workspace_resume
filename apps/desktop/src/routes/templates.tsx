import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../lib/constants";
import { TemplateThumb } from "../components/TemplateThumb";
import { TemplateManifestSchema } from "@jsw/template-engine";
import type { Template } from "../lib/types";

export const Route = createFileRoute("/templates")({ component: TemplatesPage });

function TemplatesPage() {
  const qc = useQueryClient();
  const templates = useQuery({ queryKey: ["templates"], queryFn: api.listTemplates });

  // 每个模板的 manifest（描述等元信息）
  const assetsList = useQueries({
    queries: (templates.data ?? []).map((t) => ({
      queryKey: ["template-assets", t.id],
      queryFn: () => api.readTemplateAssets(t.id),
      staleTime: Infinity,
      retry: false,
    })),
  });

  const manifestOf = (i: number) => {
    const raw = assetsList[i].data?.manifest_json;
    if (!raw) return null;
    try {
      return TemplateManifestSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  };

  const importZip = useMutation({
    mutationFn: (path: string) => api.importTemplateZip(path),
    onSuccess: () => {
      toast.success("模板已导入");
      qc.invalidateQueries({ queryKey: ["templates"] });
    },
    onError: (e) => toast.error(`导入被拒绝：${(e as Error).message}`),
  });
  const toggle = useMutation({
    mutationFn: (args: { id: string; enabled: boolean }) => api.setTemplateEnabled(args.id, args.enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["templates"] }),
  });

  const pickAndImport = async () => {
    const path = await open({
      multiple: false,
      directory: false,
      title: "选择模板 ZIP 包",
      filters: [{ name: "模板包", extensions: ["zip"] }],
    });
    if (!path || typeof path !== "string") return;
    importZip.mutate(path);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">模板库</h1>
        <button
          onClick={pickAndImport}
          className="min-h-[44px] rounded-md bg-zinc-900 px-4 text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          导入 ZIP 模板包
        </button>
      </div>

      <p className="text-sm text-zinc-500">
        模板包为无脚本 HTML/CSS ZIP：manifest.json + template.html + style.css + assets/（仅 PNG/JPEG/WebP/WOFF/WOFF2）。
        恶意内容（脚本、远程资源、路径穿越）会被拒绝。缩略图使用示例数据渲染。
      </p>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-3 2xl:grid-cols-4">
        {(templates.data ?? []).map((t, i) => (
          <TemplateCard
            key={t.id}
            template={t}
            description={manifestOf(i)?.description ?? null}
            onToggle={(enabled) => toggle.mutate({ id: t.id, enabled })}
          />
        ))}
      </div>
      {templates.data?.length === 0 && (
        <div className="py-16 text-center text-zinc-500">暂无模板。</div>
      )}
    </div>
  );
}

function TemplateCard({
  template,
  description,
  onToggle,
}: {
  template: Template;
  description: string | null;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <div
      className={`overflow-hidden rounded-lg border bg-white transition-shadow hover:shadow-md dark:bg-zinc-900 ${
        template.enabled
          ? "border-zinc-200 dark:border-zinc-800"
          : "border-dashed border-zinc-300 opacity-70 dark:border-zinc-700"
      }`}
    >
      <TemplateThumb templateId={template.id} />
      <div className="border-t border-zinc-100 p-3 dark:border-zinc-800">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">{template.name}</span>
          <label className="flex shrink-0 items-center gap-1.5 text-xs text-zinc-500">
            <input
              type="checkbox"
              checked={template.enabled}
              onChange={(e) => onToggle(e.target.checked)}
            />
            {template.enabled ? "已启用" : "已停用"}
          </label>
        </div>
        <p className="mt-1 line-clamp-2 min-h-[2.5em] text-sm text-zinc-500">
          {description ?? "（无描述）"}
        </p>
        <div className="mt-1 text-xs text-zinc-400">
          {template.id} · {template.origin === "builtin" ? "内置" : "导入"} · v{template.version}
        </div>
      </div>
    </div>
  );
}

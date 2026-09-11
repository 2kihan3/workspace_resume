import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../lib/constants";

export const Route = createFileRoute("/templates")({ component: TemplatesPage });

function TemplatesPage() {
  const qc = useQueryClient();
  const templates = useQuery({ queryKey: ["templates"], queryFn: api.listTemplates });

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
        恶意内容（脚本、远程资源、路径穿越）会被拒绝。
      </p>

      <div className="grid grid-cols-3 gap-4">
        {(templates.data ?? []).map((t) => (
          <div key={t.id} className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-medium">{t.name}</span>
              <span className="text-xs text-zinc-400">v{t.version}</span>
            </div>
            <div className="mb-3 text-sm text-zinc-500">
              {t.id} · {t.origin === "builtin" ? "内置" : "导入"}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={t.enabled}
                onChange={(e) => toggle.mutate({ id: t.id, enabled: e.target.checked })}
              />
              启用
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}

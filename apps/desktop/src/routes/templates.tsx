import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { toast } from "sonner";
import { open } from "@tauri-apps/plugin-dialog";
import { PackageOpen } from "lucide-react";
import { api, FEATURED_TEMPLATE_IDS } from "../lib/constants";
import { TemplateThumb } from "../components/TemplateThumb";
import { TemplateManifestSchema } from "@jsw/template-engine";
import { generateTemplatePreview, previewAttempted } from "../lib/template-preview";
import { Button, Empty } from "@jsw/ui";
import type { Template } from "../lib/types";

export const Route = createFileRoute("/templates")({ component: TemplatesPage });

function TemplatesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const templates = useQuery({ queryKey: ["templates"], queryFn: api.listTemplates });

  const featured = (templates.data ?? []).filter((t) =>
    (FEATURED_TEMPLATE_IDS as readonly string[]).includes(t.id),
  );
  const assetsList = useQueries({
    queries: featured.map((t) => ({
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

  // 为缺少静态预览图的模板补生成（每会话每模板一次，失败就用实时渲染）
  useEffect(() => {
    if (!templates.data) return;
    for (const t of templates.data) {
      if (t.preview_path || previewAttempted(t.id)) continue;
      generateTemplatePreview(t.id)
        .then(() => qc.invalidateQueries({ queryKey: ["templates"] }))
        .catch((e) => console.warn(`模板 ${t.id} 预览图生成失败，降级实时渲染：`, e));
    }
  }, [templates.data, qc]);

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
        <Button onClick={pickAndImport}>导入 ZIP 模板包</Button>
      </div>

      <p className="text-sm text-muted-foreground">
        模板包是纯 HTML/CSS 的 ZIP：manifest.json + template.html + style.css + assets/。
        带脚本、远程资源或路径穿越的包会被直接拒绝。缩略图为示例数据效果。
      </p>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-3 2xl:grid-cols-4">
        {featured.map((t, i) => (
          <TemplateCard
            key={t.id}
            template={t}
            description={manifestOf(i)?.description ?? null}
            onOpen={() => navigate({ to: "/templates/$templateId", params: { templateId: t.id } })}
            onToggle={(enabled) => toggle.mutate({ id: t.id, enabled })}
          />
        ))}
      </div>
      {templates.data?.length === 0 && (
        <Empty
          icon={<PackageOpen aria-hidden />}
          title="还没有模板"
          description="可以导入一个 ZIP 模板包试试。"
        />
      )}
    </div>
  );
}

function TemplateCard({
  template,
  description,
  onOpen,
  onToggle,
}: {
  template: Template;
  description: string | null;
  onOpen: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <div
      className={`overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-md ${
        template.enabled
          ? "border-border"
          : "border-dashed border-input opacity-70"
      }`}
    >
      <button
        onClick={onOpen}
        aria-label={`查看模板 ${template.name} 详情`}
        className="block w-full cursor-pointer text-left"
      >
        <TemplateThumb templateId={template.id} />
      </button>
      <div className="border-t border-border p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">{template.name}</span>
          <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={template.enabled}
              onChange={(e) => onToggle(e.target.checked)}
            />
            {template.enabled ? "已启用" : "已停用"}
          </label>
        </div>
        <p className="mt-1 line-clamp-2 min-h-[2.5em] text-sm text-muted-foreground">
          {description ?? "（没有描述）"}
        </p>
        <div className="mt-1 text-xs text-muted-foreground">
          {template.id} · {template.origin === "builtin" ? "内置" : "导入"} · v{template.version}
        </div>
      </div>
    </div>
  );
}

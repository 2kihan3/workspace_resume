import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { api } from "../lib/constants";
import { TemplateThumb } from "../components/TemplateThumb";
import { CreateResumeModal } from "../components/CreateResumeModal";
import { TemplateManifestSchema } from "@jsw/template-engine";
import { useGenerateTemplatePreview } from "../lib/template-preview";
import { useState } from "react";

export const Route = createFileRoute("/templates/$templateId")({
  component: TemplateDetail,
});

function TemplateDetail() {
  const { templateId } = Route.useParams();
  const qc = useQueryClient();
  const templates = useQuery({ queryKey: ["templates"], queryFn: api.listTemplates });
  const assets = useQuery({
    queryKey: ["template-assets", templateId],
    queryFn: () => api.readTemplateAssets(templateId),
    retry: false,
  });
  const [creating, setCreatingState] = useState(false);

  const template = (templates.data ?? []).find((t) => t.id === templateId);
  const manifest = assets.data
    ? (() => {
        try {
          return TemplateManifestSchema.parse(JSON.parse(assets.data!.manifest_json));
        } catch {
          return null;
        }
      })()
    : null;

  const [regenerating, setRegenerating] = useState(false);
  const regeneratePreview = useGenerateTemplatePreview();

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api.setTemplateEnabled(templateId, enabled),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["templates"] });
      toast.success(enabledTip());
    },
  });
  const enabledTip = () => (template?.enabled ? "已停用" : "已启用");

  if (templates.isLoading) return <div className="text-zinc-500">加载中…</div>;
  if (!template) {
    return (
      <div className="py-16 text-center text-zinc-500">
        模板不存在或已删除。<Link to="/templates" className="text-blue-600 hover:underline">返回模板库</Link>
      </div>
    );
  }

  const margin = manifest?.page.marginMm;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link to="/templates" className="text-sm text-zinc-500 hover:underline">← 返回模板库</Link>
        <h1 className="text-2xl font-semibold">{template.name}</h1>
      </div>

      <div className="grid grid-cols-[1fr_300px] gap-6">
        <div className="mx-auto w-full max-w-[640px] overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
          <TemplateThumb templateId={template.id} />
        </div>

        <aside className="flex flex-col gap-4">
          <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="mb-2 font-medium">模板信息</h2>
            <dl className="flex flex-col gap-1.5 text-sm">
              <InfoRow label="描述" value={manifest?.description ?? "（无描述）"} />
              <InfoRow label="ID" value={template.id} />
              <InfoRow label="作者" value={manifest?.author ?? "未知"} />
              <InfoRow label="版本" value={`v${template.version}`} />
              <InfoRow label="来源" value={template.origin === "builtin" ? "内置" : "用户导入"} />
              <InfoRow
                label="支持语言"
                value={(manifest?.supportedLocales ?? []).join("、") || "—"}
              />
              <InfoRow
                label="页面"
                value={
                  margin
                    ? `${manifest?.page.size} · 边距 ${margin[0]}/${margin[1]}/${margin[2]}/${margin[3]} mm`
                    : "A4"
                }
              />
            </dl>
            <p className="mt-3 text-xs text-zinc-400">预览使用示例数据渲染。</p>
          </section>

          <section className="flex flex-col gap-2">
            <button
              onClick={() => setCreatingState(true)}
              disabled={!template.enabled}
              className="min-h-[44px] rounded-md bg-zinc-900 px-4 text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              用此模板新建简历
            </button>
            <button
              onClick={() => toggle.mutate(!template.enabled)}
              className="min-h-[44px] rounded-md border border-zinc-300 px-4 dark:border-zinc-700"
            >
              {template.enabled ? "停用模板" : "启用模板"}
            </button>
            <button
              onClick={async () => {
                setRegenerating(true);
                try {
                  await regeneratePreview(templateId);
                  toast.success("预览图已更新");
                } catch (e) {
                  toast.error(`预览图生成失败：${(e as Error).message}`);
                } finally {
                  setRegenerating(false);
                }
              }}
              disabled={regenerating}
              className="min-h-[44px] rounded-md border border-zinc-300 px-4 disabled:opacity-50 dark:border-zinc-700"
            >
              {regenerating ? "生成中…" : "重新生成预览图"}
            </button>
            {!template.enabled && (
              <p className="text-xs text-amber-600">已停用的模板不能用于新建简历。</p>
            )}
          </section>
        </aside>
      </div>

      <CreateResumeModal
        open={creating}
        onClose={() => setCreatingState(false)}
        initialTemplateId={templateId}
      />
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-20 shrink-0 text-zinc-500">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  );
}

import { useMutation, useQuery, useQueryClient, useQueries } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { api, FEATURED_TEMPLATE_IDS } from "../lib/constants";
import { buildBlankResumeMarkdown, BLANK_TEMPLATE_ID } from "../lib/blank-resume";
import { TemplateThumb } from "./TemplateThumb";
import { TemplateManifestSchema } from "@jsw/template-engine";
import {
  Button,
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@jsw/ui";

/**
 * 新建简历弹窗：模板网格（含空白）→ 点模板看大图预览 → 用此模板创建。
 * 空白模板点击直接创建。创建后进入编辑器。
 */
export function CreateResumeModal({
  open,
  onClose,
  initialTemplateId,
}: {
  open: boolean;
  onClose: () => void;
  /** 从模板详情页打开时直接进入预览 */
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

  // 主推模板：模板库与新建入口只展示两套精选；空白简历用 modern
  const enabledTemplates = (templates.data ?? []).filter(
    (t) => t.enabled && (FEATURED_TEMPLATE_IDS as readonly string[]).includes(t.id),
  );

  const assetsList = useQueries({
    queries: enabledTemplates.map((t) => ({
      queryKey: ["template-assets", t.id],
      queryFn: () => api.readTemplateAssets(t.id),
      staleTime: Infinity,
      retry: false,
    })),
  });

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

  const previewTemplate = enabledTemplates.find((t) => t.id === previewId);
  const previewManifest = previewId ? manifestOf(previewId) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      ariaLabel="新建简历"
      className="max-w-4xl"
    >
      <DialogHeader>
        <div>
          <DialogTitle>{previewTemplate ? `预览：${previewTemplate.name}` : "新建简历"}</DialogTitle>
          {previewTemplate && (
            <DialogDescription>
              {previewManifest?.description ?? previewTemplate.id}
            </DialogDescription>
          )}
        </div>
        <DialogCloseButton />
      </DialogHeader>

      <DialogContent>
        {previewTemplate ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <Label className="flex-1">
                简历名称
                <Input value={title} onChange={(e) => setTitle(e.target.value)} className="w-56" />
              </Label>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setPreviewId(null)}>返回</Button>
                <Button onClick={() => create.mutate(previewTemplate.id)} disabled={create.isPending}>
                  使用此模板创建
                </Button>
              </div>
            </div>
            <div className="mx-auto w-full max-w-[560px] overflow-hidden rounded-lg border border-border">
              <TemplateThumb templateId={previewTemplate.id} />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <Label className="self-start">
              简历名称
              <Input value={title} onChange={(e) => setTitle(e.target.value)} className="w-56" />
            </Label>
            <div className="grid grid-cols-3 gap-4">
              <button
                onClick={() => create.mutate(BLANK_TEMPLATE_ID)}
                disabled={create.isPending}
                className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-input text-muted-foreground transition-colors hover:border-ring hover:bg-accent hover:text-accent-foreground"
              >
                <span className="text-3xl">＋</span>
                <span className="text-sm">空白简历</span>
                <span className="text-xs">点击直接创建</span>
              </button>
              {enabledTemplates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setPreviewId(t.id)}
                  className="overflow-hidden rounded-xl border border-border text-left transition-shadow hover:shadow-md"
                >
                  <TemplateThumb templateId={t.id} />
                  <div className="border-t border-border p-2">
                    <div className="text-sm font-medium">{t.name}</div>
                    <div className="line-clamp-1 text-xs text-muted-foreground">
                      {manifestOf(t.id)?.description ?? t.id}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              缩略图是示例数据的效果。创建后在编辑器里可以随时换模板。
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

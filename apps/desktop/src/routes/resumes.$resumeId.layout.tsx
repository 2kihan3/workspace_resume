import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import {
  ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Copy, Eye, EyeOff,
  FileText, LayoutGrid, Plus, Save, Trash2,
} from "lucide-react";
import { api, type LayoutConfig, type LayoutBlock } from "../lib/constants";
import {
  defaultLayoutFor, renderLayoutCanvas, replaceSectionMarkdown, splitSections,
} from "@jsw/markdown-resume";
import { Button } from "@jsw/ui";

export const Route = createFileRoute("/resumes/$resumeId/layout")({
  component: LayoutEditor,
});

type EditMode = "canvas" | "source";

const PRESET_COLORS = [
  "#0f766e", "#4f46e5", "#e11d48", "#ea580c",
  "#2563eb", "#7c3aed", "#0d9488", "#334155",
];

function LayoutEditor() {
  const { resumeId } = Route.useParams();
  const qc = useQueryClient();
  const content = useQuery({ queryKey: ["resume", resumeId], queryFn: () => api.readResume(resumeId) });

  const [markdown, setMarkdown] = useState<string | null>(null);
  const [layout, setLayout] = useState<LayoutConfig | null>(null);
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState<EditMode>("canvas");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sourceText, setSourceText] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ blockId: string; sectionId: string | null } | null>(null);
  const [editText, setEditText] = useState("");
  const [pages, setPages] = useState(1);
  const [zoom, setZoom] = useState(1);

  const canvasRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      if (!content.data || markdown !== null) return;
      setMarkdown(content.data.markdown);
      const saved = await api.getLayout(resumeId).catch(() => null);
      setLayout(saved ?? defaultLayoutFor(content.data.markdown));
    })();
  }, [content.data, markdown, resumeId]);

  // 画布渲染
  const canvas = useMemo(
    () => (markdown && layout ? renderLayoutCanvas(markdown, layout) : null),
    [markdown, layout],
  );

  // 章节内容映射（就地编辑用）
  const sectionMd = useMemo(() => {
    const map = new Map<string, string>();
    if (!markdown) return map;
    const { sections } = splitSections(markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ""));
    for (const s of sections) map.set(s.id, s.markdown);
    return map;
  }, [markdown]);

  const update = useCallback((fn: (draft: LayoutConfig) => void) => {
    setLayout((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
    setDirty(true);
  }, []);

  const save = useMutation({
    mutationFn: async () => {
      if (!markdown || !layout) throw new Error("尚未加载完成");
      await api.saveResume({ id: resumeId, markdown });
      await api.saveLayout(resumeId, layout);
    },
    onSuccess: () => {
      toast.success("排版已保存");
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["resume", resumeId] });
      qc.invalidateQueries({ queryKey: ["resumes"] });
    },
    onError: (e) => toast.error(`保存失败：${(e as Error).message}`),
  });

  const exportPdf = useMutation({
    mutationFn: async () => {
      const { renderLayoutDocument, layoutPageCss } = await import("@jsw/markdown-resume");
      if (!markdown || !layout) throw new Error("尚未加载完成");
      const printed = renderLayoutDocument(markdown, layout, true);
      if (!printed.ok) throw new Error(printed.errors.join("；"));
      const outPath = content.data!.resume.markdown_path.replace(/resume\.md$/, "resume.pdf");
      return api.exportPdfRendered({
        resumeId,
        templateId: content.data!.resume.template_id,
        renderedHtml: printed.html,
        pageCss: layoutPageCss(layout),
        outputPath: outPath,
      });
    },
    onSuccess: (r) => toast.success(`PDF 已导出（${r.page_count} 页）`),
    onError: (e) => toast.error(`导出失败：${(e as Error).message}`),
  });

  // ── 画布交互：事件委托（点击选中 / 双击编辑 / 原生拖拽排序）──
  useEffect(() => {
    const root = canvasRef.current;
    if (!root || !canvas?.content) return;

    // 容器可拖拽（编辑态文本框除外）
    root.querySelectorAll<HTMLElement>("[data-block-id]").forEach((el) => {
      el.draggable = true;
    });

    let dragId: string | null = null;

    const onClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest("[data-block-id]");
      setSelectedId(target?.getAttribute("data-block-id") ?? null);
    };

    const onDbl = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest("[data-block-id]") as HTMLElement | null;
      if (!target || !layout) return;
      const id = target.getAttribute("data-block-id");
      if (!id) return;
      const block = layout.blocks.find((b) => b.id === id);
      if (!block) return;
      if (block.type === "section") {
        setEditText(sectionMd.get(block.sectionId ?? "") ?? "");
        setEditing({ blockId: id, sectionId: block.sectionId });
      } else {
        setEditText(block.markdown ?? "");
        setEditing({ blockId: id, sectionId: null });
      }
    };

    const onDragStart = (e: DragEvent) => {
      const target = (e.target as HTMLElement).closest("[data-block-id]") as HTMLElement | null;
      if (!target) return;
      dragId = target.getAttribute("data-block-id") ?? null;
      if (dragId) e.dataTransfer?.setData("text/plain", dragId);
    };

    const onDragOver = (e: DragEvent) => {
      if (!dragId) return;
      e.preventDefault();
    };

    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const target = (e.target as HTMLElement).closest("[data-block-id]") as HTMLElement | null;
      const overId = target?.getAttribute("data-block-id") ?? null;
      if (!dragId || !overId || dragId === overId || !layout) {
        dragId = null;
        return;
      }
      update((draft) => {
        const from = draft.blocks.findIndex((b) => b.id === dragId);
        const to = draft.blocks.findIndex((b) => b.id === overId);
        if (from < 0 || to < 0) return;
        const [moved] = draft.blocks.splice(from, 1);
        draft.blocks.splice(to, 0, moved);
      });
      dragId = null;
    };

    root.addEventListener("click", onClick);
    root.addEventListener("dblclick", onDbl);
    root.addEventListener("dragstart", onDragStart);
    root.addEventListener("dragover", onDragOver);
    root.addEventListener("drop", onDrop);
    return () => {
      root.removeEventListener("click", onClick);
      root.removeEventListener("dblclick", onDbl);
      root.removeEventListener("dragstart", onDragStart);
      root.removeEventListener("dragover", onDragOver);
      root.removeEventListener("drop", onDrop);
    };
  }, [canvas?.content, layout, sectionMd, update]);

  // 选中高亮 + 页数估算
  useEffect(() => {
    const root = canvasRef.current;
    if (!root) return;
    root.querySelectorAll<HTMLElement>("[data-block-id]").forEach((el) => {
      const isSel = el.getAttribute("data-block-id") === selectedId;
      el.style.outline = isSel ? "2px solid #0f766e" : "";
      el.style.outlineOffset = isSel ? "2px" : "";
      el.style.cursor = "grab";
    });
    const page = root.querySelector(".jsw-page");
    if (page) setPages(Math.max(1, Math.ceil(page.scrollHeight / 1122)));
  }, [canvas?.content, selectedId]);

  // 缩放适配
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const fit = () => setZoom(Math.min(1, (stage.clientWidth - 48) / 794));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(stage);
    return () => ro.disconnect();
  }, []);

  // 编辑框定位：编辑态 block 的屏幕位置
  const editPos = useMemo(() => {
    if (!editing || !canvasRef.current) return null;
    const el = canvasRef.current.querySelector<HTMLElement>(
      `[data-block-id="${editing.blockId}"]`,
    );
    if (!el) return null;
    const host = canvasRef.current.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const z = zoom || 1;
    return {
      top: (r.top - host.top) / z,
      left: Math.max(0, (r.left - host.left) / z),
      width: Math.min(520, (r.width * (1 / z)) - 4),
    };
  }, [editing, zoom, canvas?.content]);

  const commitEdit = () => {
    if (!editing || !layout || markdown === null) return;
    if (editing.sectionId) {
      setMarkdown(replaceSectionMarkdown(markdown, editing.sectionId, editText));
    } else {
      update((draft) => {
        const b = draft.blocks.find((x) => x.id === editing.blockId);
        if (b) b.markdown = editText;
      });
    }
    setEditing(null);
    setDirty(true);
  };

  // 源文件加载（方案 B）
  const loadSourceFile = async () => {
    const path = await openFileDialog({
      multiple: false,
      directory: false,
      title: "选择简历 Markdown 源文件",
      filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }],
    });
    if (!path || typeof path !== "string") return;
    try {
      const text = await api.readImportSource(path);
      setSourceText(text);
      setSourceName(path.split("/").pop() ?? path);
      setDrawerOpen(true);
      setMode("source");
    } catch (e) {
      toast.error(`读取失败：${(e as Error).message}`);
    }
  };

  const loadSourceResume = async () => {
    const resumes = await api.listResumes();
    if (resumes.length === 0) {
      toast.info("简历库里还没有其他简历");
      return;
    }
    const first = resumes[0];
    const c = await api.readResume(first.id);
    setSourceText(c.markdown);
    setSourceName(first.title);
    setDrawerOpen(true);
    setMode("source");
  };

  const applyPreset = (preset: "single" | "sidebar" | "cards") => {
    update((draft) => {
      const ids = draft.blocks.map((b) => b.sectionId).filter(Boolean) as string[];
      const order = ["basic", "experience", "projects", "education", "skills"]
        .filter((id) => ids.includes(id));
      const all = [...order, ...ids.filter((id) => !order.includes(id))];
      const mk = (id: string, i: number): LayoutBlock => {
        const base: LayoutBlock = {
          id: `blk-${id}`, type: "section", sectionId: id, markdown: null,
          width: 12, hidden: false, card: false, tint: null,
        };
        if (preset === "sidebar") {
          if (["basic", "skills", "education"].includes(id)) return { ...base, width: 4 };
          return { ...base, width: 8 };
        }
        if (preset === "cards") {
          const tints = ["rose", "blue", "indigo", "teal", "amber"];
          return { ...base, card: true, tint: tints[i % tints.length] };
        }
        return base;
      };
      draft.blocks = all.map(mk);
    });
    toast.success("已应用预设，可继续微调");
  };

  if (!markdown || !layout) {
    return <div className="text-muted-foreground">加载中…</div>;
  }

  const selected = layout.blocks.find((b) => b.id === selectedId) ?? null;
  const missing = canvas?.missingSectionIds ?? [];

  return (
    <div className="flex h-full flex-col gap-3">
      {/* 顶栏 */}
      <div className="flex items-center gap-3">
        <Link
          to="/resumes/$resumeId/edit"
          params={{ resumeId }}
          className="flex h-11 items-center gap-1 rounded-md px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft aria-hidden /> 返回编辑
        </Link>
        <h1 className="flex-1 truncate text-lg font-semibold">
          排版 · {content.data?.resume.title}
        </h1>
        <span className={`text-sm ${dirty ? "text-amber-600" : "text-muted-foreground"}`}>
          {dirty ? "未保存" : "已保存"} · 约 {pages} 页
        </span>
        {/* 编辑模式二选一（A/B 验证） */}
        <div role="radiogroup" aria-label="编辑模式" className="flex overflow-hidden rounded-md border border-input">
          {(["canvas", "source"] as const).map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={mode === m}
              onClick={() => {
                setMode(m);
                if (m === "source") setDrawerOpen(true);
              }}
              className={`h-11 px-3 text-sm transition-colors ${
                mode === m ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"
              }`}
            >
              {m === "canvas" ? "画布直编" : "源文件粘贴"}
            </button>
          ))}
        </div>
        <Button onClick={() => save.mutate()} disabled={save.isPending || !dirty}>
          <Save data-icon="inline-start" /> 保存
        </Button>
        <Button variant="outline" onClick={() => exportPdf.mutate()} disabled={exportPdf.isPending}>
          导出 PDF
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        {/* 左面板 */}
        <aside className="flex w-72 shrink-0 flex-col gap-3 overflow-auto pr-1">
          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">页面</h2>
            <div className="grid grid-cols-2 gap-2">
              {([["marginTop", "上"], ["marginRight", "右"], ["marginBottom", "下"], ["marginLeft", "左"]] as const).map(
                ([key, label]) => (
                  <label key={key} className="flex flex-col gap-1 text-xs text-muted-foreground">
                    {label}边距 mm
                    <input
                      type="number" min={6} max={30} step={1}
                      value={layout.page[key]}
                      onChange={(e) =>
                        update((d) => { (d.page[key] as number) = Number(e.target.value); })
                      }
                      className="h-9 rounded-md border border-input bg-card px-2 text-sm"
                    />
                  </label>
                ),
              )}
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox" checked={layout.page.headerEnabled}
                onChange={(e) => update((d) => { d.page.headerEnabled = e.target.checked; })}
              />
              页眉
            </label>
            {layout.page.headerEnabled && (
              <input
                value={layout.page.headerMarkdown ?? ""}
                onChange={(e) => update((d) => { d.page.headerMarkdown = e.target.value; })}
                placeholder="如：张三 · 产品经理"
                className="mt-2 h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
              />
            )}
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox" checked={layout.page.footerEnabled}
                onChange={(e) => update((d) => { d.page.footerEnabled = e.target.checked; })}
              />
              页脚
            </label>
            {layout.page.footerEnabled && (
              <>
                <input
                  value={layout.page.footerMarkdown ?? ""}
                  onChange={(e) => update((d) => { d.page.footerMarkdown = e.target.value; })}
                  placeholder="页脚文案（可留空）"
                  className="mt-2 h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
                />
                <label className="mt-2 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox" checked={layout.page.footerPageNumbers}
                    onChange={(e) => update((d) => { d.page.footerPageNumbers = e.target.checked; })}
                  />
                  显示页码
                </label>
              </>
            )}
          </section>

          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">主题</h2>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  aria-label={`主题色 ${c}`}
                  onClick={() => update((d) => { d.theme.primary = c; })}
                  className={`size-8 rounded-full border-2 transition-transform hover:scale-110 ${
                    layout.theme.primary === c ? "border-foreground" : "border-transparent"
                  }`}
                  style={{ background: c }}
                />
              ))}
              <input
                type="color"
                aria-label="自定义主题色"
                value={layout.theme.primary}
                onChange={(e) => update((d) => { d.theme.primary = e.target.value; })}
                className="size-8 cursor-pointer rounded-full border border-input bg-card"
              />
            </div>
            <div className="mt-3 flex gap-2">
              {(["sans", "serif"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => update((d) => { d.theme.font = f; })}
                  className={`h-9 flex-1 rounded-md text-sm transition-colors ${
                    layout.theme.font === f ? "bg-primary text-primary-foreground" : "bg-muted hover:opacity-80"
                  }`}
                >
                  {f === "sans" ? "无衬线" : "衬线"}
                </button>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              {([["compact", "紧凑"], ["normal", "标准"], ["airy", "舒展"]] as const).map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => update((d) => { d.theme.density = v; })}
                  className={`h-9 flex-1 rounded-md text-sm transition-colors ${
                    layout.theme.density === v ? "bg-primary text-primary-foreground" : "bg-muted hover:opacity-80"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">容器（{layout.blocks.length}）</h2>
            <div className="flex flex-col gap-1">
              {layout.blocks.map((b) => {
                const label =
                  b.type === "section" ? (b.sectionId ?? "?") : `文本：${(b.markdown ?? "").slice(0, 12) || "空"}`;
                return (
                  <div
                    key={b.id}
                    onClick={() => setSelectedId(b.id)}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors ${
                      selectedId === b.id ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                    } ${b.hidden ? "opacity-40" : ""}`}
                  >
                    <span className="flex-1 truncate">{label}</span>
                    <select
                      value={b.width}
                      onChange={(e) =>
                        update((d) => {
                          const t = d.blocks.find((x) => x.id === b.id);
                          if (t) t.width = Number(e.target.value) as LayoutBlock["width"];
                        })
                      }
                      onClick={(e) => e.stopPropagation()}
                      className="h-7 rounded border border-input bg-card px-1 text-xs"
                      aria-label="宽度"
                    >
                      {[12, 8, 6, 4].map((w) => <option key={w} value={w}>{w}/12</option>)}
                    </select>
                    <button
                      aria-label={b.card ? "取消卡片" : "卡片化"}
                      onClick={(e) => { e.stopPropagation(); update((d) => { const t = d.blocks.find((x) => x.id === b.id); if (t) t.card = !t.card; }); }}
                      className={`grid size-7 place-items-center rounded hover:bg-muted ${b.card ? "text-primary" : "text-muted-foreground"}`}
                    >
                      <LayoutGrid className="size-3.5" aria-hidden />
                    </button>
                    <button
                      aria-label={b.hidden ? "显示" : "隐藏"}
                      onClick={(e) => { e.stopPropagation(); update((d) => { const t = d.blocks.find((x) => x.id === b.id); if (t) t.hidden = !t.hidden; }); }}
                      className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-muted"
                    >
                      {b.hidden ? <EyeOff className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
                    </button>
                    <button
                      aria-label="删除容器"
                      onClick={(e) => {
                        e.stopPropagation();
                        update((d) => { d.blocks = d.blocks.filter((x) => x.id !== b.id); });
                        if (selectedId === b.id) setSelectedId(null);
                      }}
                      className="grid size-7 place-items-center rounded text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm" variant="outline"
                onClick={() =>
                  update((d) => {
                    d.blocks.push({
                      id: `txt-${Date.now()}`, type: "text", sectionId: null,
                      markdown: "补充说明或自定义内容…", width: 12, hidden: false,
                      card: false, tint: null,
                    });
                  })
                }
              >
                <Plus data-icon="inline-start" /> 文本容器
              </Button>
              <Button size="sm" variant="outline" onClick={() => applyPreset("single")}>单栏</Button>
              <Button size="sm" variant="outline" onClick={() => applyPreset("sidebar")}>侧栏</Button>
              <Button size="sm" variant="outline" onClick={() => applyPreset("cards")}>卡片</Button>
            </div>
            {missing.length > 0 && (
              <div className="mt-3 rounded-md bg-amber-50 p-2 text-xs text-amber-700 dark:bg-status-amber/40 dark:text-amber-300">
                未摆放：{missing.join("、")}
                {missing.map((id) => (
                  <button
                    key={id}
                    onClick={() =>
                      update((d) => {
                        d.blocks.push({
                          id: `blk-${id}`, type: "section", sectionId: id, markdown: null,
                          width: 12, hidden: false, card: false, tint: null,
                        });
                      })
                    }
                    className="ml-2 rounded border border-amber-400 px-1.5 py-0.5 hover:bg-amber-100"
                  >
                    + {id}
                  </button>
                ))}
              </div>
            )}
          </section>
        </aside>

        {/* 画布 */}
        <div
          ref={stageRef}
          className="relative min-h-0 flex-1 overflow-auto rounded-xl bg-muted/60 p-6"
        >
          <div
            style={{ transform: `scale(${zoom})`, transformOrigin: "top center", width: 794, margin: "0 auto" }}
          >
            <div
              ref={canvasRef}
              className="jsw-canvas relative"
              style={{ width: 794 }}
            >
              {canvas?.ok && (
                <>
                  <style>{canvas.css}</style>
                  <div
                    key={(canvas.content || "").slice(0, 64) + layout.blocks.map((b) => `${b.id}:${b.hidden}:${b.width}`).join()}
                    dangerouslySetInnerHTML={{ __html: canvas.content || "" }}
                  />
                </>
              )}
              {/* 就地编辑（方案 A：双击容器；方案 B：双击后从右抽屉粘贴） */}
              {editing && editPos && (
                <div
                  className="absolute z-20 rounded-lg border border-border bg-card p-3 shadow-xl"
                  style={{ top: editPos.top, left: editPos.left, width: editPos.width }}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                >
                  <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {editing.sectionId ? `章节：${editing.sectionId}` : "文本容器"}
                      {mode === "source" && " · 从右侧源文件复制内容粘贴到此处"}
                    </span>
                    <span>Esc 取消</span>
                  </div>
                  <textarea
                    autoFocus
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setEditing(null);
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commitEdit();
                    }}
                    rows={8}
                    className="w-full rounded-md border border-input bg-background p-2 font-mono text-sm focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(null)}>取消</Button>
                    <Button size="sm" onClick={commitEdit}>完成（⌘↵）</Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 选中容器的浮动操作条 */}
          {selected && (
            <div className="pointer-events-none sticky top-0 z-10 flex justify-center">
              <div className="pointer-events-auto flex items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-md">
                <span className="px-2 text-xs text-muted-foreground">
                  {selected.type === "section" ? selected.sectionId : "文本容器"}
                </span>
                <ToolBtn label="上移" onClick={() => moveBlock(selected.id, -1)}><ArrowUp className="size-4" aria-hidden /></ToolBtn>
                <ToolBtn label="下移" onClick={() => moveBlock(selected.id, 1)}><ArrowDown className="size-4" aria-hidden /></ToolBtn>
                <span className="mx-1 h-4 w-px bg-border" />
                {[12, 8, 6, 4].map((w) => (
                  <ToolBtn
                    key={w}
                    label={`宽 ${w}`}
                    active={selected.width === w}
                    onClick={() => update((d) => { const t = d.blocks.find((x) => x.id === selected.id); if (t) t.width = w as LayoutBlock["width"]; })}
                  >
                    <span className="text-xs">{w}</span>
                  </ToolBtn>
                ))}
              </div>
            </div>
          )}

          {!canvas?.ok && (
            <div className="p-8 text-center text-sm text-muted-foreground">
              文档解析失败：{canvas?.errors.join("；")}
            </div>
          )}
        </div>

        {/* 右抽屉：源文件粘贴（方案 B） */}
        {(mode === "source" || drawerOpen) && (
          <aside className="flex w-96 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border p-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <FileText className="size-4" aria-hidden /> 源文件
                {sourceName && <span className="truncate font-normal text-muted-foreground">· {sourceName}</span>}
              </h2>
              <button
                onClick={() => setDrawerOpen(false)}
                aria-label="收起源文件面板"
                className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted"
              >
                <ChevronRight aria-hidden />
              </button>
            </div>
            <div className="flex gap-2 p-3">
              <Button size="sm" variant="outline" onClick={loadSourceFile}>选择文件…</Button>
              <Button size="sm" variant="outline" onClick={loadSourceResume}>从简历库选</Button>
              {sourceText && (
                <Button
                  size="sm" variant="ghost"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(sourceText);
                      toast.success("已复制全文，去容器里粘贴需要的部分");
                    } catch {
                      toast.error("复制失败，请手动选择");
                    }
                  }}
                >
                  <Copy data-icon="inline-start" /> 复制全文
                </Button>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
              {sourceText ? (
                <pre
                  className="select-text whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs leading-relaxed"
                >{sourceText}</pre>
              ) : (
                <p className="p-3 text-sm text-muted-foreground">
                  选一个 Markdown 源文件，从里面复制需要的片段，双击画布上的容器粘贴进去。
                </p>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );

  function moveBlock(id: string, delta: number) {
    update((d) => {
      const i = d.blocks.findIndex((b) => b.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= d.blocks.length) return;
      [d.blocks[i], d.blocks[j]] = [d.blocks[j], d.blocks[i]];
    });
  }
}

function ToolBtn({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`grid h-8 min-w-8 place-items-center rounded-md px-1.5 transition-colors ${
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

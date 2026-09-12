import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import {
  DndContext, PointerSensor, useSensor, useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Copy, Eye, EyeOff,
  FileText, GripVertical, LayoutGrid, Plus, Save, Trash2,
} from "lucide-react";
import { api, type LayoutConfig, type LayoutBlock } from "../lib/constants";
import {
  defaultLayoutFor, renderLayoutCanvas, replaceSectionMarkdown, splitSections,
} from "@jsw/markdown-resume";
import { Button } from "@jsw/ui";
import { TextareaFormatBar, textareaFormatHotkeys } from "../components/TextareaFormatBar";

export const Route = createFileRoute("/resumes/$resumeId/layout")({
  component: LayoutEditor,
});

type EditMode = "canvas" | "source";
type PresetKey = "timeline" | "modern" | "single" | "sidebar" | "cards";

const PRESET_COLORS = [
  "#0f766e", "#4f46e5", "#e11d48", "#ea580c",
  "#2563eb", "#7c3aed", "#0d9488", "#334155",
];

const TINT_OPTIONS = [
  ["rose", "#fecdd3"], ["blue", "#bfdbfe"], ["indigo", "#c7d2fe"],
  ["teal", "#99f6e4"], ["amber", "#fde68a"], ["", "#ffffff"],
] as const;

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
  const editAreaRef = useRef<HTMLTextAreaElement>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    (async () => {
      if (!content.data || markdown !== null) return;
      setMarkdown(content.data.markdown);
      const saved = await api.getLayout(resumeId).catch(() => null);
      if (saved) {
        setLayout(saved);
      } else {
        // 未排版过：按简历所选模板套对应版式（timeline/modern→同名版式，其余通栏）
        const fresh = defaultLayoutFor(content.data.markdown);
        if (content.data.resume.template_id === "builtin.timeline") {
          fresh.theme.heading = "dot";
          fresh.theme.primary = "#0d9488";
        } else if (content.data.resume.template_id === "builtin.modern") {
          fresh.theme.heading = "bar";
          fresh.theme.primary = "#7c3aed";
        }
        setLayout(fresh);
      }
    })();
  }, [content.data, markdown, resumeId]);

  const canvas = useMemo(
    () => (markdown && layout ? renderLayoutCanvas(markdown, layout) : null),
    [markdown, layout],
  );

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

  const patchBlock = useCallback((id: string, patch: Partial<LayoutBlock>) => {
    update((d) => {
      const b = d.blocks.find((x) => x.id === id);
      if (b) Object.assign(b, patch);
    });
  }, [update]);

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

  // ── 画布交互：点击选中 / 双击编辑 / 选中容器可拖拽排序 ──
  useEffect(() => {
    const root = canvasRef.current;
    if (!root || !canvas?.content) return;

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
      // 仅选中的容器可拖拽（未选中时保留文本选择）
      if (target.getAttribute("data-block-id") !== selectedId) {
        e.preventDefault();
        return;
      }
      dragId = selectedId;
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
  }, [canvas?.content, layout, sectionMd, update, selectedId]);

  // 选中高亮 + 拖拽属性 + 页数估算
  useEffect(() => {
    const root = canvasRef.current;
    if (!root) return;
    root.querySelectorAll<HTMLElement>("[data-block-id]").forEach((el) => {
      const id = el.getAttribute("data-block-id");
      const isSel = id === selectedId;
      el.style.outline = isSel ? "2px solid #0f766e" : "";
      el.style.outlineOffset = isSel ? "2px" : "";
      el.draggable = isSel;
      el.style.cursor = isSel ? "grab" : "pointer";
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

  const startEdit = (block: LayoutBlock) => {
    if (block.type === "section") {
      setEditText(sectionMd.get(block.sectionId ?? "") ?? "");
      setEditing({ blockId: block.id, sectionId: block.sectionId });
    } else {
      setEditText(block.markdown ?? "");
      setEditing({ blockId: block.id, sectionId: null });
    }
  };

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

  const applyPreset = (preset: PresetKey) => {
    update((draft) => {
      const ids = draft.blocks.map((b) => b.sectionId).filter(Boolean) as string[];
      const order = ["basic", "experience", "projects", "education", "skills"]
        .filter((id) => ids.includes(id));
      const all = [...order, ...ids.filter((id) => !order.includes(id))];
      const mk = (id: string, i: number): LayoutBlock => {
        const base: LayoutBlock = {
          id: `blk-${id}`, type: "section", sectionId: id, markdown: null,
          width: 12, hidden: false, card: false, tint: null,
          titleOverride: null, size: null,
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
      // 版式主题：时间线=节点标题+青绿；现代简洁=紫色短条；其余保持现主题
      if (preset === "timeline") {
        draft.theme.heading = "dot";
        draft.theme.primary = "#0d9488";
      } else if (preset === "modern") {
        draft.theme.heading = "bar";
        draft.theme.primary = "#7c3aed";
      }
    });
    setSelectedId(null);
    toast.success("已应用预设，可继续微调单个容器");
  };

  const onListDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    update((draft) => {
      const from = draft.blocks.findIndex((b) => b.id === active.id);
      const to = draft.blocks.findIndex((b) => b.id === over.id);
      if (from < 0 || to < 0) return;
      const [moved] = draft.blocks.splice(from, 1);
      draft.blocks.splice(to, 0, moved);
    });
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
        <aside className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto pr-1">
          {/* 整体布局（全局操作，置顶） */}
          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="mb-1 text-sm font-semibold">整体布局</h2>
            <p className="mb-3 text-xs text-muted-foreground">一键重排全部容器，之后再逐个微调。</p>
            <div className="grid grid-cols-3 gap-2">
              <PresetBtn label="时间线" desc="节点串联" onClick={() => applyPreset("timeline")} />
              <PresetBtn label="现代简洁" desc="紫色短条" onClick={() => applyPreset("modern")} />
              <PresetBtn label="通栏" desc="基础单栏" onClick={() => applyPreset("single")} />
              <PresetBtn label="侧栏" desc="左窄右宽" onClick={() => applyPreset("sidebar")} />
              <PresetBtn label="卡片" desc="彩色圆角" onClick={() => applyPreset("cards")} />
            </div>
          </section>

          {/* 选中容器编辑卡 */}
          {selected ? (
            <section className="rounded-xl border border-primary/40 bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">
                  编辑 · {selected.type === "section" ? sectionLabel(selected.sectionId) : "文本容器"}
                </h2>
                <div className="flex gap-1">
                  <ToolBtn label="上移" onClick={() => moveBlock(selected.id, -1)}><ArrowUp className="size-4" aria-hidden /></ToolBtn>
                  <ToolBtn label="下移" onClick={() => moveBlock(selected.id, 1)}><ArrowDown className="size-4" aria-hidden /></ToolBtn>
                  <ToolBtn
                    label={selected.hidden ? "显示" : "隐藏"}
                    onClick={() => patchBlock(selected.id, { hidden: !selected.hidden })}
                  >
                    {selected.hidden ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                  </ToolBtn>
                  <ToolBtn
                    label="删除"
                    onClick={() => {
                      update((d) => { d.blocks = d.blocks.filter((x) => x.id !== selected.id); });
                      setSelectedId(null);
                    }}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </ToolBtn>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                  宽度
                  <div className="flex gap-1.5">
                    {([12, 8, 6, 4] as const).map((w) => (
                      <button
                        key={w}
                        onClick={() => patchBlock(selected.id, { width: w })}
                        className={`h-9 flex-1 rounded-md text-sm transition-colors ${
                          selected.width === w ? "bg-primary text-primary-foreground" : "bg-muted hover:opacity-80"
                        }`}
                      >
                        {w === 12 ? "整行" : `${w}/12`}
                      </button>
                    ))}
                  </div>
                </label>

                {selected.type === "section" && (
                  <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                    标题（改写显示名；清空并保存 = 隐藏标题）
                    <div className="flex gap-1.5">
                      <input
                        value={selected.titleOverride ?? ""}
                        placeholder={sectionTitle(sectionMd.get(selected.sectionId ?? "") ?? "")}
                        onChange={(e) => patchBlock(selected.id, { titleOverride: e.target.value })}
                        className="h-9 flex-1 rounded-md border border-input bg-card px-2 text-sm"
                      />
                      {selected.titleOverride !== null && (
                        <button
                          onClick={() => patchBlock(selected.id, { titleOverride: null })}
                          className="shrink-0 rounded-md px-2 text-xs text-primary hover:underline"
                        >
                          用原文
                        </button>
                      )}
                    </div>
                  </label>
                )}

                <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                  字号
                  <div className="flex gap-1.5">
                    {([["small", "小"], ["normal", "标准"], ["large", "大"]] as const).map(([v, l]) => (
                      <button
                        key={v}
                        onClick={() => patchBlock(selected.id, { size: v })}
                        className={`h-9 flex-1 rounded-md text-sm transition-colors ${
                          (selected.size ?? "normal") === v ? "bg-primary text-primary-foreground" : "bg-muted hover:opacity-80"
                        }`}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                </label>

                <div className="flex items-center justify-between">
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox" checked={selected.card}
                      onChange={(e) => patchBlock(selected.id, { card: e.target.checked })}
                    />
                    卡片化（圆角浅底）
                  </label>
                  <ToolBtn
                    label="卡片化"
                    active={selected.card}
                    onClick={() => patchBlock(selected.id, { card: !selected.card })}
                  >
                    <LayoutGrid className="size-4" aria-hidden />
                  </ToolBtn>
                </div>

                {selected.card && (
                  <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                    卡片底色
                    <div className="flex gap-1.5">
                      {TINT_OPTIONS.map(([name, color]) => (
                        <button
                          key={name || "none"}
                          aria-label={name ? `底色 ${name}` : "无底色"}
                          onClick={() => patchBlock(selected.id, { tint: name || null })}
                          className={`size-7 rounded-md border-2 transition-transform hover:scale-110 ${
                            (selected.tint ?? "") === name ? "border-foreground" : "border-border"
                          }`}
                          style={{ background: color }}
                        />
                      ))}
                    </div>
                  </div>
                )}

                <Button size="sm" variant="outline" onClick={() => startEdit(selected)}>
                  编辑内容
                </Button>
              </div>
            </section>
          ) : (
            <section className="rounded-xl border border-dashed border-border bg-card/60 p-4 text-sm text-muted-foreground">
              点击画布或下方列表选中一个容器，在这里调它的宽度、标题、字号和样式。
            </section>
          )}

          {/* 页面设置 */}
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

          {/* 主题 */}
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
              {([["bar", "短条"], ["dot", "节点"], ["plain", "素标题"]] as const).map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => update((d) => { d.theme.heading = v; })}
                  className={`h-9 flex-1 rounded-md text-sm transition-colors ${
                    (layout.theme.heading ?? "bar") === v ? "bg-primary text-primary-foreground" : "bg-muted hover:opacity-80"
                  }`}
                >
                  {label}
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

          {/* 容器列表（拖拽排序） */}
          <section className="rounded-xl border border-border bg-card p-4">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-sm font-semibold">容器（{layout.blocks.length}）</h2>
              <Button
                size="sm" variant="ghost"
                onClick={() =>
                  update((d) => {
                    d.blocks.push({
                      id: `txt-${Date.now()}`, type: "text", sectionId: null,
                      markdown: "补充说明或自定义内容…", width: 12, hidden: false,
                      card: false, tint: null, titleOverride: null, size: null,
                    });
                  })
                }
              >
                <Plus data-icon="inline-start" /> 文本
              </Button>
            </div>
            <p className="mb-2 text-xs text-muted-foreground">拖 ≡ 排序；点行选中后在上方编辑。</p>
            <DndContext sensors={sensors} onDragEnd={onListDragEnd}>
              <SortableContext
                items={layout.blocks.map((b) => b.id)}
                strategy={verticalListSortingStrategy}
              >
                <ol className="flex flex-col gap-1">
                  {layout.blocks.map((b) => (
                    <SortableRow
                      key={b.id}
                      block={b}
                      selected={selectedId === b.id}
                      onSelect={() => setSelectedId(b.id)}
                    />
                  ))}
                </ol>
              </SortableContext>
            </DndContext>
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
                          titleOverride: null, size: null,
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
            <div ref={canvasRef} className={`jsw-canvas relative heading-${layout.theme.heading ?? "bar"}`} style={{ width: 794 }}>
              {canvas?.ok && (
                <>
                  <style>{canvas.css}</style>
                  <div
                    key={(canvas.content || "").slice(0, 64) + layout.blocks.map((b) => `${b.id}:${b.hidden}:${b.width}`).join()}
                    dangerouslySetInnerHTML={{ __html: canvas.content || "" }}
                  />
                </>
              )}
              {editing && editPos && (
                <div
                  className="absolute z-20 rounded-lg border border-border bg-card p-3 shadow-xl"
                  style={{ top: editPos.top, left: editPos.left, width: editPos.width }}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                >
                  <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {editing.sectionId ? `章节：${sectionLabel(editing.sectionId)}` : "文本容器"}
                      {mode === "source" && " · 从右侧源文件复制粘贴到此处"}
                    </span>
                    <span>Esc 取消</span>
                  </div>
                  <div className="mb-1.5 flex items-center justify-between rounded-md border border-border bg-muted/40 px-1 py-0.5">
                    <TextareaFormatBar
                      targetRef={editAreaRef}
                      value={editText}
                      onChange={setEditText}
                    />
                    <span className="pr-1.5 text-[11px] text-muted-foreground">⌘B / ⌘I / ⌘K</span>
                  </div>
                  <textarea
                    ref={editAreaRef}
                    autoFocus
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") { setEditing(null); return; }
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { commitEdit(); return; }
                      textareaFormatHotkeys(e, editText, setEditText);
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
                <pre className="select-text whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
                  {sourceText}
                </pre>
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

function sectionTitle(md: string): string {
  const m = /^\s*#{1,3}\s+(.+)$/m.exec(md);
  return m ? m[1].trim() : "";
}

function sectionLabel(id: string | null): string {
  const map: Record<string, string> = {
    basic: "基本信息", experience: "工作经历", projects: "项目经历",
    education: "教育经历", skills: "技能",
  };
  return (id && map[id]) || id || "?";
}

function PresetBtn({ label, desc, onClick }: { label: string; desc: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-0.5 rounded-lg border border-input bg-card px-2 py-2.5 text-sm transition-colors hover:border-ring hover:bg-accent"
    >
      <span className="font-medium">{label}</span>
      <span className="text-xs text-muted-foreground">{desc}</span>
    </button>
  );
}

function SortableRow({
  block,
  selected,
  onSelect,
}: {
  block: LayoutBlock;
  selected: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
  });
  const label =
    block.type === "section"
      ? (block.titleOverride?.trim() || sectionLabel(block.sectionId))
      : `文本：${(block.markdown ?? "").slice(0, 14) || "空"}`;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-1.5 rounded-md px-1.5 py-1.5 text-sm transition-colors ${
        selected ? "bg-accent text-accent-foreground" : "hover:bg-muted"
      } ${block.hidden ? "opacity-40" : ""} ${isDragging ? "opacity-60 shadow-md ring-1 ring-ring" : ""}`}
    >
      <button
        {...attributes}
        {...listeners}
        aria-label="拖动排序"
        className="grid size-7 cursor-grab place-items-center rounded text-muted-foreground hover:bg-muted active:cursor-grabbing"
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      <button onClick={onSelect} className="flex-1 truncate text-left" title={label}>
        {label}
      </button>
      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
        {block.width === 12 ? "整行" : `${block.width}/12`}
      </span>
    </li>
  );
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
      className={`grid size-8 place-items-center rounded-md transition-colors ${
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

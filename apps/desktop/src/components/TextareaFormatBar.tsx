import { useRef } from "react";
import { Bold, Heading2, Italic, Link2, List } from "lucide-react";

/**
 * 普通文本区的格式工具栏（排版页容器编辑框用）：
 * 对 textarea 选区应用 Markdown 标记，操作后恢复选区。
 */
export function TextareaFormatBar({
  targetRef,
  value,
  onChange,
}: {
  targetRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (next: string) => void;
}) {
  const restore = useRef<{ start: number; end: number } | null>(null);

  const apply = (fn: (sel: string, start: number, end: number) => { next: string; selStart: number; selEnd: number }) => {
    const el = targetRef.current;
    if (!el) return;
    const { selectionStart, selectionEnd } = el;
    const { next, selStart, selEnd } = fn(value, selectionStart, selectionEnd);
    onChange(next);
    restore.current = { start: selStart, end: selEnd };
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(selStart, selEnd);
    });
  };

  const wrap = (mark: string) =>
    apply((_sel, start, end) => {
      const text = value.slice(start, end);
      const has =
        text.length >= mark.length * 2 && text.startsWith(mark) && text.endsWith(mark);
      if (has) {
        const inner = text.slice(mark.length, text.length - mark.length);
        return {
          next: value.slice(0, start) + inner + value.slice(end),
          selStart: start,
          selEnd: start + inner.length,
        };
      }
      return {
        next: value.slice(0, start) + mark + text + mark + value.slice(end),
        selStart: start + mark.length,
        selEnd: start + mark.length + text.length,
      };
    });

  const prefix = (p: string) =>
    apply((_sel, start, end) => {
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const lineEndIdx = value.indexOf("\n", end);
      const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
      const line = value.slice(lineStart, lineEnd);
      const oldPrefix = /^(#{1,6} |- |\* |\d+\. )/.exec(line)?.[0] ?? "";
      const newPrefix = oldPrefix === p ? "" : p;
      const next =
        value.slice(0, lineStart) + newPrefix + line.slice(oldPrefix.length) + value.slice(lineEnd);
      return {
        next,
        selStart: start + (newPrefix.length - oldPrefix.length),
        selEnd: end + (newPrefix.length - oldPrefix.length),
      };
    });

  const link = () =>
    apply((_sel, start, end) => {
      const text = value.slice(start, end) || "链接文字";
      const insert = `[${text}](url)`;
      return {
        next: value.slice(0, start) + insert + value.slice(end),
        selStart: start + text.length + 3,
        selEnd: start + text.length + 6,
      };
    });

  return (
    <div role="toolbar" aria-label="格式" className="flex items-center gap-0.5">
      <Btn label="加粗（⌘B）" onClick={() => wrap("**")}><Bold className="size-3.5" aria-hidden /></Btn>
      <Btn label="斜体（⌘I）" onClick={() => wrap("*")}><Italic className="size-3.5" aria-hidden /></Btn>
      <Btn label="二级标题" onClick={() => prefix("## ")}><Heading2 className="size-3.5" aria-hidden /></Btn>
      <Btn label="列表项" onClick={() => prefix("- ")}><List className="size-3.5" aria-hidden /></Btn>
      <Btn label="链接（⌘K）" onClick={link}><Link2 className="size-3.5" aria-hidden /></Btn>
    </div>
  );
}

/** textarea 的 ⌘B/⌘I/⌘K 快捷键处理（挂 onKeyDown）。 */
export function textareaFormatHotkeys(
  e: React.KeyboardEvent<HTMLTextAreaElement>,
  value: string,
  onChange: (next: string) => void,
): boolean {
  if (!(e.metaKey || e.ctrlKey)) return false;
  const el = e.currentTarget;
  const { selectionStart: start, selectionEnd: end } = el;
  const text = value.slice(start, end);
  const wrapMark = (mark: string) => {
    e.preventDefault();
    const has =
      text.length >= mark.length * 2 && text.startsWith(mark) && text.endsWith(mark);
    const insert = has
      ? text.slice(mark.length, text.length - mark.length)
      : mark + text + mark;
    onChange(value.slice(0, start) + insert + value.slice(end));
    const s = start + (has ? 0 : mark.length);
    const t = s + insert.length - (has ? 0 : 0);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s, has ? t : t);
    });
    return true;
  };
  if (e.key === "b" || e.key === "B") return wrapMark("**");
  if (e.key === "i" || e.key === "I") return wrapMark("*");
  if (e.key === "k" || e.key === "K") {
    e.preventDefault();
    const label = text || "链接文字";
    const insert = `[${label}](url)`;
    onChange(value.slice(0, start) + insert + value.slice(end));
    const urlStart = start + label.length + 3;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(urlStart, urlStart + 3);
    });
    return true;
  }
  return false;
}

function Btn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
      onMouseDown={(e) => e.preventDefault()} /* 保持 textarea 选区不丢失 */
      className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}

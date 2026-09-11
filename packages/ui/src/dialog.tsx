import * as React from "react";
import { cn } from "./cn";

/**
 * 轻量 Dialog（无 radix 依赖）：
 * - 语义结构 Header/Title/Description/Footer（shadcn 组合规范）
 * - Esc 关闭、遮罩点击关闭、打开时锁定背景滚动
 * - 打开时聚焦第一个可聚焦元素，关闭后归还焦点
 */
interface DialogContextValue {
  open: boolean;
  close: () => void;
}

const DialogContext = React.createContext<DialogContextValue | null>(null);

function useDialog(): DialogContextValue {
  const ctx = React.useContext(DialogContext);
  if (!ctx) throw new Error("Dialog 子组件必须在 <Dialog> 内使用");
  return ctx;
}

export function Dialog({
  open,
  onOpenChange,
  children,
  className,
  ariaLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  className?: string;
  /** 无可见 Title 时的可访问名称 */
  ariaLabel?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const previousFocus = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    const first = ref.current?.querySelector<HTMLElement>(
      "input, textarea, select, button:not([data-close]), [href], [tabindex]:not([tabindex='-1'])",
    );
    first?.focus();
    return () => {
      document.body.style.overflow = "";
      previousFocus.current?.focus();
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <DialogContext.Provider value={{ open, close: () => onOpenChange(false) }}>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
        <div
          className="absolute inset-0 bg-black/50"
          data-close
          aria-hidden
          onClick={() => onOpenChange(false)}
        />
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          className={cn(
            "relative z-10 flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-xl bg-card text-card-foreground shadow-xl",
            className,
          )}
        >
          {children}
        </div>
      </div>
    </DialogContext.Provider>
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-start justify-between gap-4 border-b border-border p-5", className)}
      {...props}
    />
  );
}

export function DialogTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-lg font-semibold", className)} {...props} />;
}

export function DialogDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("mt-1 text-sm text-muted-foreground", className)} {...props} />;
}

export function DialogContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-h-0 flex-1 overflow-auto p-5", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex justify-end gap-2 border-t border-border p-4", className)}
      {...props}
    />
  );
}

export function DialogCloseButton({ className }: { className?: string }) {
  const { close } = useDialog();
  return (
    <button
      data-close
      onClick={close}
      aria-label="关闭"
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    </button>
  );
}

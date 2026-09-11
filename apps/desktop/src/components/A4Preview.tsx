import { useEffect, useRef, useState } from "react";
import { cn } from "@jsw/ui";

/** A4 @96dpi 的像素尺寸 */
export const A4_WIDTH_PX = 794;
export const A4_HEIGHT_PX = 1123;

/**
 * A4 等比缩放预览：iframe srcdoc + sandbox（不设 allow-scripts，spec §8.3），
 * 通过 ResizeObserver 计算缩放比例适配容器宽度。
 */
export function A4Preview({
  html,
  className,
  title = "简历预览",
}: {
  html: string;
  className?: string;
  title?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / A4_WIDTH_PX);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn("relative w-full overflow-hidden bg-white", className)}
      style={{ aspectRatio: "210 / 297" }}
    >
      {scale > 0 && (
        <iframe
          title={title}
          sandbox=""
          srcDoc={html}
          className="absolute left-0 top-0 border-0 bg-white"
          style={{
            width: A4_WIDTH_PX,
            height: A4_HEIGHT_PX,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        />
      )}
    </div>
  );
}

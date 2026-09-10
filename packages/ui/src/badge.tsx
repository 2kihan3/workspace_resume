import * as React from "react";
import { cn } from "./cn";
import { cva, type VariantProps } from "class-variance-authority";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "text-foreground",
        pending_analysis: "bg-zinc-100 text-zinc-700 border-zinc-200",
        pending_resume_optimization: "bg-sky-100 text-sky-800 border-sky-200",
        pending_communication: "bg-violet-100 text-violet-800 border-violet-200",
        pending_application: "bg-amber-100 text-amber-800 border-amber-200",
        interviewing: "bg-blue-100 text-blue-800 border-blue-200",
        passed: "bg-emerald-100 text-emerald-800 border-emerald-200",
        rejected: "bg-rose-100 text-rose-700 border-rose-200",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

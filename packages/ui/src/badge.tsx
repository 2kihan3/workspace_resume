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
        outline: "border-border text-foreground",
        pending_analysis: "border-transparent bg-status-neutral text-foreground",
        pending_resume_optimization: "border-transparent bg-status-info text-sky-800 dark:text-sky-200",
        pending_communication: "border-transparent bg-status-violet text-violet-800 dark:text-violet-200",
        pending_application: "border-transparent bg-status-amber text-amber-800 dark:text-amber-200",
        interviewing: "border-transparent bg-status-blue text-blue-800 dark:text-blue-200",
        passed: "border-transparent bg-status-pass text-emerald-800 dark:text-emerald-200",
        rejected: "border-transparent bg-status-fail text-rose-700 dark:text-rose-200",
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

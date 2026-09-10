import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { api, JOB_STATUS_ORDER, JOB_STATUS_LABELS } from "../lib/constants";
import { classifyTransition } from "@jsw/domain";
import type { JobStatus, JobSummary } from "../lib/types";

export const Route = createFileRoute("/dashboard")({ component: Dashboard });

function Dashboard() {
  const qc = useQueryClient();
  const metrics = useQuery({ queryKey: ["metrics"], queryFn: api.dashboardMetrics });
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: () => api.listJobs({}) });
  const [dragging, setDragging] = useState<JobSummary | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<JobStatus | null>(null);

  const transition = useMutation({
    mutationFn: (args: { id: string; to: JobStatus }) =>
      api.transitionJob(args.id, { to_status: args.to }),
    onSuccess: () => {
      toast.success("状态已更新");
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["metrics"] });
    },
    onError: (e) => toast.error(`状态更新失败：${(e as Error).message}`),
  });

  const m = metrics.data;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">求职看板</h1>

      <div className="grid grid-cols-5 gap-3">
        {[
          ["有效岗位", m?.total_active],
          ["待处理", m?.pending],
          ["面试阶段", m?.interviewing],
          ["通过", m?.passed],
          ["未通过", m?.rejected],
        ].map(([label, value]) => (
          <div
            key={String(label)}
            className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="text-sm text-zinc-500">{label}</div>
            <div className="text-2xl font-semibold">{value ?? "…"}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-3 overflow-x-auto">
        {JOB_STATUS_ORDER.map((status) => {
          const cards = (jobs.data ?? []).filter((j) => j.status === status);
          return (
            <div
              key={status}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (!dragging) return;
                if (dragging.status === status) return;
                const decision = classifyTransition(dragging.status, status);
                if (decision.requiresConfirmation) {
                  setConfirmTarget(status);
                } else {
                  transition.mutate({ id: dragging.id, to: status });
                }
                setDragging(null);
              }}
              className="min-h-64 rounded-lg bg-zinc-100 p-2 dark:bg-zinc-800/60"
            >
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-sm font-medium">{JOB_STATUS_LABELS[status]}</span>
                <span className="text-xs text-zinc-500">{cards.length}</span>
              </div>
              <div className="flex flex-col gap-2">
                {cards.map((job) => (
                  <div
                    key={job.id}
                    draggable
                    onDragStart={() => setDragging(job)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        window.location.hash = `/jobs/${job.id}`;
                      }
                    }}
                    role="button"
                    aria-label={`${job.company_name} ${job.role_title}`}
                    className="cursor-grab rounded-md border border-zinc-200 bg-white p-3 text-sm shadow-sm hover:shadow dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    <Link to="/jobs/$jobId" params={{ jobId: job.id }} className="font-medium hover:underline">
                      {job.company_name}
                    </Link>
                    <div className="text-zinc-500">{job.role_title || "未填写岗位"}</div>
                    {job.location && (
                      <div className="mt-1 text-xs text-zinc-400">{job.location}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {confirmTarget && dragging && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="确认状态变更"
            className="w-96 rounded-lg bg-white p-6 shadow-xl dark:bg-zinc-900"
          >
            <h2 className="mb-2 text-lg font-semibold">确认变更状态？</h2>
            <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-300">
              将把「{dragging.company_name}」从「{JOB_STATUS_LABELS[dragging.status]}」变更为
              「{JOB_STATUS_LABELS[confirmTarget]}」。此操作会记录到时间线。
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="min-h-[44px] rounded-md px-4 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                onClick={() => setConfirmTarget(null)}
              >
                取消
              </button>
              <button
                className="min-h-[44px] rounded-md bg-zinc-900 px-4 text-white dark:bg-zinc-100 dark:text-zinc-900"
                onClick={() => {
                  transition.mutate({ id: dragging.id, to: confirmTarget });
                  setConfirmTarget(null);
                }}
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

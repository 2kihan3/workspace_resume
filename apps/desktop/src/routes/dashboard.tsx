import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { api, JOB_STATUS_ORDER, JOB_STATUS_LABELS } from "../lib/constants";
import { Button, Card, Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@jsw/ui";
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
          <Card key={String(label)} className="p-4">
            <div className="text-sm text-muted-foreground">{label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{value ?? "\u2026"}</div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-3 overflow-x-auto pb-1">
        {JOB_STATUS_ORDER.map((status) => {
          const cards = (jobs.data ?? []).filter((j) => j.status === status);
          return (
            <div
              key={status}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (!dragging || dragging.status === status) return;
                const decision = classifyTransition(dragging.status, status);
                if (decision.requiresConfirmation) {
                  setConfirmTarget(status);
                } else {
                  transition.mutate({ id: dragging.id, to: status });
                }
                setDragging(null);
              }}
              className="flex min-h-64 flex-col gap-2 rounded-xl bg-muted/60 p-2"
            >
              <div className="flex items-center justify-between px-1 py-1">
                <span className="text-sm font-medium">{JOB_STATUS_LABELS[status]}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{cards.length}</span>
              </div>
              {cards.map((job) => (
                <div
                  key={job.id}
                  draggable
                  onDragStart={() => setDragging(job)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") window.location.hash = `/jobs/${job.id}`;
                  }}
                  role="button"
                  aria-label={`${job.company_name} ${job.role_title}`}
                  className="cursor-grab rounded-lg border border-border bg-card p-3 text-sm shadow-sm transition-shadow duration-150 hover:shadow-md"
                >
                  <Link to="/jobs/$jobId" params={{ jobId: job.id }} className="font-medium hover:underline">
                    {job.company_name}
                  </Link>
                  <div className="text-muted-foreground">{job.role_title || "未填写岗位"}</div>
                  {job.location && <div className="mt-1 text-xs text-muted-foreground">{job.location}</div>}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <Dialog
        open={confirmTarget !== null && !!dragging}
        onOpenChange={(o) => !o && setConfirmTarget(null)}
        ariaLabel="确认状态变更"
      >
        <DialogHeader>
          <DialogTitle>确认变更状态</DialogTitle>
          <DialogDescription>
            「{dragging?.company_name}」将从「
            {dragging ? JOB_STATUS_LABELS[dragging.status] : ""}」移动到「
            {confirmTarget ? JOB_STATUS_LABELS[confirmTarget] : ""}」，并记录到时间线。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setConfirmTarget(null)}>
            取消
          </Button>
          <Button
            onClick={() => {
              if (dragging && confirmTarget) transition.mutate({ id: dragging.id, to: confirmTarget });
              setConfirmTarget(null);
            }}
          >
            确认移动
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

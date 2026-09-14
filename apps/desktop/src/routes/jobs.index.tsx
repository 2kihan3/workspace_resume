import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { JobDeleteDialog, JobEditDialog, jobEditable } from "../components/JobDialogs";
import { api, JOB_STATUS_LABELS } from "../lib/constants";
import type { JobSummary } from "../lib/types";
import { Badge, Button, Card, Empty, Input, Label, Textarea } from "@jsw/ui";

export const Route = createFileRoute("/jobs/")({ component: JobsPage });

function JobsPage() {
  const qc = useQueryClient();
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: () => api.listJobs({}) });
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [jd, setJd] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<JobSummary | null>(null);
  const [deleting, setDeleting] = useState<JobSummary | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.createJob({ company_name: company, role_title: role, jd_markdown: jd }),
    onSuccess: () => {
      toast.success("岗位已创建");
      setCompany(""); setRole(""); setJd(""); setShowForm(false);
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["metrics"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">岗位库</h1>
        <Button onClick={() => setShowForm((v) => !v)}>
          <Plus data-icon="inline-start" />
          {showForm ? "收起表单" : "新建岗位"}
        </Button>
      </div>

      {showForm && (
        <Card className="p-5">
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => { e.preventDefault(); create.mutate(); }}
          >
            <div className="grid grid-cols-2 gap-4">
              <Label>
                公司名称 *
                <Input required value={company} onChange={(e) => setCompany(e.target.value)} placeholder="如：示例科技" />
              </Label>
              <Label>
                岗位名称
                <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="如：高级产品经理" />
              </Label>
            </div>
            <Label>
              JD 内容（Markdown）*
              <Textarea required rows={8} value={jd} onChange={(e) => setJd(e.target.value)} className="font-mono text-[15px]" />
            </Label>
            <div className="flex justify-end">
              <Button type="submit" disabled={create.isPending}>创建并进入分析</Button>
            </div>
          </form>
        </Card>
      )}

      {editing && <JobEditDialog job={editing} open onOpenChange={() => setEditing(null)} />}
      {deleting && <JobDeleteDialog job={deleting} open onOpenChange={() => setDeleting(null)} />}

      <div className="flex flex-col gap-2">
        {(jobs.data ?? []).map((job) => (
          <div
            key={job.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 transition-shadow duration-150 hover:shadow-md"
          >
            <Link to="/jobs/$jobId" params={{ jobId: job.id }} className="min-w-0 flex-1">
              <div className="font-medium">{job.company_name}</div>
              <div className="text-sm text-muted-foreground">
                {job.role_title || "未填写岗位"}
                {job.location ? ` · ${job.location}` : ""}
                {job.salary_text ? ` · ${job.salary_text}` : ""}
              </div>
            </Link>
            <div className="flex shrink-0 items-center gap-1">
              {jobEditable(job.status) ? (
                <button
                  aria-label="编辑岗位信息"
                  title="编辑岗位信息（优化简历前可用）"
                  onClick={() => setEditing(job)}
                  className="grid size-9 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Pencil className="size-4" aria-hidden />
                </button>
              ) : null}
              <button
                aria-label="删除岗位"
                title="删除岗位"
                onClick={() => setDeleting(job)}
                className="grid size-9 place-items-center rounded-md text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
              <Badge variant={job.status}>{JOB_STATUS_LABELS[job.status]}</Badge>
            </div>
          </div>
        ))}
        {jobs.data?.length === 0 && (
          <Empty
            title="还没有岗位"
            description="新建一个岗位，粘贴 JD 后就能开始分析和跟进。"
            action={<Button onClick={() => setShowForm(true)}>新建岗位</Button>}
          />
        )}
      </div>
    </div>
  );
}

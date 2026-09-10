import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { api, JOB_STATUS_LABELS } from "../lib/constants";
import { Badge } from "@jsw/ui";

export const Route = createFileRoute("/jobs/")({ component: JobsPage });

function JobsPage() {
  const qc = useQueryClient();
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: () => api.listJobs({}) });
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [jd, setJd] = useState("");
  const [showForm, setShowForm] = useState(false);

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
        <button
          onClick={() => setShowForm((v) => !v)}
          className="min-h-[44px] rounded-md bg-zinc-900 px-4 text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          {showForm ? "收起" : "新建岗位"}
        </button>
      </div>

      {showForm && (
        <form
          className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
          onSubmit={(e) => { e.preventDefault(); create.mutate(); }}
        >
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              公司名称 *
              <input required value={company} onChange={(e) => setCompany(e.target.value)}
                className="min-h-[44px] rounded-md border border-zinc-300 px-3 dark:border-zinc-700 dark:bg-zinc-800" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              岗位名称
              <input value={role} onChange={(e) => setRole(e.target.value)}
                className="min-h-[44px] rounded-md border border-zinc-300 px-3 dark:border-zinc-700 dark:bg-zinc-800" />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            JD 内容（Markdown）*
            <textarea required rows={8} value={jd} onChange={(e) => setJd(e.target.value)}
              className="rounded-md border border-zinc-300 p-3 font-mono text-[15px] dark:border-zinc-700 dark:bg-zinc-800" />
          </label>
          <div className="flex justify-end">
            <button type="submit" disabled={create.isPending}
              className="min-h-[44px] rounded-md bg-zinc-900 px-4 text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
              创建并进入分析
            </button>
          </div>
        </form>
      )}

      <div className="flex flex-col gap-2">
        {(jobs.data ?? []).map((job) => (
          <Link
            key={job.id}
            to="/jobs/$jobId"
            params={{ jobId: job.id }}
            className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white p-4 hover:shadow dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div>
              <div className="font-medium">{job.company_name}</div>
              <div className="text-sm text-zinc-500">
                {job.role_title || "未填写岗位"}
                {job.location ? ` · ${job.location}` : ""}
                {job.salary_text ? ` · ${job.salary_text}` : ""}
              </div>
            </div>
            <Badge variant={job.status}>{JOB_STATUS_LABELS[job.status]}</Badge>
          </Link>
        ))}
        {jobs.data?.length === 0 && (
          <div className="py-16 text-center text-zinc-500">还没有岗位，点击「新建岗位」开始。</div>
        )}
      </div>
    </div>
  );
}

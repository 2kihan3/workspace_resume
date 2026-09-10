import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { api, JOB_STATUS_LABELS, JOB_STATUS_ORDER } from "../lib/constants";
import { Badge } from "@jsw/ui";
import type { JobStatus } from "../lib/types";

export const Route = createFileRoute("/jobs/$jobId")({ component: JobDetail });

const TABS = ["概览", "JD 与分析", "岗位简历", "沟通", "面试", "AI 记录"] as const;

function JobDetail() {
  const { jobId } = Route.useParams();
  const [tab, setTab] = useState<(typeof TABS)[number]>("概览");
  const job = useQuery({ queryKey: ["job", jobId], queryFn: () => api.getJob(jobId) });

  if (!job.data) {
    return <div className="text-zinc-500">加载中…</div>;
  }
  const j = job.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/jobs" className="text-sm text-zinc-500 hover:underline">← 返回岗位库</Link>
          <h1 className="text-2xl font-semibold">
            {j.company_name}
            {j.role_title ? ` · ${j.role_title}` : ""}
          </h1>
        </div>
        <Badge variant={j.status}>{JOB_STATUS_LABELS[j.status]}</Badge>
      </div>

      <div role="tablist" aria-label="岗位详情" className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`min-h-[44px] px-4 text-[15px] ${
              tab === t
                ? "border-b-2 border-zinc-900 font-medium dark:border-zinc-100"
                : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "概览" && <OverviewTab jobId={jobId} status={j.status} />}
      {tab === "JD 与分析" && <JdTab jobId={jobId} />}
      {tab === "岗位简历" && <ResumeTab jobId={jobId} />}
      {tab === "沟通" && <CommunicationTab jobId={jobId} />}
      {tab === "面试" && <InterviewTab jobId={jobId} />}
      {tab === "AI 记录" && <AIRunsTab jobId={jobId} />}
    </div>
  );
}

function OverviewTab({ jobId, status }: { jobId: string; status: JobStatus }) {
  const qc = useQueryClient();
  const events = useQuery({ queryKey: ["events", jobId], queryFn: () => api.listJobEvents(jobId) });
  const [target, setTarget] = useState<JobStatus>(status);
  const [reason, setReason] = useState("");

  const transition = useMutation({
    mutationFn: () => api.transitionJob(jobId, { to_status: target, reason: reason || null }),
    onSuccess: () => {
      toast.success("状态已变更");
      qc.invalidateQueries({ queryKey: ["job", jobId] });
      qc.invalidateQueries({ queryKey: ["events", jobId] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="grid grid-cols-2 gap-6">
      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-3 font-medium">手动调整状态</h2>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            目标状态
            <select value={target} onChange={(e) => setTarget(e.target.value as JobStatus)}
              className="min-h-[44px] rounded-md border border-zinc-300 px-3 dark:border-zinc-700 dark:bg-zinc-800">
              {JOB_STATUS_ORDER.map((s) => (
                <option key={s} value={s}>{JOB_STATUS_LABELS[s]}</option>
              ))}
            </select>
          </label>
          {(target === "passed" || target === "rejected") && (
            <label className="flex flex-col gap-1 text-sm">
              原因（可选）
              <input value={reason} onChange={(e) => setReason(e.target.value)}
                className="min-h-[44px] rounded-md border border-zinc-300 px-3 dark:border-zinc-700 dark:bg-zinc-800" />
            </label>
          )}
          <button onClick={() => transition.mutate()}
            className="min-h-[44px] self-start rounded-md bg-zinc-900 px-4 text-white dark:bg-zinc-100 dark:text-zinc-900">
            应用变更
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-3 font-medium">时间线</h2>
        <ol className="flex flex-col gap-2 text-sm">
          {(events.data ?? []).map((ev) => (
            <li key={ev.id} className="border-l-2 border-zinc-200 pl-3 dark:border-zinc-700">
              <div>
                {ev.event_type}
                {ev.from_status && ev.to_status && (
                  <span className="text-zinc-500">
                    ：{JOB_STATUS_LABELS[ev.from_status]} → {JOB_STATUS_LABELS[ev.to_status]}
                  </span>
                )}
              </div>
              <div className="text-xs text-zinc-400">
                {ev.occurred_at} · {ev.actor === "user" ? "用户" : ev.actor === "system" ? "系统" : "AI"}
              </div>
            </li>
          ))}
          {events.data?.length === 0 && <li className="text-zinc-500">暂无事件</li>}
        </ol>
      </section>
    </div>
  );
}

function JdTab({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const jd = useQuery({ queryKey: ["jd", jobId], queryFn: () => api.readJd(jobId) });
  const artifacts = useQuery({ queryKey: ["artifacts", jobId], queryFn: () => api.readJobArtifacts(jobId) });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const save = useMutation({
    mutationFn: () => api.updateJd(jobId, draft),
    onSuccess: () => {
      toast.success("JD 已保存");
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["jd", jobId] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const analysis = (artifacts.data ?? []).find((a) => a.name === "jd-analysis.json");
  const research = (artifacts.data ?? []).find((a) => a.name === "company-research.md");
  const sources = (artifacts.data ?? []).find((a) => a.name === "company-sources.json");

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-medium">原始 JD</h2>
          {editing ? (
            <button onClick={() => save.mutate()} className="min-h-[44px] rounded-md bg-zinc-900 px-4 text-white dark:bg-zinc-100 dark:text-zinc-900">
              保存
            </button>
          ) : (
            <button onClick={() => { setDraft(jd.data ?? ""); setEditing(true); }}
              className="min-h-[44px] rounded-md border border-zinc-300 px-4 dark:border-zinc-700">
              编辑
            </button>
          )}
        </div>
        {editing ? (
          <textarea rows={14} value={draft} onChange={(e) => setDraft(e.target.value)}
            className="w-full rounded-md border border-zinc-300 p-3 font-mono text-[15px] dark:border-zinc-700 dark:bg-zinc-800" />
        ) : (
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-[15px]">{jd.data}</pre>
        )}
      </section>

      {analysis && (
        <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-2 font-medium">JD 结构化分析</h2>
          <JDAnalysisView json={analysis.content} />
        </section>
      )}
      {research && (
        <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-2 font-medium">公司调研</h2>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-[15px]">{research.content}</pre>
        </section>
      )}
      {sources && (
        <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-2 font-medium">调研来源</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {(safeParse(sources.content) as Array<{ title?: string; url?: string; publisher?: string }>).map((s, i) => (
              <li key={i}>
                <a href={s.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline dark:text-blue-400">
                  {s.title || s.url}
                </a>
                {s.publisher ? ` — ${s.publisher}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return []; }
}

function JDAnalysisView({ json }: { json: string }) {
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(json); } catch { /* 忽略 */ }
  const list = (key: string) => {
    const arr = data[key];
    return Array.isArray(arr) && arr.length > 0 ? (
      <div>
        <div className="text-sm font-medium text-zinc-500">{key}</div>
        <ul className="list-disc pl-5 text-[15px]">
          {arr.map((v, i) => <li key={i}>{String(v)}</li>)}
        </ul>
      </div>
    ) : null;
  };
  return (
    <div className="flex flex-col gap-3">
      {typeof data.summary === "string" && <p className="text-[15px]">{data.summary}</p>}
      {list("responsibilities")}
      {list("mustHave")}
      {list("niceToHave")}
      {list("keywords")}
      {list("candidateRisks")}
      {list("questionsToClarify")}
    </div>
  );
}

function ResumeTab({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const resumes = useQuery({ queryKey: ["resumes"], queryFn: api.listResumes });
  const job = useQuery({ queryKey: ["job", jobId], queryFn: () => api.getJob(jobId) });
  const [selected, setSelected] = useState<string>("");

  const enqueue = useMutation({
    mutationFn: () =>
      api.enqueueRun({ run_type: "resume_tailoring", job_id: jobId, resume_id: selected }),
    onSuccess: () => {
      toast.success("简历优化任务已入队");
      qc.invalidateQueries({ queryKey: ["runs", jobId] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const tailored = (resumes.data ?? []).filter((r) => r.job_id === jobId);
  const bases = (resumes.data ?? []).filter((r) => r.kind === "base");

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-3 font-medium">生成岗位版简历</h2>
        <div className="flex items-end gap-3">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            选择基础简历
            <select value={selected} onChange={(e) => setSelected(e.target.value)}
              className="min-h-[44px] rounded-md border border-zinc-300 px-3 dark:border-zinc-700 dark:bg-zinc-800">
              <option value="">请选择…</option>
              {bases.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
            </select>
          </label>
          <button
            disabled={!selected || enqueue.isPending}
            onClick={() => enqueue.mutate()}
            className="min-h-[44px] rounded-md bg-zinc-900 px-4 text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
            运行优化
          </button>
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          将发送 inputs/jd.md、inputs/job.json、inputs/base-resume.md 给本机 Codex。
        </p>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-3 font-medium">岗位版简历</h2>
        {job.data?.active_resume_id && (
          <p className="mb-2 text-xs text-zinc-500">当前生效：{job.data.active_resume_id}</p>
        )}
        <div className="flex flex-col gap-2">
          {tailored.map((r) => (
            <Link key={r.id} to="/resumes/$resumeId/edit" params={{ resumeId: r.id }}
              className="rounded-md border border-zinc-200 p-3 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
              {r.title} <span className="text-zinc-400">（{r.updated_at}）</span>
            </Link>
          ))}
          {tailored.length === 0 && <div className="text-sm text-zinc-500">暂无岗位版简历</div>}
        </div>
      </section>
    </div>
  );
}

function CommunicationTab({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["comms", jobId], queryFn: () => api.listCommunications(jobId) });
  const [channel, setChannel] = useState("phone");
  const [notes, setNotes] = useState("");
  const [contact, setContact] = useState("");
  const [advance, setAdvance] = useState(false);

  const add = useMutation({
    mutationFn: () =>
      api.addCommunication(jobId, {
        occurred_at: new Date().toISOString(),
        contact_name: contact || null,
        channel,
        notes,
        advance_to_pending_application: advance,
      }),
    onSuccess: () => {
      toast.success(advance ? "沟通已记录，岗位进入待投递" : "沟通已记录");
      setNotes(""); setContact("");
      qc.invalidateQueries({ queryKey: ["comms", jobId] });
      qc.invalidateQueries({ queryKey: ["job", jobId] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const apply = useMutation({
    mutationFn: () =>
      api.addApplication(jobId, {
        applied_at: new Date().toISOString(),
        channel: "other",
        notes: "",
      }),
    onSuccess: () => {
      toast.success("投递已记录，岗位进入面试阶段");
      qc.invalidateQueries({ queryKey: ["job", jobId] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="grid grid-cols-2 gap-6">
      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-3 font-medium">新增沟通记录</h2>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            渠道
            <select value={channel} onChange={(e) => setChannel(e.target.value)}
              className="min-h-[44px] rounded-md border border-zinc-300 px-3 dark:border-zinc-700 dark:bg-zinc-800">
              {["phone", "email", "wechat", "linkedin", "meeting", "other"].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            联系人
            <input value={contact} onChange={(e) => setContact(e.target.value)}
              className="min-h-[44px] rounded-md border border-zinc-300 px-3 dark:border-zinc-700 dark:bg-zinc-800" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            备注
            <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)}
              className="rounded-md border border-zinc-300 p-3 text-[15px] dark:border-zinc-700 dark:bg-zinc-800" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={advance} onChange={(e) => setAdvance(e.target.checked)} />
            完成沟通，进入待投递
          </label>
          <button onClick={() => add.mutate()} disabled={add.isPending}
            className="min-h-[44px] self-start rounded-md bg-zinc-900 px-4 text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
            记录
          </button>
        </div>
        <hr className="my-4 border-zinc-200 dark:border-zinc-800" />
        <button onClick={() => apply.mutate()} disabled={apply.isPending}
          className="min-h-[44px] w-full rounded-md border border-zinc-300 dark:border-zinc-700">
          记录投递动作（进入面试阶段）
        </button>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-3 font-medium">沟通历史</h2>
        <ol className="flex flex-col gap-2 text-sm">
          {(list.data ?? []).map((c) => (
            <li key={c.id} className="rounded-md bg-zinc-50 p-3 dark:bg-zinc-800/60">
              <div>{c.channel}{c.contact_name ? ` · ${c.contact_name}` : ""}</div>
              <div className="text-zinc-500">{c.notes}</div>
              <div className="text-xs text-zinc-400">{c.occurred_at}</div>
            </li>
          ))}
          {list.data?.length === 0 && <li className="text-zinc-500">暂无沟通记录</li>}
        </ol>
      </section>
    </div>
  );
}

function InterviewTab({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["interviews", jobId], queryFn: () => api.listInterviews(jobId) });
  const [name, setName] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");

  const add = useMutation({
    mutationFn: () =>
      api.upsertInterview(jobId, {
        name,
        status: scheduledAt ? "scheduled" : "planned",
        scheduled_at: scheduledAt || null,
        notes: "",
      }),
    onSuccess: () => {
      toast.success("面试轮次已添加");
      setName(""); setScheduledAt("");
      qc.invalidateQueries({ queryKey: ["interviews", jobId] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const complete = useMutation({
    mutationFn: (args: { id: string; result: string }) =>
      api.upsertInterview(jobId, {
        id: args.id,
        name: (list.data ?? []).find((r) => r.id === args.id)?.name ?? "面试",
        status: "completed",
        notes: "",
        result: args.result,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["interviews", jobId] });
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-3 font-medium">添加面试轮次</h2>
        <div className="flex items-end gap-3">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            轮次名称
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：一面 / 技术面"
              className="min-h-[44px] rounded-md border border-zinc-300 px-3 dark:border-zinc-700 dark:bg-zinc-800" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            时间（可选）
            <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)}
              className="min-h-[44px] rounded-md border border-zinc-300 px-3 dark:border-zinc-700 dark:bg-zinc-800" />
          </label>
          <button onClick={() => add.mutate()} disabled={!name}
            className="min-h-[44px] rounded-md bg-zinc-900 px-4 text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
            添加
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-3 font-medium">轮次列表</h2>
        <ol className="flex flex-col gap-2">
          {(list.data ?? []).map((r) => (
            <li key={r.id} className="flex items-center justify-between rounded-md bg-zinc-50 p-3 dark:bg-zinc-800/60">
              <div>
                <span className="font-medium">第 {r.sequence} 轮 · {r.name}</span>
                <span className="ml-2 text-sm text-zinc-500">{r.status}</span>
                {r.scheduled_at && <div className="text-xs text-zinc-400">{r.scheduled_at}</div>}
              </div>
              {r.status !== "completed" ? (
                <div className="flex gap-2">
                  <button onClick={() => complete.mutate({ id: r.id, result: "passed" })}
                    className="min-h-[36px] rounded-md border border-emerald-300 px-3 text-sm">通过</button>
                  <button onClick={() => complete.mutate({ id: r.id, result: "failed" })}
                    className="min-h-[36px] rounded-md border border-rose-300 px-3 text-sm">未通过</button>
                </div>
              ) : (
                <span className={`text-sm ${r.result === "passed" ? "text-emerald-600" : r.result === "failed" ? "text-rose-600" : ""}`}>
                  {r.result === "passed" ? "已通过" : r.result === "failed" ? "未通过" : r.status}
                </span>
              )}
            </li>
          ))}
          {list.data?.length === 0 && <li className="text-sm text-zinc-500">暂无面试轮次</li>}
        </ol>
      </section>
    </div>
  );
}

function AIRunsTab({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const runs = useQuery({ queryKey: ["runs", jobId], queryFn: () => api.listRuns(jobId) });

  const runType = (t: string) =>
    t === "job_analysis" ? "JD 分析" : t === "company_research" ? "公司调研" : "简历优化";
  const runStatus = (s: string) =>
    ({ queued: "排队中", running: "运行中", waiting_approval: "等待授权", succeeded: "已完成", failed: "失败", cancelled: "已取消" }[s] ?? s);

  const analysis = useMutation({
    mutationFn: () => api.enqueueRun({ run_type: "job_analysis", job_id: jobId }),
    onSuccess: () => {
      toast.success("JD 分析任务已入队");
      qc.invalidateQueries({ queryKey: ["runs", jobId] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const research = useMutation({
    mutationFn: () => api.enqueueRun({ run_type: "company_research", job_id: jobId }),
    onSuccess: () => {
      toast.success("公司调研任务已入队");
      qc.invalidateQueries({ queryKey: ["runs", jobId] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-3">
        <button onClick={() => analysis.mutate()} disabled={analysis.isPending}
          className="min-h-[44px] rounded-md bg-zinc-900 px-4 text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
          运行 JD 分析
        </button>
        <button onClick={() => research.mutate()} disabled={research.isPending}
          className="min-h-[44px] rounded-md border border-zinc-300 px-4 dark:border-zinc-700">
          运行公司调研（需要网络）
        </button>
      </div>
      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-3 font-medium">任务记录</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-zinc-500">
              <th className="py-1">类型</th><th>状态</th><th>排队时间</th><th>错误</th><th></th>
            </tr>
          </thead>
          <tbody>
            {(runs.data ?? []).map((r) => (
              <tr key={r.id} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="py-2">{runType(r.run_type)}</td>
                <td>{runStatus(r.status)}</td>
                <td className="text-zinc-500">{r.queued_at}</td>
                <td className="text-rose-600">{r.error_message ?? ""}</td>
                <td className="text-right">
                  {["queued", "running", "waiting_approval"].includes(r.status) && (
                    <button
                      onClick={async () => { await api.cancelRun(r.id); qc.invalidateQueries({ queryKey: ["runs", jobId] }); }}
                      className="text-rose-600 hover:underline">取消</button>
                  )}
                </td>
              </tr>
            ))}
            {runs.data?.length === 0 && (
              <tr><td colSpan={5} className="py-6 text-center text-zinc-500">暂无任务</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

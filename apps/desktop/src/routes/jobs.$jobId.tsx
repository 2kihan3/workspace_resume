import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { api, JOB_STATUS_LABELS, JOB_STATUS_ORDER } from "../lib/constants";
import { Badge, Button, Select } from "@jsw/ui";
import type { JobStatus } from "../lib/types";

export const Route = createFileRoute("/jobs/$jobId")({ component: JobDetail });

const TABS = ["概览", "JD 与分析", "岗位简历", "沟通", "面试", "AI 记录"] as const;

function JobDetail() {
  const { jobId } = Route.useParams();
  const [tab, setTab] = useState<(typeof TABS)[number]>("概览");
  const job = useQuery({ queryKey: ["job", jobId], queryFn: () => api.getJob(jobId) });

  if (!job.data) {
    return <div className="text-muted-foreground">加载中…</div>;
  }
  const j = job.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/jobs" className="text-sm text-muted-foreground hover:underline">← 返回岗位库</Link>
          <h1 className="text-2xl font-semibold">
            {j.company_name}
            {j.role_title ? ` · ${j.role_title}` : ""}
          </h1>
        </div>
        <Badge variant={j.status}>{JOB_STATUS_LABELS[j.status]}</Badge>
      </div>

      <div role="tablist" aria-label="岗位详情" className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`min-h-11 px-4 text-[15px] transition-colors duration-150 ${
              tab === t
                ? "border-b-2 border-primary font-medium text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "概览" && <OverviewTab jobId={jobId} status={j.status} goTab={(t) => setTab(t as (typeof TABS)[number])} />}
      {tab === "JD 与分析" && <JdTab jobId={jobId} />}
      {tab === "岗位简历" && <ResumeTab jobId={jobId} />}
      {tab === "沟通" && <CommunicationTab jobId={jobId} />}
      {tab === "面试" && <InterviewTab jobId={jobId} />}
      {tab === "AI 记录" && <AIRunsTab jobId={jobId} />}
    </div>
  );
}

function OverviewTab({ jobId, status, goTab }: { jobId: string; status: JobStatus; goTab: (t: string) => void }) {
  const qc = useQueryClient();
  const events = useQuery({ queryKey: ["events", jobId], queryFn: () => api.listJobEvents(jobId) });
  const [target, setTarget] = useState<JobStatus>(status);
  const [reason, setReason] = useState("");

  const analysis = useMutation({
    mutationFn: () => api.enqueueRun({ run_type: "job_analysis", job_id: jobId }),
    onSuccess: () => {
      toast.success("JD 分析任务已入队");
      qc.invalidateQueries({ queryKey: ["runs", jobId] });
      goTab("AI 记录");
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const research = useMutation({
    mutationFn: () => api.enqueueRun({ run_type: "company_research", job_id: jobId }),
    onSuccess: () => {
      toast.success("公司调研任务已入队");
      qc.invalidateQueries({ queryKey: ["runs", jobId] });
      goTab("AI 记录");
    },
    onError: (e) => toast.error((e as Error).message),
  });

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

  // 下一步主动作（spec §12.3）：按状态引导
  const next: { title: string; desc: string; primary?: { label: string; onClick: () => void; loading?: boolean }; link?: { label: string; tab: string } } | null =
    status === "pending_analysis"
      ? {
          title: "下一步：分析 JD",
          desc: "用本机 Codex 解析职责与要求，完成后自动进入待优化简历。",
          primary: { label: "运行 JD 分析", onClick: () => analysis.mutate(), loading: analysis.isPending },
          link: { label: research.isPending ? "调研中…" : "同时做公司调研", tab: "__research__" },
        }
      : status === "pending_resume_optimization"
        ? { title: "下一步：生成岗位版简历", desc: "选择基础简历，AI 按这份 JD 定向改写一份完整副本。", link: { label: "去生成岗位版简历", tab: "岗位简历" } }
        : status === "pending_communication"
          ? { title: "下一步：记录沟通", desc: "和 HR 聊过后记录一条沟通，进入待投递。", link: { label: "去记录沟通", tab: "沟通" } }
          : status === "pending_application"
            ? { title: "下一步：记录投递", desc: "投出简历后记录投递动作，进入面试阶段。", link: { label: "去记录投递", tab: "沟通" } }
            : status === "interviewing"
              ? { title: "下一步：管理面试", desc: "添加轮次、记录结果。", link: { label: "去管理面试轮次", tab: "面试" } }
              : null;

  return (
    <div className="flex flex-col gap-6">
      {next && (
        <section className="flex items-center gap-4 rounded-xl border border-primary/40 bg-accent/60 p-5">
          <div className="min-w-0 flex-1">
            <h2 className="font-medium text-accent-foreground">{next.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{next.desc}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {next.link &&
              (next.link.tab === "__research__" ? (
                <Button variant="outline" onClick={() => research.mutate()} disabled={research.isPending}>
                  {next.link.label}
                </Button>
              ) : (
                <Button variant="outline" onClick={() => goTab(next.link!.tab)}>{next.link.label}</Button>
              ))}
            {next.primary && (
              <Button onClick={next.primary.onClick} disabled={next.primary.loading}>
                {next.primary.label}
              </Button>
            )}
          </div>
        </section>
      )}
      <div className="grid grid-cols-2 gap-6">
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 font-medium">手动调整状态</h2>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            目标状态
            <Select value={target} onChange={(e) => setTarget(e.target.value as JobStatus)}>
              {JOB_STATUS_ORDER.map((s) => (
                <option key={s} value={s}>{JOB_STATUS_LABELS[s]}</option>
              ))}
            </Select>
          </label>
          {(target === "passed" || target === "rejected") && (
            <label className="flex flex-col gap-1 text-sm">
              原因（可选）
              <input value={reason} onChange={(e) => setReason(e.target.value)}
                className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring" />
            </label>
          )}
          <button onClick={() => transition.mutate()}
            className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-50">
            应用变更
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 font-medium">时间线</h2>
        <ol className="flex flex-col gap-2 text-sm">
          {(events.data ?? []).map((ev) => (
            <li key={ev.id} className="border-l-2 border-border pl-3">
              <div>
                {ev.event_type}
                {ev.from_status && ev.to_status && (
                  <span className="text-muted-foreground">
                    ：{JOB_STATUS_LABELS[ev.from_status]} → {JOB_STATUS_LABELS[ev.to_status]}
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {ev.occurred_at} · {ev.actor === "user" ? "用户" : ev.actor === "system" ? "系统" : "AI"}
              </div>
            </li>
          ))}
          {events.data?.length === 0 && <li className="text-muted-foreground">暂无事件</li>}
        </ol>
      </section>
      </div>
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

  const runAnalysis = useMutation({
    mutationFn: () => api.enqueueRun({ run_type: "job_analysis", job_id: jobId }),
    onSuccess: () => {
      toast.success("JD 分析任务已入队，可到「AI 记录」查看进度");
      qc.invalidateQueries({ queryKey: ["runs", jobId] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const runResearch = useMutation({
    mutationFn: () => api.enqueueRun({ run_type: "company_research", job_id: jobId }),
    onSuccess: () => {
      toast.success("公司调研任务已入队（需要网络）");
      qc.invalidateQueries({ queryKey: ["runs", jobId] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between rounded-xl border border-primary/30 bg-accent/50 p-3">
        <span className="text-sm text-muted-foreground">
          AI 会把 JD 原文和岗位信息发送给本机 Codex 分析。
        </span>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => runResearch.mutate()} disabled={runResearch.isPending}>
            公司调研
          </Button>
          <Button onClick={() => runAnalysis.mutate()} disabled={runAnalysis.isPending}>
            {runAnalysis.isPending ? "入队中…" : "运行 JD 分析"}
          </Button>
        </div>
      </div>
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-medium">原始 JD</h2>
          {editing ? (
            <button onClick={() => save.mutate()} className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-50">
              保存
            </button>
          ) : (
            <button onClick={() => { setDraft(jd.data ?? ""); setEditing(true); }}
              className="">
              编辑
            </button>
          )}
        </div>
        {editing ? (
          <textarea rows={14} value={draft} onChange={(e) => setDraft(e.target.value)}
            className="w-full rounded-md border border-input bg-card p-3 font-mono text-[15px] transition-colors focus-visible:ring-2 focus-visible:ring-ring" />
        ) : (
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-[15px]">{jd.data}</pre>
        )}
      </section>

      {analysis && (
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-2 font-medium">JD 结构化分析</h2>
          <JDAnalysisView json={analysis.content} />
        </section>
      )}
      {research && (
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-2 font-medium">公司调研</h2>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-[15px]">{research.content}</pre>
        </section>
      )}
      {sources && (
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-2 font-medium">调研来源</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {(safeParse(sources.content) as Array<{ title?: string; url?: string; publisher?: string }>).map((s, i) => (
              <li key={i}>
                <a href={s.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
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
        <div className="text-sm font-medium text-muted-foreground">{key}</div>
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
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 font-medium">生成岗位版简历</h2>
        <div className="flex items-end gap-3">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            选择基础简历
            <select value={selected} onChange={(e) => setSelected(e.target.value)}
              className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring">
              <option value="">请选择…</option>
              {bases.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
            </select>
          </label>
          <button
            disabled={!selected || enqueue.isPending}
            onClick={() => enqueue.mutate()}
            >
            运行优化
          </button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          将发送 inputs/jd.md、inputs/job.json、inputs/base-resume.md 给本机 Codex。
        </p>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 font-medium">岗位版简历</h2>
        {job.data?.active_resume_id && (
          <p className="mb-2 text-xs text-muted-foreground">当前生效：{job.data.active_resume_id}</p>
        )}
        <div className="flex flex-col gap-2">
          {tailored.map((r) => (
            <Link key={r.id} to="/resumes/$resumeId/edit" params={{ resumeId: r.id }}
              className="rounded-lg border border-border p-3 text-sm transition-colors hover:bg-muted">
              {r.title} <span className="text-muted-foreground">（{r.updated_at}）</span>
            </Link>
          ))}
          {tailored.length === 0 && <div className="text-sm text-muted-foreground">暂无岗位版简历</div>}
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
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 font-medium">新增沟通记录</h2>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            渠道
            <select value={channel} onChange={(e) => setChannel(e.target.value)}
              className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring">
              {["phone", "email", "wechat", "linkedin", "meeting", "other"].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            联系人
            <input value={contact} onChange={(e) => setContact(e.target.value)}
              className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            备注
            <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)}
              className="__TEXTAREA__" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={advance} onChange={(e) => setAdvance(e.target.checked)} />
            完成沟通，进入待投递
          </label>
          <button onClick={() => add.mutate()} disabled={add.isPending}
            className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-50">
            记录
          </button>
        </div>
        <hr className="my-4 border-border" />
        <button onClick={() => apply.mutate()} disabled={apply.isPending}
          className="inline-flex h-11 w-full items-center justify-center rounded-md border border-input bg-card px-4 text-sm font-medium transition-colors hover:bg-muted">
          记录投递动作（进入面试阶段）
        </button>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 font-medium">沟通历史</h2>
        <ol className="flex flex-col gap-2 text-sm">
          {(list.data ?? []).map((c) => (
            <li key={c.id} className="rounded-lg bg-muted/60 p-3">
              <div>{c.channel}{c.contact_name ? ` · ${c.contact_name}` : ""}</div>
              <div className="text-muted-foreground">{c.notes}</div>
              <div className="text-xs text-muted-foreground">{c.occurred_at}</div>
            </li>
          ))}
          {list.data?.length === 0 && <li className="text-muted-foreground">暂无沟通记录</li>}
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
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 font-medium">添加面试轮次</h2>
        <div className="flex items-end gap-3">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            轮次名称
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：一面 / 技术面"
              className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            时间（可选）
            <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)}
              className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring" />
          </label>
          <button onClick={() => add.mutate()} disabled={!name}
            >
            添加
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 font-medium">轮次列表</h2>
        <ol className="flex flex-col gap-2">
          {(list.data ?? []).map((r) => (
            <li key={r.id} className="flex items-center justify-between rounded-lg bg-muted/60 p-3">
              <div>
                <span className="font-medium">第 {r.sequence} 轮 · {r.name}</span>
                <span className="ml-2 text-sm text-muted-foreground">{r.status}</span>
                {r.scheduled_at && <div className="text-xs text-muted-foreground">{r.scheduled_at}</div>}
              </div>
              {r.status !== "completed" ? (
                <div className="flex gap-2">
                  <button onClick={() => complete.mutate({ id: r.id, result: "passed" })}
                    className="h-9 rounded-md border border-emerald-300 px-3 text-sm text-emerald-700 transition-colors hover:bg-emerald-50 dark:hover:bg-emerald-950/40">通过</button>
                  <button onClick={() => complete.mutate({ id: r.id, result: "failed" })}
                    className="h-9 rounded-md border border-rose-300 px-3 text-sm text-rose-700 transition-colors hover:bg-rose-50 dark:hover:bg-rose-950/40">未通过</button>
                </div>
              ) : (
                <span className={`text-sm ${r.result === "passed" ? "text-emerald-600" : r.result === "failed" ? "text-rose-600" : ""}`}>
                  {r.result === "passed" ? "已通过" : r.result === "failed" ? "未通过" : r.status}
                </span>
              )}
            </li>
          ))}
          {list.data?.length === 0 && <li className="text-sm text-muted-foreground">暂无面试轮次</li>}
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
          >
          运行 JD 分析
        </button>
        <button onClick={() => research.mutate()} disabled={research.isPending}
          className="">
          运行公司调研（需要网络）
        </button>
      </div>
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 font-medium">任务记录</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1">类型</th><th>状态</th><th>排队时间</th><th>错误</th><th></th>
            </tr>
          </thead>
          <tbody>
            {(runs.data ?? []).map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="py-2">{runType(r.run_type)}</td>
                <td>{runStatus(r.status)}</td>
                <td className="text-muted-foreground">{r.queued_at}</td>
                <td className="text-destructive">{r.error_message ?? ""}</td>
                <td className="text-right">
                  {["queued", "running", "waiting_approval"].includes(r.status) && (
                    <button
                      onClick={async () => { await api.cancelRun(r.id); qc.invalidateQueries({ queryKey: ["runs", jobId] }); }}
                      className="text-destructive hover:underline">取消</button>
                  )}
                </td>
              </tr>
            ))}
            {runs.data?.length === 0 && (
              <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">暂无任务</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

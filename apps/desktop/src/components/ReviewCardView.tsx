import { Badge } from "@jsw/ui";

/** interview-reviewer 产物可视化（对照 interview-review.json schema） */

interface Dim { v: number | null; w: number; why: string }
interface ReviewScore {
  total?: number;
  verdict?: string;
  confidence?: string;
  dimensions?: Record<string, Dim>;
}
interface QA {
  id?: string; question?: string; answer_summary?: string;
  follow_ups?: Array<{ q?: string; a_summary?: string }>;
  grade?: string; attribution?: string | null; notes?: string;
}
interface Signal { clue?: string; reading?: string; light?: string; evidence?: string }

export interface InterviewReviewData {
  meta?: {
    company?: string; position?: string; round?: string; interviewer_role?: string;
    input_type?: string; transcription?: { status?: string; duration_min?: number; tool?: string };
    upstream?: { jd_analysis?: boolean; tailoring_report?: boolean };
    warnings?: string[];
  };
  structure?: Array<{ segment?: string; start?: string; summary?: string }>;
  qa_list?: QA[];
  interviewer?: { role?: string; style?: string; focus_map?: Array<{ area?: string; evidence?: string }> };
  signals?: Signal[];
  concern_map?: Array<{ concern?: string; evidence?: string; severity?: string }>;
  reconciliation?: Record<string, unknown>;
  score?: ReviewScore;
  actions?: {
    reanswers?: Array<{ from?: string; issue?: string; framework?: string; use?: string }>;
    [k: string]: unknown;
  };
  summary?: string;
}

const DIM_META: Array<[string, string]> = [
  ["content", "内容深度"],
  ["delivery", "表达结构"],
  ["fit_presentation", "匹配呈现"],
  ["authenticity_defense", "真实防御"],
  ["counter_questions", "反问质量"],
  ["signals", "信号解读"],
];

const GRADE_STYLE: Record<string, string> = {
  "讲透了": "bg-status-pass text-emerald-700 dark:text-emerald-300",
  "合格": "bg-status-blue text-blue-700 dark:text-blue-300",
  "含糊": "bg-status-amber text-amber-700 dark:text-amber-300",
  "崩了": "bg-status-fail text-rose-700 dark:text-rose-300",
};
const LIGHT_STYLE: Record<string, string> = {
  "红": "bg-status-fail text-rose-700 dark:text-rose-300",
  "黄": "bg-status-amber text-amber-700 dark:text-amber-300",
  "绿": "bg-status-pass text-emerald-700 dark:text-emerald-300",
};

function verdictVariant(v?: string): React.ComponentProps<typeof Badge>["variant"] {
  if (!v) return "secondary";
  if (v.includes("稳")) return "passed";
  if (v.includes("悬")) return "rejected";
  return "pending_application"; // 五五开等
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

export function ReviewCardView({ data }: { data: InterviewReviewData }) {
  const sc = data.score;
  const m = data.meta;
  const inputLabel =
    m?.input_type === "audio" ? "录音转写" : m?.input_type === "transcript" ? "逐字稿" : m?.input_type === "notes" ? "自述回忆" : m?.input_type;

  return (
    <div className="flex flex-col gap-4">
      {/* 打分卡头部 */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <span className="text-3xl font-semibold tabular-nums">
            {sc?.total ?? "—"}<span className="text-base text-muted-foreground">/100</span>
          </span>
          <Badge variant={verdictVariant(sc?.verdict)} className="text-sm">{sc?.verdict ?? "未评"}</Badge>
          <span className="text-xs text-muted-foreground">
            置信度 {sc?.confidence ?? "—"}
            {m?.transcription?.duration_min ? ` · 面试约 ${m.transcription.duration_min} 分钟` : ""}
            {inputLabel ? ` · 输入：${inputLabel}` : ""}
            {m?.transcription?.status === "失败" ? " · 转写失败（降级产出）" : ""}
          </span>
          <span className="ml-auto text-sm text-muted-foreground">
            {m?.company} · {m?.position} · {m?.round}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          {DIM_META.map(([key, label]) => {
            const d = sc?.dimensions?.[key];
            const pct = d?.v == null ? null : Math.round(d.v);
            return (
              <div key={key} className="rounded-lg bg-muted/60 p-2.5">
                <div className="flex items-baseline justify-between text-xs text-muted-foreground">
                  <span>{label}</span><span>×{Math.round((d?.w ?? 0) * 100)}%</span>
                </div>
                <div className="text-xl font-semibold tabular-nums">{pct == null ? "N/A" : pct}</div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-border">
                  <div className="h-full rounded-full bg-primary" style={{ width: pct == null ? "0%" : `${pct}%` }} />
                </div>
                {d?.why ? <p className="mt-1 line-clamp-3 text-[11px] leading-snug text-muted-foreground" title={d.why}>{d.why}</p> : null}
              </div>
            );
          })}
        </div>
        {(m?.warnings?.length ?? 0) > 0 && (
          <ul className="mt-3 list-disc rounded-lg bg-status-amber/40 p-3 pl-7 text-xs text-amber-800 dark:text-amber-300">
            {m!.warnings!.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        )}
      </div>

      {/* 面试结构与面试官 */}
      <div className="grid grid-cols-2 gap-4">
        <Section title="面试结构还原">
          <ol className="flex flex-col gap-1.5 text-sm">
            {(data.structure ?? []).map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs tabular-nums">{s.start}</span>
                <span><Badge variant="outline" className="mr-1.5">{s.segment}</Badge>{s.summary}</span>
              </li>
            ))}
          </ol>
        </Section>
        <Section title={`面试官画像（${data.interviewer?.style ?? "未知风格"}）`}>
          <p className="mb-2 text-sm text-muted-foreground">{data.interviewer?.role}</p>
          <ul className="flex flex-col gap-1.5 text-sm">
            {(data.interviewer?.focus_map ?? []).map((f, i) => (
              <li key={i}><span className="font-medium">{f.area}</span>
                <span className="block text-xs text-muted-foreground">{f.evidence}</span></li>
            ))}
          </ul>
        </Section>
      </div>

      {/* 逐题评估 */}
      {(data.qa_list?.length ?? 0) > 0 && (
        <Section title={`逐题评估（${data.qa_list!.length} 题）`}>
          <div className="flex flex-col gap-2">
            {data.qa_list!.map((qa) => (
              <details key={qa.id} className="rounded-lg bg-muted/50 p-3">
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                  <span className="font-mono text-xs text-muted-foreground">{qa.id}</span>
                  <span className={`rounded px-1.5 py-0.5 text-xs ${GRADE_STYLE[qa.grade ?? ""] ?? "bg-muted"}`}>{qa.grade}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{qa.question}</span>
                </summary>
                <div className="mt-2 flex flex-col gap-1.5 pl-8 text-sm">
                  <p className="text-muted-foreground">{qa.answer_summary}</p>
                  {(qa.follow_ups?.length ?? 0) > 0 && (
                    <ul className="ml-4 list-disc border-l border-border pl-3 text-muted-foreground">
                      {qa.follow_ups!.map((f, i) => (
                        <li key={i}><span className="font-medium">{f.q}</span> → {f.a_summary}</li>
                      ))}
                    </ul>
                  )}
                  {qa.notes && (
                    <p className="rounded bg-background/60 p-2 text-xs">
                      点评：{qa.notes}
                      {qa.attribution ? <Badge variant="secondary" className="ml-1.5">{qa.attribution}</Badge> : null}
                    </p>
                  )}
                </div>
              </details>
            ))}
          </div>
        </Section>
      )}

      {/* 信号与疑虑 */}
      <div className="grid grid-cols-2 gap-4">
        <Section title="面试官信号">
          <ul className="flex flex-col gap-2 text-sm">
            {(data.signals ?? []).map((sig, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs ${LIGHT_STYLE[sig.light ?? ""] ?? "bg-muted"}`}>{sig.light}</span>
                <span>{sig.reading}
                  {sig.evidence ? <span className="ml-1 text-xs text-muted-foreground">（{sig.evidence}）</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </Section>
        <Section title="疑虑地图">
          <ul className="flex flex-col gap-2 text-sm">
            {(data.concern_map ?? []).map((c, i) => (
              <li key={i}>
                <span className="font-medium">{c.concern ?? c.evidence}</span>
                <span className="block text-xs text-muted-foreground">{c.evidence}</span>
              </li>
            ))}
            {(data.concern_map?.length ?? 0) === 0 && <li className="text-muted-foreground">无明显疑虑</li>}
          </ul>
        </Section>
      </div>

      {/* 上游对账 */}
      {data.reconciliation && Object.keys(data.reconciliation).length > 0 && (
        <Section title="上游对账（预判命中 / 简历一致性）">
          <pre className="overflow-auto whitespace-pre-wrap rounded-lg bg-muted/60 p-3 text-xs leading-relaxed">
            {JSON.stringify(data.reconciliation, null, 2)}
          </pre>
        </Section>
      )}

      {/* 行动包 */}
      {(data.actions?.reanswers?.length ?? 0) > 0 && (
        <Section title={`重答清单（${data.actions!.reanswers!.length}）`}>
          <div className="flex flex-col gap-2">
            {data.actions!.reanswers!.map((r, i) => (
              <div key={i} className="rounded-lg bg-muted/50 p-3 text-sm">
                <div className="mb-1 flex items-center gap-2">
                  <Badge variant="outline">{r.from}</Badge>
                  {r.use && <span className="text-xs text-muted-foreground">用途：{r.use}</span>}
                </div>
                <p className="font-medium text-rose-600 dark:text-rose-400">问题：{r.issue}</p>
                <p className="mt-1 text-muted-foreground">重答框架：{r.framework}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {data.summary && (
        <Section title="总评">
          <p className="text-sm leading-relaxed text-muted-foreground">{data.summary}</p>
        </Section>
      )}
    </div>
  );
}

import { Badge } from "@jsw/ui";

/**
 * jd-analyst 决策打分卡渲染（新 schema：mode/basic/requirements/
 * hidden_signals/match_advice/score/...）。旧版 v1 数据由 JDAnalysisView 回退。
 */

interface Dim { v: number | null; w: number; why: string }
interface Score {
  total: number;
  band: string;
  dimensions?: Record<string, Dim>;
  veto?: string | null;
  confidence?: string;
  confidence_notes?: string;
}
interface Requirement { id?: string; raw?: string; decoded?: string; weight?: string; evidence?: string }
interface Signal { clue?: string; reading?: string; light?: string; evidence?: string }
interface MatchAdvice {
  resume_ref?: string;
  keywords_must_hit?: string[];
  experience_to_front?: string[];
  gaps?: string[];
  packagable?: string[];
}
interface Prediction { from?: string; question?: string; probes?: string }

export interface JDAnalystResult {
  mode?: string;
  score?: Score;
  basic?: {
    company?: string; title?: string; level?: string; location?: string;
    work_mode?: string; salary?: { min?: number; max?: number; band_width_pct?: number; vs_market?: string };
  };
  requirements?: Requirement[];
  hidden_signals?: Signal[];
  match_advice?: MatchAdvice;
  interview_predictions?: Prediction[];
  salary_anchor?: string;
  action_checklist?: string[];
  research?: { status?: string; items?: Array<{ question?: string; finding?: string; source?: string }> };
}

/** 判断 JSON 是否为新 schema（有 mode 或 score.dimensions） */
export function isJDAnalyst(data: Record<string, unknown>): boolean {
  return "mode" in data || "score" in data;
}

const DIM_META: Array<[string, string]> = [
  ["job_quality", "岗位质量"],
  ["match_fit", "匹配度"],
  ["risk", "风险"],
  ["opportunity", "机会窗口"],
];

const LIGHT_STYLE: Record<string, string> = {
  "红": "bg-status-fail text-rose-700 dark:text-rose-300",
  "黄": "bg-status-amber text-amber-700 dark:text-amber-300",
  "绿": "bg-status-pass text-emerald-700 dark:text-emerald-300",
};

function bandVariant(band?: string): React.ComponentProps<typeof Badge>["variant"] {
  if (!band) return "secondary";
  if (band.includes("投") && !band.includes("慎") && !band.includes("不")) return "passed";
  if (band.includes("不投")) return "rejected";
  return "pending_application";
}

export function ScorecardView({ data }: { data: JDAnalystResult }) {
  const sc = data.score;
  const b = data.basic;
  return (
    <div className="flex flex-col gap-4">
      {/* 决策卡头部 */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <span className="text-3xl font-semibold tabular-nums">
            {sc?.total ?? "—"}<span className="text-base text-muted-foreground">/100</span>
          </span>
          <Badge variant={bandVariant(sc?.band)} className="text-sm">{sc?.band ?? "未评"}</Badge>
          {sc?.veto ? (
            <Badge variant="rejected" className="text-sm">一票否决：{sc.veto}</Badge>
          ) : null}
          <span className="ml-auto text-xs text-muted-foreground">
            模式 {data.mode ?? "—"} · 置信度 {sc?.confidence ?? "—"}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {DIM_META.map(([key, label]) => {
            const d = sc?.dimensions?.[key];
            const pct = d?.v == null ? null : Math.round(d.v);
            return (
              <div key={key} className="rounded-lg bg-muted/60 p-3">
                <div className="flex items-baseline justify-between text-xs text-muted-foreground">
                  <span>{label}</span>
                  <span>×{Math.round((d?.w ?? 0) * 100)}%</span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-xl font-semibold tabular-nums">
                    {pct == null ? "N/A" : pct}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: pct == null ? "0%" : `${pct}%` }}
                  />
                </div>
                {d?.why ? (
                  <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground" title={d.why}>{d.why}</p>
                ) : null}
              </div>
            );
          })}
        </div>
        {sc?.confidence_notes ? (
          <p className="mt-2 text-xs text-amber-600">{sc.confidence_notes}</p>
        ) : null}
      </div>

      {/* 基本信息 */}
      {b ? (
        <section className="rounded-xl border border-border bg-card p-4 text-sm">
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <span className="font-medium">{b.company}</span>
            {b.title ? <span>{b.title}</span> : null}
            {b.level ? <span className="text-muted-foreground">{b.level}</span> : null}
            {b.location ? <span className="text-muted-foreground">{b.location}</span> : null}
            {b.work_mode ? <span className="text-muted-foreground">{b.work_mode}</span> : null}
            {b.salary?.min != null ? (
              <span className="text-muted-foreground">
                {b.salary.min}–{b.salary.max}k
                {b.salary.vs_market ? ` · ${b.salary.vs_market}` : ""}
              </span>
            ) : null}
          </div>
          {data.salary_anchor ? (
            <p className="mt-2 text-muted-foreground">谈薪锚点：{data.salary_anchor}</p>
          ) : null}
        </section>
      ) : null}

      {/* 要求解码 */}
      {data.requirements?.length ? (
        <section className="rounded-xl border border-border bg-card p-4">
          <h3 className="mb-2 text-sm font-semibold">要求解码（{data.requirements.length}）</h3>
          <ul className="flex flex-col gap-1.5">
            {data.requirements.map((r, i) => (
              <li key={i} className="text-sm">
                <Badge variant={r.weight === "硬门槛" ? "rejected" : r.weight === "核心" ? "pending_application" : "secondary"} className="mr-2">
                  {r.weight ?? "?"}
                </Badge>
                <span className="text-muted-foreground">{r.id ?? `R${i + 1}`}</span>{" "}
                {r.decoded || r.raw}
                {r.raw && r.decoded ? (
                  <span className="ml-1 text-xs text-muted-foreground">（{r.raw}）</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* 红黄绿信号 */}
      {data.hidden_signals?.length ? (
        <section className="rounded-xl border border-border bg-card p-4">
          <h3 className="mb-2 text-sm font-semibold">隐藏信号（{data.hidden_signals.length}）</h3>
          <ul className="flex flex-col gap-1.5">
            {data.hidden_signals.map((sig, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs ${LIGHT_STYLE[sig.light ?? ""] ?? "bg-muted"}`}>
                  {sig.light}
                </span>
                <span>
                  {sig.reading}
                  {sig.clue ? <span className="ml-1 text-xs text-muted-foreground">「{sig.clue}」</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* 匹配建议 */}
      {data.match_advice ? (
        <section className="rounded-xl border border-primary/40 bg-accent/50 p-4">
          <h3 className="mb-2 text-sm font-semibold">匹配建议（基准：{data.match_advice.resume_ref ?? "—"}）</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="mb-1 font-medium">必须命中的关键词</div>
              <div className="flex flex-wrap gap-1">
                {(data.match_advice.keywords_must_hit ?? []).map((k) => (
                  <Badge key={k} variant="outline">{k}</Badge>
                ))}
              </div>
              <div className="mt-2 mb-1 font-medium">前置的经历</div>
              <ul className="list-disc pl-4 text-muted-foreground">
                {(data.match_advice.experience_to_front ?? []).map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
            <div>
              <div className="mb-1 font-medium text-rose-600">真差距</div>
              <ul className="list-disc pl-4 text-muted-foreground">
                {(data.match_advice.gaps ?? []).map((g, i) => <li key={i}>{g}</li>)}
              </ul>
              <div className="mt-2 mb-1 font-medium text-emerald-600">可重述弥补</div>
              <ul className="list-disc pl-4 text-muted-foreground">
                {(data.match_advice.packagable ?? []).map((g, i) => <li key={i}>{g}</li>)}
              </ul>
            </div>
          </div>
        </section>
      ) : null}

      {/* 面试预判 */}
      {data.interview_predictions?.length ? (
        <section className="rounded-xl border border-border bg-card p-4">
          <h3 className="mb-2 text-sm font-semibold">面试预判</h3>
          <ul className="flex flex-col gap-1.5 text-sm">
            {data.interview_predictions.map((p, i) => (
              <li key={i}>
                <span className="mr-1 text-muted-foreground">{p.from}</span>
                {p.question}
                {p.probes ? <span className="ml-1 text-xs text-muted-foreground">（{p.probes}）</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* 行动清单 */}
      {data.action_checklist?.length ? (
        <section className="rounded-xl border border-border bg-card p-4">
          <h3 className="mb-2 text-sm font-semibold">行动清单</h3>
          <ul className="list-disc pl-5 text-sm text-muted-foreground">
            {data.action_checklist.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

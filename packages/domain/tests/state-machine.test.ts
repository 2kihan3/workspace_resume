import { describe, expect, it } from "vitest";
import {
  classifyTransition,
  SYSTEM_TRANSITIONS,
  isTerminal,
  allowedTargets,
} from "../src/state-machine";
import {
  CreateJobInputSchema,
  JDAnalysisV1Schema,
  TailoringReportV1Schema,
} from "../src/schemas";

describe("岗位状态机", () => {
  it("正常链路逐步推进", () => {
    let s: keyof typeof SYSTEM_TRANSITIONS = "pending_analysis";
    const steps = [s];
    while (SYSTEM_TRANSITIONS[s]) {
      s = SYSTEM_TRANSITIONS[s]!;
      steps.push(s);
    }
    expect(steps).toEqual([
      "pending_analysis",
      "pending_resume_optimization",
      "pending_communication",
      "pending_application",
      "interviewing",
      "passed",
    ]);
  });

  it("跨阶段跳转需要确认", () => {
    const d = classifyTransition("pending_analysis", "interviewing");
    expect(d.allowed).toBe(true);
    expect(d.kind).toBe("skip_forward");
    expect(d.requiresConfirmation).toBe(true);
  });

  it("系统推进无需确认", () => {
    const d = classifyTransition("pending_analysis", "pending_resume_optimization");
    expect(d.kind).toBe("system");
    expect(d.requiresConfirmation).toBe(false);
  });

  it("回退需要确认", () => {
    const d = classifyTransition("interviewing", "pending_analysis");
    expect(d.kind).toBe("backward");
    expect(d.requiresConfirmation).toBe(true);
  });

  it("从终态恢复需要确认", () => {
    const d = classifyTransition("passed", "interviewing");
    expect(d.kind).toBe("restore");
    expect(d.requiresConfirmation).toBe(true);
  });

  it("进入终态不需要确认", () => {
    expect(classifyTransition("interviewing", "rejected").kind).toBe("terminal");
    expect(classifyTransition("interviewing", "passed").kind).toBe("system");
  });

  it("终态判定", () => {
    expect(isTerminal("passed")).toBe(true);
    expect(isTerminal("rejected")).toBe(true);
    expect(isTerminal("interviewing")).toBe(false);
  });

  it("看板允许拖到所有其他状态", () => {
    expect(allowedTargets("pending_analysis")).toHaveLength(6);
  });
});

describe("Zod schema", () => {
  it("CreateJobInput 拒绝空公司名", () => {
    expect(CreateJobInputSchema.safeParse({ company_name: " ", jd_markdown: "x" }).success).toBe(false);
    expect(CreateJobInputSchema.safeParse({ companyName: "acme", jdMarkdown: "x" }).success).toBe(true);
  });

  it("JDAnalysisV1 接受合法输出", () => {
    const r = JDAnalysisV1Schema.safeParse({
      schemaVersion: 1, roleTitle: "PM", summary: "s", responsibilities: [],
      mustHave: [], niceToHave: [], keywords: [], seniority: null,
      location: null, salary: null, candidateRisks: [], questionsToClarify: [],
    });
    expect(r.success).toBe(true);
  });

  it("JDAnalysisV1 拒绝缺字段", () => {
    expect(JDAnalysisV1Schema.safeParse({ schemaVersion: 1 }).success).toBe(false);
  });

  it("TailoringReportV1 结构校验", () => {
    const r = TailoringReportV1Schema.safeParse({
      schemaVersion: 1, baseResumeSha256: "a".repeat(64), jdAnalysisSha256: "b".repeat(64),
      changedSections: [], matchedKeywords: [], unsupportedClaims: [], warnings: [],
    });
    expect(r.success).toBe(true);
  });
});

export type JobStatus =
  | "pending_analysis"
  | "pending_resume_optimization"
  | "pending_communication"
  | "pending_application"
  | "interviewing"
  | "passed"
  | "rejected";

export type AIRunType =
  | "job_analysis"
  | "company_research"
  | "resume_tailoring";

export type AIRunStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "succeeded"
  | "failed"
  | "cancelled";

export type InterviewRoundStatus =
  | "planned"
  | "scheduled"
  | "completed"
  | "cancelled";

export type CommunicationChannel =
  | "phone"
  | "email"
  | "wechat"
  | "linkedin"
  | "meeting"
  | "other";

export const JOB_STATUSES: readonly JobStatus[] = [
  "pending_analysis",
  "pending_resume_optimization",
  "pending_communication",
  "pending_application",
  "interviewing",
  "passed",
  "rejected",
] as const;

export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = [
  "passed",
  "rejected",
] as const;

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  pending_analysis: "待分析",
  pending_resume_optimization: "待优化简历",
  pending_communication: "待沟通",
  pending_application: "待投递",
  interviewing: "面试中",
  passed: "已通过",
  rejected: "未通过",
};

import type { JobStatus } from "./types";

export { api } from "./ipc";
export * from "./types";

export const JOB_STATUS_ORDER: JobStatus[] = [
  "pending_analysis",
  "pending_resume_optimization",
  "pending_communication",
  "pending_application",
  "interviewing",
  "passed",
  "rejected",
];

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  pending_analysis: "待分析",
  pending_resume_optimization: "待优化简历",
  pending_communication: "待沟通",
  pending_application: "待投递",
  interviewing: "面试中",
  passed: "已通过",
  rejected: "未通过",
};

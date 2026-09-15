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
export type { LayoutConfig, LayoutBlock } from "./ipc";

/** 模板库与新建弹窗主推的模板；编辑器/导入的模板下拉保留全部。 */
export const FEATURED_TEMPLATE_IDS = ["builtin.timeline", "builtin.modern"] as const;

/** 沟通/投递渠道（中国主流招聘平台 + 社区 + 基础方式） */
export const COMM_CHANNELS = [
  ["boss", "BOSS直聘"],
  ["liepin", "猎聘"],
  ["zhilian", "智联招聘"],
  ["51job", "前程无忧"],
  ["xiaohongshu", "小红书"],
  ["phone", "电话"],
  ["email", "邮件"],
  ["wechat", "微信"],
  ["linkedin", "领英"],
  ["meeting", "会议/面谈"],
  ["other", "其他"],
] as const;

export function channelLabel(key: string): string {
  return COMM_CHANNELS.find(([k]) => k === key)?.[1] ?? key;
}

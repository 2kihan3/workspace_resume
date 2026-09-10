import {
  JOB_STATUSES,
  TERMINAL_JOB_STATUSES,
  type JobStatus,
} from "./enums";

/**
 * 岗位状态机（spec §6）。
 *
 * 规则：
 * - 系统引导的下一步沿正常链路推进；
 * - 用户可从任意非终态跳到任意状态，也可从终态恢复；
 * - 跨过一个或多个阶段需要确认；
 * - 状态变化必须与事件记录在同一事务（由 Rust application service 保证）。
 */
const CANONICAL_ORDER: JobStatus[] = [
  "pending_analysis",
  "pending_resume_optimization",
  "pending_communication",
  "pending_application",
  "interviewing",
  "passed",
];

/** 系统引导的正常推进链：from -> to */
export const SYSTEM_TRANSITIONS: Record<JobStatus, JobStatus | null> = {
  pending_analysis: "pending_resume_optimization",
  pending_resume_optimization: "pending_communication",
  pending_communication: "pending_application",
  pending_application: "interviewing",
  interviewing: "passed",
  passed: null,
  rejected: null,
};

export function isTerminal(status: JobStatus): boolean {
  return TERMINAL_JOB_STATUSES.includes(status);
}

export function isCanonical(status: JobStatus): boolean {
  return CANONICAL_ORDER.includes(status);
}

export type TransitionKind = "system" | "skip_forward" | "backward" | "restore" | "terminal";

export interface TransitionDecision {
  allowed: boolean;
  kind: TransitionKind;
  /** 跨阶段时 UI 必须弹确认框 */
  requiresConfirmation: boolean;
}

/**
 * 判定一次状态变化属于哪种类型。
 * 这里不做持久化，只做纯判定，UI 与 Rust service 使用同一语义。
 */
export function classifyTransition(
  from: JobStatus | null,
  to: JobStatus,
): TransitionDecision {
  if (!JOB_STATUSES.includes(to)) {
    return { allowed: false, kind: "terminal", requiresConfirmation: false };
  }
  if (from === to) {
    return { allowed: false, kind: "system", requiresConfirmation: false };
  }
  const systemNext = from ? SYSTEM_TRANSITIONS[from] : null;
  if (systemNext === to) {
    return { allowed: true, kind: "system", requiresConfirmation: false };
  }
  if (isTerminal(to)) {
    return { allowed: true, kind: "terminal", requiresConfirmation: false };
  }
  if (from === null) {
    return { allowed: true, kind: "system", requiresConfirmation: false };
  }
  if (isTerminal(from) && !isTerminal(to)) {
    // 从终态（passed/rejected）回到流程态
    return { allowed: true, kind: "restore", requiresConfirmation: true };
  }
  const fi = CANONICAL_ORDER.indexOf(from);
  const ti = CANONICAL_ORDER.indexOf(to);
  if (ti > fi) {
    return { allowed: true, kind: "skip_forward", requiresConfirmation: true };
  }
  return { allowed: true, kind: "backward", requiresConfirmation: true };
}

/** 看板上一个状态允许拖拽到的所有目标状态 */
export function allowedTargets(from: JobStatus): JobStatus[] {
  return JOB_STATUSES.filter((s) => s !== from);
}

//! 岗位状态枚举与状态机（spec §5.1、§6）。
//!
//! `#[serde(rename_all = "snake_case")]` 使 `PendingAnalysis` 序列化为
//! 数据库中的 `pending_analysis`，与 migration CHECK 约束一一对应。

use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    PendingAnalysis,
    PendingResumeOptimization,
    PendingCommunication,
    PendingApplication,
    Interviewing,
    Passed,
    Rejected,
}

impl JobStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            JobStatus::PendingAnalysis => "pending_analysis",
            JobStatus::PendingResumeOptimization => "pending_resume_optimization",
            JobStatus::PendingCommunication => "pending_communication",
            JobStatus::PendingApplication => "pending_application",
            JobStatus::Interviewing => "interviewing",
            JobStatus::Passed => "passed",
            JobStatus::Rejected => "rejected",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "pending_analysis" => JobStatus::PendingAnalysis,
            "pending_resume_optimization" => JobStatus::PendingResumeOptimization,
            "pending_communication" => JobStatus::PendingCommunication,
            "pending_application" => JobStatus::PendingApplication,
            "interviewing" => JobStatus::Interviewing,
            "passed" => JobStatus::Passed,
            "rejected" => JobStatus::Rejected,
            _ => return None,
        })
    }

    pub fn is_terminal(&self) -> bool {
        matches!(self, JobStatus::Passed | JobStatus::Rejected)
    }

    /// 系统引导链（spec §6.1）：分析成功 -> 简历 -> 沟通 -> 投递 -> 面试 -> 通过。
    pub fn canonical_next(&self) -> Option<JobStatus> {
        Some(match self {
            JobStatus::PendingAnalysis => JobStatus::PendingResumeOptimization,
            JobStatus::PendingResumeOptimization => JobStatus::PendingCommunication,
            JobStatus::PendingCommunication => JobStatus::PendingApplication,
            JobStatus::PendingApplication => JobStatus::Interviewing,
            JobStatus::Interviewing => JobStatus::Passed,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum Actor {
    User,
    System,
    Ai,
}

impl Actor {
    pub fn as_str(&self) -> &'static str {
        match self {
            Actor::User => "user",
            Actor::System => "system",
            Actor::Ai => "ai",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransitionKind {
    /// 正常链路推进
    System,
    /// 向前跳过若干阶段
    SkipForward,
    /// 回退
    Backward,
    /// 从终态恢复
    Restore,
    /// 进入终态
    Terminal,
}

/// 判定 from -> to 的转移类型。UI 与 service 共用同一语义（spec §6.2）。
pub fn classify_transition(from: JobStatus, to: JobStatus) -> TransitionKind {
    use JobStatus::*;
    if to == Passed || to == Rejected {
        if from.canonical_next() == Some(to) {
            return TransitionKind::System;
        }
        return TransitionKind::Terminal;
    }
    if from.canonical_next() == Some(to) {
        return TransitionKind::System;
    }
    const ORDER: [JobStatus; 5] = [
        PendingAnalysis,
        PendingResumeOptimization,
        PendingCommunication,
        PendingApplication,
        Interviewing,
    ];
    match (ORDER.iter().position(|s| *s == from), ORDER.iter().position(|s| *s == to)) {
        (Some(fi), Some(ti)) if ti > fi => TransitionKind::SkipForward,
        (Some(_), Some(_)) => TransitionKind::Backward,
        (None, Some(_)) => TransitionKind::Restore,
        _ => TransitionKind::Backward,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_status_strings() {
        for s in [
            JobStatus::PendingAnalysis,
            JobStatus::PendingResumeOptimization,
            JobStatus::PendingCommunication,
            JobStatus::PendingApplication,
            JobStatus::Interviewing,
            JobStatus::Passed,
            JobStatus::Rejected,
        ] {
            assert_eq!(JobStatus::parse(s.as_str()), Some(s));
        }
        assert_eq!(JobStatus::parse("nope"), None);
    }

    #[test]
    fn canonical_chain() {
        let mut s = JobStatus::PendingAnalysis;
        let mut steps = vec![s];
        while let Some(next) = s.canonical_next() {
            steps.push(next);
            s = next;
        }
        assert_eq!(steps.len(), 6);
        assert_eq!(steps[5], JobStatus::Passed);
    }

    #[test]
    fn classify() {
        assert_eq!(
            classify_transition(JobStatus::PendingAnalysis, JobStatus::PendingResumeOptimization),
            TransitionKind::System
        );
        assert_eq!(
            classify_transition(JobStatus::PendingAnalysis, JobStatus::Interviewing),
            TransitionKind::SkipForward
        );
        assert_eq!(
            classify_transition(JobStatus::Interviewing, JobStatus::PendingAnalysis),
            TransitionKind::Backward
        );
        assert_eq!(
            classify_transition(JobStatus::Passed, JobStatus::Interviewing),
            TransitionKind::Restore
        );
        assert_eq!(
            classify_transition(JobStatus::Interviewing, JobStatus::Rejected),
            TransitionKind::Terminal
        );
        assert_eq!(
            classify_transition(JobStatus::Interviewing, JobStatus::Passed),
            TransitionKind::System
        );
    }

    #[test]
    fn serde_snake_case() {
        let json = serde_json::to_string(&JobStatus::PendingResumeOptimization).unwrap();
        assert_eq!(json, r#""pending_resume_optimization""#);
    }
}

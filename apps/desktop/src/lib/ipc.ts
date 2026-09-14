/**
 * 类型化 IPC 封装（spec §11）。正式 bindings.ts 由 tauri-specta 在 debug 构建时生成，
 * 这里先行手写与 Rust 域类型一致的签名；类型以 specta 导出为准。
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  AIRun,
  Application,
  Artifact,
  Communication,
  InterviewRound,
  Job,
  JobEvent,
  JobStatus,
  JobSummary,
  Resume,
  ResumeContent,
  Template,
} from "./types";

export type { AIRun, Application, Artifact, Communication, InterviewRound, Job, JobEvent, JobStatus, JobSummary, Resume, ResumeContent, Template };

export interface SerializedError {
  code: string;
  message: string;
}

export interface CreateJobInput {
  company_name: string;
  role_title: string;
  jd_markdown: string;
  source_url?: string | null;
  location?: string | null;
  salary_text?: string | null;
}

export interface TransitionJobInput {
  to_status: JobStatus;
  reason?: string | null;
}

export interface DashboardMetrics {
  total_active: number;
  pending: number;
  interviewing: number;
  passed: number;
  rejected: number;
}

export interface AddCommunicationInput {
  occurred_at: string;
  contact_name?: string | null;
  channel: string;
  notes: string;
  advance_to_pending_application: boolean;
}

export interface AddApplicationInput {
  applied_at: string;
  channel: string;
  notes: string;
}

export interface UpsertInterviewInput {
  id?: string | null;
  sequence?: number | null;
  name: string;
  status: string;
  scheduled_at?: string | null;
  format?: string | null;
  interviewer?: string | null;
  notes: string;
  result?: string | null;
}

export interface SaveResumeInput {
  id: string;
  title?: string | null;
  markdown: string;
  template_id?: string | null;
}

export interface SkillInfo {
  name: string;
  description: string;
  path: string | null;
  enabled: boolean;
  error: string | null;
  /** 发现来源目录（工作区/本机个人目录），UI 据此分组 */
  cwd: string;
}

export interface AIRunInput {
  run_type: "job_analysis" | "company_research" | "resume_tailoring";
  job_id: string;
  resume_id?: string | null;
}

export interface AIServiceStatus {
  codex_path: string | null;
  codex_version: string | null;
  app_server_state: string;
  logged_in: boolean | null;
  account_email: string | null;
  plan_type: string | null;
}

export interface LoginStartResult {
  kind: string;
  auth_url: string | null;
  verification_url: string | null;
  user_code: string | null;
}

export type { LayoutConfig, LayoutBlock } from "@jsw/markdown-resume";
import type { LayoutConfig } from "@jsw/markdown-resume";

export interface RunOutput {
  name: string;
  content: string;
}

export interface TemplateAssets {
  template_html: string;
  style_css: string;
  manifest_json: string;
}

export const api = {
  // jobs
  listJobs: (query: { status?: JobStatus | null; search?: string | null }) =>
    invoke<JobSummary[]>("list_jobs", { query }),
  getJob: (id: string) => invoke<Job>("get_job", { id }),
  createJob: (input: CreateJobInput) => invoke<Job>("create_job", { input }),
  updateJob: (id: string, patch: Partial<CreateJobInput>) =>
    invoke<Job>("update_job", { id, patch }),
  transitionJob: (id: string, input: TransitionJobInput) =>
    invoke<Job>("transition_job", { id, input }),
  deleteJob: (id: string) => invoke<void>("delete_job", { id }),
  readJd: (id: string) => invoke<string>("read_jd", { id }),
  updateJd: (id: string, markdown: string) => invoke<Job>("update_jd", { id, markdown }),
  listJobEvents: (id: string) => invoke<JobEvent[]>("list_job_events", { id }),
  addCommunication: (id: string, input: AddCommunicationInput) =>
    invoke<Communication>("add_communication", { id, input }),
  listCommunications: (id: string) => invoke<Communication[]>("list_communications", { id }),
  addApplication: (id: string, input: AddApplicationInput) =>
    invoke<Application>("add_application", { id, input }),
  listApplications: (id: string) => invoke<Application[]>("list_applications", { id }),
  upsertInterview: (id: string, input: UpsertInterviewInput) =>
    invoke<InterviewRound>("upsert_interview", { id, input }),
  listInterviews: (id: string) => invoke<InterviewRound[]>("list_interviews", { id }),
  reorderInterview: (id: string, interviewId: string, newSequence: number) =>
    invoke<void>("reorder_interview", { id, interviewId, newSequence }),
  dashboardMetrics: () => invoke<DashboardMetrics>("dashboard_metrics"),

  // resumes
  readImportSource: (path: string) => invoke<string>("read_import_source", { path }),
  importMarkdown: (path: string, normalizedMarkdown: string, title: string, templateId: string) =>
    invoke<Resume>("import_markdown", { path, normalizedMarkdown, title, templateId }),
  createBaseResume: (title: string, markdown: string) =>
    invoke<Resume>("create_base_resume", { title, markdown }),
  readResume: (id: string) => invoke<ResumeContent>("read_resume", { id }),
  saveResume: (input: SaveResumeInput) => invoke<Resume>("save_resume", { input }),
  createResumeVersion: (id: string, title: string) =>
    invoke<Resume>("create_resume_version", { id, title }),
  duplicateResume: (id: string) => invoke<Resume>("duplicate_resume", { id }),
  getLayout: (id: string) => invoke<LayoutConfig | null>("get_layout", { id }),
  saveLayout: (id: string, config: LayoutConfig) =>
    invoke<void>("save_layout", { id, config }),
  listResumes: () => invoke<Resume[]>("list_resumes"),
  deleteResume: (id: string) => invoke<void>("delete_resume", { id }),
  exportPdfRendered: (args: {
    resumeId: string;
    templateId: string;
    renderedHtml: string;
    pageCss: string;
    outputPath: string;
  }) => invoke<{ output_path: string; page_count: number; sha256: string }>("export_pdf_rendered", args),

  // templates
  listTemplates: () => invoke<Template[]>("list_templates"),
  setTemplateEnabled: (id: string, enabled: boolean) =>
    invoke<void>("set_template_enabled", { id, enabled }),
  importTemplateZip: (zipPath: string) => invoke<Template>("import_template_zip", { zipPath }),
  readTemplateAssets: (id: string) => invoke<TemplateAssets>("read_template_assets", { id }),
  saveTemplatePreview: (templateId: string, renderedHtml: string) =>
    invoke<string>("save_template_preview", { templateId, renderedHtml }),
  readTemplatePreview: (templateId: string) =>
    invoke<string | null>("read_template_preview", { templateId }),

  // ai
  readAIStatus: () => invoke<AIServiceStatus>("read_ai_status"),
  getCodexPathOverride: () => invoke<string | null>("get_codex_path_override"),
  setCodexPathOverride: (path: string) =>
    invoke<void>("set_codex_path_override", { path }),
  startAppServer: () => invoke<string>("start_app_server"),
  startLogin: (mode: "chatgpt" | "apiKey", apiKey?: string) =>
    invoke<LoginStartResult>("start_login", { input: { mode, apiKey } }),
  logout: () => invoke<void>("logout"),
  listSkills: (forceReload: boolean) => invoke<SkillInfo[]>("list_skills", { forceReload }),
  setSkillEnabled: (path: string, enabled: boolean) =>
    invoke<void>("set_skill_enabled", { path, enabled }),
  importSkill: (path: string, replace: boolean) =>
    invoke<string>("import_skill", { path, replace }),
  deleteSkill: (name: string) => invoke<void>("delete_skill", { name }),
  enqueueRun: (input: AIRunInput) => invoke<AIRun>("enqueue_run", { input }),
  cancelRun: (id: string) => invoke<void>("cancel_run", { id }),
  listRuns: (jobId?: string | null) => invoke<AIRun[]>("list_runs", { jobId }),
  readJobArtifacts: (jobId: string) => invoke<RunOutput[]>("read_job_artifacts", { jobId }),
  listArtifacts: (jobId: string) => invoke<Artifact[]>("list_artifacts", { jobId }),

  // backup / app
  createBackup: () => invoke<string>("create_backup"),
  restoreBackup: (backupPath: string) => invoke<void>("restore_backup", { backupPath }),
  appInfo: () => invoke<{ version: string; app_data_dir: string }>("app_info"),
  runRecoveryScan: () => invoke<[number, number]>("run_recovery_scan"),
};

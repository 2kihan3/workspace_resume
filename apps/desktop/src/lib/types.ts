export type JobStatus =
  | "pending_analysis"
  | "pending_resume_optimization"
  | "pending_communication"
  | "pending_application"
  | "interviewing"
  | "passed"
  | "rejected";

export interface Job {
  id: string;
  company_name: string;
  role_title: string;
  status: JobStatus;
  jd_path: string;
  source_url: string | null;
  location: string | null;
  salary_text: string | null;
  active_resume_id: string | null;
  terminal_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobSummary {
  id: string;
  company_name: string;
  role_title: string;
  status: JobStatus;
  location: string | null;
  salary_text: string | null;
  updated_at: string;
}

export interface JobEvent {
  id: string;
  job_id: string;
  event_type: string;
  from_status: JobStatus | null;
  to_status: JobStatus | null;
  actor: "user" | "system" | "ai";
  payload_json: string;
  occurred_at: string;
}

export interface Resume {
  id: string;
  title: string;
  kind: "base" | "tailored";
  markdown_path: string;
  parent_resume_id: string | null;
  job_id: string | null;
  template_id: string;
  content_sha256: string;
  created_at: string;
  updated_at: string;
}

export interface ResumeContent {
  resume: Resume;
  markdown: string;
}

export interface Communication {
  id: string;
  job_id: string;
  occurred_at: string;
  contact_name: string | null;
  channel: string;
  notes: string;
  created_at: string;
}

export interface Application {
  id: string;
  job_id: string;
  applied_at: string;
  channel: string;
  notes: string;
  created_at: string;
}

export interface InterviewRound {
  id: string;
  job_id: string;
  sequence: number;
  name: string;
  status: string;
  scheduled_at: string | null;
  format: string | null;
  interviewer: string | null;
  notes: string;
  result: string | null;
  created_at: string;
  updated_at: string;
}

export interface Template {
  id: string;
  name: string;
  origin: "builtin" | "uploaded";
  version: string;
  manifest_path: string;
  preview_path: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface AIRun {
  id: string;
  job_id: string | null;
  resume_id: string | null;
  run_type: string;
  status: "queued" | "running" | "waiting_approval" | "succeeded" | "failed" | "cancelled";
  thread_id: string | null;
  model: string | null;
  skill_snapshot_json: string;
  input_manifest_json: string;
  output_manifest_json: string | null;
  workdir_path: string;
  error_code: string | null;
  error_message: string | null;
  queued_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface Artifact {
  id: string;
  job_id: string | null;
  resume_id: string | null;
  ai_run_id: string | null;
  kind: string;
  relative_path: string;
  sha256: string;
  metadata_json: string;
  created_at: string;
}

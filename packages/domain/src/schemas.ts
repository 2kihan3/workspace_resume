import { z } from "zod";
import { JOB_STATUSES } from "./enums";

export const JobStatusSchema = z.enum(JOB_STATUSES as unknown as [string, ...string[]]);
export type JobStatusValue = z.infer<typeof JobStatusSchema>;

export const CreateJobInputSchema = z.object({
  companyName: z.string().trim().min(1, "公司名称不能为空"),
  roleTitle: z.string().default(""),
  jdMarkdown: z.string().min(1, "JD 内容不能为空"),
  sourceUrl: z.string().url().optional().or(z.literal("")),
  location: z.string().optional(),
  salaryText: z.string().optional(),
});
export type CreateJobInput = z.infer<typeof CreateJobInputSchema>;

export const TransitionJobInputSchema = z.object({
  jobId: z.string().uuid(),
  toStatus: z.enum(JOB_STATUSES as unknown as [string, ...string[]]),
  reason: z.string().optional(),
});
export type TransitionJobInput = z.infer<typeof TransitionJobInputSchema>;

export const CommunicationSchema = z.object({
  occurredAt: z.string(),
  contactName: z.string().optional(),
  channel: z.enum(["phone", "email", "wechat", "linkedin", "meeting", "other"]),
  notes: z.string().default(""),
});
export type Communication = z.infer<typeof CommunicationSchema>;

export const InterviewRoundSchema = z.object({
  sequence: z.number().int().positive(),
  name: z.string().min(1),
  status: z.enum(["planned", "scheduled", "completed", "cancelled"]),
  scheduledAt: z.string().optional(),
  format: z.string().optional(),
  interviewer: z.string().optional(),
  notes: z.string().default(""),
  result: z.enum(["passed", "failed", "pending"]).optional(),
});
export type InterviewRound = z.infer<typeof InterviewRoundSchema>;

// ---- 简历 Markdown 协议（spec §7） ----

export const RESUME_SCHEMA_VERSION = 1;
export const SYSTEM_SECTION_IDS = [
  "basic",
  "experience",
  "projects",
  "education",
  "skills",
] as const;
export type SystemSectionId = (typeof SYSTEM_SECTION_IDS)[number];

export const SECTION_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export interface ParsedResumeSection {
  id: string;
  title: string;
  markdown: string;
  isSystem: boolean;
}

export interface ResumeFrontmatter {
  schemaVersion: number;
  title: string;
  locale: string;
  templateId: string;
}

export interface ResumeParseResult {
  ok: boolean;
  frontmatter: ResumeFrontmatter | null;
  sections: ParsedResumeSection[];
  missingSystemSections: SystemSectionId[];
  duplicateSectionIds: string[];
  unknownSectionIds: string[];
  errors: string[];
}

// ---- 视觉模板上下文（spec §8.2） ----

export interface TemplateContextV1 {
  document: {
    title: string;
    locale: string;
  };
  resume: {
    bodyHtml: string;
  };
  sections: Record<
    string,
    {
      title: string;
      html: string;
    }
  >;
}

// ---- AI 输出 schema（spec §10.7） ----

export const JDAnalysisV1Schema = z.object({
  schemaVersion: z.literal(1),
  roleTitle: z.string(),
  summary: z.string(),
  responsibilities: z.array(z.string()),
  mustHave: z.array(z.string()),
  niceToHave: z.array(z.string()),
  keywords: z.array(z.string()),
  seniority: z.string().nullable(),
  location: z.string().nullable(),
  salary: z.string().nullable(),
  candidateRisks: z.array(z.string()),
  questionsToClarify: z.array(z.string()),
});
export type JDAnalysisV1 = z.infer<typeof JDAnalysisV1Schema>;

export const CompanySourceV1Schema = z.object({
  title: z.string(),
  url: z.string().url(),
  publisher: z.string(),
  accessedAt: z.string(),
  supportingClaims: z.array(z.string()),
});
export type CompanySourceV1 = z.infer<typeof CompanySourceV1Schema>;

export const TailoringReportV1Schema = z.object({
  schemaVersion: z.literal(1),
  baseResumeSha256: z.string(),
  jdAnalysisSha256: z.string(),
  changedSections: z.array(
    z.object({ sectionId: z.string(), summary: z.string() }),
  ),
  matchedKeywords: z.array(z.string()),
  unsupportedClaims: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type TailoringReportV1 = z.infer<typeof TailoringReportV1Schema>;

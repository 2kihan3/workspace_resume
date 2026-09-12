import { serializeResumeDocument } from "@jsw/markdown-resume";

/**
 * 生成符合协议的空白简历骨架（新建流程用，spec §7）。
 * frontmatter 的 templateId 写入所选模板；section 结构完整但内容为空/占位。
 */
export function buildBlankResumeMarkdown(title: string, templateId: string): string {
  return serializeResumeDocument({
    title,
    locale: "zh-CN",
    templateId,
    sections: [
      {
        id: "basic",
        markdown: `## 基本信息

# 你的名字

求职意向

- 邮箱：
- 电话：
- 城市：`,
      },
      { id: "experience", markdown: "## 工作经历" },
      { id: "projects", markdown: "## 项目经历" },
      { id: "education", markdown: "## 教育经历" },
      { id: "skills", markdown: "## 技能" },
    ],
  });
}

/** 空白简历的默认模板（与 magic-resume 的空白行为一致：直接创建）。 */
export const BLANK_TEMPLATE_ID = "builtin.modern";

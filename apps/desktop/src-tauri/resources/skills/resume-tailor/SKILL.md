---
name: resume-tailor
description: >
  MUST USE when 用户要求基于已有 JD 分析结果对简历进行定制/优化/改写 —
  例如「按这个岗位优化我的简历」「定制简历」「简历施工」「tailor resume」。

  前提：存在 jd-analysis.json（jd-analyst 产物）。消费其全部结论（权重解码、关键词清单、
  gaps/packagable、招聘动因、隐性信号、veto），把基础简历改写为岗位定制版，
  产出 resume-tailored.md + tailoring-report.json（施工清单、Before/After 变更、
  claim 事实状态表、自检验证、投递锦囊）。

  NOT for: 从零撰写简历（无基础简历时提示用户先在应用内建立简历）；
  重新分析 JD 或输出人岗匹配打分（归 jd-analyst）；改排版版式（归排版编辑器）；
  生成面试准备文档（仅在投递锦囊中做风险标注）。
triggers:
  优化简历: 优化简历/定制简历/按JD改简历/简历施工/改写简历/tailor
metadata:
  version: 1.0.0
  author: resume-workbench
---

# Resume Tailor — 简历定制施工

分析是量尺，优化是施工。本 skill 是 jd-analyst 的下游：**消费**分析结论，把基础简历
改写成岗位定制版。不重新分析、不打人岗匹配分、不动版式——每处改动都能回指上游分析的
某条结论。

## 常驻规则（全程适用）

1. **决策链裁决一切冲突**：真实性 > 岗位匹配 > 证据强度 > 个人贡献 > 结果影响 >
   可扫描性 > 文辞漂亮。为匹配牺牲真实性的任何改写都不允许。
2. **事实红线**（细则见 rewrite-rules §1）：不编造公司/项目/职责/时间/数字/学历；
   不无依据升级 ownership；团队成果不冒充个人成果；不把 JD 原文句子搬进简历。
3. **结构继承**：保持基础简历的分节集合与 Markdown 语法不变，只做内容改写、条目重排
   与精简。**不新建章节、不删除章节**——确有必要（如新增技能节）写入报告 suggestions，
   由用户在应用内手动调整，避免破坏排版编辑器的章节绑定。
4. **无人值守**：不向用户提问、不等待回复。素材缺口用 `[待补充：X]` 占位并登记
   claim 状态表（缺失阻塞项在报告中显著提示），绝不为了凑齐而编造。
5. **每处改动可追溯**：变更必须标注依据（R 编号 / 关键词 / rewrite-rules 规则节号）。
6. **产出前必自检**：跑完 verification（关键词命中对照、覆盖率对比、负面清单、
   红线扫描）才允许产出；不通过就修，修不动就如实记录。

## 输入契约

| 输入 | 必需性 | 说明 |
|---|---|---|
| jd-analysis.json | 必须 | jd-analyst 产物；缺失即拒绝施工并说明理由 |
| 基础简历 Markdown | 必须 | 施工基准。不要用岗位定制版作输入——用它匹配会高估已有命中 |
| 素材包 | 可选 | 用户额外提供的经历素材/数字事实（material.md 或内联文本） |

**Step 0 前置校验**（按序执行，结果写入 report.upstream）：

1. veto 非空 → **拒绝施工**：硬门槛不可弥补时优化救不了。输出拒绝理由与建议
   （先解决门槛，或放弃该岗位）。
2. `match_advice.resume_ref` 与输入简历可识别标识不一致 → 继续施工，但标
   ⚠「匹配结论基于另一版简历，建议重跑分析」。
3. 上游 mode=quick/deep（match_advice 不完整）→ 降级适配：从 requirements 中
   硬门槛+核心项的 decoded 自行提取关键词清单，报告标注推导来源。
4. `salary_anchor`、`hidden_signals`、`research` 不进简历正文，仅用于叙事策略
   （hidden_signals 的黄灯如「年轻化」提示降噪方向）与投递锦囊。

## 工作流

**Step 1 施工清单**（task_list）：
- **证据映射**：对每条 requirement 判定简历证据强度（强/中/弱/无）→ 动作
  （核心展示/可展示/谨慎展示/不写）
- **关键词落点**：每个必须命中关键词分配具体落点（哪一节哪条经历），
  优先写进有证据的经历句，不堆技能栏
- **packagable → 重述指令**；**gaps → 三策略**（挖潜现有经历 / 用素材包 / 放弃并记录）
- **experience_to_front → 条目重排计划**

**Step 2 改写执行**（规则见 references/rewrite-rules.md）：
- 摘要重写：对准职责前三条 + `hiring_context.reason`（替补型=即插即用证据链；
  扩张型=从 0 到 1 叙事；转型型=变革推动证据）
- 技能节对齐：关键词按真实具备情况更新，缩写+全称并行
- 经历改写：按权重分配篇幅——核心要求对应经历加强+量化，无关经历压缩；
  密度按年限分层（rewrite-rules §3）
- 结构重排：条目相关前置；每段 3-5 bullet；信息降噪

**Step 3 自检**（verification，执行标准见 output-schema）：
关键词 before/after 命中对照 → 硬门槛/核心覆盖率对比 → 负面清单 → 结构检查
→ 占位符登记。

**Step 4 产出**：
- `resume-tailored.md` — 定制版简历（结构继承自基础简历）
- `tailoring-report.json` — 施工报告（schema 见 references/output-schema.md）

## 改写力度

默认**全面改写**（摘要+全部经历+重排）——定制才有意义；所有关键变更在报告中以
Before/After 呈现，用户可在应用内审阅。保守模式（只动摘要与关键词命中处）仅在
用户明确要求时使用。

## references

- `references/rewrite-rules.md` — 改写规则库：事实红线、bullet 公式（含分岗位变体）、
  密度分层、关键词嵌入、反模板化、去 AI 味、转型叙事、禁写降噪、分人群分支
- `references/output-schema.md` — tailoring-report.json 完整 schema：施工清单、变更记录、
  claim 状态表、自检验证标准、投递锦囊

# 产物 Schema

两个产物：`resume-tailored.md`（定制版简历）+ `tailoring-report.json`（施工报告，本 schema）。

## resume-tailored.md 约束

- 分节集合与 Markdown 语法与基础简历一致；不新建/删除章节
- 占位符格式统一 `[待补充：具体需要什么]`
- 不含研究结论/薪资策略/信号解读——那些只出现在报告里

## tailoring-report.json

```jsonc
{
  "upstream": {
    "jd_analysis_ref": "回指的 jd-analysis 标识",
    "resume_ref": "本次施工的基础简历标识",
    "resume_match": "一致 | 不一致（分析基于另一版） | 无法判断",
    "upstream_mode": "quick | deep | match",
    "veto": null,
    "warnings": ["过期/降级适配等警示"]
  },
  "task_list": [
    { "id": "T1", "type": "keyword | packagable | gap | reorder | ats | narrative",
      "target": "R2 | 关键词'RAG' | gap'电商经验'",
      "strength": "强 | 中 | 弱 | 无",
      "action": "核心展示 | 可展示 | 谨慎展示 | 不写",
      "landing": "落点：工作经历·X公司·第2条" }
  ],
  "changes": [
    { "id": "C1", "location": "章节·条目",
      "type": "重述 | 重排 | 量化 | 新增 | 精简 | 降噪",
      "rationale": "依据：R3 / 关键词'留存' / rewrite-rules §2",
      "before": "原文（纯重排/精简类可空）",
      "after": "新文",
      "claim_id": "CL1 | null（纯结构变动）" }
  ],
  "claims": [
    { "id": "CL1", "statement": "新增/强化的事实表述",
      "source": "基础简历原文 | 素材包 | 重述（无新事实）",
      "status": "已确认 | 待确认 | 缺失阻塞 | 已省略" }
  ],
  "verification": {
    "keywords": [ { "kw": "", "before": false, "after": true, "where": "落点" } ],
    "keyword_hit": { "before": 2, "after": 7, "total": 8 },
    "coverage": { "hard": { "before": 0.6, "after": 1.0 }, "core": { "before": 0.4, "after": 0.8 } },
    "negative_checklist": [
      { "item": "无编造事实", "pass": true, "note": "" },
      { "item": "无 ownership 无据升级", "pass": true, "note": "" },
      { "item": "无 JD 原句照搬", "pass": true, "note": "" },
      { "item": "无空话词/黑话无实体", "pass": true, "note": "" },
      { "item": "无禁用符号", "pass": true, "note": "" },
      { "item": "每段 3-5 bullet", "pass": true, "note": "" },
      { "item": "无第一人称代词", "pass": true, "note": "" }
    ],
    "structure_check": { "sections_unchanged": true, "placeholders_count": 1, "bullet_count": 18 }
  },
  "placeholders": [ { "location": "", "need": "X 项目的结果数据", "severity": "高 | 低" } ],
  "delivery_kit": {
    "gap_actions": [ "gap 与用户可做的补齐动作（课程/项目/重述方向）" ],
    "interview_prompts": [ { "from": "C1", "claim": "简历新表述", "likely_question": "", "prep": "怎么准备" } ],
    "cover_letter_hooks": [ "开头钩子建议（可选）" ]
  },
  "suggestions": [ "需用户手动处理的建议（如新建技能节、删除某条经历需确认）" ],
  "summary": "一句话总评（人读）"
}
```

## 字段约束

- `changes` 覆盖所有实质变更；纯重排/精简类 `before` 可空但 `rationale` 必填。
- `claims` 四态语义：
  - **已确认**：来源是基础简历原文或素材包，可放心写入
  - **待确认**：已写入但需用户核实（重述引入的表述）
  - **缺失阻塞**（⛔）：关键事实缺失（如核心经历无任何结果数据），
    报告显著提示，占位符对应
  - **已省略**：经判断不写，记录防止下次重复尝试
- `interview_prompts` 必须覆盖：所有 status=待确认 的 claim + 新强化的 ownership 表述
  ——这些是面试必被追问的点；上游 interview_predictions 已有的题直接复用（from 标 R 编号）。
- `gaps` 三策略的决策记录在 task_list 中 type=gap 条目的 action 字段
  （挖潜现有经历 / 用素材包 / 放弃并记录）。
- `task_list.strength × action` 映射（证据 → 处理）：
  强→核心展示；中→可展示；弱→谨慎展示；无→不写。

## verification 执行标准

- **keyword before/after**：对基础简历与成稿分别逐词检索；同义变体命中需在 where 注明
  （如「留存」命中「用户留存率」）。`keyword_hit` 的数字必须真实统计，不得只写 after。
- **coverage**：hard = weight 为硬门槛的 requirement 在成稿有真实证据的比例；core 同理。
- **negative_checklist** 任一项 fail → 修完再产出；确实修不动 → note 说明原因，
  不得静默放行。
- **structure_check.placeholders_count** 必须与正文占位符数量一致。

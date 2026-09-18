# 产物 Schema

四个产物：`interview-review.json`（本 schema）+ `interview-review.md`（人读报告）+
`follow-up-email.md`（感谢信草稿，默认产出）+ `interview-transcript.md`（仅音频输入时）。

## interview-review.md 约束

- 打分卡第一屏（总分/六维/预判/置信度），分析章节是依据展开
- 引用原话用引号保留原文；每条结论标注时间戳或 Q 编号
- 不含性格/心理评判措辞

## interview-review.json

```jsonc
{
  "meta": {
    "company": "", "position": "",
    "round": "一面 | 二面 | HR面 | 终面 | 未知（推断）",
    "interviewer_role": "技术 | 业务 | HR | 老板 | 未知（推断）",
    "input_type": "audio | transcript | notes",
    "transcription": { "tool": "", "status": "成功 | 失败 | 未涉及", "duration_min": 0 },
    "upstream": { "jd_analysis": false, "tailoring_report": false },
    "warnings": []
  },
  "structure": [
    { "segment": "自我介绍 | 专业问答 | 项目深挖 | 行为面 | 反问 | 收尾",
      "start": "mm:ss 或段落号", "summary": "" }
  ],
  "qa_list": [
    { "id": "Q1", "question": "面试官原话", "answer_summary": "",
      "follow_ups": [ { "q": "", "a_summary": "" } ],
      "grade": "讲透了 | 合格 | 含糊 | 崩了",
      "attribution": "没准备 | 没经验 | 表达问题 | 非必要 | null（非含糊/崩级）",
      "notes": "" }
  ],
  "interviewer": {
    "role": "", "style": "深挖型 | 压力型 | 温和型 | 混合",
    "focus_map": [ { "area": "", "evidence": "Q3-Q5 连续追问" } ]
  },
  "signals": [
    { "clue": "原话或行为描述", "reading": "", "light": "红 | 黄 | 绿", "evidence": "mm:ss" }
  ],
  "concern_map": [
    { "topic": "", "follow_up_count": 0, "defense": "稳 | 勉强 | 崩",
      "related_requirement": "R2 | null", "suggested_fix": "" }
  ],
  "reconciliation": {
    "status": "已对账 | 独立复盘（无上游产物）",
    "predictions_hit": [ { "from": "R2", "predicted": "", "asked": true, "performance": "" } ],
    "predictions_missed": [ { "from": "R4", "predicted": "" } ],
    "surprise_questions": [ { "q": "", "source_guess": "L2 推断原因" } ],
    "claims_defense": [ { "claim": "", "probed": true, "held_up": "稳 | 勉强 | 崩" } ],
    "consistency": [ { "type": "口述超出简历 | 简历有但讲不清 | 一致", "item": "", "risk": "" } ]
  },
  "score": {
    "total": 0, "verdict": "稳 | 五五开 | 悬",
    "dimensions": {
      "content":              { "v": 0, "w": 0.25, "why": "" },
      "delivery":             { "v": 0, "w": 0.15, "why": "" },
      "fit_presentation":     { "v": 0, "w": 0.20, "why": "" },
      "authenticity_defense": { "v": 0, "w": 0.20, "why": "" },
      "counter_questions":    { "v": 0, "w": 0.10, "why": "" },
      "signals":              { "v": 0, "w": 0.10, "why": "" }
    },
    "verdict_confidence": "高 | 中 | 低",
    "verdict_evidence": ["依据信号列表"]
  },
  "actions": {
    "reanswers": [ { "from": "Q5", "issue": "", "framework": "参考答案骨架（STAR/结论先行）", "use": "下一轮或同岗其他公司" } ],
    "next_prep": [ "下一场准备项" ],
    "round_overround": "与上一轮复盘的对账结论（多轮时；单轮为 null）"
  },
  "summary": "一句话总评（人读）"
}
```

## 字段约束

- `qa_list` 按时间顺序编号（Q 前缀）；`follow_ups` 可为空数组
- `attribution` 仅含糊/崩了级别必填，其余为 null
- `signals.evidence`、`structure.start`：音频输入用 mm:ss 时间戳，文本输入用段落号
- `reconciliation` 仅在上游产物存在时填 predictions/claims/consistency；
  否则 `status=独立复盘` 且三数组为空
- `concern_map` 规则见 signal-rules「疑虑地图构建」：追问 ≥2 或防御=崩 必入感谢信
  补坑清单；崩 + 硬门槛话题必入 next_prep
- `counter_questions` / `signals` 在 `input_type=notes` 时 v=null（N/A），
  权重按 scoring-rules 归一化
- 降级情形必须产出 schema 合法文件：转写失败时 qa_list/score 各维可空值 +
  warnings 说明；不得静默缺文件
- `actions.reanswers` 必须覆盖所有 grade=崩了 的题，且逐条给参考答案骨架
  （骨架可用占位 `[待补充：X]` 标注需要用户填的数字，不编造）

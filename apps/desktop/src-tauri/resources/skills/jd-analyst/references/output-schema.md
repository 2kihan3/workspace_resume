# 打分模型与输出 Schema

## 打分模型

四维各 0–100，加权求和为总分。

### 维度定义

**JQ 岗位质量（权重 40%）**

| 区间 | 锚点 |
|---|---|
| 90–100 | 核心业务线（L3 已证）+ JD 专业度高 + 成长路径明确 |
| 70–89 | 成长业务线，或 JD 专业但业务线地位未证实 |
| 50–69 | 地位不明（快解档常见，置信度低） |
| 30–49 | 边缘/实验性业务（有证据） |
| 0–29 | 边缘业务 + JD 敷衍 |

**MF 匹配度（权重 30%，无简历时 N/A）**

    MF = 100 × (0.5 × 硬门槛命中率 + 0.35 × 核心要求覆盖率 + 0.15 × 加分项命中率)

硬门槛不满足且不可弥补 → MF 封顶 30。

**RK 风险（权重 20%）**

从 100 起扣：红灯每条 -15~-25、黄灯每条 -5~-10（标准见 red-flags），下限 0。
未核实的 L3 风险项不扣分，但计入置信度警示。

**OW 机会窗口（权重 10%）**

基础 60 分调整：新挂(<2 周) +10；长期挂(>3 月) -20；技能组合稀缺 +15；
大路货 -10；扩张期多岗同招 +10。截断到 [0,100]。

### 汇总规则

- 总分 = Σ(维度分 × 权重)
- MF 为 N/A 时权重归一化：JQ 57% / RK 29% / OW 14%
- **决策带**：≥75 投 · 55–74 慎投偏投 · 40–54 慎投（先补信息）· <40 不投
- **一票否决**命中时决策带被覆盖为「不投（门槛）」，veto 字段写明理由，
  总分照常输出但标注仅供参考

### 置信度

- **高**：结论主要基于 L1 + 已核实 L3
- **中**：存在未核实 L2/L3，但不改变决策带
- **低**：风险或业务线判断依赖未核实信息 → 卡片标注「跑深解可提升置信度」

## 决策卡渲染格式

    ┌─ 决策卡 ─────────────────────────────
    │ 总分 72/100 → 慎投偏投        置信度 中
    │ 岗位质量 85 ×40%  核心业务线，JD 专业（L3 已证）
    │ 匹配度   65 ×30%  SQL 硬门槛过；电商经验缺，可用消费项目对冲
    │ 风险     60 ×20%  「抗压」×2 黄灯（L2）；口碑未核实
    │ 机会     70 ×10%  新挂 3 天；留存分析技能组合稀缺
    │ 一票否决：无
    └──────────────────────────────────────

## JSON Schema

```jsonc
{
  "mode": "quick | deep | match",
  "basic": {
    "company": "", "title": "", "level": "", "location": "", "work_mode": "",
    "salary": { "min": 0, "max": 0, "band_width_pct": 0, "vs_market": "L3 待查 | 高于/接近/低于 P50" }
  },
  "jd_quality": { "author": "HR | 业务方 | 模板抄写（推断）", "professionalism": "高 | 中 | 低", "signals": [] },
  "hiring_context": { "reason": "替补 | 扩张 | 转型 | 不明", "business_stage": "", "evidence": "L2" },
  "requirements": [
    { "id": "R1", "raw": "原文", "decoded": "真实含义", "weight": "硬门槛 | 核心 | 加分", "evidence": "L1 | L2" }
  ],
  "hidden_signals": [
    { "clue": "原文线索", "reading": "解读", "light": "红 | 黄 | 绿", "deduction": 0, "evidence": "L2 | L3" }
  ],
  "research": {
    "status": "未执行 | 已核实 | 部分核实",
    "items": [ { "question": "", "finding": "", "source": "" } ],
    "unresolved": []
  },
  "match_advice": {
    "resume_ref": "基准简历文件名/版本标识",
    "keywords_must_hit": [], "experience_to_front": [],
    "gaps": [], "packagable": []
  },
  "interview_predictions": [ { "from": "R1", "question": "", "probes": "考察点" } ],
  "score": {
    "total": 0, "band": "投 | 慎投偏投 | 慎投 | 不投",
    "dimensions": {
      "job_quality":  { "v": 0, "w": 0.40, "why": "" },
      "match_fit":    { "v": null, "w": 0.30, "why": "N/A：未提供简历" },
      "risk":         { "v": 0, "w": 0.20, "why": "" },
      "opportunity":  { "v": 0, "w": 0.10, "why": "" }
    },
    "veto": null,
    "confidence": "高 | 中 | 低",
    "confidence_notes": ""
  },
  "salary_anchor": "",
  "action_checklist": []
}
```

### 字段约束

- `requirements` 按 JD 出现顺序编号（R 前缀）；`interview_predictions.from` 回指 R 编号
- `match_fit.v` 为 null 表示 N/A（快解/深解档），此时权重按汇总规则归一化
- `hidden_signals.deduction` 记录该信号对风险分的扣分（绿灯与未核实项为 0）
- `research` 仅深解档填充；快解档在 `unresolved` 里列 L3 待查清单
- `match_advice.gaps` 与 `packagable` 必须分开：真差距 vs 可通过重述弥补
- 匹配分是**快照语义**：绑定 `resume_ref` 所指的那版简历；基础简历更新后匹配维度过期，
  需重跑分析刷新（JD 侧结论不受影响）
- 三档模式的输出字段差异：
  - quick：`research.status = 未执行`，`match_fit.v = null`
  - deep：`research` 填充核实结果
  - match：`match_advice`、`interview_predictions`、`salary_anchor` 必须完整

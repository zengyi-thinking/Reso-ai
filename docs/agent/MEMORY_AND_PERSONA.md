# Memory and Persona

## 核心区别

- Memory：发生过什么，包括 episodic、persona_related、relationship、correction、reflection。
- Persona：Reso 当前如何理解这个人，是可解释、可修正、可版本化的模型，不是真理。

```text
Event → Memory → Evidence → Pattern → Hypothesis
      → Persona Patch Candidate → User Confirmation → Persona Version
```

一次事件不能直接更新 Persona。Patch Candidate 必须记录 `fromVersionId`、JSON path、old/proposed value、reason、evidence IDs、confidence 和 status。Product API 检查 from version 和用户决定后才提交新版本。

Correction Memory 高优先级：用户明确否认“慢热”等简单解释后，后续检索必须带回这次纠正，并抑制冲突的旧假设。

Core v0.1 的可解释检索分数为：

```text
semantic + recency + importance + type + relationship + correction_boost
```

`semantic` 项保留可解释 lexical 骨干；当查询与某条 memory 均携带 embedding 且维度一致时，其余弦相似度被重标定到同一个 [0, 0.55] 区间并与 lexical 取最大值，`reason` 追加 `vec=` 分量供审计，vector-only 的匹配也能通过准入门槛。Correction 固定获得显式 boost，并通过 `conflictsWith` 抑制冲突的旧 Reflection——该抑制在引入向量项后依然保持决定性；未配置 embedding 时分数严格退回纯 lexical 基线。禁用的 Memory 完全不参与检索，Agent Lab 可据此做 ablation + replay。

Reflection 大多数时候不产生 Persona Patch。只有显式用户陈述、显式 correction，或至少两条一致的独立 evidence 才能产生 Patch Candidate；Lab 的 Accept 只生成测试用 preview，正式 Persona Version 仍由 Product API 提交。

候选晋升：Reflection 产出的候选默认 status=pending 且 requiresReview=true，由用户经 `/api/memory-candidates/:id/decision` 与 `/api/persona-patches/:id/decision` 裁决。memory candidate 被 accept 后在同一事务中晋升为正式 Memory（importance=confidence、enabled=true），reject 则关闭候选；patch candidate 的 accept 仅标记 accepted 与 confirmed_at，Persona Version bump 是尚未开始的后续流程，因此 patch 候选会持续停留在 pending 等待未来的版本晋升。

# Reso Agent Architecture

Reso Agent 不是“System Prompt → LLM”。

```text
Reso Agent = Identity + Persona + Memory + Relationship + Context
           + Policy + Tools + Runtime + Model
```

统一管线：

```text
Incoming Message → Perception → Context Builder → Memory Retrieval
→ Persona Context → Relationship Context → Mode Router
→ Relational Strategy → Policy / Permission → Planner → Tool Calling
→ Model Router → Natural Response → Post-turn Reflection
→ Memory Candidate → Persona Patch Candidate → Relationship Update Candidate
```

LLM 只是推理引擎；公共 API 不暴露 provider、模型或 prompt 名称。Agent Service 无 Product DB 写权限，只返回 Contract 定义的响应和 Candidate。

Core v0.1 的 `ModelProvider` 有两个实现：默认的 `DeterministicModelProvider` 用于 CI 与离线回归；`MiniMaxModelProvider` 用于手动 opt-in 真实测试。真实 provider 不可用时显式失败，禁止 silent fallback。供应商元数据只进入内部 privacy-safe Lab trace，不进入产品的 Agent Turn 公共 Contract。

Context Builder 每轮只装配相关 Persona slice、可解释 Top-K Memory、Relationship 摘要与最近 8 条消息。Memory v0.1 使用可调试的 lexical semantic baseline，评分包含 semantic、recency、importance、type、relationship 与 correction boost；未来 embedding provider 可以替换 semantic 部分，但不得移除解释与 correction conflict suppression。

Trace 采用 allowlist：input summary/reference、persona version、retrieved memory IDs、relationship、mode、policy、tools、model、latency、output、candidate IDs、eval result。不得保存 Chain-of-Thought、密钥、Authorization header 或未脱敏 provider 原始载荷。

用户可见的工作过程使用共享 Agent Event Stream：`status` 描述真实 Runtime 阶段，`public_reflection` 提供 evidence-backed 的公开解释，`message` 承载暂定、继续或最终回复。Trace 只记录 cadence、事件类型与 evidence refs；Provider 私有推理从不进入事件流。

## Runtime modules（2026-08-27 补齐）

- **Presence**：`presence/state.py` 从授权输入推导同行状态（累计轮次、共享记忆数、连续性：首次/持续/回归），以 `[Presence]` 段进入系统上下文；不虚构任何状态。
- **Pattern**：`pattern/detector.py` 做可解释模式检测——同一主题词在 ≥2 条相互独立的证据记忆中出现即成模式；显式 Correction 记为 exception 并下调置信度（纠正次数 ≥ 出现次数时该模式不成立）。Reflection 的 hypothesis Patch 由模式驱动，不再写死内容。
- **事实/解释分离校验**：`runtime/verification.py` 对 reconsidered 最终立场做运行时标记检查；未通过则单次重试（Prompt 明确要求区分观察与解读），仍未通过在 Trace 标记 `fact_separation_verified=false` 并在 Lab eval 中可见。
- **Consent 接缝**：`AgentAuthorizedContext.activeProxyConsent`（缺省 false，fail-closed）。Pipeline 从授权上下文读取；只有 Product API 在验证过有效、未撤销的 Consent 后才可置 true。这是 Phase 4 Proxy Mission 的既定前置，当前默认拒绝。
- **Journey 草稿**：`persona/draft.py` 从 Journey 答案推导 Persona 草稿——每个选择只构成 uncertain hypothesis（引用 question/choice ID），跨情境重复的选择提升置信度但仍为假设；`confirmedByUser` 恒为 false。

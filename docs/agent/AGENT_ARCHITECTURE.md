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

## 成长闭环与检索增强（2026-08-27 补齐）

- **Reflection Task**：`runtime/reflection_tasks.py` 以版本化 Prompt `prompts/reflection/v1.md` 对授权 transcript 批量产出候选；evidence 必须引用 transcript 内真实 message id 否则整条丢弃，未知 memory type 丢弃而不改写映射，单批 ≤3 条 memory candidates、≤1 条 patch candidate，patch 必须携带 persona 版本作为 `from_version_id`；候选恒为 status=pending 且 requiresReview=true。
- **混合检索**：`memory/retriever.py` 在可解释 lexical baseline 上叠加可选向量项——query 与 memory 均带 embedding 且维度一致时，余弦按 floor 0.32 / ceiling 0.95 重标定进 [0, 0.55] semantic 区间，取 `max(lexical, vec_component)` 并在 reason 追加 `vec=`；correction conflict suppression 保持决定性。
- **惰性查询向量**：pipeline 每轮只在存在至少一条自带 embedding 的授权记忆时才计算一次 query embedding；`LLM_EMBEDDING_MODEL` 未配置即全链路纯 lexical，绝不伪造向量。
- **内部 Embeddings 端点**：`POST /v1/embeddings` 接收 ≤64 条 inputs，MiniMax provider 按 OpenAI-style `/embeddings` 调用并统一到固定 1536 维（对应 `memories.embedding` pgvector 列），provider 失败 fail-fast 映射 502；embedding 在 Contract 上始终是可选字段。
- **Deep Recall 工具**：`tools/registry.py` 提供允许列表式 ToolRegistry（上限 8 个）；首个工具 `memory_deep_recall` 仅在出现过往指涉线索（上次/之前/还记得等）时对本次已授权记忆做第二遍 lexical sweep，合并最多 2 条 score.final≥0.45 的额外记忆使其进入可引用 allowedEvidence，向系统上下文追加来源标注并发送一次 recalling status；TraceRecord.tool_names 已填充。无网络工具，暂不做 agentic LLM 工具调用循环。
- **Worker 成长闭环**：conversation turn 持久化为每条用户消息写幂等 `message.created` Outbox；Worker 订阅后按 `reflection_runs` watermark 统计水位之上的用户消息，达到 `WORKER_REFLECTION_THRESHOLD`（默认 4）才构建 transcript/persona/memories 触发 reflect，候选写入 memory_candidates / persona_patch_candidates 并推进水位；未领取访客因无 persona version 自动跳过，失败沿 retry/backoff/dead-letter 上抛。

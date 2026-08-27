# ADR-0008: Agent 成长闭环、Embedding 检索与候选晋升边界

- Status: Accepted
- Date: 2026-08-27
- Owner: Agent + Backend

## Context

`/v1/agent/reflect` 与 `/v1/persona/suggest-patch` 此前只有确定性 stub，Memory 检索仅有可解释的
lexical baseline，tools registry 不存在；Agent 只在被调用的那一轮被动回应，产品缺少
“经历 → 记忆 → 反思 → 用户确认”的成长闭环。落地闭环需要明确三件事：反思由谁触发、
Embedding 归谁所有、Candidate 如何变成事实。

## Decision

1. 触发由 Worker 经 Outbox 驱动：conversation turn 落库时为每条用户消息写幂等的 `message.created`
   Outbox；Worker 订阅后按会话水位（`reflection_runs`，migration 0008）统计未反思的用户消息，
   达到 `WORKER_REFLECTION_THRESHOLD`（默认 4）才通过 ReflectionOrchestrationService 构建
   transcript/persona/memories 调用 reflect。无 persona version 的未领取会话直接跳过，避免
   patch 候选的外键悬空；失败沿 Worker 的 retry/backoff/dead-letter 语义上抛。
2. Embedding 计算只属于 Agent Service：新内部端点 `POST /v1/embeddings` 使用 MiniMax provider，
   向量统一截断/重归一化到固定 1536 维（对应 migration 0002 的 `memories.embedding` pgvector 列）。
   embedding 在 Contract 上是可选字段；未配置 `LLM_EMBEDDING_MODEL` 时全链路退回纯 lexical，
   绝不伪造向量。读路径对 provider 失败 fail-fast 映射 502，写路径（claim/backfill）best-effort
   吞掉错误仅告警留待下次回填——这是有意保留的非对称降级契约。
3. Reflection Contract 用 transcript/context 扩展：请求携带授权后的 `transcript`（1..50 条消息）、
   可空 `persona` 与可选 `memories`。引擎强制 evidence 必须引用 transcript 内真实 message id，
   否则整个候选丢弃；未知 memory type 丢弃而非改写映射；单批 ≤3 条 memory candidates、≤1 条
   patch candidate；patch 必须有 persona version 作为 `from_version_id`，否则跳过。
   `/v1/persona/suggest-patch` 以 `focus="patches"` 复用同一 runtime 与 Prompt v1。
4. Candidate 一律以 status=pending + requiresReview=true 由 Product API 侧落库，裁决收口在四条
   审阅路由。memory candidate 被 accept 时在同一事务内晋升为正式 Memory（importance=confidence、
   enabled=true），至此记忆链路闭合；patch 的 accept 只标记 accepted + confirmed_at，
   Persona Version bump 明确推迟为后续工作，当前 Persona 不因此改变。
5. Tools 范围限定为确定性的进程内 deep recall：`tools/registry.py` 提供允许列表式 ToolRegistry
   （上限 8 个），首个工具 `memory_deep_recall` 仅在过往指涉线索出现时对本次已授权记忆做第二遍
   lexical sweep，合并结果计入可引用 allowedEvidence，并在 trace 中记录 tool_names。

## Consequences

- “Agent Suggests, Service Commits” 全程成立：触发时机、水位、持久化与裁决都在 Product API / Worker，
  Agent 只消费授权上下文并返回候选；
- 未配置 Embedding 时行为可预期地退化为纯 lexical，而不是报错或伪造召回质量；
- 追加 migration `0008_product_growth_loop.sql` 引入 watermark 表、evidence_message_ids 列与新索引；
- 无网络工具、无 agentic LLM 工具循环，trace 不增加新的隐私面。

## Alternatives rejected

- API 内联触发或定时器轮询：把反思成本绑进请求路径，或制造空转轮询；Outbox 已提供可靠、幂等的语义；
- Node/Product API 侧自行计算 Embedding 或引入外部向量数据库：越过模型 ownership，且在规模证据出现前
  违反 AGENTS.md 对基础设施的约束；
- 由 Agent 回调 Product API 反向拉取对话上下文：违反服务边界与单向依赖方向；
- LLM agentic 工具调用循环：传输通道与安全策略尚未就绪，先以确定性工具验证价值再逐步放开。

## Forward / rollback

Migration 只前滚。回滚成长闭环只需停止 Worker 订阅，watermark 表保留进度；修正使用新的 compensating
migration 或以新 ADR supersede 本篇。

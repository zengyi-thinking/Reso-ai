# Database Design

## 技术基线

PostgreSQL + pgvector 保存正式事实和后续向量检索，Redis 用于简单异步调度/Streams。第一版不引入 MongoDB、Neo4j、Pinecone、Kafka 或 Elasticsearch。

## 核心实体

- Identity：`users`、`agents`。
- Journey：`journeys`、`journey_answers`。
- Persona：`persona_profiles`、`persona_versions`、`persona_patch_candidates`、`persona_evidence`。
- Memory：`memories`、`memory_evidence`。
- Conversation：`conversations`、`messages`。
- Relationship：`relationships`、`relationship_events`。
- Social：`social_missions`、`agent_interactions`。
- Decision support：`recommendations`。
- Privacy：`consent_grants`、`disclosure_rules`。
- Quality：`agent_traces`、`agent_evaluations`。

## Ownership

Product API/Backend Worker 是正式表的唯一写入者。Agent Service 只接收授权后的 context 并返回 Candidate；不得持有写凭据。`persona_profiles.current_version_id` 指向当前已提交版本，Candidate 在 accepted 后仍需由 Persona Service 创建新 Version。

## Memory != Persona

`memories` 保存事件摘要、类型、来源和时间，可带 embedding；`persona_versions` 保存用户确认后的版本化模型。`persona_evidence` 显式连接 Patch Candidate 与 Memory，避免一次事件直接成为人格事实。

## 生命周期与索引

- UUID 主键、外键和必要时间索引已在 migration 中建立。
- Consent 通过 `revoked_at` 保留审计，不物理删除后冒充从未存在。
- Trace 未来必须定义短保留期、脱敏和用户删除级联策略。
- embedding dimension 目前是 bootstrap 假设，接入真实模型前必须通过新 migration 确认，不改写旧 migration。

## Migration

`0001_enable_extensions.sql` 启用 pgcrypto/vector；`0002_initial_schema.sql` 建立第一版结构。合并后只追加新 migration，禁止修改历史文件。

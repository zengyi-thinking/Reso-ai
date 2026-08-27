# Database Design

## 技术基线

PostgreSQL + pgvector 保存正式事实和后续向量检索，Redis 用于简单异步调度/Streams。第一版不引入 MongoDB、Neo4j、Pinecone、Kafka 或 Elasticsearch。

## 核心实体

- Identity：`users`、`agents`。
- Journey：`journeys`、`journey_answers`。
- Journey Evidence / Manual：`journey_evidence_snapshots`、`personal_manual_snapshots`、`personal_manual_edits`。
- Persona：`persona_profiles`、`persona_versions`、`persona_patch_candidates`、`persona_evidence`。
- Memory：`memories`、`memory_evidence`。
- Conversation：`conversations`、`messages`。
- Relationship：`relationships`、`relationship_events`。
- Social：`social_missions`、`agent_interactions`。
- Decision support：`recommendations`。
- Privacy：`consent_grants`、`disclosure_rules`。
- Quality：`agent_traces`、`agent_evaluations`。
- Async delivery：`event_outbox`、`event_consumptions`、`dead_letter_events`。
- Product connection：`connections`、`connection_messages`、`user_blocks`。
- Assist / Tea Party：`agent_assist_requests`、扩展后的 `social_missions`、`agent_interactions`。
- Operations：`user_sessions`、`product_audit_log`、`rate_limit_buckets`。

## Ownership

Product API/Backend Worker 是正式表的唯一写入者。Agent Service 只接收授权后的 context 并返回 Candidate；不得持有写凭据。`persona_profiles.current_version_id` 指向当前已提交版本，Candidate 在 accepted 后仍需由 Persona Service 创建新 Version。

`connections` 是两名用户是否已正式连接、关闭或屏蔽的产品事实；`relationships` 是对用户或 Agent 互动阶段的可演进关系模型。Relationship 不得覆盖 Connection 的正式状态，Connection 事件使用独立语义并通过受控 Product command 更新。

## Memory != Persona

`memories` 保存事件摘要、类型、来源和时间，可带 embedding；`persona_versions` 保存用户确认后的版本化模型。`persona_evidence` 显式连接 Patch Candidate 与 Memory，避免一次事件直接成为人格事实。

## 生命周期与索引

- UUID 主键、外键和必要时间索引已在 migration 中建立。
- Consent 通过 `revoked_at` 保留审计，不物理删除后冒充从未存在。
- Trace 未来必须定义短保留期、脱敏和用户删除级联策略。
- embedding dimension 目前是 bootstrap 假设，接入真实模型前必须通过新 migration 确认，不改写旧 migration。

## Migration

`0001_enable_extensions.sql` 启用 pgcrypto/vector；`0002_initial_schema.sql` 建立第一版结构；`0003_event_outbox.sql` 建立 committed event、消费幂等与 dead-letter 接缝。合并后只追加新 migration，禁止修改历史文件。

`0004_post_connection_tea_party.sql` 增加真人 Connection、Assist、有限轮茶话会、Session、审计和限流结构，并复用 `0003_event_outbox.sql` 已建立的 committed event、消费幂等和 dead-letter 接缝。后续只追加新 migration，禁止修改历史文件。

`0005_journey_personal_manual.sql` 增量扩展 Journey Answer（stage、自由回答、耗时、客户端幂等 ID、服务端 Evidence），新增不可变 Evidence Snapshot、Personal Manual 原始/当前内容、用户编辑历史以及 Manual→Persona V1/Agent 的唯一关联。匿名 token 只保存 SHA-256；`source_manual_snapshot_id` 防止同一说明书创建多个正式 Persona V1。

Migration 会保留升级前已有的匿名 Journey，并为其写入不可逆、不可恢复的随机哈希以满足 fail-closed
约束；由于旧 schema 从未有可交付给客户端的匿名凭据，这些 legacy 行不会被伪装成可认领资源。如需业务认领，必须由
Backend 通过后续受审计的补偿流程处理。

Journey、Personal Manual 和 Persona 是三个独立生命周期：答案完成后冻结 Evidence；Worker 只写入校验通过的 Candidate 作为 ready Manual；用户点击领取后，Product API 才在事务中创建正式 Persona Version 和 Agent。用户编辑只更新 `current_content_json` 并追加 `personal_manual_edits`，不会覆盖 `original_content_json` 或 Journey Evidence。

`journeys_user_official_version_idx` 与 `journeys_anonymous_official_version_idx` 保证每个 owner/version
最多一个正式 Journey；Backend 会自动把后续 Attempt 关联为 replay，不能由客户端自报 `official`。

`pnpm test:database` 使用独立临时 Compose project 运行全部 migration、应用合成 seed、检查核心/outbox 表并验证 Redis 健康，结束后只删除该临时 project 的 volume。

正式升级使用：

```bash
pnpm --filter @reso/api db:migrate
```

Migration Runner 使用 PostgreSQL advisory lock 防止多个实例同时迁移，并在 `schema_migrations` 保存文件名、SHA-256 校验和和应用时间。已经应用的 Migration 如果内容被改写，Runner 会拒绝继续。

PostgreSQL 18 的数据卷必须挂载到 `/var/lib/postgresql`；旧的 `/var/lib/postgresql/data` 路径会使 PG18 容器拒绝启动。

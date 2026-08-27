# ADR-0007: Journey Evidence、Personal Manual 与 Persona Claim 边界

- Status: Accepted
- Date: 2026-08-27
- Owner: Backend / Product API

## Context

互动 Journey 完成后需要立即生成并展示《个人说明书》，但未领取的说明书不能冒充正式 Persona。
旧实现使用浏览器存储、固定等待和模型网关，无法提供可信 Evidence、事务、权限和幂等。

## Decision

1. Product API 保存原始 Answer，并通过版本化 Evidence Registry 生成可信 Evidence。
2. Journey complete 在一个 PostgreSQL 事务中冻结 Evidence Snapshot、创建 generating Manual、写
   `journey.completed` Outbox。
3. Worker 的 `persona_jobs` 通过 `IAgentClient.generatePersonalManual` 获得 Candidate；共享 Contract、
   Evidence 引用和安全措辞验证通过后才能将 Manual 标为 ready。
4. ready Manual 可直接展示；用户编辑是可选操作，原始生成内容和 Evidence 不变。
5. 点击“领取我的 Agent”本身就是用户确认。Product API 才创建不可变 Persona V1 和长期 Agent，
   并通过唯一约束与行锁保证并发幂等。
6. Agent Service 不写 Product DB；Frontend 不直连 Agent Service。

## Consequences

- 未领取 Manual 不是正式 Persona，产品语义清晰；
- 生成失败显式进入 failed/retryable，不使用固定模板伪装成功；
- 需要 Frontend 接入状态轮询和领取按钮；Agent 团队需要实现 Pydantic/OpenAPI/Prompt/Eval；
- Personal Manual 内容暂存于 `PersonaContent.identity.personalManual`，兼容现有 Persona Schema，后续若
  要提升为正式一等字段必须另做版本化 Contract/ADR。

## Alternatives rejected

- 强制草稿确认后才展示：违反已确认产品流程；
- Agent 直接创建 Persona：越过 Product API ownership；
- localStorage 作为事实源：无法保证权限、幂等和跨设备恢复；
- 生成失败回退固定报告：会把无证据模板冒充 Agent 成功结果。

## Forward / rollback

Migration 只前滚。修正使用新的 compensating migration；不删除 Evidence、编辑或 Claim 审计历史。

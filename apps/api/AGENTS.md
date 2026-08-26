# Product API Ownership

作用域：`apps/api` 与 `database`。

- API 是 Auth、User、Journey、Conversation、Persona、Relationship、Recommendation、Consent 的事实和规则拥有者。
- Agent 结果只能作为 Candidate；正式 Persona Version、Relationship 与 Consent 由 API 校验并提交。
- 所有边界先改 `@reso/contracts`，所有输入/输出运行时校验。
- Agent provider 只能通过 `IAgentClient` 切换；生产环境禁止静默退回 Mock。
- 数据库变更必须追加 migration、外键、索引、生命周期说明和测试。
- 不实现 Prompt、模型路由或 Agent 私有策略。
- 变化至少运行 API/Contracts lint、typecheck、test、build 和相关 integration test。

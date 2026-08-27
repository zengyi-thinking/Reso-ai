# Journeys boundary

本目录是 Product API 的 Journey 业务域，拥有 Attempt、原始 Answer、服务端 Evidence
Registry、Evidence Snapshot、Personal Manual Snapshot、可选用户修改和 Claim Agent 命令。

边界规则：

- 浏览器只提交稳定题目/选项 ID、可选自由回答、耗时和客户端幂等 ID；
- `evidence-registry.ts` 根据版本化定义生成可信 Evidence，浏览器结论不进入正式数据；
- `complete` 在同一事务中完成 Journey、冻结 Evidence、创建 generating Manual 并写 Outbox；
- Worker 的 `persona_jobs` 只通过 `IAgentClient` 取得 Personal Manual Candidate；
- ready Manual 可直接展示，编辑是可选项；
- 只有 Claim Agent 命令会创建正式 Persona V1 和长期 Agent；
- Agent Service 不持有 Product DB 写凭据。

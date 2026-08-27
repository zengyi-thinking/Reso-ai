# Journey → 个人说明书 → 领取 Agent 集成说明

## 用户最终流程

`完成影游 → Backend 冻结 Evidence → Worker 生成说明书 → ready 后直接展示 → 可选修改 → 领取我的 Agent → Persona V1 + 长期 Agent`

Personal Manual 的内部 Candidate/Snapshot 状态不会成为强制确认页面。用户不修改也可以领取；点击领取
本身就是确认当前版本。

## Backend 已提供

- `packages/contracts/src/journey.ts`：Attempt、Answer、Progress、Evidence、Manual、Claim 和错误 Schema；
- `apps/api/src/journeys/evidence-registry.ts`：`mountain-v1` 七组正式选择的服务端真源；
- Backend 自动判定首份 official Journey；客户端漏传 replay 字段也不会制造第二份正式 Evidence；
- Journey API：创建、保存答案、恢复、完成、匿名认领、Manual 状态/读取/重试/编辑、Claim Agent；
- PostgreSQL `0005`：答案、Evidence Snapshot、Manual 原始/当前快照、编辑历史和 Claim 关联；
- `journey.completed` 与业务完成同事务写 Outbox；
- Worker `persona_jobs` 调用 `IAgentClient.generatePersonalManual`；
- `ResoAgentClient` Remote adapter、测试夹具、Zod Schema、Evidence 引用、九变量/五章节和危险措辞校验；
- Session/匿名 token 权限、幂等 ID、行锁、唯一约束、审计与 traceId；
- Claim Agent 事务：当前 Manual 创建 Persona V1（`confirmedByUser=true`）并创建/复用长期 Agent。
- Claim 事务同时写一条幂等 `persona.created` Outbox 和审计记录，重复/并发领取不会重复发事件。

## Frontend 负责人需要完成

- 在 `apps/web/src/features/journey` 迁移影游画面、Canvas、视频和交互；
- 只向 Product API 提交稳定 ID、自由回答、耗时和客户端 UUID；
- 使用 Web Crypto 生成匿名 Journey token，安全保存于当前设备，不放 URL/日志；
- 刷新后调用 Journey GET 恢复进度，不把 localStorage 当正式事实源；
- complete 后展示 generating / failed / retryable 状态；
- ready 后直接展示个人说明书，不增加强制 edit/confirm 门；
- 主按钮为“领取我的 Agent”，另提供可选“修改说明书”；
- 不直连 Agent Service、模型或数据库。

## Agent Service 已提供

- `/v1/personal-manual/generate` Pydantic/OpenAPI 与 TypeScript Contract parity；
- 版本化 `personal_manual_generate/v1.md` Prompt，通过配置的真实 MiniMax 生成九变量、五章节；
- Provider 边界限制公开文本长度，结构、字段顺序和 Evidence 引用仍严格校验；
- timeout、unavailable、invalid schema 显式失败，不返回 provider raw response 或 Chain-of-Thought；
- 确定性 Contract/API 测试，以及 `.env` MiniMax 手动真实 smoke。

## Product / Tech Lead 仍需确认

- Frontend 的注册入口如何取得现有服务端 Session（登录 Provider 仍未批准）；
- Personal Manual 在 Persona UI 中的最终展示字段是否继续放在 `identity.personalManual`，或未来升级
  Persona Contract；
- `mountain-v1` 与后续“人生群岛” Journey 的并存和升级策略。

## 联调顺序

1. Frontend 使用共享 Contract 和本地测试夹具完成 Journey/Manual/Claim UI；
2. 启动 PostgreSQL 与 Worker，验证 `journey.completed` → 真实 Agent → ready Manual；
3. 在 Staging 跑：匿名 Journey → 注册认领 → ready 直显 → 可选编辑 → 重复/并发 Claim；
4. 检查生产失败不会回退替代模型，日志中没有自由回答、token、provider raw payload 或 Chain-of-Thought。

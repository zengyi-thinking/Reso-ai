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
- Mock/Remote adapter、Zod Schema、Evidence 引用、九变量/五章节和危险措辞校验；
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

## Agent 负责人需要完成

- 在 Agent Service 增加 `/v1/personal-manual/generate` 的 Pydantic/OpenAPI；
- 输入与 `PersonalManualGenerationRequestSchema` 对齐，输出与
  `PersonalManualCandidateSchema` 对齐；
- 根据 Evidence 生成固定顺序的九变量、五章节，并只引用请求中的 `evidenceRef`；
- Prompt 使用非诊断、可修正、证据不足时降低置信度的措辞；
- 定义 timeout、unavailable、invalid schema 行为，不返回 provider raw response 或 Chain-of-Thought；
- 增加 deterministic Eval：Evidence Fidelity、引用完整性、安全措辞、自由回答注入防护；
- Backend 不会替 Agent 团队修改 Prompt、模型路由或 Eval。

## Product / Tech Lead 仍需确认

- Frontend 的注册入口如何取得现有服务端 Session（登录 Provider 仍未批准）；
- Personal Manual 在 Persona UI 中的最终展示字段是否继续放在 `identity.personalManual`，或未来升级
  Persona Contract；
- 真实 Agent endpoint 合并后冻结 OpenAPI 与版本策略。

## 联调顺序

1. Frontend 用共享 Contract + Mock 完成 Journey/Manual/Claim UI；
2. Agent 团队实现 Pydantic/OpenAPI、Prompt、Eval；
3. Backend 用同一 golden fixture 验证 Remote adapter，生产失败不得回退 Mock；
4. 在 Staging 跑：匿名 Journey → 注册认领 → ready 直显 → 可选编辑 → 重复/并发 Claim；
5. 检查日志中没有自由回答、token、provider raw payload 或 Chain-of-Thought。

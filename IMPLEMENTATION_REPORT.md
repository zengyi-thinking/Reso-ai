# Reso.AI Backend 实施报告

> 日期：2026-08-26  
> 范围：真人聊天 Agent Assist + 建立联系后的有限轮茶话会  
> 实现位置：`D:\codex\shenicest黑客松2026.8.26\reso-ai-github版`

## 1. 实际完成内容

### Contract

- 新增 Assist 状态、分析、润色、候选回复 Contract；
- 新增 Tea Party 状态、单轮 Social Act、摘要、查询 Contract；
- 新增稳定错误码和相关事件；
- Agent 输出包含参与者、Disclosure、长度和 `traceId` 校验；
- 茶话会 Contract 将硬上限限制为 8 轮；
- Contract 当前是 v0.1 实现基线，尚无 Tech Lead 已批准的外部证据。

### Agent Client

- `IAgentClient` 新增 `analyzeIncoming`、`polishDraft`、`actSocially`、`evaluateSocial`；
- `MockAgentClient` 返回确定性结果，并可演练 timeout、unavailable、invalid_schema；
- `ResoAgentClient` 实现 HTTP timeout、Bearer 服务鉴权、状态码映射和 Zod 响应校验；
- `AGENT_PROVIDER=mock|remote|reso-agent` 可切换；生产不会静默退回 Mock。

### 数据与状态

- 新增 `0004_post_connection_tea_party.sql`，不改写 GitHub 已有 `0001`-`0003` Migration；
- 新增 Connection、真人消息、Block、Assist 请求、审计结构，并复用 GitHub 已有 `event_outbox` / `event_consumptions` / `dead_letter_events`；
- 扩展 Social Mission 和 Agent Interaction 的轮数、停止原因、摘要、Trace、可见性；
- 数据库唯一约束覆盖 Connection 对、Assist 幂等键、每 Connection 一次茶话会、每 Mission/Turn 一条记录；
- 新增 Repository 接口、内存实现及 Assist/Tea Party 状态机。
- 实现正式 `PostgresProductRepository`，覆盖 Connection、真人消息、Assist、Mission、Interaction、committed event、Session 和审计；production 禁止回退到内存 Repository。
- 新增 `ConnectionLifecycleService`，在同一数据库事务中提交 Relationship/Consent/Block 正式状态与 committed event，避免任务只靠手工写事件启动。
- Assist 完成/失败和 Tea Party started/ready/failed 的状态、Outbox 事件与脱敏 Audit 同事务提交，失败时整体回滚。
- Connection lifecycle 在事务内锁定 Connection 后再执行 mutation，避免双方并发授权互相覆盖。
- 实现 Migration Runner：advisory lock、文件顺序、SHA-256 校验和、重复执行和单文件事务。
- 主 Compose 只由 Migration Runner 执行 migration，不再与 PostgreSQL entrypoint 双重初始化。
- 修复 PostgreSQL 18 Docker 数据卷路径。

### Agent Assist 与真人聊天

- 实现分析、润色、私有结果读取接口；
- 验证 Session、Connection 参与者、建立联系状态、消息归属和 sender；
- 支持客户端幂等键、长度限制和用户级窗口限流；并发重复请求只有唯一键创建者调用 Agent，其余请求返回同一任务状态；
- Assist 结果只对请求者可见；
- 润色只返回候选，不写真人消息；
- 真人消息写入路径不依赖 Agent。

### 茶话会

- 建立联系且双方 Proxy Consent 有效后幂等创建一次 Mission；
- Worker 事件适配器处理关系建立、Consent 授予/撤销和 Block；
- 每轮重新检查 Connection、Consent 和 Block；
- 最多 6-8 轮，默认 8 轮，并受模型调用预算限制；
- 每轮按 `(mission, turn)` 幂等保存；
- wrong speaker、wrong trace、Disclosure 非 ALLOW 等非法响应不入库；
- Assist 强制校验 Agent trace 一致；茶话会只接受严格 `L2_SOCIAL + ALLOW` 的可见输出。
- 摘要可选，摘要失败不影响已有记录 ready；
- 生成 started/ready/failed Outbox 事件。
- Worker 复用 GitHub 已有 committed-event 架构，实现 `event_consumptions` 领取、`FOR UPDATE SKIP LOCKED`、锁超时恢复、指数退避和第 5 次失败写 `dead_letter_events`；实际进程测试完成 8 轮并保存 8 条记录。
- 茶话会执行使用跨进程 PostgreSQL advisory lock，Outbox ACK/retry 使用 `attempt_count` fencing，防止重复 Agent 调用和过期 Worker 覆盖新租约。

### 查询与通知

- 实现 `GET /api/connections/{id}/tea-party`；
- 实现受控 `POST /api/connections/{id}/tea-party/retry`；
- 返回 not_available、permission_required、queued、running、ready、failed、blocked 等状态；
- ready 记录严格按 `turnNo` 排序，并按查看者生成 my_agent/their_agent 标签；
- 第三方不能读取；
- Block 后按 fail-closed 返回状态但隐藏历史正文；
- 实现参与者可见的通知轮询接口，底层事件保存在 Outbox。
- 实现 SSE `/api/notifications/stream`，仅推送状态、ID 和 Trace，不推送茶话会正文。

### 生产鉴权、限流和可观测性

- 实现不可预测 Session Token、数据库只存 SHA-256 哈希、过期校验和撤销；
- 实现 PostgreSQL 共享限流，避免多实例各自计数；
- 在请求入口只生成一次 `traceId`，写入响应头、API、数据库、Worker 和 Agent 调用；
- Assist、真人消息、Mission 事件写入脱敏审计日志；
- production 配置为内存 Repository 或 Demo Session 时拒绝启动。

## 2. 主要修改文件

- `packages/contracts/src/assist.ts`
- `packages/contracts/src/tea-party.ts`
- `packages/contracts/src/errors.ts`
- `packages/contracts/src/events.ts`
- `apps/api/src/agent-client/*`
- `apps/api/src/product/*`
- `apps/api/src/app.ts`
- `apps/api/src/server.ts`
- `apps/worker/src/social_jobs/handler.ts`
- `database/migrations/0004_post_connection_tea_party.sql`
- `apps/api/tests/*.test.ts`
- `apps/worker/tests/social-handler.test.ts`
- `packages/contracts/tests/contracts.test.ts`
- `.env.example`
- `TESTING_GUIDE.md`
- `IMPLEMENTATION_REPORT.md`

## 3. 实际运行测试

最终业务测试命令：

```powershell
corepack pnpm --filter @reso/contracts test
corepack pnpm --filter @reso/api test
corepack pnpm --filter @reso/worker test
```

最终结果：

- Contracts：11 passed，0 failed；
- API：51 passed，0 failed（包含 8 个真实 PostgreSQL 集成测试）；
- Worker：5 passed，0 failed；
- 合计：67 passed，0 failed。

阶段中出现并修复的失败：

- 首次使用 Codex 自带 pnpm 时被 minimum release age 策略阻止；最终严格复用仓库锁文件和本地 store，并只允许 `esbuild` 官方安装脚本，依赖安装退出码为 0；
- Phase 2 SQL 结构测试首次 1 失败，因为只读取新 Migration、漏读旧 Migration 中已有的 turn 唯一约束；修正为检查完整 Migration 链；
- Phase 3 首次 4 失败，因为测试变量名写错，应用尚未进入业务逻辑；修复后 4/4 通过；
- PostgreSQL 第一次真执行因 Docker Desktop Linux 引擎未启动而失败；恢复后又发现 PG18 卷路径不兼容并完成修复，最终 Migration、Repository、Session、Worker 和重试测试通过。
- Worker 种子第一次因 PowerShell/psql JSON 转义失败，改用 `jsonb_build_object` 后成功；没有留下错误业务数据。
- 拉取后发现本地新增 Migration 与 GitHub 的 `0003_event_outbox.sql` 重号且另建 `outbox_events`；已顺延为 `0004` 并删除双 Outbox 方案，最终数据库集成测试全部通过。

最终质量门禁：

- Contracts/API/Worker lint：全部通过；
- Contracts/Config/API/Worker typecheck：全部通过；
- Contracts/Config/Test Fixtures/API/Worker build：全部通过；
- Web、Agent Lab、UI、Design Tokens、Test Fixtures 的 lint/typecheck/test/build 回归全部通过；
- Python Agent：Ruff format/lint、mypy 全部通过，pytest 30 passed，eval smoke 2 passed；
- 全仓 `format:check` 仍受既有非本任务文件影响；本次 Backend、Worker、Contract 和相关文档变更已单独通过 Prettier 检查，没有跨域格式化 Frontend、Agent 或 Agent Lab；
- 构建后首次全量测试曾因 API 测试脚本同时扫描 `tests` 与 `dist/tests` 出现 54 passed / 2 failed；将脚本限定为源码 `tests` 后解决。

实际启动 Smoke Test：

- development Mock：health 200、Assist 200、trace 一致、Tea Party ready/8 轮、第三方 403；
- development unavailable：Assist 503 `AGENT_UNAVAILABLE`，真人消息接口仍返回 201。
- production-like PostgreSQL：API 启动成功、数据库 Session 鉴权成功、Assist 200 且状态真实保存为 completed；
- Worker 进程：通过 GitHub 的 `event_outbox` 消费 `relationship.updated → social_mission.created → ready`，最终状态证据为 `ready|8 turns|8 interactions|acked`；
- Migration Runner：空库第一次依次应用 `0001`-`0004`，第二次 4 个 Migration 全部识别为已应用并校验 SHA-256。

## 4. Mock 与真实依赖

当前使用 Mock：

- 自动测试和 development 演示使用 `MockAgentClient`；
- development 使用内存 Repository、合成 Connection、合成消息和 Demo Session；
- Remote Client 使用假的 HTTP Response 做契约/异常测试，没有连接真实 Agent。

仍依赖其他团队：

- Tech Lead/Product 最终批准 Contract；
- Product 确认 Proxy Consent 是否独立，以及 Block/撤销后的历史可见性；
- Agent 团队提供真实 `/v1/turn`、`/v1/social/act`、`/v1/social/evaluate` 地址、Token 和字段 parity；
- Frontend 接入 Assist、茶话会查询、通知，并实现抽屉、手势和 UI；
- 团队正式登录/注册入口调用 Backend Session Service，或提供已批准的外部身份 Provider；
- Staging 真实 Agent、Frontend 和端到端 E2E。

## 5. 已知限制和风险

- 真实 Agent 尚未联调，Remote Client 只通过隔离 Contract 测试；
- 当前 Agent Service 的 Python 路径/字段仍与新版 Backend Contract 不一致，即使提供地址也不能直接联调；
- development Demo Session 是合成测试能力，不能用于生产；
- Backend 已实现生产 Session 创建/解析/撤销原语，但用户注册、密码、验证码或第三方 OAuth 方案未由 Product/Tech Lead 确定，因此没有擅自实现登录页面或某一身份供应商；
- 手动 retry 只允许 failed Mission，成功或运行中状态返回 `RETRY_NOT_ALLOWED`；
- Contract 尚待 Tech Lead 最终确认，因此不能宣称跨团队冻结完成；
- Block/Consent 撤销后的已完成历史产品规则未定，当前采用隐藏正文的安全默认；
- PostgreSQL Outbox 是 V0.1 的持久化 Queue；Redis 尚未用于本功能任务调度，这是有意的最小架构选择；
- 未实现任何 Agent Runtime、Prompt、模型路由、Memory、Reflection、Policy、Eval、前端 UI 或自动代发真人消息。

## 6. 对原计划的完成度结论

| Phase                        | 结论                     | 可验证证据 / 剩余条件                                                                                                                     |
| ---------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0 Contract Baseline    | 部分完成                 | Zod Contract、错误码、事件和测试已实现；尚缺 Tech Lead/Product/Agent/Frontend 的正式批准，不能宣称跨团队冻结。                            |
| Phase 1 Agent Client 与 Mock | 本地完成                 | Mock 确定性与三种失败模式、Remote timeout/auth/schema/error mapping 均有测试；无模型 Key 可运行。                                         |
| Phase 2 数据库与状态机       | 完成                     | `0004`、唯一约束、状态机、事务性 committed event、Migration Runner 与 PostgreSQL 集成测试通过。                                           |
| Phase 3 Agent Assist         | 完成                     | 分析、润色、私有读取、权限、并发幂等、限流、Agent 故障不阻断真人聊天均有测试。                                                            |
| Phase 4 茶话会编排           | Mock/Backend 完成        | 关系/Consent/Block committed event、Worker、6-8 轮上限、预算、幂等、停止条件、非法输出拒绝和摘要降级均已验证。                            |
| Phase 5 查询与通知           | 完成                     | GET/retry、状态矩阵、第三方拒绝、排序、SSE 和 fail-closed 历史隐藏均有测试。                                                              |
| Phase 6 真实 Agent 联调      | 未完成（外部依赖）       | 仍需 Agent 团队提供与共享 Contract 一致的 Staging API、Token 和重试计费语义；当前只验证 Remote adapter。                                  |
| Phase 7 发布前验证           | 本地完成，Staging 未完成 | 后端 67 tests、相关质量门禁、全仓 TS/Python 回归、Migration 和 Worker 进程 smoke 已通过；真实 Agent、Frontend、Staging E2E 仍待三线联调。 |

因此，本次 Backend 在 `AGENT_PROVIDER=mock` 和本地 PostgreSQL 范围内已达到可提交、可联调状态；原计划的完整发布态尚不能宣称完成，剩余工作集中在跨团队 Contract 批准、真实 Agent parity 与 Staging E2E，不应由 Backend 单方面伪造完成。

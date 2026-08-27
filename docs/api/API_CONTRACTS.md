# API Contracts

`packages/contracts` 是 TypeScript/HTTP/Event 的真源，使用 Zod 同时完成运行时校验和类型推导。Python Pydantic models 必须与其保持 parity；当前 AgentTurn 已由同一组 valid/invalid golden fixture 跨 Zod 与 Pydantic 验证，更广泛的 OpenAPI/JSON Schema 生成留给 Stage 1。

## Error envelope

内部/旧版路由错误使用 `{ error: { code, message, requestId?, details? } }`。本页 v0.1 业务路由使用 `ProductErrorResponseSchema`：`{ code, message, traceId, retryable }`。`code` 是稳定的机器可读标识；生产错误不得泄露内部堆栈或 provider raw payload。跨版本统一错误 envelope 属于后续 breaking contract 工作，不在 v0.1 中静默改语义。

## Agent 内部接口

| Method | Path                           | Contract                                                    |
| ------ | ------------------------------ | ----------------------------------------------------------- |
| GET    | `/v1/health`                   | service/status                                              |
| POST   | `/v1/agent/turn`               | `AgentTurnRequest → AgentTurnResponse`                      |
| POST   | `/v1/agent/reflect`            | `AgentReflectionRequest → AgentReflectionResponse`          |
| POST   | `/v1/persona/initialize`       | `PersonaInitializeRequest → PersonaVersion Draft`           |
| POST   | `/v1/persona/suggest-patch`    | reflection input → candidates                               |
| POST   | `/v1/social/act`               | `SocialMission → SocialMissionResult`                       |
| POST   | `/v1/social/evaluate`          | mission result → evaluated result                           |
| POST   | `/v1/personal-manual/generate` | `PersonalManualGenerationRequest → PersonalManualCandidate` |
| POST   | `/v1/assist/analyze`           | `AnalyzeIncomingRequest → AnalyzeIncomingResponse`          |
| POST   | `/v1/assist/polish`            | `PolishDraftRequest → PolishDraftResponse`                  |
| POST   | `/v1/tea-party/act`            | `SocialActRequest → SocialActResponse`                      |
| POST   | `/v1/tea-party/evaluate`       | `SocialEvaluateRequest → SocialEvaluateResponse`            |

模型名、provider、prompt 版本和原始 model call 都是 Agent 内部细节，禁止出现在 URL。

## Provider adapter

`IAgentClient` 同时定义基础 Agent、Personal Manual、Assist 与 Tea Party 能力。Product API 只装配 `ResoAgentClient`；确定性实现只允许存在于测试夹具。所有远端成功响应再次通过 Zod parse，失败响应通过共享 error envelope parse。真实 provider 失败直接报错，不存在替代模型降级路径。旧 `/v1/social/*` 与 Tea Party v1 使用不同契约，后者固定使用 `/v1/tea-party/*`，禁止在同一路由复用不兼容 Schema。

## EventEnvelope

统一字段：`id`、`type`、`version`、`occurredAt`、`producer`、`correlationId`、`causationId`、`subjectId`、`payload`。消费者必须幂等；新增 breaking payload 时升级 event version。

## 真人聊天 Assist 与联系后茶话会（v0.1 baseline）

| Method | Path                                    | 用途                               |
| ------ | --------------------------------------- | ---------------------------------- |
| POST   | `/api/connections/{id}/assist/analyze`  | 私有分析一条对方消息               |
| POST   | `/api/connections/{id}/assist/polish`   | 返回草稿候选，不自动发送           |
| GET    | `/api/assist/{id}`                      | 请求者读取自己的 Assist 结果       |
| GET    | `/api/connections/{id}/tea-party`       | 参与者读取状态和有序记录           |
| POST   | `/api/connections/{id}/tea-party/retry` | 仅重试允许的 failed Mission        |
| GET    | `/api/notifications`                    | 轮询参与者可见的 ready/failed 事件 |
| GET    | `/api/notifications/stream`             | SSE 推送状态与 ID，不推送正文      |
| DELETE | `/api/session`                          | 撤销当前不透明 Session Token       |

对应共享 Schema 位于 `assist.ts`、`tea-party.ts` 和 `errors.ts`。所有业务 API 必须从服务端 Session 解析用户；不得接受 body/query 中的可信 `userId`。

Backend 到 Agent 的 v0.1 能力为 `analyzeIncoming`、`polishDraft`、`actSocially` 和 `evaluateSocial`。单轮输出必须通过共享 Schema、speaker、trace、长度和 Disclosure 检查后才能保存。当前 Contract 是实现基线，仍待 Tech Lead/Product/Agent/Frontend 最终批准。

生产 Session 使用不可预测的 Bearer Token，数据库只保存 SHA-256 哈希；API 不接受 body/query 中的可信 `userId`。每次请求在 `onRequest` 生成或接受一个合法 UUID `traceId`，同时写入响应头、业务记录、Outbox、Worker 和 Agent 调用。

## Journey 与个人说明书（v1）

| Method | Path                                        | Contract / 用途                                                        |
| ------ | ------------------------------------------- | ---------------------------------------------------------------------- |
| POST   | `/api/journeys`                             | `CreateJourneyRequest → CreateJourneyResponse`，创建或幂等恢复 Attempt |
| GET    | `/api/journeys/{id}`                        | `JourneyProgress`，恢复答案和下一题                                    |
| POST   | `/api/journeys/{id}/answers`                | `JourneyAnswerInput → JourneyAnswer`，服务端生成 Evidence              |
| POST   | `/api/journeys/{id}/complete`               | 原子完成 Journey、Evidence Snapshot、generating Manual、Outbox         |
| POST   | `/api/journeys/{id}/claim-ownership`        | 登录后认领匿名 Journey                                                 |
| GET    | `/api/journeys/{id}/personal-manual/status` | 查询 generating / ready / failed / claimed                             |
| GET    | `/api/journeys/{id}/personal-manual`        | ready 后直接读取，不要求先编辑或确认                                   |
| POST   | `/api/journeys/{id}/personal-manual/retry`  | 仅重试 retryable failure                                               |
| PATCH  | `/api/journeys/{id}/personal-manual`        | 可选用户修改，保留 Agent 原始快照                                      |
| POST   | `/api/journeys/{id}/claim-agent`            | 当前 Manual → 正式 Persona V1 + 长期 Agent                             |

Claim Agent 成功时，Persona V1、Agent 关联、`persona.created` Outbox 与审计在同一 Product DB
事务提交；重复或并发请求返回同一结果，不重复创建或发事件。

`JourneyAnswerInputSchema` 是 strict Schema，只允许 `stageId`、`questionId`、`choiceId`、
可选 `responseText`、`elapsedMs` 和 `clientAnswerId`。`summary`、`signals`、`target`、
`confidence`、`official` 或 Persona 结论会被拒绝。

匿名 Journey 使用 32 字节以上的 Web Crypto 随机 token；客户端在创建请求中提交，后续放在
`x-journey-token`。Product DB 只保存 SHA-256。登录用户身份只来自服务端 Session，不接受 body/query
里的 `userId`。

`replayOfJourneyId` 只是客户端可提供的关联提示，不是 `official` 的决定来源。Backend 会按
owner + `journeyVersion` 自动查找首个正式 Attempt；即使客户端遗漏 replay 字段，后续 Attempt 也会被
标记为 replay。数据库部分唯一索引保证并发创建时仍只有一份 `official=true`。

# API Contracts

`packages/contracts` 是 TypeScript/HTTP/Event 的真源，使用 Zod 同时完成运行时校验和类型推导。Python Pydantic models 必须与其保持 parity；当前 AgentTurn 已由同一组 valid/invalid golden fixture 跨 Zod 与 Pydantic 验证，更广泛的 OpenAPI/JSON Schema 生成留给 Stage 1。

## Error envelope

内部/旧版路由错误使用 `{ error: { code, message, requestId?, details? } }`。本页 v0.1 业务路由使用 `ProductErrorResponseSchema`：`{ code, message, traceId, retryable }`。`code` 是稳定的机器可读标识；生产错误不得泄露内部堆栈或 provider raw payload。跨版本统一错误 envelope 属于后续 breaking contract 工作，不在 v0.1 中静默改语义。

## Agent 内部接口

| Method | Path                        | Contract                                           |
| ------ | --------------------------- | -------------------------------------------------- |
| GET    | `/v1/health`                | service/status                                     |
| POST   | `/v1/agent/turn`            | `AgentTurnRequest → AgentTurnResponse`             |
| POST   | `/v1/agent/reflect`         | `AgentReflectionRequest → AgentReflectionResponse` |
| POST   | `/v1/persona/initialize`    | `PersonaInitializeRequest → PersonaVersion Draft`  |
| POST   | `/v1/persona/suggest-patch` | reflection input → candidates                      |
| POST   | `/v1/social/act`            | `SocialMission → SocialMissionResult`              |
| POST   | `/v1/social/evaluate`       | mission result → evaluated result                  |

模型名、provider、prompt 版本和原始 model call 都是 Agent 内部细节，禁止出现在 URL。

## Provider adapter

`IAgentClient` 定义 `turn`、`reflect`、`initializePersona`、`suggestPersonaPatch`、`runSocialAction`、`evaluateSocialInteraction`。Product API 只装配 `ResoAgentClient`；所有远端成功响应再次通过 Zod parse，失败响应通过共享 error envelope parse。真实 provider 失败直接报错，不存在 Mock 降级路径。

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

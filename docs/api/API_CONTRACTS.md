# API Contracts

`packages/contracts` 是 TypeScript/HTTP/Event 的真源，使用 Zod 同时完成运行时校验和类型推导。Python Pydantic models 必须与其保持 parity；当前 AgentTurn 已由同一组 valid/invalid golden fixture 跨 Zod 与 Pydantic 验证，更广泛的 OpenAPI/JSON Schema 生成留给 Stage 1。

## Error envelope

HTTP 错误统一为 `{ error: { code, message, requestId?, details? } }`。`code` 是稳定的机器可读标识，`details` 只用于安全的字段校验信息。Product API 对未知路由、无效输入、provider 失败和未处理异常都不返回 undocumented shape；生产错误不得泄露内部堆栈或 provider raw payload。

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

# API Contracts

`packages/contracts` 是 TypeScript/HTTP/Event 的真源，使用 Zod 同时完成运行时校验和类型推导。Python Pydantic models 必须与其保持 parity，Stage 1 将增加 OpenAPI/JSON Schema golden test。

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

`IAgentClient` 定义 `turn`、`reflect`、`initializePersona`、`suggestPersonaPatch`、`runSocialAction`、`evaluateSocialInteraction`。`MockAgentClient` 和 `ResoAgentClient` 必须返回相同 Contract；所有远端响应再次通过 Zod parse。

## EventEnvelope

统一字段：`id`、`type`、`version`、`occurredAt`、`producer`、`correlationId`、`causationId`、`subjectId`、`payload`。消费者必须幂等；新增 breaking payload 时升级 event version。
